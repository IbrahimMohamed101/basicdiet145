"use strict";

const opsPayloadService = require("./dashboard/opsPayloadService");

const INSTALL_KEY = Symbol.for(
  "basicdiet.explicitKitchenAddonVisibilityPolicy.installed"
);
const ORIGINAL_KEY = Symbol.for(
  "basicdiet.explicitKitchenAddonVisibilityPolicy.original"
);
const WRAPPED_KEY = Symbol.for(
  "basicdiet.explicitKitchenAddonVisibilityPolicy.wrapped"
);

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
}

function isLegacyImplicitAddon(addon) {
  if (!addon || typeof addon !== "object") return false;

  const selectionOrigin = clean(addon.selectionOrigin);
  const allocationKey = clean(addon.dailyAllocationKey);

  return Boolean(
    addon.autoDailyAddon === true
      || selectionOrigin === "subscription_daily_default"
      || allocationKey.startsWith("daily-addon:")
  );
}

function isKitchenVisibleAddon(addon) {
  if (!addon || typeof addon !== "object") return false;
  if (clean(addon.addonSettlementState) === "released") return false;
  if (isLegacyImplicitAddon(addon)) return false;
  return true;
}

function filterAddonSelections(value) {
  return Array.isArray(value) ? value.filter(isKitchenVisibleAddon) : [];
}

function sanitizeDayAddons(day) {
  if (!day || typeof day !== "object") return day;

  const source = typeof day.toObject === "function" ? day.toObject() : day;
  return {
    ...source,
    addonSelections: filterAddonSelections(source.addonSelections),
    oneTimeAddonSelections: filterAddonSelections(source.oneTimeAddonSelections),
    recurringAddons: filterAddonSelections(source.recurringAddons),
  };
}

function installExplicitKitchenAddonVisibilityPolicy() {
  if (globalThis[INSTALL_KEY]) return opsPayloadService;

  const original = opsPayloadService.buildKitchenDetailsPayload;
  if (typeof original !== "function") {
    throw new Error("buildKitchenDetailsPayload is required for kitchen add-on policy");
  }

  Object.defineProperty(opsPayloadService, ORIGINAL_KEY, {
    value: original,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  const wrapped = function explicitKitchenAddonPayload(
    day = {},
    subscription = {},
    lang = "en",
    catalogMaps = {}
  ) {
    return original(
      sanitizeDayAddons(day),
      subscription,
      lang,
      catalogMaps
    );
  };
  wrapped[WRAPPED_KEY] = true;
  opsPayloadService.buildKitchenDetailsPayload = wrapped;

  globalThis[INSTALL_KEY] = true;
  return opsPayloadService;
}

installExplicitKitchenAddonVisibilityPolicy();

module.exports = {
  filterAddonSelections,
  installExplicitKitchenAddonVisibilityPolicy,
  isKitchenVisibleAddon,
  isLegacyImplicitAddon,
  sanitizeDayAddons,
};
