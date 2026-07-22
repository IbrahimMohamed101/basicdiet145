"use strict";

const resolver = require("./subscription/subscriptionPickupOwnershipResolverService");
const { logger } = require("../utils/logger");

const INSTALL_KEY = Symbol.for("basicdiet.pickupSubscriptionOwnershipRecovery.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupSubscriptionOwnershipRecovery.wrapped");
const FUNCTION_NAMES = Object.freeze([
  "createSubscriptionPickupRequestForClient",
  "getPickupAvailabilityForClient",
  "getSubscriptionPickupRequestStatusForClient",
  "listSubscriptionPickupRequestsForClient",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function copyFunctionProperties(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (["name", "length", "prototype", "arguments", "caller"].includes(String(key))) continue;
    if (key === WRAPPED_KEY) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor) Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Function metadata is best-effort; the wrapper behavior remains canonical.
    }
  }
}

async function resolvePickupContextForRoute(args = {}) {
  try {
    return await resolver.resolvePickupSubscriptionContext({
      requestedSubscriptionId: args.subscriptionId,
      userId: args.userId,
      date: args.date || null,
      session: args.session || null,
    });
  } catch (error) {
    if (!error || error.code !== "NOT_FOUND") throw error;

    // Flutter may retain an id from an overview response that was replaced or
    // deleted during account/subscription recovery. Never query another user's
    // subscription: resolve only the authenticated user's single active pickup
    // subscription for the requested business date.
    const current = await resolver.findCurrentPickupSubscription({
      userId: args.userId,
      date: args.date || null,
      session: args.session || null,
    });
    if (!current) throw error;

    logger.warn("deleted stale pickup subscription id resolved to authenticated user's current subscription", {
      requestedSubscriptionId: clean(args.subscriptionId),
      resolvedSubscriptionId: clean(current._id),
      userId: clean(args.userId),
    });

    return {
      subscription: current,
      subscriptionId: clean(current._id),
      requestedSubscriptionId: clean(args.subscriptionId),
      resolution: "deleted_stale_id_authenticated_current_subscription",
      ownershipRecovered: false,
    };
  }
}

function wrapPickupFunction(pickupService, functionName) {
  const original = pickupService && pickupService[functionName];
  if (typeof original !== "function") {
    const error = new Error(`Missing pickup service function: ${functionName}`);
    error.code = "PICKUP_OWNERSHIP_RECOVERY_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPED_KEY]) return original;

  const wrapped = async function pickupWithCanonicalAuthenticatedSubscription(args = {}) {
    const context = await resolvePickupContextForRoute(args);
    return original({
      ...args,
      subscriptionId: context.subscriptionId,
    });
  };

  copyFunctionProperties(original, wrapped);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__pickupSubscriptionOwnershipRecovery", { value: true });
  Object.defineProperty(wrapped, "__pickupOwnershipOriginal", { value: original });
  pickupService[functionName] = wrapped;
  return wrapped;
}

function installPickupSubscriptionOwnershipRecovery() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const pickupService = require("./subscription/subscriptionPickupRequestClientService");
  const wrappedFunctions = {};
  for (const functionName of FUNCTION_NAMES) {
    wrappedFunctions[functionName] = wrapPickupFunction(pickupService, functionName);
  }

  const state = {
    installed: true,
    wrappedFunctions,
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installPickupSubscriptionOwnershipRecovery();

module.exports = {
  FUNCTION_NAMES,
  INSTALL_KEY,
  WRAPPED_KEY,
  installPickupSubscriptionOwnershipRecovery,
  resolvePickupContextForRoute,
};
