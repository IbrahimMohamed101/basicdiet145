"use strict";

const STATE_KEY = Symbol.for("basicdiet.subscriptionBackendRepairComposition.state");
const LEGACY_DAILY_ADDON_WRAP_KEY = Symbol.for("basicdiet.subscriptionDailyAddonPolicy.wrapped");

function assertInstalled(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = "SUBSCRIPTION_REPAIR_COMPOSITION_INCOMPLETE";
    throw error;
  }
}

function protectFunctionFromLegacyWrapper(fn, label) {
  if (typeof fn !== "function") {
    const error = new Error(`Missing function while protecting legacy carryover authority: ${label}`);
    error.code = "SUBSCRIPTION_REPAIR_COMPOSITION_INCOMPLETE";
    throw error;
  }
  Object.defineProperty(fn, LEGACY_DAILY_ADDON_WRAP_KEY, {
    value: true,
    configurable: true,
  });
  Object.defineProperty(fn, "__legacyCarryoverProtected", {
    value: true,
    configurable: true,
  });
  return fn;
}

function suppressLegacyCarryoverWrappers() {
  const pricingService = require("./subscription/subscriptionAddonPricingService");
  const balanceService = require("./subscription/subscriptionAddonBalanceService");

  protectFunctionFromLegacyWrapper(
    pricingService.buildAddonChoicePricingPreview,
    "subscriptionAddonPricingService.buildAddonChoicePricingPreview"
  );
  protectFunctionFromLegacyWrapper(
    balanceService.buildClientAddonBalance,
    "subscriptionAddonBalanceService.buildClientAddonBalance"
  );
  protectFunctionFromLegacyWrapper(
    balanceService.buildAddonSubscriptionAllowances,
    "subscriptionAddonBalanceService.buildAddonSubscriptionAllowances"
  );

  return {
    pricingCoreProtected: true,
    clientBalanceProtected: true,
    allowancesProtected: true,
  };
}

function verifyComposition() {
  const presentation = require("./subscription/pickupCanonicalPresentationService");
  const pricingService = require("./subscription/subscriptionAddonPricingService");
  const addonChoicesService = require("./subscription/subscriptionAddonChoicesService");
  const dailyAddonService = require("./subscription/subscriptionDailyAddonService");
  const planningService = require("./subscription/subscriptionPlanningClientService");
  const pickupService = require("./subscription/subscriptionPickupRequestClientService");
  const opsPayloadService = require("./dashboard/opsPayloadService");

  assertInstalled(
    presentation.normalizePickupItem && presentation.normalizePickupItem.__cycleSafeObjectIds === true,
    "Pickup canonical presentation is missing the cycle-safe ObjectId boundary"
  );
  assertInstalled(
    pricingService.buildAddonChoicePricingPreview === pricingService.buildAddonChoicePricingPreviewCore,
    "Add-on pricing is not using the non-mutating carryover core"
  );
  assertInstalled(
    pricingService.buildAddonChoicePricingPreview.__legacyCarryoverProtected === true,
    "The pricing core was exposed to the legacy entitlement mutation wrapper"
  );
  assertInstalled(
    addonChoicesService.buildAddonChoicePricingPreview === pricingService.buildAddonChoicePricingPreviewCore,
    "Add-on choices captured a legacy carryover pricing reference"
  );
  assertInstalled(
    dailyAddonService.__reservationClosurePatched === true,
    "Daily add-on reservation lifecycle closure is not installed"
  );
  assertInstalled(
    dailyAddonService.ensureDailyAddonDefaultsForDay
      && dailyAddonService.ensureDailyAddonDefaultsForDay.__operationBoundaryAware === true,
    "Daily add-on operations boundary is not the final ensure authority"
  );
  assertInstalled(
    dailyAddonService.ensureDailyAddonDefaultsForDay.__original
      && dailyAddonService.ensureDailyAddonDefaultsForDay.__original.__reservationReconciliation === true,
    "Daily add-on reservation reconciliation is not inside the operation boundary"
  );
  assertInstalled(
    dailyAddonService.reconcileDayDailyAddonState
      && dailyAddonService.reconcileDayDailyAddonState.__readOnlyDiagnostic === true,
    "Daily add-on read reconciliation is not read-only"
  );
  assertInstalled(
    planningService.appendDayMealsForClient
      && planningService.appendDayMealsForClient.__deliveryAppendSaga === true,
    "Delivery append saga is not installed"
  );
  assertInstalled(
    pickupService.createSubscriptionPickupRequestForClient
      && pickupService.createSubscriptionPickupRequestForClient.__pickupReservationRecovery === true,
    "Pickup request crash recovery is not installed"
  );
  assertInstalled(
    opsPayloadService.buildKitchenDetailsPayload
      && opsPayloadService.buildKitchenDetailsPayload.__stableAddonIdentity === true,
    "Ops add-on DTO stable identity mapper is not installed"
  );

  return {
    objectIdGuard: true,
    carryoverPricingCore: true,
    legacyCarryoverSuppressed: true,
    addonChoicesPricingCore: true,
    addonReservationLifecycle: true,
    addonOperationBoundary: true,
    readOnlyQueries: true,
    deliveryAppendSaga: true,
    pickupRequestRecovery: true,
    stableOpsAddonIdentity: true,
  };
}

function installSubscriptionBackendRepairComposition() {
  const current = globalThis[STATE_KEY];
  if (current && current.status === "installed") return current;
  if (current && current.status === "installing") {
    const error = new Error("Subscription backend repair composition was re-entered during installation");
    error.code = "SUBSCRIPTION_REPAIR_COMPOSITION_REENTRANT";
    throw error;
  }

  const state = {
    status: "installing",
    startedAt: new Date(),
    installedAt: null,
    verification: null,
    legacyCarryoverProtection: null,
  };
  globalThis[STATE_KEY] = state;

  try {
    require("./installPickupCanonicalObjectIdCoreGuard");
    state.legacyCarryoverProtection = suppressLegacyCarryoverWrappers();
    require("./installSubscriptionDailyAddonPolicy");
    require("./installSubscriptionAddonCarryoverAuthority");
    require("./installSubscriptionAddonReservationClosure");
    require("./installSubscriptionAddonReservationReconciliation");
    require("./installSubscriptionDailyAddonOperationBoundary");
    require("./installSubscriptionAddonOpsIdentityClosure");
    require("./installPickupRequestRecovery");
    require("./installSubscriptionDeliveryAppendSaga");
    require("./installReadOnlySubscriptionQueries");

    state.verification = verifyComposition();
    state.status = "installed";
    state.installedAt = new Date();
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode = error && error.code || "SUBSCRIPTION_REPAIR_COMPOSITION_FAILED";
    state.errorMessage = error && error.message || "Subscription repair composition failed";
    throw error;
  }
}

installSubscriptionBackendRepairComposition();

module.exports = {
  LEGACY_DAILY_ADDON_WRAP_KEY,
  STATE_KEY,
  installSubscriptionBackendRepairComposition,
  suppressLegacyCarryoverWrappers,
  verifyComposition,
};
