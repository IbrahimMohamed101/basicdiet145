"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../../utils/featureFlags");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  performStackingSkipDay,
  performStackingUnskipDay,
} = require("./subscriptionStackingSkipService");

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingWriteEnabled(),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    findBatchOwner(subscriptionId) {
      return SubscriptionEntitlementBatch.findOne({
        containerSubscriptionId: subscriptionId,
      })
        .select("userId containerSubscriptionId")
        .lean();
    },
    stackingSkip: (args) => performStackingSkipDay(args),
    stackingUnskip: (args) => performStackingUnskipDay(args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function resolveStackingSkipRoute({ subscriptionId, userId, runtime }) {
  if (!runtime.globallyEnabled()) {
    return { enabled: false, reason: "write_globally_disabled", ownerId: "" };
  }
  const suppliedUserId = String(userId || "");
  if (!suppliedUserId || !runtime.writeEnabledForUser(suppliedUserId)) {
    return {
      enabled: false,
      reason: "user_not_allowlisted",
      ownerId: suppliedUserId,
    };
  }
  const batch = await runtime.findBatchOwner(subscriptionId);
  if (!batch) {
    return { enabled: false, reason: "subscription_not_stacked", ownerId: "" };
  }
  const ownerId = String(batch.userId || "");
  if (ownerId !== suppliedUserId || !runtime.writeEnabledForUser(ownerId)) {
    return { enabled: false, reason: "batch_owner_mismatch", ownerId };
  }
  return {
    enabled: true,
    reason: "stacked_skip_ready",
    ownerId,
    containerSubscriptionId: String(batch.containerSubscriptionId || subscriptionId || ""),
  };
}

function createStackingSkipWrappers(originals = {}, runtimeOverrides = null) {
  if (typeof originals.performSkipDay !== "function") {
    throw new TypeError("performSkipDay must be a function");
  }
  if (typeof originals.performUnskipDay !== "function") {
    throw new TypeError("performUnskipDay must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return {
    async performSkipDay(args = {}) {
      const route = await resolveStackingSkipRoute({
        subscriptionId: args.subscriptionId,
        userId: args.userId,
        runtime,
      });
      if (!route.enabled) return originals.performSkipDay(args);
      return runtime.stackingSkip(args);
    },

    async performUnskipDay(args = {}) {
      const route = await resolveStackingSkipRoute({
        subscriptionId: args.subscriptionId,
        userId: args.userId,
        runtime,
      });
      if (!route.enabled) return originals.performUnskipDay(args);
      return runtime.stackingUnskip(args);
    },
  };
}

module.exports = {
  createStackingSkipWrappers,
  resolveStackingSkipRoute,
};
