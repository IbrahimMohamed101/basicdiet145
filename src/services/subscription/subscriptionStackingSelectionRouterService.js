"use strict";

const {
  isExtraSelectionCanaryEnabledForUser,
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  hasPersistedStackingPurchaseBatch,
} = require("./subscriptionStackingSelectionEligibilityService");
const {
  performStackingDayPlanningConfirmation,
  performStackingDaySelectionUpdate,
  performStackingDaySelectionValidation,
} = require("./subscriptionStackingSelectionWriteService");

function routerError(code, message, status = 503, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function defaultRuntime() {
  return {
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    extraCanaryEnabledForUser: (userId) => isExtraSelectionCanaryEnabledForUser(userId),
    hasPersistedStackingBatch: (subscriptionId) => hasPersistedStackingPurchaseBatch(subscriptionId),
    stackingUpdate: (args) => performStackingDaySelectionUpdate(args),
    stackingValidation: (args) => performStackingDaySelectionValidation(args),
    stackingConfirmation: (args) => performStackingDayPlanningConfirmation(args),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function createStackingSelectionWrappers(originals = {}, runtimeOverrides = null) {
  const runtime = resolveRuntime(runtimeOverrides);
  const originalUpdate = originals.performDaySelectionUpdate;
  const originalValidation = originals.performDaySelectionValidation;
  const originalBulk = originals.performBulkDaySelectionPlanningBalanceValidation;
  const originalConfirmation = originals.performDayPlanningConfirmation;

  async function persistedStackingSelectionEnabled(args = {}) {
    if (!runtime.writeEnabledForUser(args.userId)) return false;
    if (!args.subscriptionId) return false;
    return Boolean(await runtime.hasPersistedStackingBatch(args.subscriptionId));
  }

  function extraSelectionEnabled(args = {}, stackingEnabled = false) {
    return Boolean(
      stackingEnabled
      && runtime.extraCanaryEnabledForUser(args.userId)
    );
  }

  for (const [name, fn] of Object.entries({
    performDaySelectionUpdate: originalUpdate,
    performDaySelectionValidation: originalValidation,
    performBulkDaySelectionPlanningBalanceValidation: originalBulk,
    performDayPlanningConfirmation: originalConfirmation,
  })) {
    if (typeof fn !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
  }

  return {
    async performDaySelectionUpdate(args = {}) {
      const stackingEnabled = await persistedStackingSelectionEnabled(args);
      if (!stackingEnabled) {
        return originalUpdate(args);
      }
      return runtime.stackingUpdate({
        ...args,
        extraSelectionEnabled: extraSelectionEnabled(args, stackingEnabled),
      });
    },

    async performDaySelectionValidation(args = {}) {
      const stackingEnabled = await persistedStackingSelectionEnabled(args);
      if (!stackingEnabled) {
        return originalValidation(args);
      }
      return runtime.stackingValidation({
        ...args,
        extraSelectionEnabled: extraSelectionEnabled(args, stackingEnabled),
      });
    },

    async performBulkDaySelectionPlanningBalanceValidation(args = {}) {
      const stackingEnabled = await persistedStackingSelectionEnabled(args);
      if (!stackingEnabled) {
        return originalBulk(args);
      }
      throw routerError(
        "STACKING_BULK_PLANNING_NOT_READY",
        "Bulk meal planning is not enabled for stacked subscriptions yet",
        503
      );
    },

    async performDayPlanningConfirmation(args = {}) {
      const stackingEnabled = await persistedStackingSelectionEnabled(args);
      if (!stackingEnabled) {
        return originalConfirmation(args);
      }
      return runtime.stackingConfirmation({
        ...args,
        extraSelectionEnabled: extraSelectionEnabled(args, stackingEnabled),
      });
    },
  };
}

module.exports = {
  createStackingSelectionWrappers,
};
