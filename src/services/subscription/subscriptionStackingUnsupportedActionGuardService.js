"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const {
  isSubscriptionStackingWriteEnabled,
} = require("../../utils/featureFlags");
const {
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");

const BLOCKED_ACTION_CODES = Object.freeze({
  skip: "STACKING_SKIP_NOT_READY",
  unskip: "STACKING_UNSKIP_NOT_READY",
  skip_range: "STACKING_SKIP_RANGE_NOT_READY",
  freeze: "STACKING_FREEZE_NOT_READY",
  unfreeze: "STACKING_UNFREEZE_NOT_READY",
  cancel: "STACKING_CANCELLATION_NOT_READY",
});

function guardError(action, details = {}) {
  const code = BLOCKED_ACTION_CODES[action] || "STACKING_ACTION_NOT_READY";
  const err = new Error(
    "This subscription action is temporarily unavailable for combined packages"
  );
  err.code = code;
  err.status = 503;
  err.details = {
    action,
    retryable: false,
    ...details,
  };
  return err;
}

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
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function resolveGuardDecision({
  subscriptionId,
  suppliedUserId = "",
  runtime,
} = {}) {
  if (!runtime.globallyEnabled()) {
    return { blocked: false, reason: "write_globally_disabled", ownerId: "" };
  }
  if (suppliedUserId && !runtime.writeEnabledForUser(suppliedUserId)) {
    return { blocked: false, reason: "user_not_allowlisted", ownerId: suppliedUserId };
  }

  const batch = await runtime.findBatchOwner(subscriptionId);
  if (!batch) {
    return { blocked: false, reason: "subscription_not_stacked", ownerId: "" };
  }
  const ownerId = String(batch.userId || "");
  if (!ownerId || !runtime.writeEnabledForUser(ownerId)) {
    return { blocked: false, reason: "batch_owner_not_allowlisted", ownerId };
  }
  if (suppliedUserId && ownerId !== String(suppliedUserId)) {
    return { blocked: false, reason: "supplied_user_not_owner", ownerId };
  }
  return {
    blocked: true,
    reason: "stacked_action_not_integrated",
    ownerId,
    containerSubscriptionId: String(batch.containerSubscriptionId || subscriptionId || ""),
  };
}

function buildClientErrorResult(action, decision) {
  const err = guardError(action, {
    subscriptionId: decision.containerSubscriptionId || null,
  });
  return {
    ok: false,
    status: err.status,
    code: err.code,
    message: err.message,
    details: err.details,
  };
}

function createUnsupportedActionWrappers(originals = {}, runtimeOverrides = null) {
  const runtime = resolveRuntime(runtimeOverrides);
  const requiredFunctions = [
    "performSkipDay",
    "performUnskipDay",
    "performSkipRange",
    "freezeSubscriptionForClient",
    "unfreezeSubscriptionForClient",
    "cancelSubscriptionDomain",
  ];
  for (const name of requiredFunctions) {
    if (typeof originals[name] !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
  }

  return {
    async performSkipDay(args = {}) {
      const decision = await resolveGuardDecision({
        subscriptionId: args.subscriptionId,
        suppliedUserId: args.userId,
        runtime,
      });
      if (!decision.blocked) return originals.performSkipDay(args);
      throw guardError("skip", {
        subscriptionId: decision.containerSubscriptionId,
      });
    },

    async performUnskipDay(args = {}) {
      const decision = await resolveGuardDecision({
        subscriptionId: args.subscriptionId,
        suppliedUserId: args.userId,
        runtime,
      });
      if (!decision.blocked) return originals.performUnskipDay(args);
      throw guardError("unskip", {
        subscriptionId: decision.containerSubscriptionId,
      });
    },

    async performSkipRange(args = {}) {
      const decision = await resolveGuardDecision({
        subscriptionId: args.subscriptionId,
        suppliedUserId: args.userId,
        runtime,
      });
      if (!decision.blocked) return originals.performSkipRange(args);
      throw guardError("skip_range", {
        subscriptionId: decision.containerSubscriptionId,
      });
    },

    async freezeSubscriptionForClient(args = {}) {
      const decision = await resolveGuardDecision({
        subscriptionId: args.subscriptionId,
        suppliedUserId: args.userId,
        runtime,
      });
      if (!decision.blocked) return originals.freezeSubscriptionForClient(args);
      return buildClientErrorResult("freeze", decision);
    },

    async unfreezeSubscriptionForClient(args = {}) {
      const decision = await resolveGuardDecision({
        subscriptionId: args.subscriptionId,
        suppliedUserId: args.userId,
        runtime,
      });
      if (!decision.blocked) return originals.unfreezeSubscriptionForClient(args);
      return buildClientErrorResult("unfreeze", decision);
    },

    async cancelSubscriptionDomain(args = {}) {
      const suppliedUserId = args.actor && args.actor.userId
        ? String(args.actor.userId)
        : "";
      const decision = await resolveGuardDecision({
        subscriptionId: args.subscriptionId,
        suppliedUserId,
        runtime,
      });
      if (!decision.blocked) return originals.cancelSubscriptionDomain(args);
      throw guardError("cancel", {
        subscriptionId: decision.containerSubscriptionId,
        actorKind: args.actor && args.actor.kind || null,
      });
    },
  };
}

module.exports = {
  BLOCKED_ACTION_CODES,
  buildClientErrorResult,
  createUnsupportedActionWrappers,
  guardError,
  resolveGuardDecision,
};
