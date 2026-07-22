"use strict";

const presentation = require("./subscription/pickupCanonicalPresentationService");
const { sanitizeObjectIdCycles } = require("../utils/safeObjectIdValue");

const INSTALL_KEY = Symbol.for("basicdiet.pickupCanonicalObjectIdCoreGuard.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.pickupCanonicalObjectIdCoreGuard.wrapped");

const GUARDED_EXPORTS = [
  "buildCanonicalKitchenDetails",
  "canonicalItemType",
  "canonicalTitle",
  "isMealPickupItem",
  "isSandwichLike",
  "normalizeAvailability",
  "normalizeKitchenCard",
  "normalizePickupItem",
  "pickupItemToAddon",
  "pickupItemToKitchenSlot",
  "realProductId",
];

function installPickupCanonicalObjectIdCoreGuard() {
  if (globalThis[INSTALL_KEY]) return;
  globalThis[INSTALL_KEY] = true;

  for (const name of GUARDED_EXPORTS) {
    const original = presentation[name];
    if (typeof original !== "function" || original[WRAPPED_KEY]) continue;
    const guarded = function cycleSafeCanonicalPresentation(...args) {
      const safeArgs = args.map((arg) => sanitizeObjectIdCycles(arg));
      return original(...safeArgs);
    };
    guarded[WRAPPED_KEY] = true;
    guarded.__original = original;
    guarded.__cycleSafeObjectIds = true;
    presentation[name] = guarded;
  }
}

installPickupCanonicalObjectIdCoreGuard();

module.exports = {
  GUARDED_EXPORTS,
  installPickupCanonicalObjectIdCoreGuard,
};
