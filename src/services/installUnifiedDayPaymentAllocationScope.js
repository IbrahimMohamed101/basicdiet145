"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.unifiedDayPaymentAllocationScope.installed");

function installUnifiedDayPaymentAllocationScope() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const entitlementService = require("./subscription/subscriptionMealEntitlementService");
  const {
    createScopedLinkPaymentToAllocations,
    createScopedMarkPaidFunding,
    createScopedValidatePaymentAllocations,
    createTerminalReservationReleaseWrapper,
  } = require("./subscription/subscriptionUnifiedDayPaymentAllocationScopeService");

  if (
    entitlementService.linkPaymentToAllocations
    && entitlementService.linkPaymentToAllocations.__unifiedDayPaymentAllocationScoped !== true
  ) {
    entitlementService.linkPaymentToAllocations = createScopedLinkPaymentToAllocations(
      entitlementService.linkPaymentToAllocations
    );
  }
  if (
    entitlementService.validatePaymentAllocations
    && entitlementService.validatePaymentAllocations.__unifiedDayPaymentAllocationScoped !== true
  ) {
    entitlementService.validatePaymentAllocations = createScopedValidatePaymentAllocations(
      entitlementService.validatePaymentAllocations
    );
  }
  if (
    entitlementService.markPaidFunding
    && entitlementService.markPaidFunding.__unifiedDayPaymentAllocationScoped !== true
  ) {
    entitlementService.markPaidFunding = createScopedMarkPaidFunding(
      entitlementService.markPaidFunding
    );
  }

  // Load only after the entitlement exports above are patched. The payment
  // service destructures them during module initialization.
  const unifiedPaymentService = require("./subscription/unifiedDayPaymentService");
  if (
    unifiedPaymentService.verifyUnifiedDayPaymentFlow
    && unifiedPaymentService.verifyUnifiedDayPaymentFlow.__unifiedDayPaymentTerminalReleaseScoped !== true
  ) {
    unifiedPaymentService.verifyUnifiedDayPaymentFlow = createTerminalReservationReleaseWrapper(
      unifiedPaymentService.verifyUnifiedDayPaymentFlow,
      { transitionAllocation: entitlementService.transitionAllocation }
    );
  }

  const state = {
    installed: true,
    linkScoped: Boolean(
      entitlementService.linkPaymentToAllocations
        && entitlementService.linkPaymentToAllocations.__unifiedDayPaymentAllocationScoped === true
    ),
    validationScoped: Boolean(
      entitlementService.validatePaymentAllocations
        && entitlementService.validatePaymentAllocations.__unifiedDayPaymentAllocationScoped === true
    ),
    fundingScoped: Boolean(
      entitlementService.markPaidFunding
        && entitlementService.markPaidFunding.__unifiedDayPaymentAllocationScoped === true
    ),
    terminalReleaseScoped: Boolean(
      unifiedPaymentService.verifyUnifiedDayPaymentFlow
        && unifiedPaymentService.verifyUnifiedDayPaymentFlow.__unifiedDayPaymentTerminalReleaseScoped === true
    ),
  };
  globalThis[INSTALL_KEY] = state;
  return state;
}

installUnifiedDayPaymentAllocationScope();

module.exports = {
  INSTALL_KEY,
  installUnifiedDayPaymentAllocationScope,
};
