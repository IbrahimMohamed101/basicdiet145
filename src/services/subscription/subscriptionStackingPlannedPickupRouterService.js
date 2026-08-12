"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementAllocation = require("../../models/SubscriptionEntitlementAllocation");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../../utils/featureFlags");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  assertTransactionalSession,
} = require("./subscriptionEntitlementLedgerService");

function pickupError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeKeys(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

function resolveRequestedMealCount(args = {}) {
  const candidates = [
    args.mealCount,
    args.quantity,
    args.count,
    args.requestedMealCount,
    args.requestedMeals,
    args.pickupRequest && args.pickupRequest.mealCount,
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function resolvePickupDate(args = {}) {
  const candidates = [
    args.date,
    args.pickupDate,
    args.day && args.day.date,
    args.pickupRequest && args.pickupRequest.date,
  ];
  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  }
  return "";
}

function normalizeSlotKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^\d+$/.test(normalized)) return `slot_${Number(normalized)}`;
  return normalized;
}

function collectExplicitPickupSlotKeys(pickupRequest = {}) {
  const selectionMode = String(pickupRequest.selectionMode || "legacy_meal_count");
  if (selectionMode === "legacy_meal_count") return [];

  const keys = [];
  const add = (value) => {
    const key = normalizeSlotKey(value);
    if (key) keys.push(key);
  };

  for (const value of Array.isArray(pickupRequest.selectedMealSlotIds)
    ? pickupRequest.selectedMealSlotIds
    : []) {
    add(value);
  }

  for (const item of Array.isArray(pickupRequest.selectedPickupItems)
    ? pickupRequest.selectedPickupItems
    : []) {
    if (!item || typeof item !== "object") continue;
    add(item.slotKey);
    add(item.slotId);
    if (String(item.source || "") === "mealSlot") add(item.sourceId);
  }

  const snapshotSlots = pickupRequest.snapshot
    && Array.isArray(pickupRequest.snapshot.mealSlots)
    ? pickupRequest.snapshot.mealSlots
    : [];
  for (const slot of snapshotSlots) {
    if (!slot || typeof slot !== "object") continue;
    add(slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : ""));
  }

  return normalizeKeys(keys);
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingWriteEnabled(),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    findBatchOwner(subscriptionId, session = null) {
      let query = SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      }).select("userId containerSubscriptionId").lean();
      if (session) query = query.session(session);
      return query;
    },
    findConfirmedDay({ subscriptionId, dayId, date, session }) {
      const filter = {
        _id: dayId,
        subscriptionId,
        date,
        $or: [
          { plannerState: "confirmed" },
          { planningState: "confirmed" },
        ],
      };
      return SubscriptionDay.findOne(filter).session(session).lean();
    },
    findAllocations({ subscriptionId, userId, pickupRequestId, dayId, date, session }) {
      return SubscriptionEntitlementAllocation.find({
        containerSubscriptionId: subscriptionId,
        userId,
        subscriptionDayId: dayId,
        date,
        state: "reserved",
        $or: [
          { pickupRequestId: null },
          { pickupRequestId },
        ],
      }).sort({ slotKey: 1, _id: 1 }).session(session).lean();
    },
    claimAllocation({ allocationId, subscriptionId, userId, pickupRequestId, dayId, date, session }) {
      return SubscriptionEntitlementAllocation.findOneAndUpdate(
        {
          _id: allocationId,
          containerSubscriptionId: subscriptionId,
          userId,
          subscriptionDayId: dayId,
          date,
          state: "reserved",
          pickupRequestId: null,
        },
        { $set: { pickupRequestId } },
        { new: true, session }
      ).lean();
    },
    findAllocationById({ allocationId, session }) {
      return SubscriptionEntitlementAllocation.findById(allocationId)
        .session(session)
        .lean();
    },
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function resolvePlannedPickupRoute({ subscriptionId, session, runtime }) {
  const batch = await runtime.findBatchOwner(subscriptionId, session);
  if (!batch) {
    return { enabled: false, reason: "subscription_not_stacked", ownerId: "" };
  }

  const ownerId = String(batch.userId || "");
  if (!runtime.globallyEnabled()) {
    throw pickupError(
      "STACKING_PICKUP_WRITE_DISABLED",
      "Pickup writes are disabled for this combined subscription",
      503,
      { subscriptionId: String(subscriptionId || "") }
    );
  }
  if (!ownerId || !runtime.writeEnabledForUser(ownerId)) {
    throw pickupError(
      "STACKING_PICKUP_WRITE_DISABLED",
      "Pickup writes are not enabled for this combined subscription",
      503,
      { subscriptionId: String(subscriptionId || "") }
    );
  }

  return {
    enabled: true,
    reason: "planned_pickup_supported",
    ownerId,
    containerSubscriptionId: String(batch.containerSubscriptionId || subscriptionId || ""),
  };
}

function assertPickupIdentity({ route, subscriptionId, pickupRequest }) {
  if (!pickupRequest || !pickupRequest._id) {
    throw pickupError("STACKING_PICKUP_REQUEST_REQUIRED", "Pickup request is required", 400);
  }
  if (String(pickupRequest.subscriptionId || "") !== String(subscriptionId || "")) {
    throw pickupError(
      "STACKING_PICKUP_SUBSCRIPTION_MISMATCH",
      "Pickup request does not belong to the combined subscription",
      409
    );
  }
  if (String(pickupRequest.userId || "") !== String(route.ownerId || "")) {
    throw pickupError(
      "STACKING_PICKUP_OWNER_MISMATCH",
      "Pickup request owner does not match the combined subscription owner",
      403
    );
  }
  const dayId = pickupRequest.subscriptionDayId;
  const date = resolvePickupDate({ pickupRequest });
  const mealCount = resolveRequestedMealCount({ pickupRequest });
  if (!dayId || !date || mealCount < 1) {
    throw pickupError(
      "STACKING_PICKUP_REQUIRES_CONFIRMED_DAY",
      "Combined-package pickup requires a confirmed planned day",
      422,
      { hasDayId: Boolean(dayId), date: date || null, mealCount }
    );
  }
  return { dayId, date, mealCount };
}

function choosePickupAllocations({ allocations, pickupRequest, mealCount }) {
  const rows = Array.isArray(allocations) ? allocations : [];
  const pickupRequestId = String(pickupRequest._id || "");
  const explicitKeys = collectExplicitPickupSlotKeys(pickupRequest);
  const rowBySlotKey = new Map(rows.map((row) => [normalizeSlotKey(row.slotKey), row]));

  let selected;
  if (explicitKeys.length > 0) {
    selected = explicitKeys.map((key) => rowBySlotKey.get(key)).filter(Boolean);
    if (selected.length !== explicitKeys.length) {
      throw pickupError(
        "STACKING_PICKUP_ALLOCATION_SET_INCOMPLETE",
        "One or more selected pickup slots are unavailable",
        409,
        {
          expectedCount: explicitKeys.length,
          actualCount: selected.length,
          missingSlotKeys: explicitKeys.filter((key) => !rowBySlotKey.has(key)),
        }
      );
    }
    if (selected.length !== mealCount) {
      throw pickupError(
        "STACKING_PICKUP_ALLOCATION_COUNT_MISMATCH",
        "Selected pickup slots must match the pickup meal count",
        409,
        { mealCount, selectedSlotCount: selected.length }
      );
    }
  } else {
    const alreadyClaimed = rows.filter(
      (row) => String(row.pickupRequestId || "") === pickupRequestId
    );
    const available = rows.filter((row) => !row.pickupRequestId);
    selected = [...alreadyClaimed, ...available].slice(0, mealCount);
    if (selected.length !== mealCount) {
      throw pickupError(
        "STACKING_PICKUP_ALLOCATION_COUNT_MISMATCH",
        "Not enough confirmed day allocations are available for pickup",
        409,
        { mealCount, allocationCount: selected.length }
      );
    }
  }

  const wrongOwner = selected.find((row) => String(row.userId || "") !== String(pickupRequest.userId || ""));
  if (wrongOwner) {
    throw pickupError("STACKING_PICKUP_OWNER_MISMATCH", "Pickup allocation owner mismatch", 403);
  }
  const wrongDay = selected.find((row) => (
    String(row.subscriptionDayId || "") !== String(pickupRequest.subscriptionDayId || "")
      || String(row.date || "") !== String(pickupRequest.date || "")
  ));
  if (wrongDay) {
    throw pickupError(
      "STACKING_PICKUP_DATE_MISMATCH",
      "Pickup allocation belongs to a different subscription day",
      409
    );
  }

  return selected;
}

async function reservePlannedStackingPickupEntitlements({
  subscriptionId,
  pickupRequest,
  session,
  runtime: runtimeOverrides = null,
} = {}) {
  const runtime = resolveRuntime(runtimeOverrides);
  const route = await resolvePlannedPickupRoute({ subscriptionId, session, runtime });
  if (!route.enabled) return { handled: false, reservation: null };

  try {
    assertTransactionalSession(session);
  } catch (_err) {
    throw pickupError(
      "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED",
      "Combined-package pickup requires an active MongoDB transaction",
      503
    );
  }

  const identity = assertPickupIdentity({ route, subscriptionId, pickupRequest });
  const day = await runtime.findConfirmedDay({
    subscriptionId,
    dayId: identity.dayId,
    date: identity.date,
    session,
  });
  if (!day) {
    throw pickupError(
      "STACKING_PICKUP_REQUIRES_CONFIRMED_DAY",
      "Combined-package pickup requires a confirmed planned day",
      422,
      { subscriptionDayId: String(identity.dayId), date: identity.date }
    );
  }

  const allocations = await runtime.findAllocations({
    subscriptionId,
    userId: route.ownerId,
    pickupRequestId: pickupRequest._id,
    dayId: identity.dayId,
    date: identity.date,
    session,
  });
  const selected = choosePickupAllocations({
    allocations,
    pickupRequest,
    mealCount: identity.mealCount,
  });

  const allocationKeys = [];
  const newlyClaimedKeys = [];
  for (const row of selected) {
    const allocationKey = String(row.allocationKey || "");
    if (String(row.pickupRequestId || "") === String(pickupRequest._id)) {
      allocationKeys.push(allocationKey);
      continue;
    }

    const claimed = await runtime.claimAllocation({
      allocationId: row._id,
      subscriptionId,
      userId: route.ownerId,
      pickupRequestId: pickupRequest._id,
      dayId: identity.dayId,
      date: identity.date,
      session,
    });
    if (!claimed) {
      const raced = await runtime.findAllocationById({ allocationId: row._id, session });
      if (
        raced
        && String(raced.state || "") === "reserved"
        && String(raced.pickupRequestId || "") === String(pickupRequest._id)
      ) {
        allocationKeys.push(allocationKey);
        continue;
      }
      throw pickupError(
        "STACKING_PICKUP_ALLOCATION_CLAIM_CONFLICT",
        "A selected pickup allocation was claimed concurrently",
        409,
        { allocationKey }
      );
    }
    allocationKeys.push(allocationKey);
    newlyClaimedKeys.push(allocationKey);
  }

  return {
    handled: true,
    reservation: {
      allocationKeys,
      newlyReservedKeys: [],
      newlyClaimedKeys,
      plannedStackingPickup: true,
    },
  };
}

function assertPlannedPickupAllocations({
  allocations,
  requestedKeys = [],
  requestedMealCount = 0,
  subscriptionId,
  date,
} = {}) {
  const rows = Array.isArray(allocations) ? allocations : [];
  if (!rows.length) {
    throw pickupError(
      "STACKING_PICKUP_REQUIRES_CONFIRMED_DAY",
      "Pickup for combined packages requires a confirmed meal-planning day",
      422,
      { subscriptionId: String(subscriptionId || ""), date: date || null }
    );
  }
  if (requestedKeys.length > 0) {
    const actualKeys = new Set(rows.map((row) => String(row.allocationKey || "")));
    const missingKeys = requestedKeys.filter((key) => !actualKeys.has(key));
    if (missingKeys.length > 0 || rows.length !== requestedKeys.length) {
      throw pickupError(
        "STACKING_PICKUP_ALLOCATION_SET_INCOMPLETE",
        "One or more pickup allocations were not found",
        409,
        { expectedCount: requestedKeys.length, actualCount: rows.length, missingKeys }
      );
    }
  }
  if (requestedMealCount > 0 && rows.length !== requestedMealCount) {
    throw pickupError(
      "STACKING_PICKUP_ALLOCATION_COUNT_MISMATCH",
      "Pickup meal count must match the confirmed day allocations",
      409,
      { requestedMealCount, allocationCount: rows.length, date: date || null }
    );
  }
  const incompatible = rows.find((row) => String(row.state || "") !== "reserved");
  if (incompatible) {
    throw pickupError(
      "STACKING_PICKUP_ALLOCATION_STATE_CONFLICT",
      "Pickup allocations must still be reserved",
      409,
      { allocationKey: String(incompatible.allocationKey || ""), state: incompatible.state }
    );
  }
  const dateMismatch = date ? rows.find((row) => String(row.date || "") !== date) : null;
  if (dateMismatch) {
    throw pickupError(
      "STACKING_PICKUP_DATE_MISMATCH",
      "Pickup allocations belong to a different subscription day",
      409
    );
  }
  return rows;
}

function createStackingPlannedPickupWrapper(originalReservePickup, runtimeOverrides = null) {
  if (typeof originalReservePickup !== "function") {
    throw new TypeError("originalReservePickup must be a function");
  }
  return async function reservePlannedStackingPickup(args = {}) {
    const result = await reservePlannedStackingPickupEntitlements({
      ...args,
      runtime: runtimeOverrides,
    });
    if (!result.handled) return originalReservePickup(args);
    return result.reservation;
  };
}

module.exports = {
  assertPickupIdentity,
  assertPlannedPickupAllocations,
  choosePickupAllocations,
  collectExplicitPickupSlotKeys,
  createStackingPlannedPickupWrapper,
  normalizeKeys,
  reservePlannedStackingPickupEntitlements,
  resolvePickupDate,
  resolvePlannedPickupRoute,
  resolveRequestedMealCount,
};
