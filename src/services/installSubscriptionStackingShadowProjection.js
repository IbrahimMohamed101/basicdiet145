"use strict";

const {
  createCurrentOverviewShadowWrapper,
} = require("./subscription/subscriptionStackingShadowService");

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
    const wrapped = createCurrentOverviewShadowWrapper(original);
    copyFunctionMetadata(original, wrapped);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    overviewService.buildCurrentSubscriptionOverview = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    responseMutationEnabled: false,
    writeEnabled: false,
    mode: "allowlisted_shadow_only",
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
