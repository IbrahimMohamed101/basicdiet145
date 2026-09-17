"use strict";

const {
  normalizeLocalizedFields,
  sanitizeInvalidDisplayStrings,
} = require("../utils/safeLocalizedText");

const INSTALL_KEY = Symbol.for("basicdiet.pickupCanonical.runtimeGuardInstalled");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupCanonical.runtimeGuardWrapped");

function safeString(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function objectIdString(value) {
  if (!value || typeof value !== "object" || typeof value.toHexString !== "function") {
    return null;
  }
  try {
    return safeString(value.toHexString()) || null;
  } catch (_err) {
    return null;
  }
}

function sanitizeCanonicalValue(value, state = null) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;

  const objectId = objectIdString(value);
  if (objectId) return objectId;
  if (value instanceof Date || value instanceof Map || value instanceof Set || Buffer.isBuffer(value)) return value;

  const context = state || {
    active: new WeakSet(),
    completed: new WeakMap(),
  };

  if (context.active.has(value)) return null;
  if (context.completed.has(value)) return context.completed.get(value);

  if (Array.isArray(value)) {
    const output = [];
    context.completed.set(value, output);
    context.active.add(value);
    for (const entry of value) {
      output.push(sanitizeCanonicalValue(entry, context));
    }
    context.active.delete(value);
    return output;
  }

  let source = value;
  if (typeof value.toObject === "function") {
    try {
      const plain = value.toObject({
        depopulate: false,
        flattenMaps: true,
        flattenObjectIds: true,
        getters: false,
        virtuals: false,
      });
      if (plain && plain !== value && typeof plain === "object") source = plain;
    } catch (_err) {
      source = value;
    }
  }

  const output = {};
  context.completed.set(value, output);
  if (source !== value) context.completed.set(source, output);
  context.active.add(value);
  if (source !== value) context.active.add(source);

  for (const [key, entry] of Object.entries(source)) {
    output[key] = sanitizeCanonicalValue(entry, context);
  }

  context.active.delete(value);
  if (source !== value) context.active.delete(source);
  return output;
}

function prepareCanonicalArgument(value) {
  return normalizeLocalizedFields(sanitizeCanonicalValue(value));
}

function finalizeCanonicalResult(value) {
  return sanitizeInvalidDisplayStrings(sanitizeCanonicalValue(value));
}

function wrapExports(target, functionNames) {
  for (const name of functionNames) {
    const original = target && target[name];
    if (typeof original !== "function" || original[WRAPPED_KEY]) continue;

    const wrapped = function guardedPickupCanonicalCall(...args) {
      const sanitizedArgs = args.map((arg) => prepareCanonicalArgument(arg));
      const result = original.apply(this, sanitizedArgs);
      if (result && typeof result.then === "function") {
        return result.then((resolved) => finalizeCanonicalResult(resolved));
      }
      return finalizeCanonicalResult(result);
    };
    wrapped[WRAPPED_KEY] = true;
    wrapped.__original = original;
    target[name] = wrapped;
  }
}

function installPickupCanonicalRuntimeGuard() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  const canonical = require("./subscription/pickupCanonicalPresentationService");
  wrapExports(canonical, [
    "canonicalItemType",
    "canonicalTitle",
    "normalizeAvailability",
    "normalizeKitchenCard",
    "normalizePickupItem",
    "pickupItemToAddon",
    "pickupItemToKitchenSlot",
    "realProductId",
    "buildCanonicalKitchenDetails",
  ]);

  const bilingual = require("../utils/subscriptionBilingualResponse");
  wrapExports(bilingual, [
    "normalizePickupAvailabilityDisplayNames",
    "normalizeSubscriptionBilingualResponse",
  ]);
}

installPickupCanonicalRuntimeGuard();

module.exports = {
  finalizeCanonicalResult,
  installPickupCanonicalRuntimeGuard,
  objectIdString,
  prepareCanonicalArgument,
  sanitizeCanonicalValue,
};
