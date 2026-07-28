"use strict";

const STATE_KEY = Symbol.for(
  "basicdiet.mealBuilderPremiumAuthorityComposition.state"
);
const MEAL_BUILDER_SERVICE_PATH = require.resolve(
  "./subscription/mealBuilderConfigService"
);

function copyExportDescriptors(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    Object.defineProperty(target, key, descriptor);
  }
  return target;
}

function installMealBuilderPremiumAuthorityComposition() {
  const existing = globalThis[STATE_KEY];
  if (existing && existing.installed) return existing;

  const cachedModule = require.cache[MEAL_BUILDER_SERVICE_PATH];
  if (!cachedModule || !cachedModule.exports) {
    const state = Object.freeze({
      installed: true,
      recomposed: false,
      reason: "meal_builder_service_not_preloaded",
      reboundExports: [],
    });
    globalThis[STATE_KEY] = state;
    return state;
  }

  const capturedExports = cachedModule.exports;

  // The service can be imported by tests or circular dependencies before the
  // independent Premium authority is installed. Re-evaluate only this pure
  // service module after Premium composition, then preserve the original exports
  // object so every pre-existing reference receives the corrected closures.
  delete require.cache[MEAL_BUILDER_SERVICE_PATH];
  const freshExports = require(MEAL_BUILDER_SERVICE_PATH);
  copyExportDescriptors(capturedExports, freshExports);

  // Keep all future require() calls and all earlier references on one shared
  // exports object. No database operation or customer data mutation occurs here.
  require.cache[MEAL_BUILDER_SERVICE_PATH].exports = capturedExports;

  const reboundExports = Reflect.ownKeys(freshExports)
    .filter((key) => typeof freshExports[key] === "function")
    .map(String)
    .sort();
  const state = Object.freeze({
    installed: true,
    recomposed: true,
    reason: "preloaded_service_rebound_after_premium_authority",
    reboundExports,
  });
  globalThis[STATE_KEY] = state;
  return state;
}

const installation = installMealBuilderPremiumAuthorityComposition();

module.exports = {
  MEAL_BUILDER_SERVICE_PATH,
  STATE_KEY,
  copyExportDescriptors,
  installMealBuilderPremiumAuthorityComposition,
  installation,
};
