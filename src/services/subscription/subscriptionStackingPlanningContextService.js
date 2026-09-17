"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const {
  buildEntitlementSlotBlueprint,
  preserveExistingSelectionsForBlueprint,
} = require("./subscriptionEntitlementSlotBlueprintService");
const {
  assertTransactionalSession,
  materializeEntitlementDayBlueprint,
} = require("./subscriptionEntitlementLedgerService");
const {
  normalizeDateString,
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");

function planningError(code, message, status = 422, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function clonePlain(value) {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return JSON.parse(JSON.stringify(value));
}

function normalizeSlotKey(slot = {}) {
  const explicit = String(slot.slotKey || "").trim();
  if (explicit) return explicit;
  const slotIndex = Number(slot.slotIndex || 0);
  return Number.isInteger(slotIndex) && slotIndex > 0 ? `slot_${slotIndex}` : "";
}

function filterBatchesVisibleAsOf(batches, businessDate) {
  const currentDate = normalizeDateString(businessDate);
  return (Array.isArray(batches) ? batches : []).filter((batch) => {
    if (!batch) return false;
    if (String(batch.status || "") !== "paid_scheduled") return true;
    const startDate = normalizeDateString(batch.effectiveStartDate);
    return Boolean(currentDate && startDate && startDate <= currentDate);
  });
}

function assertIncomingSlotsWithinBlueprint({ blueprint, mealSlots = [] } = {}) {
  const allowedKeys = new Set(
    (blueprint && Array.isArray(blueprint.slots) ? blueprint.slots : [])
      .map((slot) => String(slot.slotKey || ""))
      .filter(Boolean)
  );
  const seen = new Set();

  for (const slot of Array.isArray(mealSlots) ? mealSlots : []) {
    const slotKey = normalizeSlotKey(slot);
    if (!slotKey || !allowedKeys.has(slotKey)) {
      throw planningError(
        "STACKING_SLOT_OUTSIDE_ENTITLEMENT",
        "Meal slot is outside the entitlement blueprint",
        422,
        {
          slotKey: slotKey || null,
          requiredSlotCount: Number(blueprint && blueprint.requiredSlotCount || 0),
        }
      );
    }
    if (seen.has(slotKey)) {
      throw planningError(
        "STACKING_DUPLICATE_SLOT",
        "Meal slots must be unique",
        422,
        { slotKey }
      );
    }
    seen.add(slotKey);
  }
}

function buildStackingPlanningSubscriptionView({ subscription, projection, blueprint } = {}) {
  if (!subscription || !projection || !blueprint) {
    throw planningError(
      "STACKING_PLANNING_CONTEXT_REQUIRED",
      "Subscription, projection, and blueprint are required"
    );
  }
  const base = clonePlain(subscription);
  const firstGrams = blueprint.slots && blueprint.slots[0]
    ? Number(blueprint.slots[0].proteinGrams || 0)
    : Number(base.selectedGrams || 0);

  return {
    ...base,
    totalMeals: Number(projection.mealBalance.totalMeals || 0),
    remainingMeals: Number(projection.mealBalance.remainingMeals || 0),
    reservedMeals: Number(projection.mealBalance.reservedMeals || 0),
    consumedMeals: Number(projection.mealBalance.consumedMeals || 0),
    forfeitedMeals: Number(projection.mealBalance.forfeitedMeals || 0),
    selectedMealsPerDay: Number(projection.requiredMealsPerDay || 0),
    // Compatibility fallback only. Per-slot grams remain authoritative in the blueprint.
    selectedGrams: firstGrams || Number(base.selectedGrams || 0),
    stackingPlanningContext: {
      version: "subscription_stacking.v1",
      date: blueprint.businessDate,
      requiredSlotCount: blueprint.requiredSlotCount,
      batchIds: projection.batchIds,
      mixedProteinGrams: projection.hasMixedProteinGrams,
      grams: projection.grams,
    },
  };
}

function defaultRuntime() {
  return {
    async findBatches({ containerSubscriptionId, session = null }) {
      let query = SubscriptionEntitlementBatch.find({
        containerSubscriptionId,
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 });
      if (session) query = query.session(session);
      return query.lean();
    },
    materializeBlueprint: (args) => materializeEntitlementDayBlueprint(args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function resolveStackingPlanningContext({
  userId,
  subscription,
  date,
  businessDate,
  existingMealSlots = [],
  incomingMealSlots = [],
  materialize = false,
  session = null,
  runtime: runtimeOverrides = null,
} = {}) {
  if (!subscription || !subscription._id) {
    throw planningError(
      "STACKING_CONTAINER_REQUIRED",
      "Subscription container is required",
      404
    );
  }
  if (userId && String(subscription.userId || "") !== String(userId)) {
    throw planningError("FORBIDDEN", "Subscription does not belong to the user", 403);
  }
  const targetDate = normalizeDateString(date);
  const currentDate = normalizeDateString(businessDate);
  if (!targetDate || !currentDate) {
    throw planningError(
      "INVALID_STACKING_PLANNING_DATE",
      "date and businessDate must use YYYY-MM-DD",
      400
    );
  }

  const runtime = resolveRuntime(runtimeOverrides);
  const allBatches = await runtime.findBatches({
    containerSubscriptionId: subscription._id,
    session,
  });
  const visibleBatches = filterBatchesVisibleAsOf(allBatches, currentDate);
  const projection = projectSubscriptionEntitlements({
    batches: visibleBatches,
    businessDate: targetDate,
    historicalLifecycle: false,
  });
  if (projection.batchCount === 0 || projection.requiredMealsPerDay < 1) {
    throw planningError(
      "STACKING_NO_ENTITLEMENT_FOR_DATE",
      "No active subscription entitlement is available for this date",
      422,
      { date: targetDate, businessDate: currentDate }
    );
  }
  if (projection.hasFulfillmentConflict) {
    throw planningError(
      "STACKING_FULFILLMENT_CONFLICT",
      "Overlapping batches have incompatible fulfillment profiles",
      409,
      {
        date: targetDate,
        fulfillmentProfiles: projection.fulfillmentProfiles,
      }
    );
  }

  const contributingBatchIds = new Set(projection.batchIds);
  const contributingBatches = visibleBatches.filter((batch) => (
    contributingBatchIds.has(String(batch._id || ""))
  ));
  const blueprint = buildEntitlementSlotBlueprint({
    batches: contributingBatches,
    businessDate: targetDate,
  });
  assertIncomingSlotsWithinBlueprint({
    blueprint,
    mealSlots: incomingMealSlots,
  });

  const mergedMealSlots = preserveExistingSelectionsForBlueprint({
    blueprint,
    existingMealSlots,
  });
  const incomingByKey = new Map(
    (Array.isArray(incomingMealSlots) ? incomingMealSlots : [])
      .map((slot) => [normalizeSlotKey(slot), slot])
      .filter(([slotKey]) => Boolean(slotKey))
  );
  const plannedMealSlots = mergedMealSlots.map((slot) => {
    const incoming = incomingByKey.get(String(slot.slotKey || ""));
    return incoming
      ? {
        ...clonePlain(incoming),
        slotIndex: slot.slotIndex,
        slotKey: slot.slotKey,
      }
      : slot;
  });

  let persistedBlueprint = null;
  if (materialize) {
    try {
      assertTransactionalSession(session);
    } catch (_err) {
      throw planningError(
        "STACKING_PLANNING_TRANSACTION_REQUIRED",
        "Blueprint materialization requires an active transaction",
        503
      );
    }
    const materialized = await runtime.materializeBlueprint({
      userId: subscription.userId,
      containerSubscriptionId: subscription._id,
      date: targetDate,
      batches: contributingBatches,
      session,
    });
    persistedBlueprint = materialized.blueprint;
  }

  const subscriptionView = buildStackingPlanningSubscriptionView({
    subscription,
    projection,
    blueprint,
  });

  return {
    date: targetDate,
    businessDate: currentDate,
    allBatches,
    visibleBatches,
    contributingBatches,
    projection,
    blueprint: persistedBlueprint || blueprint,
    subscriptionView,
    plannedMealSlots,
  };
}

module.exports = {
  assertIncomingSlotsWithinBlueprint,
  buildStackingPlanningSubscriptionView,
  filterBatchesVisibleAsOf,
  normalizeSlotKey,
  resolveStackingPlanningContext,
};
