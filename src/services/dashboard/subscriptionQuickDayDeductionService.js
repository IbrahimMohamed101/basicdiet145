"use strict";

const mongoose = require("mongoose");

const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionQuickDayDeduction = require("../../models/SubscriptionQuickDayDeduction");
const dateUtils = require("../../utils/date");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  reconcileSubscriptionStackingLifecycleTransactional,
} = require("../subscription/subscriptionStackingLifecycleService");
const {
  consumeBatchThroughAllocationLedgerTransactional,
} = require("./subscriptionQuickDayDeductionLedgerAdapter");

const SOURCE = "pickup_quick_deduction";
const ALLOWED_ROLES = new Set(["superadmin", "admin", "cashier", "restaurant"]);

class QuickDayDeductionError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "QuickDayDeductionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function assertAllowedRole(role) {
  if (!ALLOWED_ROLES.has(String(role || ""))) {
    throw new QuickDayDeductionError(
      "FORBIDDEN",
      "You are not allowed to deduct subscription meals",
      403
    );
  }
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

function normalizeInput({ subscriptionId, batchId, days, idempotencyKey }) {
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    throw new QuickDayDeductionError(
      "INVALID_SUBSCRIPTION_ID",
      "Invalid subscription id",
      400
    );
  }
  if (!mongoose.Types.ObjectId.isValid(batchId)) {
    throw new QuickDayDeductionError(
      "INVALID_ENTITLEMENT_BATCH_ID",
      "Invalid entitlement batch id",
      400
    );
  }
  const normalizedDays = Number(days);
  if (!Number.isInteger(normalizedDays) || normalizedDays <= 0 || normalizedDays > 31) {
    throw new QuickDayDeductionError(
      "INVALID_DAYS",
      "days must be an integer between 1 and 31",
      400
    );
  }
  return {
    subscriptionId: String(subscriptionId),
    batchId: String(batchId),
    days: normalizedDays,
    idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
  };
}

function mealCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function deductibleMealsForBatch(batch) {
  return mealCount(batch && batch.remainingMeals) + mealCount(batch && batch.reservedMeals);
}

function batchIsEligible(batch, businessDate) {
  if (!batch || batch.applicationState !== "applied") return false;
  if (!["active", "paid_scheduled"].includes(String(batch.status || ""))) return false;
  if (deductibleMealsForBatch(batch) <= 0) return false;
  const start = dateUtils.toKSADateString(batch.effectiveStartDate);
  const end = dateUtils.toKSADateString(batch.validityEndDate || batch.endDate);
  return start <= businessDate && businessDate <= end;
}

function serializeOperation(operation, { idempotent = false } = {}) {
  const source = operation && typeof operation.toObject === "function"
    ? operation.toObject()
    : operation || {};
  return {
    id: source._id ? String(source._id) : null,
    idempotent,
    source: source.source || SOURCE,
    subscriptionId: String(source.subscriptionId || ""),
    batchId: String(source.entitlementBatchId || ""),
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

function createDefaultRuntime() {
  return {
    startSession: () => startSafeSession(),
    getBusinessDate: () => getRestaurantBusinessDate(),
    findOperation(idempotencyKey, session = null) {
      let query = SubscriptionQuickDayDeduction.findOne({ idempotencyKey });
      if (session) query = query.session(session);
      return query.lean();
    },
    findSubscription(subscriptionId, session) {
      return Subscription.findById(subscriptionId).session(session);
    },
    findBatch({ subscriptionId, batchId, session }) {
      return SubscriptionEntitlementBatch.findOne({
        _id: batchId,
        containerSubscriptionId: subscriptionId,
      }).session(session).lean();
    },
    consumeBatch(args) {
      return consumeBatchThroughAllocationLedgerTransactional(args);
    },
    reconcile(args) {
      return reconcileSubscriptionStackingLifecycleTransactional(args);
    },
    async createOperation(payload, session) {
      const [created] = await SubscriptionQuickDayDeduction.create([payload], { session });
      return created;
    },
    async createAudit(payload, session) {
      const [created] = await SubscriptionAuditLog.create([payload], { session });
      return created;
    },
    findEligibleBatches(subscriptionId, businessDate) {
      const dayStart = new Date(`${businessDate}T00:00:00+03:00`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
      return SubscriptionEntitlementBatch.find({
        containerSubscriptionId: subscriptionId,
        applicationState: "applied",
        status: { $in: ["active", "paid_scheduled"] },
        effectiveStartDate: { $lte: dayEnd },
        $expr: {
          $gte: [
            { $ifNull: ["$validityEndDate", "$endDate"] },
            dayStart,
          ],
        },
        $or: [
          { remainingMeals: { $gt: 0 } },
          { reservedMeals: { $gt: 0 } },
        ],
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();
    },
    findPlans(planIds) {
      return Plan.find({ _id: { $in: planIds } }).lean();
    },
  };
}

function resolveRuntime(overrides = null) {
  const runtime = createDefaultRuntime();
  return overrides && typeof overrides === "object"
    ? { ...runtime, ...overrides }
    : runtime;
}

function assertSameOperation(existing, input) {
  const same = String(existing.subscriptionId) === input.subscriptionId
    && String(existing.entitlementBatchId) === input.batchId
    && Number(existing.days) === input.days;
  if (!same) {
    throw new QuickDayDeductionError(
      "IDEMPOTENCY_KEY_CONFLICT",
      "Idempotency key was already used for a different quick deduction",
      409
    );
  }
}

function createQuickDayDeductionService(runtimeOverrides = null) {
  const runtime = resolveRuntime(runtimeOverrides);

  async function listOptions({ subscriptionId, role }) {
    assertAllowedRole(role);
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      throw new QuickDayDeductionError(
        "INVALID_SUBSCRIPTION_ID",
        "Invalid subscription id",
        400
      );
    }

    const businessDate = await runtime.getBusinessDate();
    const batches = await runtime.findEligibleBatches(subscriptionId, businessDate);
    const planIds = [
      ...new Set(batches.map((batch) => String(batch.planId || "")).filter(Boolean)),
    ];
    const plans = planIds.length ? await runtime.findPlans(planIds) : [];
    const planMap = new Map(plans.map((plan) => [String(plan._id), plan]));

    return {
      subscriptionId: String(subscriptionId),
      businessDate,
      batches: batches.map((batch) => {
        const plan = planMap.get(String(batch.planId || ""));
        return {
          id: String(batch._id),
          planId: String(batch.planId || ""),
          planName: plan && plan.name ? plan.name : null,
          status: batch.status,
          mealsPerDay: Number(batch.mealsPerDay || 0),
          proteinGrams: Number(batch.proteinGrams || 0),
          totalMeals: Number(batch.totalMeals || 0),
          remainingMeals: mealCount(batch.remainingMeals),
          reservedMeals: mealCount(batch.reservedMeals),
          deductibleMeals: deductibleMealsForBatch(batch),
          consumedMeals: Number(batch.consumedMeals || 0),
          effectiveStartDate: batch.effectiveStartDate,
          validityEndDate: batch.validityEndDate || batch.endDate,
        };
      }),
    };
  }

  async function deduct({
    subscriptionId,
    batchId,
    days,
    idempotencyKey,
    actorId,
    actorRole,
  }) {
    assertAllowedRole(actorRole);
    const input = normalizeInput({ subscriptionId, batchId, days, idempotencyKey });

    const replay = await runtime.findOperation(input.idempotencyKey);
    if (replay) {
      assertSameOperation(replay, input);
      return serializeOperation(replay, { idempotent: true });
    }

    const session = await runtime.startSession();
    if (!session || session.supportsTransactions === false) {
      if (session && typeof session.endSession === "function") await session.endSession();
      throw new QuickDayDeductionError(
        "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED",
        "Quick stacked-package deduction requires MongoDB transaction support",
        503
      );
    }

    let result;
    try {
      await session.withTransaction(async () => {
        const existing = await runtime.findOperation(input.idempotencyKey, session);
        if (existing) {
          assertSameOperation(existing, input);
          result = serializeOperation(existing, { idempotent: true });
          return;
        }

        const subscription = await runtime.findSubscription(input.subscriptionId, session);
        if (!subscription || String(subscription.status || "") !== "active") {
          throw new QuickDayDeductionError(
            "SUBSCRIPTION_NOT_ACTIVE",
            "Active subscription not found",
            404
          );
        }

        const batch = await runtime.findBatch({
          subscriptionId: input.subscriptionId,
          batchId: input.batchId,
          session,
        });
        if (!batch) {
          throw new QuickDayDeductionError(
            "ENTITLEMENT_BATCH_NOT_FOUND",
            "Entitlement batch does not belong to this subscription",
            404
          );
        }

        const businessDate = await runtime.getBusinessDate();
        if (!batchIsEligible(batch, businessDate)) {
          throw new QuickDayDeductionError(
            "ENTITLEMENT_BATCH_NOT_ELIGIBLE",
            "Entitlement batch is not eligible for pickup deduction today",
            409,
            { businessDate, batchStatus: batch.status }
          );
        }

        const mealsPerDay = Number(batch.mealsPerDay || 0);
        if (!Number.isInteger(mealsPerDay) || mealsPerDay <= 0) {
          throw new QuickDayDeductionError(
            "INVALID_BATCH_MEALS_PER_DAY",
            "Batch meals-per-day is invalid",
            409
          );
        }
        const mealsToDeduct = input.days * mealsPerDay;
        const availableMeals = mealCount(batch.remainingMeals);
        const reservedMeals = mealCount(batch.reservedMeals);
        const deductibleMeals = availableMeals + reservedMeals;
        if (deductibleMeals < mealsToDeduct) {
          throw new QuickDayDeductionError(
            "INSUFFICIENT_BATCH_CREDITS",
            "Selected package does not have enough unconsumed meals",
            422,
            {
              remainingMeals: availableMeals,
              reservedMeals,
              deductibleMeals,
              requestedMeals: mealsToDeduct,
            }
          );
        }

        const before = {
          remainingMeals: availableMeals,
          reservedMeals,
          deductibleMeals,
          consumedMeals: Number(batch.consumedMeals || 0),
        };

        const consumption = await runtime.consumeBatch({
          subscription,
          batch,
          businessDate,
          mealsToDeduct,
          idempotencyKey: input.idempotencyKey,
          session,
        });
        const updatedBatch = consumption && consumption.updatedBatch
          ? consumption.updatedBatch
          : consumption;
        const allocationKeys = consumption && Array.isArray(consumption.allocationKeys)
          ? consumption.allocationKeys.map(String)
          : [];
        if (!updatedBatch) {
          throw new QuickDayDeductionError(
            "BATCH_BALANCE_CONFLICT",
            "Package balance changed while the deduction was being applied",
            409
          );
        }

        const lifecycle = await runtime.reconcile({
          containerSubscriptionId: subscription._id,
          businessDate,
          session,
        });
        const after = {
          remainingMeals: Number(updatedBatch.remainingMeals || 0),
          reservedMeals: Number(updatedBatch.reservedMeals || 0),
          deductibleMeals: deductibleMealsForBatch(updatedBatch),
          consumedMeals: Number(updatedBatch.consumedMeals || 0),
          subscriptionRemainingMeals: lifecycle && lifecycle.container
            ? Number(lifecycle.container.remainingMeals || 0)
            : null,
          subscriptionReservedMeals: lifecycle && lifecycle.container
            ? Number(lifecycle.container.reservedMeals || 0)
            : null,
          subscriptionConsumedMeals: lifecycle && lifecycle.container
            ? Number(lifecycle.container.consumedMeals || 0)
            : null,
        };

        const operation = await runtime.createOperation({
          idempotencyKey: input.idempotencyKey,
          subscriptionId: subscription._id,
          entitlementBatchId: updatedBatch._id,
          userId: subscription.userId,
          actorId: actorId || null,
          actorRole: String(actorRole || ""),
          source: SOURCE,
          businessDate,
          days: input.days,
          mealsPerDay,
          mealsDeducted: mealsToDeduct,
          allocationKeys,
          before,
          after,
        }, session);

        await runtime.createAudit({
          entityType: "subscription",
          entityId: subscription._id,
          action: "quick_day_deduction",
          fromStatus: subscription.status,
          toStatus: lifecycle && lifecycle.container
            ? lifecycle.container.status
            : subscription.status,
          actorType: String(actorRole || "admin"),
          actorId: actorId || undefined,
          note: SOURCE,
          meta: {
            source: SOURCE,
            idempotencyKey: input.idempotencyKey,
            businessDate,
            entitlementBatchId: String(updatedBatch._id),
            days: input.days,
            mealsPerDay,
            mealsDeducted: mealsToDeduct,
            allocationKeys,
            before,
            after,
          },
        }, session);

        result = serializeOperation(operation, { idempotent: false });
      });
      return result;
    } catch (error) {
      if (error && error.code === 11000) {
        const raced = await runtime.findOperation(input.idempotencyKey);
        if (raced) {
          assertSameOperation(raced, input);
          return serializeOperation(raced, { idempotent: true });
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  return { deduct, listOptions };
}

const service = createQuickDayDeductionService();

module.exports = {
  SOURCE,
  QuickDayDeductionError,
  batchIsEligible,
  createQuickDayDeductionService,
  deductibleMealsForBatch,
  deduct: service.deduct,
  listOptions: service.listOptions,
  normalizeInput,
};
