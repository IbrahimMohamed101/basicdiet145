"use strict";

const {
  createStackingEntitlementWrappers,
} = require("./subscription/subscriptionStackingEntitlementRouterService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingEntitlementRouter.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingEntitlementRouter.wrapped");

function installSubscriptionStackingEntitlementRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const entitlementService = require("./subscription/subscriptionMealEntitlementService");
  const wrappers = createStackingEntitlementWrappers({
    reserveDayEntitlements: entitlementService.reserveDayEntitlements,
    transitionDayEntitlements: entitlementService.transitionDayEntitlements,
    reopenDayEntitlements: entitlementService.reopenDayEntitlements,
    transitionAllocation: entitlementService.transitionAllocation,
    reacquireAllocation: entitlementService.reacquireAllocation,
    reservePickupEntitlements: entitlementService.reservePickupEntitlements,
    transitionPickupEntitlements: entitlementService.transitionPickupEntitlements,
  });

  for (const [name, wrapped] of Object.entries(wrappers)) {
    const original = entitlementService[name];
    if (original && original[WRAPPED_KEY] === true) continue;
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    entitlementService[name] = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    directPickupReservationEnabled: false,
    mode: "write_flag_and_user_allowlist",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingEntitlementRouter();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingEntitlementRouter,
};
