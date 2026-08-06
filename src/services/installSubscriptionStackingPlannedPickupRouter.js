"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.installed");

function installSubscriptionStackingPlannedPickupRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  // Deliberately do not wrap reservePickupEntitlements yet. The planned pickup
  // adapter must first bind the authenticated customer to the entitlement batch
  // owner and verify the exact confirmed SubscriptionDay allocation set.
  // Keeping this installer inert prevents an accidental require from bypassing
  // legacy ownership/business checks while the application is serving clients.
  const state = Object.freeze({
    installed: false,
    defaultClosed: true,
    securityApproved: false,
    reason: "ownership_and_confirmed_day_binding_required",
    createsNewCredits: false,
    mode: "fail_closed",
  });

  globalThis[INSTALL_KEY] = state;
  return state;
}

module.exports = {
  INSTALL_KEY,
  installSubscriptionStackingPlannedPickupRouter,
};
