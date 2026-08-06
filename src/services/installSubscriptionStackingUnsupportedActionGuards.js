"use strict";

const {
  createUnsupportedActionWrappers,
} = require("./subscription/subscriptionStackingUnsupportedActionGuardService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingUnsupportedActionGuards.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingUnsupportedActionGuards.wrapped");

function installSubscriptionStackingUnsupportedActionGuards() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const skipService = require("./subscription/subscriptionSkipService");
  const freezeClientService = require("./subscription/subscriptionFreezeClientService");
  const cancellationService = require("./subscription/subscriptionCancellationService");
  const wrappers = createUnsupportedActionWrappers({
    performSkipDay: skipService.performSkipDay,
    performUnskipDay: skipService.performUnskipDay,
    performSkipRange: skipService.performSkipRange,
    freezeSubscriptionForClient: freezeClientService.freezeSubscriptionForClient,
    unfreezeSubscriptionForClient: freezeClientService.unfreezeSubscriptionForClient,
    cancelSubscriptionDomain: cancellationService.cancelSubscriptionDomain,
  });

  const targets = [
    [skipService, "performSkipDay"],
    [skipService, "performUnskipDay"],
    [skipService, "performSkipRange"],
    [freezeClientService, "freezeSubscriptionForClient"],
    [freezeClientService, "unfreezeSubscriptionForClient"],
    [cancellationService, "cancelSubscriptionDomain"],
  ];

  for (const [service, name] of targets) {
    const original = service[name];
    if (original && original[WRAPPED_KEY] === true) continue;
    const wrapped = wrappers[name];
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    service[name] = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    blockedWhileIncomplete: [
      "skip",
      "unskip",
      "skip_range",
      "freeze",
      "unfreeze",
      "cancel",
    ],
    mode: "stacked_batch_and_allowlisted_write_only",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingUnsupportedActionGuards();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingUnsupportedActionGuards,
};
