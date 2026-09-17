"use strict";

const {
  createStackingSkipWrappers,
} = require("./subscription/subscriptionStackingSkipRouterService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingSkipRouter.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingSkipRouter.wrapped");

function installSubscriptionStackingSkipRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const skipService = require("./subscription/subscriptionSkipService");
  const wrappers = createStackingSkipWrappers({
    performSkipDay: skipService.performSkipDay,
    performUnskipDay: skipService.performUnskipDay,
  });

  for (const [name, wrapped] of Object.entries(wrappers)) {
    const original = skipService[name];
    if (original && original[WRAPPED_KEY] === true) continue;
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    skipService[name] = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    supported: ["skip", "unskip"],
    stillBlocked: ["skip_range"],
    mode: "write_flag_allowlist_and_stacked_batch",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingSkipRouter();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingSkipRouter,
};
