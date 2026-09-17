"use strict";

const {
  createStackingSelectionWrappers,
} = require("./subscription/subscriptionStackingSelectionRouterService");

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingSelectionRouter.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionStackingSelectionRouter.wrapped");

function installSubscriptionStackingSelectionRouter() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const selectionService = require("./subscription/subscriptionSelectionService");
  const wrappers = createStackingSelectionWrappers({
    performDaySelectionUpdate: selectionService.performDaySelectionUpdate,
    performDaySelectionValidation: selectionService.performDaySelectionValidation,
    performBulkDaySelectionPlanningBalanceValidation:
      selectionService.performBulkDaySelectionPlanningBalanceValidation,
    performDayPlanningConfirmation: selectionService.performDayPlanningConfirmation,
  });

  for (const [name, wrapped] of Object.entries(wrappers)) {
    const original = selectionService[name];
    if (original && original[WRAPPED_KEY] === true) continue;
    Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    selectionService[name] = wrapped;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    defaultClosed: true,
    bulkPlanningEnabled: false,
    mode: "write_flag_and_user_allowlist",
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionStackingSelectionRouter();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  installSubscriptionStackingSelectionRouter,
};
