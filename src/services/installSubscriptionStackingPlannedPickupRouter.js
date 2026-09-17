"use strict";

const {
  createStackingPlannedPickupBalanceWrapper,
  createStackingPlannedPickupReleaseBalanceWrapper,
} = require("./subscription/subscriptionStackingPlannedPickupRouterService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.wrapped");

function installSubscriptionStackingPlannedPickupRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  // The repair composition is installed first, so this wraps its final balance
  // authority rather than a stale pre-composition export. Non-stacked requests
  // delegate unchanged; stacked requests must pass write rollout, exact batch
  // ownership, confirmed-day binding, and transactional allocation checks.
  const balanceService = require("./subscription/subscriptionPickupRequestBalanceService");
  const original = balanceService.reserveSubscriptionMealsForPickupRequest;
  if (typeof original !== "function") {
    throw new Error(
      "subscriptionPickupRequestBalanceService.reserveSubscriptionMealsForPickupRequest is missing"
    );
  }
  if (original[WRAPPED_KEY] !== true) {
    const wrapped = createStackingPlannedPickupBalanceWrapper(original);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    balanceService.reserveSubscriptionMealsForPickupRequest = wrapped;
  }
  const originalRelease = balanceService.releaseReservedPickupMeals;
  if (typeof originalRelease !== "function") {
    throw new Error(
      "subscriptionPickupRequestBalanceService.releaseReservedPickupMeals is missing"
    );
  }
  if (originalRelease[WRAPPED_KEY] !== true) {
    const wrappedRelease = createStackingPlannedPickupReleaseBalanceWrapper(originalRelease);
    Object.defineProperty(wrappedRelease, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrappedRelease, "__original", { value: originalRelease });
    balanceService.releaseReservedPickupMeals = wrappedRelease;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    securityApproved: true,
    ownerBound: true,
    confirmedDayBound: true,
    createsNewCredits: false,
    mode: "write_flag_and_user_allowlist",
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
