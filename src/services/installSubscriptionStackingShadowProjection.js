"use strict";

const {
  createCurrentOverviewShadowWrapper,
} = require("./subscription/subscriptionStackingShadowService");
const {
  createCurrentOverviewReadWrapper,
} = require("./subscription/subscriptionStackingReadService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingShadowProjection.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingShadowProjection.wrapped");

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
      // Function metadata is non-critical and must never prevent startup.
    }
  }
  return target;
}

function installSubscriptionStackingShadowProjection() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const overviewService = require("./subscription/subscriptionClientOverviewService");
  const original = overviewService.buildCurrentSubscriptionOverview;
  if (typeof original !== "function") {
    throw new Error("subscriptionClientOverviewService.buildCurrentSubscriptionOverview is missing");
  }

  if (original[WRAPPED_KEY] !== true) {
    // Shadow observes the legacy response first. The read wrapper may then apply
    // an allowlisted projection. Both wrappers are default-closed by flags.
    const shadowWrapped = createCurrentOverviewShadowWrapper(original);
    const wrapped = createCurrentOverviewReadWrapper(shadowWrapped);
    copyFunctionMetadata(original, wrapped);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    overviewService.buildCurrentSubscriptionOverview = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    responseMutationEnabledByFlag: true,
    writeEnabled: false,
    mode: "allowlisted_shadow_and_current_overview_read",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingShadowProjection();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingShadowProjection,
};
