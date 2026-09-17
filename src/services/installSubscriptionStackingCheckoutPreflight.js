"use strict";

const {
  createStackingCheckoutPreflightWrapper,
} = require("./subscription/subscriptionStackingCheckoutPreflightService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingCheckoutPreflight.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingCheckoutPreflight.wrapped");

function installSubscriptionStackingCheckoutPreflight() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const checkoutService = require("./subscription/subscriptionCheckoutService");
  const original = checkoutService.performSubscriptionCheckout;
  if (typeof original !== "function") {
    throw new Error("subscriptionCheckoutService.performSubscriptionCheckout is missing");
  }

  if (original[WRAPPED_KEY] !== true) {
    const wrapped = createStackingCheckoutPreflightWrapper(original);
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    checkoutService.performSubscriptionCheckout = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    blocksUnsupportedExtrasBeforeInvoice: true,
    mode: "write_flag_and_user_allowlist",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingCheckoutPreflight();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingCheckoutPreflight,
};
