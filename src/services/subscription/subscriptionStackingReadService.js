"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { logger } = require("../../utils/logger");
const {
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");

const READ_EVENT = "subscription_stacking_current_overview_read";

function readError(code, message, status = 503, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function applyProjectionToCurrentOverviewResponse(response, projection) {
  if (!response || typeof response !== "object" || !response.data) return response;
  if (!projection || typeof projection !== "object") return response;

  const sourceData = response.data;
  const sourceBalance = sourceData.mealBalance && typeof sourceData.mealBalance === "object"
    ? sourceData.mealBalance
    : {};
  const totalMeals = normalizeNonNegativeInteger(projection.mealBalance?.totalMeals);
  const remainingMeals = normalizeNonNegativeInteger(projection.mealBalance?.remainingMeals);
  const reservedMeals = normalizeNonNegativeInteger(projection.mealBalance?.reservedMeals);
  const consumedMeals = normalizeNonNegativeInteger(projection.mealBalance?.consumedMeals);
  const forfeitedMeals = normalizeNonNegativeInteger(projection.mealBalance?.forfeitedMeals);
  const requiredMealsPerDay = normalizeNonNegativeInteger(projection.requiredMealsPerDay);
  const canConsumeNow = projection.batchCount > 0 && remainingMeals > 0;

  return {
    ...response,
    data: {
      ...sourceData,
      totalMeals,
      remainingMeals,
      selectedMealsPerDay: requiredMealsPerDay,
      mealBalance: {
        ...sourceBalance,
        totalMeals,
        remainingMeals,
        availableMeals: remainingMeals,
        reservedMeals,
        consumedMeals,
        forfeitedMeals,
        canConsumeNow,
        maxConsumableMealsNow: canConsumeNow ? remainingMeals : 0,
        mealBalancePolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
        dailyMealLimitEnforced: false,
        dailyMealsDefault: requiredMealsPerDay,
      },
    },
  };
}

function defaultRuntime() {
  return {
    readEnabledForUser: (userId) => isReadStackingEnabledForUser(userId),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    async findBatches({ userId, containerSubscriptionId }) {
      return SubscriptionEntitlementBatch.find({
        userId,
        containerSubscriptionId,
        status: { $in: ["paid_scheduled", "active", "exhausted", "expired"] },
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();
    },
    info: (message, meta) => logger.info(message, meta),
    error: (message, meta) => logger.error(message, meta),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function createCurrentOverviewReadWrapper(original, runtimeOverrides = null) {
  if (typeof original !== "function") {
    throw new TypeError("original current overview builder must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function buildCurrentSubscriptionOverviewWithStackingRead(args = {}) {
    const response = await original(args);
    const userId = String(args && args.userId || "");
    if (!runtime.readEnabledForUser(userId)) return response;

    const data = response && response.data && typeof response.data === "object"
      ? response.data
      : null;
    if (!data) return response;
    const containerSubscriptionId = String(
      data.subscriptionId || data._id || data.id || ""
    );
    const businessDate = String(data.businessDate || "");
    if (!containerSubscriptionId || !businessDate) {
      if (runtime.writeEnabledForUser(userId)) {
        throw readError(
          "STACKING_READ_IDENTITY_MISSING",
          "Stacking read requires subscriptionId and businessDate"
        );
      }
      return response;
    }

    try {
      const batches = await runtime.findBatches({
        userId,
        containerSubscriptionId,
      });
      if (!Array.isArray(batches) || batches.length === 0) {
        runtime.info(READ_EVENT, {
          outcome: "legacy_fallback_no_batches",
          userId,
          subscriptionId: containerSubscriptionId,
          businessDate,
        });
        return response;
      }

      const projection = projectSubscriptionEntitlements({
        batches,
        businessDate,
      });
      const projectedResponse = applyProjectionToCurrentOverviewResponse(
        response,
        projection
      );
      runtime.info(READ_EVENT, {
        outcome: "projection_applied",
        userId,
        subscriptionId: containerSubscriptionId,
        businessDate,
        batchCount: projection.batchCount,
        remainingMeals: projection.mealBalance.remainingMeals,
        requiredMealsPerDay: projection.requiredMealsPerDay,
        mixedProteinGrams: projection.hasMixedProteinGrams,
        fulfillmentConflict: projection.hasFulfillmentConflict,
      });
      return projectedResponse;
    } catch (err) {
      runtime.error(READ_EVENT, {
        outcome: "error",
        userId,
        subscriptionId: containerSubscriptionId,
        businessDate,
        error: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : undefined,
      });
      if (runtime.writeEnabledForUser(userId)) {
        throw readError(
          "STACKING_READ_UNAVAILABLE",
          "Stacking balance is temporarily unavailable",
          503,
          { cause: err && err.message ? err.message : String(err) }
        );
      }
      return response;
    }
  };
}

module.exports = {
  READ_EVENT,
  applyProjectionToCurrentOverviewResponse,
  createCurrentOverviewReadWrapper,
};
