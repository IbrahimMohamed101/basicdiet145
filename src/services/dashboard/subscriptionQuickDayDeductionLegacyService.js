"use strict";

const crypto = require("node:crypto");
const mongoose = require("mongoose");

const ActivityLog = require("../../models/ActivityLog");
const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionQuickDayDeduction = require("../../models/SubscriptionQuickDayDeduction");
const dateUtils = require("../../utils/date");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  ensureEntitlementLedger,
  reservePickupEntitlements,
  transitionPickupEntitlements,
} = require("../subscription/subscriptionMealEntitlementService");
const {
  QuickDayDeductionError,
} = require("./subscriptionQuickDayDeductionService");

const LEGACY_TARGET_ID = "legacy";
const SOURCE = "pickup_quick_deduction";
const ALLOWED_ROLES = new Set(["superadmin", "admin", "cashier", "restaurant"]);

function assertAllowedRole(role) {
  if (!ALLOWED_ROLES.has(String(role || ""))) {
    throw new QuickDayDeductionError(
      "FORBIDDEN",
      "You are not allowed to deduct subscription meals",
      403
    );
  }
}

function assertSubscriptionId(subscriptionId) {
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    throw new QuickDayDeductionError(
      "INVALID_SUBSCRIPTION_ID",
      "Invalid subscription id",
      400
    );
  }
}

function normalizeDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0 || days > 31) {
    throw new QuickDayDeductionError(
      "INVALID_DAYS",
      "days must be an integer between 1 and 31",
      400
    );
  }
  return days;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 200) {
    throw new QuickDayDeductionError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required",
      400
    );
  }
  return key;
}

function mealCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function premiumRemaining(subscription) {
  return (Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [])
    .reduce((sum, row) => sum + mealCount(row && row.remainingQty), 0);
}

function regularRemaining(subscription) {
  return Math.max(
    0,
    mealCount(subscription && subscription.remainingMeals)
      - premiumRemaining(subscription)
  );
}

function isRegularReservedAllocation(allocation) {
  if (!allocation || allocation.state !== "reserved") return false;
  const premiumSource = String(
    allocation.premiumFunding && allocation.premiumFunding.source || "none"
  );
  return premiumSource === "none";
}

function compareReservedAllocations(left, right) {
  const dateCompare = String(left && left.date || "").localeCompare(
    String(right && right.date || "")
  );
  if (dateCompare !== 0) return dateCompare;
  const slotCompare = String(left && left.slotKey || "").localeCompare(
    String(right && right.slotKey || "")
  );
  if (slotCompare !== 0) return slotCompare;
  return String(left && left.allocationKey || "").localeCompare(
    String(right && right.allocationKey || "")
  );
}

function regularReservedAllocations(subscription) {
  return (Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : [])
    .filter(isRegularReservedAllocation)
    .slice()
    .sort(compareReservedAllocations);
}

function regularReserved(subscription) {
  return regularReservedAllocations(subscription).length;
}

function regularDeductible(subscription) {
  return regularRemaining(subscription) + regularReserved(subscription);
}

function isWithinValidity(subscription, businessDate) {
  const start = subscription && subscription.startDate
    ? dateUtils.toKSADateString(subscription.startDate)
    : null;
  const endDate = subscription && (subscription.validityEndDate || subscription.endDate);
  const end = endDate ? dateUtils.toKSADateString(endDate) : null;
  return (!start || start <= businessDate) && (!end || end >= businessDate);
}

function deterministicPickupRequestId(idempotencyKey) {
  const hex = crypto
    .createHash("sha256")
    .update(`pickup_quick_legacy:${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function serializeOperation(operation, { idempotent = false } = {}) {
  const source = operation && typeof operation.toObject === "function"
    ? operation.toObject()
    : operation || {};
  return {
    id: source._id ? String(source._id) : null,
    idempotent,
    source: source.source || SOURCE,
    targetType: source.targetType || "legacy_subscription",
    subscriptionId: String(source.subscriptionId || ""),
    batchId: LEGACY_TARGET_ID,
    businessDate: source.businessDate || null,
    days: Number(source.days || 0),
    mealsPerDay: Number(source.mealsPerDay || 0),
    mealsDeducted: Number(source.mealsDeducted || 0),
    before: source.before || null,
    after: source.after || null,
    allocationKeys: Array.isArray(source.allocationKeys) ? source.allocationKeys : [],
    createdAt: source.createdAt || null,
  };
}

function assertReplayMatches(existing, { subscriptionId, days }) {
  const same = String(existing.subscriptionId) === String(subscriptionId)
    && String(existing.targetType || "") === "legacy_subscription"
    && Number(existing.days) === Number(days);
  if (!same) {
    throw new QuickDayDeductionError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "Idempotency key was already used for a different quick deduction",
      409
    );
  }
}

async function listOption({ subscriptionId, role } = {}) {
  assertAllowedRole(role);
  assertSubscriptionId(subscriptionId);

  const businessDate = await getRestaurantBusinessDate();
  const hasAnyBatch = await SubscriptionEntitlementBatch.exists({
    containerSubscriptionId: subscriptionId,
  });
  if (hasAnyBatch) return null;

  const subscription = await Subscription.findOne({
    _id: subscriptionId,
    status: "active",
    deliveryMode: "pickup",
  }).select(
    "_id planId startDate endDate validityEndDate totalMeals remainingMeals reservedMeals consumedMeals selectedMealsPerDay mealsPerDay selectedGrams premiumBalance baseMealAllocations"
  ).lean();
  if (!subscription || !isWithinValidity(subscription, businessDate)) return null;

  const mealsPerDay = Number(subscription.selectedMealsPerDay || subscription.mealsPerDay || 0);
  const availableRegularMeals = regularRemaining(subscription);
  const reservedRegularMeals = regularReserved(subscription);
  const deductibleRegularMeals = availableRegularMeals + reservedRegularMeals;
  if (!Number.isInteger(mealsPerDay) || mealsPerDay <= 0 || deductibleRegularMeals <= 0) {
    return null;
  }

  const plan = subscription.planId
    ? await Plan.findById(subscription.planId).select("name").lean()
    : null;

  return {
    id: LEGACY_TARGET_ID,
    targetType: "legacy_subscription",
    planId: String(subscription.planId || ""),
    planName: plan && plan.name ? plan.name : null,
    status: "active",
    mealsPerDay,
    proteinGrams: Math.max(0, Number(subscription.selectedGrams || 0)),
    totalMeals: Math.max(0, Number(subscription.totalMeals || 0)),
    remainingMeals: availableRegularMeals,
    reservedMeals: reservedRegularMeals,
    deductibleMeals: deductibleRegularMeals,
    consumedMeals: Math.max(0, Number(subscription.consumedMeals || 0)),
    effectiveStartDate: subscription.startDate,
    validityEndDate: subscription.validityEndDate || subscription.endDate,
  };
}

async function deduct({
  subscriptionId,
  batchId,
  days: rawDays,
  idempotencyKey: rawIdempotencyKey,
  actorId,
  actorRole,
} = {}) {
  assertAllowedRole(actorRole);
  assertSubscriptionId(subscriptionId);
  if (String(batchId || "") !== LEGACY_TARGET_ID) {
    throw new QuickDayDeductionError(
      "INVALID_LEGACY_TARGET",
      "Invalid legacy quick deduction target",
      400
    );
  }
  const days = normalizeDays(rawDays);
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);

  const replay = await SubscriptionQuickDayDeduction.findOne({ idempotencyKey }).lean();
  if (replay) {
    assertReplayMatches(replay, { subscriptionId, days });
    return serializeOperation(replay, { idempotent: true });
  }

  const session = await startSafeSession();
  if (!session || session.supportsTransactions === false) {
    if (session && typeof session.endSession === "function") await session.endSession();
    throw new QuickDayDeductionError(
      "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED",
      "Quick day deduction requires MongoDB transaction support",
      503
    );
  }

  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await SubscriptionQuickDayDeduction.findOne({ idempotencyKey })
        .session(session)
        .lean();
      if (existing) {
        assertReplayMatches(existing, { subscriptionId, days });
        result = serializeOperation(existing, { idempotent: true });
        return;
      }

      const anyBatch = await SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      }).select("_id").session(session).lean();
      if (anyBatch) {
        throw new QuickDayDeductionError(
          "LEGACY_TARGET_NO_LONGER_AVAILABLE",
          "This subscription now has package batches; select the package explicitly",
          409
        );
      }

      let subscription = await Subscription.findOne({
        _id: subscriptionId,
        status: "active",
        deliveryMode: "pickup",
      }).session(session);
      if (!subscription) {
        throw new QuickDayDeductionError(
          "PICKUP_SUBSCRIPTION_REQUIRED",
          "Quick day deduction is only available for active pickup subscriptions",
          409
        );
      }

      const businessDate = await getRestaurantBusinessDate();
      if (!isWithinValidity(subscription, businessDate)) {
        throw new QuickDayDeductionError(
          "SUBSCRIPTION_OUTSIDE_VALIDITY",
          "Date outside subscription validity",
          409
        );
      }

      await ensureEntitlementLedger(subscriptionId, session);
      subscription = await Subscription.findById(subscriptionId).session(session);

      const mealsPerDay = Number(subscription.selectedMealsPerDay || subscription.mealsPerDay || 0);
      if (!Number.isInteger(mealsPerDay) || mealsPerDay <= 0) {
        throw new QuickDayDeductionError(
          "INVALID_BATCH_MEALS_PER_DAY",
          "Subscription meals-per-day is invalid",
          409
        );
      }

      const mealsToDeduct = days * mealsPerDay;
      const availableRegularMeals = regularRemaining(subscription);
      const allReservedRegularAllocations = regularReservedAllocations(subscription);
      const reservedRegularMeals = allReservedRegularAllocations.length;
      const deductibleRegularMeals = availableRegularMeals + reservedRegularMeals;
      if (deductibleRegularMeals < mealsToDeduct) {
        throw new QuickDayDeductionError(
          "INSUFFICIENT_BATCH_CREDITS",
          "Subscription does not have enough unconsumed regular meals",
          422,
          {
            remainingMeals: availableRegularMeals,
            reservedMeals: reservedRegularMeals,
            deductibleMeals: deductibleRegularMeals,
            requestedMeals: mealsToDeduct,
          }
        );
      }

      const before = {
        remainingMeals: Number(subscription.remainingMeals || 0),
        regularRemainingMeals: availableRegularMeals,
        reservedMeals: Number(subscription.reservedMeals || 0),
        regularReservedMeals: reservedRegularMeals,
        deductibleMeals: deductibleRegularMeals,
        consumedMeals: Number(subscription.consumedMeals || 0),
      };

      const reservedAllocationKeys = allReservedRegularAllocations
        .slice(0, mealsToDeduct)
        .map((allocation) => String(allocation.allocationKey))
        .filter(Boolean);

      if (reservedAllocationKeys.length) {
        await transitionPickupEntitlements({
          subscriptionId,
          allocationKeys: reservedAllocationKeys,
          toState: "consumed",
          session,
        });
      }

      const freshMealsToConsume = mealsToDeduct - reservedAllocationKeys.length;
      let freshAllocationKeys = [];
      if (freshMealsToConsume > 0) {
        const pickupRequest = {
          _id: deterministicPickupRequestId(idempotencyKey),
          subscriptionDayId: null,
          date: businessDate,
          mealCount: freshMealsToConsume,
        };
        const reservation = await reservePickupEntitlements({
          subscriptionId,
          pickupRequest,
          session,
        });
        freshAllocationKeys = Array.isArray(reservation && reservation.allocationKeys)
          ? reservation.allocationKeys.map(String)
          : [];
        if (freshAllocationKeys.length !== freshMealsToConsume) {
          throw new QuickDayDeductionError(
            "LEGACY_ALLOCATION_COUNT_MISMATCH",
            "Quick day deduction did not reserve the expected number of meals",
            409,
            {
              expectedCount: freshMealsToConsume,
              actualCount: freshAllocationKeys.length,
            }
          );
        }
        await transitionPickupEntitlements({
          subscriptionId,
          allocationKeys: freshAllocationKeys,
          toState: "consumed",
          session,
        });
      }

      const allocationKeys = [...reservedAllocationKeys, ...freshAllocationKeys];
      if (allocationKeys.length !== mealsToDeduct) {
        throw new QuickDayDeductionError(
          "LEGACY_ALLOCATION_COUNT_MISMATCH",
          "Quick day deduction did not consume the expected number of meals",
          409,
          {
            expectedCount: mealsToDeduct,
            actualCount: allocationKeys.length,
          }
        );
      }

      const updated = await Subscription.findById(subscriptionId).session(session).lean();
      const after = {
        remainingMeals: Number(updated.remainingMeals || 0),
        regularRemainingMeals: regularRemaining(updated),
        reservedMeals: Number(updated.reservedMeals || 0),
        regularReservedMeals: regularReserved(updated),
        deductibleMeals: regularDeductible(updated),
        consumedMeals: Number(updated.consumedMeals || 0),
        subscriptionRemainingMeals: Number(updated.remainingMeals || 0),
        subscriptionConsumedMeals: Number(updated.consumedMeals || 0),
      };

      const [operation] = await SubscriptionQuickDayDeduction.create([
        {
          idempotencyKey,
          subscriptionId,
          entitlementBatchId: null,
          targetType: "legacy_subscription",
          userId: subscription.userId,
          actorId: actorId || null,
          actorRole: String(actorRole || ""),
          source: SOURCE,
          businessDate,
          days,
          mealsPerDay,
          mealsDeducted: mealsToDeduct,
          allocationKeys,
          before,
          after,
        },
      ], { session });

      await SubscriptionAuditLog.create([
        {
          entityType: "subscription",
          entityId: subscriptionId,
          action: "quick_day_deduction",
          fromStatus: subscription.status,
          toStatus: updated.status,
          actorType: String(actorRole || "admin"),
          actorId: actorId || undefined,
          note: SOURCE,
          meta: {
            source: SOURCE,
            targetType: "legacy_subscription",
            idempotencyKey,
            businessDate,
            entitlementBatchId: null,
            days,
            mealsPerDay,
            mealsDeducted: mealsToDeduct,
            consumedReservedMeals: reservedAllocationKeys.length,
            consumedAvailableMeals: freshAllocationKeys.length,
            allocationKeys,
            before,
            after,
          },
        },
      ], { session });

      result = serializeOperation(operation, { idempotent: false });
    });
    return result;
  } catch (error) {
    if (error && error.code === 11000) {
      const raced = await SubscriptionQuickDayDeduction.findOne({ idempotencyKey }).lean();
      if (raced) {
        assertReplayMatches(raced, { subscriptionId, days });
        return serializeOperation(raced, { idempotent: true });
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  LEGACY_TARGET_ID,
  deduct,
  deterministicPickupRequestId,
  isRegularReservedAllocation,
  listOption,
  premiumRemaining,
  regularDeductible,
  regularRemaining,
  regularReserved,
  regularReservedAllocations,
};
