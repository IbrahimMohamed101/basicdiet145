"use strict";

const {
  createStackingPlannedPickupWrapper,
} = require("./subscription/subscriptionStackingPlannedPickupRouterService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.wrapped");

function installSubscriptionStackingPlannedPickupRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const entitlementService = require("./subscription/subscriptionMealEntitlementService");
  const original = entitlementService.reservePickupEntitlements;
  if (typeof original !== "function") {
    throw new Error("subscriptionMealEntitlementService.reservePickupEntitlements is missing");
  }

  if (original[WRAPPED_KEY] !== true) {
    const wrapped = createStackingPlannedPickupWrapper(original);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    entitlementService.reservePickupEntitlements = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    confirmedDayOnly: true,
    createsNewCredits: false,
    mode: "reuse_existing_stacking_allocations",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingPlannedPickupRouter();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingPlannedPickupRouter,
};
