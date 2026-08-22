"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const {
  isExtraSelectionCanaryEnabledForUser,
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");

function hasPersistedStackingPurchaseBatch(subscriptionId) {
  return SubscriptionEntitlementBatch.exists({
    containerSubscriptionId: subscriptionId,
    sourceType: { $ne: "legacy_seed" },
    applicationState: "applied",
  });
}

function defaultRuntime() {
  return {
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    extraEnabledForUser: (userId) => isExtraSelectionCanaryEnabledForUser(userId),
    hasPersistedStackingBatch: (subscriptionId) => hasPersistedStackingPurchaseBatch(subscriptionId),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function isPersistedStackingSelectionEnabled({
  userId,
  subscriptionId,
  requireExtraSelection = false,
  runtime: runtimeOverrides = null,
} = {}) {
  if (!userId || !subscriptionId) return false;
  const runtime = resolveRuntime(runtimeOverrides);
  if (!runtime.writeEnabledForUser(userId)) return false;
  if (requireExtraSelection && !runtime.extraEnabledForUser(userId)) return false;
  return Boolean(await runtime.hasPersistedStackingBatch(subscriptionId));
}

module.exports = {
  hasPersistedStackingPurchaseBatch,
  isPersistedStackingSelectionEnabled,
};
