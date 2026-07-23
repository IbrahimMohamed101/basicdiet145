"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.premiumUpgradeImageHydration.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.premiumUpgradeImageHydration.wrapped");

function installPremiumUpgradeImageHydration() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const premiumService = require("./subscription/premiumUpgradeConfigService");
  const {
    hydratePremiumUpgradeRowsWithImages,
  } = require("./premiumUpgradeImageHydrationService");
  const original = premiumService.listActiveReadyPremiumUpgradeConfigs;

  if (typeof original !== "function") {
    throw new TypeError("premiumService.listActiveReadyPremiumUpgradeConfigs is required");
  }

  if (original[WRAPPED_KEY] !== true) {
    const wrapped = async function listActiveReadyPremiumUpgradeConfigsWithImages(options = {}) {
      const rows = await original.apply(this, arguments);
      return hydratePremiumUpgradeRowsWithImages(rows, {
        session: options && options.session ? options.session : null,
      });
    };
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    premiumService.listActiveReadyPremiumUpgradeConfigs = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    imageHydrationWrapped: Boolean(
      premiumService.listActiveReadyPremiumUpgradeConfigs
      && premiumService.listActiveReadyPremiumUpgradeConfigs[WRAPPED_KEY] === true
    ),
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installPremiumUpgradeImageHydration();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installPremiumUpgradeImageHydration,
};
