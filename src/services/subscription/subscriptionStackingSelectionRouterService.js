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
  async function extraSelectionEnabled(args = {}) {
    if (!runtime.extraCanaryEnabledForUser(args.userId)) return false;
    return Boolean(await runtime.hasPersistedStackingBatch(args.subscriptionId));
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
      if (!runtime.writeEnabledForUser(args.userId)) {
        return originalUpdate(args);
      }
      return runtime.stackingUpdate({
        ...args,
        extraSelectionEnabled: await extraSelectionEnabled(args),
      });
    },

    async performDaySelectionValidation(args = {}) {
      if (!runtime.writeEnabledForUser(args.userId)) {
        return originalValidation(args);
      }
      return runtime.stackingValidation({
        ...args,
        extraSelectionEnabled: await extraSelectionEnabled(args),
      });
    },

    async performBulkDaySelectionPlanningBalanceValidation(args = {}) {
      if (!runtime.writeEnabledForUser(args.userId)) {
        return originalBulk(args);
      }
      throw routerError(
        "STACKING_BULK_PLANNING_NOT_READY",
        "Bulk meal planning is not enabled for stacked subscriptions yet",
        503
      );
    },

    async performDayPlanningConfirmation(args = {}) {
      if (!runtime.writeEnabledForUser(args.userId)) {
        return originalConfirmation(args);
      }
      return runtime.stackingConfirmation({
        ...args,
        extraSelectionEnabled: await extraSelectionEnabled(args),
      });
    },
  };
}

module.exports = {
  createStackingSelectionWrappers,
};
