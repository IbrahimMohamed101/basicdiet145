"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const SubscriptionExtraEntitlementBucket = require("../../models/SubscriptionExtraEntitlementBucket");
const { logger } = require("../../utils/logger");
const {
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
  isExtraSelectionCanaryEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");
const {
  bucketEligibleOnDate,
  projectExtraEntitlements,
} = require("./subscriptionExtraEntitlementBucketService");

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

function applyExtraProjectionToCurrentOverviewResponse(response, buckets, businessDate) {
  if (!response || typeof response !== "object" || !response.data) return response;
  const eligible = (Array.isArray(buckets) ? buckets : []).filter((row) => (
    bucketEligibleOnDate(row, businessDate)
  ));
  const projection = projectExtraEntitlements({ buckets: eligible, businessDate });
  const premiumBuckets = eligible.filter((row) => row.kind === "premium");
  const addonBuckets = eligible.filter((row) => row.kind === "addon");
  const addonByCategory = new Map();
  for (const row of addonBuckets) {
    const category = String(row.category || row.allowanceCategory || "").trim().toLowerCase();
    if (!category) continue;
    const current = addonByCategory.get(category) || {
      totalUnits: 0,
      remainingUnits: 0,
      reservedUnits: 0,
      consumedUnits: 0,
      canConsumeNow: false,
      unitPolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
    };
    current.totalUnits += normalizeNonNegativeInteger(row.purchasedQty);
    current.remainingUnits += normalizeNonNegativeInteger(row.remainingQty);
    current.reservedUnits += normalizeNonNegativeInteger(row.reservedQty);
    current.consumedUnits += normalizeNonNegativeInteger(row.consumedQty);
    current.canConsumeNow = current.remainingUnits > 0;
    addonByCategory.set(category, current);
  }
  const addonBalanceSummary = Object.fromEntries(addonByCategory);
  const addonCategoryAllowances = [...addonByCategory.entries()].map(([category, row]) => ({
    category,
    includedTotalQty: row.totalUnits,
    remainingIncludedQty: row.remainingUnits,
    reservedQty: row.reservedUnits,
    consumedQty: row.consumedUnits,
    hasBalanceBucket: true,
  }));
  const addonSubscriptionAllowances = projection.addons.map((group) => {
    const funding = addonBuckets.find((row) => (
      String(row.entitlementKey || "").trim().toLowerCase() === group.key
    )) || {};
    return {
      entitlementKey: group.key,
      addonPlanId: funding.addonPlanId || funding.addonId || null,
      addonId: funding.addonId || null,
      category: funding.category || "",
      entitlementCategory: funding.allowanceCategory || funding.category || "",
      balanceBucketId: funding.balanceBucketId || funding._id || null,
      includedTotalQty: group.purchasedQty,
      remainingIncludedQty: group.remainingQty,
      reservedQty: group.reservedQty,
      consumedQty: group.consumedQty,
      currency: funding.currency || "SAR",
      source: "subscription",
      sourceOfTruth: true,
      spendable: group.remainingQty > 0,
    };
  });
  const premiumBalance = premiumBuckets.map((row) => ({
    _id: row._id,
    premiumKey: row.premiumKey,
    configId: row.configId || null,
    revision: Number(row.revision || 0),
    proteinId: row.proteinId || null,
    purchasedQty: normalizeNonNegativeInteger(row.purchasedQty),
    remainingQty: normalizeNonNegativeInteger(row.remainingQty),
    reservedQty: normalizeNonNegativeInteger(row.reservedQty),
    consumedQty: normalizeNonNegativeInteger(row.consumedQty),
    forfeitedQty: normalizeNonNegativeInteger(row.forfeitedQty),
    unitExtraFeeHalala: Number(row.unitPriceHalala || 0),
    currency: row.currency || "SAR",
  }));
  const premiumSummary = projection.premium.map((group) => ({
    premiumKey: group.key,
    purchasedQtyTotal: group.purchasedQty,
    remainingQtyTotal: group.remainingQty,
    reservedQtyTotal: group.reservedQty,
    consumedQtyTotal: group.consumedQty,
    forfeitedQtyTotal: group.forfeitedQty,
  }));
  const addonBalance = addonBuckets.map((row) => ({
    _id: row.balanceBucketId || row._id,
    addonId: row.addonId || null,
    addonPlanId: row.addonPlanId || null,
    entitlementKey: row.entitlementKey || "",
    category: row.category || "",
    allowanceCategory: row.allowanceCategory || row.category || "",
    purchasedQty: normalizeNonNegativeInteger(row.purchasedQty),
    includedTotalQty: normalizeNonNegativeInteger(row.purchasedQty),
    remainingQty: normalizeNonNegativeInteger(row.remainingQty),
    reservedQty: normalizeNonNegativeInteger(row.reservedQty),
    consumedQty: normalizeNonNegativeInteger(row.consumedQty),
    forfeitedQty: normalizeNonNegativeInteger(row.forfeitedQty),
    purchasedDailyQty: normalizeNonNegativeInteger(row.purchasedDailyQty),
    unitPriceHalala: Number(row.unitPriceHalala || 0),
    overageUnitPriceHalala: Number(row.overageUnitPriceHalala || 0),
    currency: row.currency || "SAR",
  }));

  return {
    ...response,
    data: {
      ...response.data,
      premiumBalance,
      premiumSummary,
      addonBalance,
      addonBalanceSummary,
      addonCategoryAllowances,
      addonSubscriptionAllowances,
    },
  };
}

function defaultRuntime() {
  return {
    readEnabledForUser: (userId) => isReadStackingEnabledForUser(userId),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    extraSelectionEnabledForUser: (userId) => isExtraSelectionCanaryEnabledForUser(userId),
    async findBatches({ userId, containerSubscriptionId }) {
      return SubscriptionEntitlementBatch.find({
        userId,
        containerSubscriptionId,
        status: { $in: ["paid_scheduled", "active", "exhausted", "expired"] },
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();
    },
    findExtraBuckets({ userId, containerSubscriptionId }) {
      return SubscriptionExtraEntitlementBucket.find({
        userId,
        containerSubscriptionId,
        applicationState: "applied",
      }).sort({ kind: 1, validityEndDate: 1, effectiveStartDate: 1, _id: 1 }).lean();
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
      const hasPersistedPurchaseBatch = batches.some((row) => row.sourceType !== "legacy_seed");
      const finalResponse = runtime.extraSelectionEnabledForUser(userId)
        && hasPersistedPurchaseBatch
        ? applyExtraProjectionToCurrentOverviewResponse(
          projectedResponse,
          await runtime.findExtraBuckets({ userId, containerSubscriptionId }),
          businessDate
        )
        : projectedResponse;
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
      return finalResponse;
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
  applyExtraProjectionToCurrentOverviewResponse,
  applyProjectionToCurrentOverviewResponse,
  createCurrentOverviewReadWrapper,
};
