"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.stableDayMealReservationIdentity.installed");

function installStableDayMealReservationIdentity() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const entitlementService = require("./subscription/subscriptionMealEntitlementService");
  if (
    entitlementService.reserveDayEntitlements
    && entitlementService.reserveDayEntitlements.__stableDaySlotIdentity === true
  ) {
    const existing = {
      installed: true,
      reserveDayEntitlements: entitlementService.reserveDayEntitlements,
    };
    globalThis[INSTALL_KEY] = existing;
    return existing;
  }

  const originalService = {
    allocationKeyOf: entitlementService.allocationKeyOf,
    buildDayAllocationSpecs: entitlementService.buildDayAllocationSpecs,
    ensureEntitlementLedger: entitlementService.ensureEntitlementLedger,
    reacquireAllocation: entitlementService.reacquireAllocation,
    reserveDayEntitlements: entitlementService.reserveDayEntitlements,
  };
  const {
    createStableDayEntitlementReservationService,
  } = require("./subscription/subscriptionMealEntitlementIdentityService");
  const stableService = createStableDayEntitlementReservationService({ originalService });

  entitlementService.reserveDayEntitlements = stableService.reserveDayEntitlementsStable;

  const state = {
    installed: true,
    originalReserveDayEntitlements: originalService.reserveDayEntitlements,
    reserveDayEntitlements: entitlementService.reserveDayEntitlements,
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installStableDayMealReservationIdentity();

module.exports = {
  INSTALL_KEY,
  installStableDayMealReservationIdentity,
};
