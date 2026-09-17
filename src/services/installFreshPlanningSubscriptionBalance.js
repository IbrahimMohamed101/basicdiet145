"use strict";

const Subscription = require("../models/Subscription");
const selectionService = require("./subscription/subscriptionSelectionService");

const INSTALL_KEY = Symbol.for("basicdiet.freshPlanningSubscriptionBalance.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.freshPlanningSubscriptionBalance.wrapped");

function copyFunctionMetadata(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["length", "name", "prototype", "arguments", "caller", "__original"].includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Non-critical metadata must never prevent startup.
    }
  }
  return target;
}

function installFreshPlanningSubscriptionBalance() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const original = selectionService.performDayPlanningConfirmation;
  if (typeof original !== "function") {
    throw new Error("subscriptionSelectionService.performDayPlanningConfirmation is missing");
  }
  if (original[WRAPPED_KEY] === true) {
    const existing = Object.freeze({ installed: true, confirmationFreshBalance: true });
    globalThis[INSTALL_KEY] = existing;
    return existing;
  }

  const wrapped = async function performDayPlanningConfirmationWithFreshSubscription(args = {}) {
    const result = await original(args);
    const subscriptionId = result && result.subscription && (result.subscription._id || result.subscription.id)
      || args.subscriptionId;
    if (!subscriptionId) return result;

    const freshSubscription = await Subscription.findById(subscriptionId).populate("planId");
    if (!freshSubscription) {
      const error = new Error("Subscription disappeared after day planning confirmation");
      error.code = "DATA_INTEGRITY_ERROR";
      error.status = 409;
      throw error;
    }

    return {
      ...result,
      subscription: freshSubscription,
    };
  };

  copyFunctionMetadata(original, wrapped);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__freshSubscriptionBalance", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(wrapped, "__original", {
    value: original,
    configurable: true,
  });
  selectionService.performDayPlanningConfirmation = wrapped;

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    confirmationFreshBalance: true,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installFreshPlanningSubscriptionBalance();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installFreshPlanningSubscriptionBalance,
};
