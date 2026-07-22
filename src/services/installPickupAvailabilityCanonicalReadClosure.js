"use strict";

const readClosure = require("./subscription/pickupAvailabilityCanonicalReadClosureService");
const ownershipInstaller = require("./installPickupSubscriptionOwnershipRecovery");

const INSTALL_KEY = Symbol.for("basicdiet.pickupAvailabilityCanonicalReadClosure.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupAvailabilityCanonicalReadClosure.wrapped");

function copyFunctionProperties(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["name", "length", "prototype", "arguments", "caller"].includes(String(key))) continue;
    if (key === WRAPPED_KEY) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor) Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Function metadata is best-effort; runtime behavior remains canonical.
    }
  }
}

function installPickupAvailabilityCanonicalReadClosure() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const pickupService = require("./subscription/subscriptionPickupRequestClientService");
  const original = pickupService.getPickupAvailabilityForClient;
  if (typeof original !== "function") {
    const error = new Error("Pickup availability function is unavailable");
    error.code = "PICKUP_AVAILABILITY_READ_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPED_KEY]) return globalThis[INSTALL_KEY];

  const wrapped = readClosure.buildAvailabilityReadClosure(original, {
    resolveContext: ownershipInstaller.resolvePickupContextForRoute,
  });
  copyFunctionProperties(original, wrapped);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__pickupAvailabilityCanonicalReadClosure", { value: true });
  Object.defineProperty(wrapped, "__pickupAvailabilityCanonicalReadOriginal", { value: original });
  pickupService.getPickupAvailabilityForClient = wrapped;

  const state = {
    installed: true,
    wrapped,
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installPickupAvailabilityCanonicalReadClosure();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installPickupAvailabilityCanonicalReadClosure,
};
