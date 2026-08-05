"use strict";

const {
  createFinalizeSubscriptionDraftPaymentWrapper,
} = require("./subscription/subscriptionStackingFinalizeRouterService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingWriteRouter.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingWriteRouter.wrapped");

function copyFunctionMetadata(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["length", "name", "prototype", "arguments", "caller", "__original"].includes(key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(target, key, descriptor);
    } catch (_err) {
      // Metadata is non-critical and must not prevent application startup.
    }
  }
  return target;
}

function installSubscriptionStackingWriteRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const activationService = require("./subscription/subscriptionActivationService");
  const original = activationService.finalizeSubscriptionDraftPaymentFlow;
  if (typeof original !== "function") {
    throw new Error("subscriptionActivationService.finalizeSubscriptionDraftPaymentFlow is missing");
  }

  if (original[WRAPPED_KEY] !== true) {
    const wrapped = createFinalizeSubscriptionDraftPaymentWrapper(original);
    copyFunctionMetadata(original, wrapped);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    activationService.finalizeSubscriptionDraftPaymentFlow = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    mode: "write_flag_and_user_allowlist",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingWriteRouter();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingWriteRouter,
};
