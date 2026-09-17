"use strict";

const {
  createStackingPickupAvailabilityReadWrapper,
} = require("./subscription/subscriptionStackingPickupAvailabilityReadService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingPickupAvailabilityProjection.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingPickupAvailabilityProjection.wrapped");

function copyFunctionMetadata(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["length", "name", "prototype", "arguments", "caller", "__original"].includes(String(key))) {
      continue;
    }
    if (key === WRAPPED_KEY) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(target, key, descriptor);
    } catch (_err) {
      // Metadata is diagnostic only and must not prevent startup.
    }
  }
  return target;
}

function installSubscriptionStackingPickupAvailabilityProjection() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  // The backend repair composition installs recovery/ownership wrappers first.
  // Wrap the final exported function afterwards so controllers loaded by
  // createApp capture the stacking-aware read surface without bypassing those
  // existing protections.
  const pickupService = require("./subscription/subscriptionPickupRequestClientService");
  const original = pickupService.getPickupAvailabilityForClient;
  if (typeof original !== "function") {
    throw new Error("subscriptionPickupRequestClientService.getPickupAvailabilityForClient is missing");
  }

  if (original[WRAPPED_KEY] !== true) {
    const wrapped = createStackingPickupAvailabilityReadWrapper(original);
    copyFunctionMetadata(original, wrapped);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    Object.defineProperty(wrapped, "__stackingPickupWalletProjection", { value: true });
    pickupService.getPickupAvailabilityForClient = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    mode: "stacking_read_flag_and_user_allowlist",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingPickupAvailabilityProjection();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingPickupAvailabilityProjection,
};
