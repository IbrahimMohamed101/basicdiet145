"use strict";

const STATE_KEY = Symbol.for("basicdiet.subscriptionBackendRepairComposition.state");
const LEGACY_DAILY_ADDON_WRAP_KEY = Symbol.for("basicdiet.subscriptionDailyAddonPolicy.wrapped");

const BALANCE_LIFECYCLE_PATHS = Object.freeze([
  "reservationKeys",
  "consumedAllocationKeys",
  "releasedAllocationKeys",
]);
const SELECTION_LIFECYCLE_PATHS = Object.freeze([
  "autoDailyAddon",
  "dailyEntitlement",
  "selectionOrigin",
  "dailyAllocationKey",
  "addonSettlementState",
  "reservedAt",
  "settledAt",
  "releasedAt",
  "settlementReason",
  "subscriptionAddonLabelI18n",
  "resolvedProductNameI18n",
  "requiresKitchenChoice",
]);

function assertInstalled(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = "SUBSCRIPTION_REPAIR_COMPOSITION_INCOMPLETE";
    throw error;
  }
}

function requireChildSchema(model, path, label) {
  const schemaPath = model && model.schema && model.schema.path(path);
  const childSchema = schemaPath && schemaPath.schema;
  assertInstalled(childSchema, `${label} is missing its declared child schema`);
  return childSchema;
}

function verifyStaticAddonSchemas() {
  const Subscription = require("../models/Subscription");
  const SubscriptionDay = require("../models/SubscriptionDay");
  const balanceSchema = requireChildSchema(Subscription, "addonBalance", "Subscription.addonBalance");
  const subscriptionSelectionSchema = requireChildSchema(Subscription, "addonSelections", "Subscription.addonSelections");
  const daySelectionSchema = requireChildSchema(SubscriptionDay, "addonSelections", "SubscriptionDay.addonSelections");

  for (const path of BALANCE_LIFECYCLE_PATHS) {
    assertInstalled(
      balanceSchema.path(path),
      `Subscription.addonBalance.${path} must be declared statically before startup composition`
    );
  }
  for (const path of SELECTION_LIFECYCLE_PATHS) {
    assertInstalled(
      subscriptionSelectionSchema.path(path),
      `Subscription.addonSelections.${path} must be declared statically before startup composition`
    );
    assertInstalled(
      daySelectionSchema.path(path),
      `SubscriptionDay.addonSelections.${path} must be declared statically before startup composition`
    );
  }

  const settlementPath = daySelectionSchema.path("addonSettlementState");
  assertInstalled(
    settlementPath
      && JSON.stringify(settlementPath.enumValues) === JSON.stringify(["", "reserved", "consumed", "released"]),
    "SubscriptionDay.addonSelections.addonSettlementState has an incompatible enum"
  );

  return {
    balanceLedgerStatic: true,
    subscriptionSelectionStatic: true,
    daySelectionStatic: true,
  };
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
  const entitlementService = require("./subscription/subscriptionMealEntitlementService");
  const premiumPaymentService = require("./subscription/premiumExtraDayPaymentService");
  const selectionService = require("./subscription/subscriptionSelectionService");
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
    entitlementService.reserveDayEntitlements
      && entitlementService.reserveDayEntitlements.__stableDaySlotIdentity === true,
    "Day meal entitlement reservation is still revision-dependent"
  );
  assertInstalled(
    premiumPaymentService.settlePaidPremiumExtraDayPayment
      && premiumPaymentService.settlePaidPremiumExtraDayPayment.__paidPremiumStateSynchronized === true,
    "Paid Premium settlement does not synchronize SubscriptionDay and Subscription mirrors"
  );
  assertInstalled(
    selectionService.performDaySelectionUpdate
      && selectionService.performDaySelectionUpdate.__preservesPaidPremiumState === true
      && selectionService.performDaySelectionValidation
      && selectionService.performDaySelectionValidation.__preservesPaidPremiumState === true,
    "Planner writes can downgrade an already-paid Premium selection"
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
    pickupService.getPickupAvailabilityForClient
      && pickupService.getPickupAvailabilityForClient.__pickupAvailabilityDiagnosticFailOpen === true,
    "Pickup availability diagnostics can still break the Flutter read contract"
  );
  assertInstalled(
    pickupService.createSubscriptionPickupRequestForClient
      && pickupService.createSubscriptionPickupRequestForClient.__pickupSubscriptionOwnershipRecovery === true
      && pickupService.getPickupAvailabilityForClient
      && pickupService.getPickupAvailabilityForClient.__pickupSubscriptionOwnershipRecovery === true,
    "Pickup routes did not capture the authenticated subscription ownership resolver"
  );
  assertInstalled(
    opsPayloadService.buildKitchenDetailsPayload
      && opsPayloadService.buildKitchenDetailsPayload.__stableAddonIdentity === true,
    "Ops add-on DTO stable identity mapper is not installed"
  );

  return {
    staticAddonSchemas: true,
    objectIdGuard: true,
    stableDaySlotMealReservation: true,
    paidPremiumStateConsistency: true,
    carryoverPricingCore: true,
    legacyCarryoverSuppressed: true,
    addonChoicesPricingCore: true,
    addonReservationLifecycle: true,
    addonOperationBoundary: true,
    readOnlyQueries: true,
    deliveryAppendSaga: true,
    pickupRequestRecovery: true,
    pickupAvailabilityDiagnosticsFailOpen: true,
    pickupSubscriptionOwnershipRecovery: true,
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
    staticSchemaAuthority: null,
    legacyCarryoverProtection: null,
  };
  globalThis[STATE_KEY] = state;

  try {
    state.staticSchemaAuthority = verifyStaticAddonSchemas();
    require("./installPickupCanonicalObjectIdCoreGuard");
    // Install before planning, Pickup, Delivery, payment, or recovery services
    // capture entitlement and paid-state functions by destructuring them.
    require("./installStableDayMealReservationIdentity");
    require("./installPaidPremiumStateConsistency");
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
    // This wrapper must be outermost so stale Flutter subscription ids are
    // resolved before recovery, diagnostics, or balance mutation code executes.
    require("./installPickupSubscriptionOwnershipRecovery");

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
  BALANCE_LIFECYCLE_PATHS,
  LEGACY_DAILY_ADDON_WRAP_KEY,
  SELECTION_LIFECYCLE_PATHS,
  STATE_KEY,
  installSubscriptionBackendRepairComposition,
  suppressLegacyCarryoverWrappers,
  verifyComposition,
  verifyStaticAddonSchemas,
};
