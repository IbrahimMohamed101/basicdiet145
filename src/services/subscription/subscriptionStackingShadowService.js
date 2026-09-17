"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { logger } = require("../../utils/logger");
const {
  isSubscriptionStackingShadowEnabled,
} = require("../../utils/featureFlags");
const {
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");

const SHADOW_EVENT = "subscription_stacking_shadow_projection";

function parseShadowUserAllowlist(rawValue = process.env.SUBSCRIPTION_STACKING_SHADOW_USER_IDS) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isShadowUserAllowed(
  userId,
  rawValue = process.env.SUBSCRIPTION_STACKING_SHADOW_USER_IDS,
  allowAllUsers = process.env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS
) {
  if (String(allowAllUsers || "").trim().toLowerCase() === "true") {
    return Boolean(String(userId || "").trim());
  }
  const allowlist = parseShadowUserAllowlist(rawValue);
  if (allowlist.has("*")) return true;
  const normalizedUserId = String(userId || "").trim();
  return Boolean(normalizedUserId && allowlist.has(normalizedUserId));
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function resolveOverviewMealBalance(data = {}) {
  const balance = data.mealBalance && typeof data.mealBalance === "object"
    ? data.mealBalance
    : {};
  return {
    totalMeals: normalizeNonNegativeInteger(
      balance.totalMeals !== undefined ? balance.totalMeals : data.totalMeals
    ),
    remainingMeals: normalizeNonNegativeInteger(
      balance.remainingMeals !== undefined ? balance.remainingMeals : data.remainingMeals
    ),
    reservedMeals: normalizeNonNegativeInteger(balance.reservedMeals),
    consumedMeals: normalizeNonNegativeInteger(
      balance.consumedMeals !== undefined
        ? balance.consumedMeals
        : Math.max(
          0,
          normalizeNonNegativeInteger(data.totalMeals)
            - normalizeNonNegativeInteger(data.remainingMeals)
        )
    ),
    forfeitedMeals: normalizeNonNegativeInteger(balance.forfeitedMeals),
  };
}

function buildOverviewShadowSnapshot(data = {}) {
  const mealBalance = resolveOverviewMealBalance(data);
  return {
    subscriptionId: String(data.subscriptionId || data._id || data.id || ""),
    businessDate: String(data.businessDate || ""),
    mealBalance,
    requiredMealsPerDay: normalizeNonNegativeInteger(
      data.selectedMealsPerDay !== undefined
        ? data.selectedMealsPerDay
        : data.mealBalance && data.mealBalance.dailyMealsDefault
    ),
  };
}

function compareShadowProjection({ legacy, projected } = {}) {
  const mismatches = [];
  const compareField = (field, legacyValue, projectedValue) => {
    if (Number(legacyValue || 0) === Number(projectedValue || 0)) return;
    mismatches.push({
      field,
      legacy: Number(legacyValue || 0),
      projected: Number(projectedValue || 0),
    });
  };

  compareField(
    "mealBalance.totalMeals",
    legacy && legacy.mealBalance && legacy.mealBalance.totalMeals,
    projected && projected.mealBalance && projected.mealBalance.totalMeals
  );
  compareField(
    "mealBalance.remainingMeals",
    legacy && legacy.mealBalance && legacy.mealBalance.remainingMeals,
    projected && projected.mealBalance && projected.mealBalance.remainingMeals
  );
  compareField(
    "mealBalance.reservedMeals",
    legacy && legacy.mealBalance && legacy.mealBalance.reservedMeals,
    projected && projected.mealBalance && projected.mealBalance.reservedMeals
  );
  compareField(
    "mealBalance.consumedMeals",
    legacy && legacy.mealBalance && legacy.mealBalance.consumedMeals,
    projected && projected.mealBalance && projected.mealBalance.consumedMeals
  );
  compareField(
    "mealBalance.forfeitedMeals",
    legacy && legacy.mealBalance && legacy.mealBalance.forfeitedMeals,
    projected && projected.mealBalance && projected.mealBalance.forfeitedMeals
  );
  compareField(
    "requiredMealsPerDay",
    legacy && legacy.requiredMealsPerDay,
    projected && projected.requiredMealsPerDay
  );

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

function defaultRuntime() {
  return {
    shadowEnabled: () => isSubscriptionStackingShadowEnabled(),
    isUserAllowed: (userId) => isShadowUserAllowed(userId),
    async findBatches({ userId, containerSubscriptionId }) {
      return SubscriptionEntitlementBatch.find({
        userId,
        containerSubscriptionId,
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();
    },
    info: (message, meta) => logger.info(message, meta),
    warn: (message, meta) => logger.warn(message, meta),
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

function createCurrentOverviewShadowWrapper(original, runtimeOverrides = null) {
  if (typeof original !== "function") {
    throw new TypeError("original current overview builder must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function buildCurrentSubscriptionOverviewWithStackingShadow(args = {}) {
    const response = await original(args);

    if (!runtime.shadowEnabled()) return response;
    const userId = args && args.userId ? String(args.userId) : "";
    if (!runtime.isUserAllowed(userId)) return response;

    const data = response && response.data && typeof response.data === "object"
      ? response.data
      : null;
    if (!data) return response;

    const legacy = buildOverviewShadowSnapshot(data);
    if (!legacy.subscriptionId || !legacy.businessDate) {
      runtime.warn(SHADOW_EVENT, {
        outcome: "skipped_missing_identity",
        userId,
        subscriptionId: legacy.subscriptionId || null,
        businessDate: legacy.businessDate || null,
      });
      return response;
    }

    try {
      const batches = await runtime.findBatches({
        userId,
        containerSubscriptionId: legacy.subscriptionId,
      });

      if (!Array.isArray(batches) || batches.length === 0) {
        runtime.info(SHADOW_EVENT, {
          outcome: "no_batches",
          userId,
          subscriptionId: legacy.subscriptionId,
          businessDate: legacy.businessDate,
        });
        return response;
      }

      const projected = projectSubscriptionEntitlements({
        batches,
        businessDate: legacy.businessDate,
      });
      const comparison = compareShadowProjection({ legacy, projected });
      const meta = {
        outcome: comparison.matches ? "match" : "mismatch",
        userId,
        subscriptionId: legacy.subscriptionId,
        businessDate: legacy.businessDate,
        batchCount: projected.batchCount,
        batchIds: projected.batchIds,
        mixedProteinGrams: projected.hasMixedProteinGrams,
        grams: projected.grams,
        fulfillmentConflict: projected.hasFulfillmentConflict,
        mismatches: comparison.mismatches,
      };

      if (comparison.matches) runtime.info(SHADOW_EVENT, meta);
      else runtime.warn(SHADOW_EVENT, meta);
    } catch (err) {
      runtime.error(SHADOW_EVENT, {
        outcome: "error",
        userId,
        subscriptionId: legacy.subscriptionId,
        businessDate: legacy.businessDate,
        error: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : undefined,
      });
    }

    // Shadow mode is observability-only. Never mutate or replace the response.
    return response;
  };
}

module.exports = {
  SHADOW_EVENT,
  buildOverviewShadowSnapshot,
  compareShadowProjection,
  createCurrentOverviewShadowWrapper,
  isShadowUserAllowed,
  parseShadowUserAllowlist,
  resolveOverviewMealBalance,
};
