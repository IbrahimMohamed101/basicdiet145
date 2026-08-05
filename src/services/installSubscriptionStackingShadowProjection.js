"use strict";

const {
  createCurrentOverviewShadowWrapper,
} = require("./subscription/subscriptionStackingShadowService");
const {
  createCurrentOverviewReadWrapper,
} = require("./subscription/subscriptionStackingReadService");
const {
  createTimelineReadWrapper,
} = require("./subscription/subscriptionStackingTimelineReadService");

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
  const originalOverview = overviewService.buildCurrentSubscriptionOverview;
  if (typeof originalOverview !== "function") {
    throw new Error("subscriptionClientOverviewService.buildCurrentSubscriptionOverview is missing");
  }

  if (originalOverview[WRAPPED_KEY] !== true) {
    // Shadow observes the legacy response first. The read wrapper may then apply
    // an allowlisted projection. Both wrappers are default-closed by flags.
    const shadowWrapped = createCurrentOverviewShadowWrapper(originalOverview);
    const wrappedOverview = createCurrentOverviewReadWrapper(shadowWrapped);
    copyFunctionMetadata(originalOverview, wrappedOverview);
    Object.defineProperty(wrappedOverview, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrappedOverview, "__original", { value: originalOverview });
    overviewService.buildCurrentSubscriptionOverview = wrappedOverview;
  }

  // This module is installed before app/routes/controllers are loaded, so the
  // subscriptionService re-export captures the wrapped timeline function.
  const timelineService = require("./subscription/subscriptionTimelineService");
  const originalTimeline = timelineService.buildSubscriptionTimeline;
  if (typeof originalTimeline !== "function") {
    throw new Error("subscriptionTimelineService.buildSubscriptionTimeline is missing");
  }
  if (originalTimeline[WRAPPED_KEY] !== true) {
    const wrappedTimeline = createTimelineReadWrapper(originalTimeline);
    copyFunctionMetadata(originalTimeline, wrappedTimeline);
    Object.defineProperty(wrappedTimeline, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrappedTimeline, "__original", { value: originalTimeline });
    timelineService.buildSubscriptionTimeline = wrappedTimeline;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    currentOverviewReadEnabledByFlag: true,
    timelineReadEnabledByFlag: true,
    writeEnabled: false,
    mode: "allowlisted_shadow_current_overview_and_timeline_read",
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
