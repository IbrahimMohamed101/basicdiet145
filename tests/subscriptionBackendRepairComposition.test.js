"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  LEGACY_DAILY_ADDON_WRAP_KEY,
  STATE_KEY,
  installSubscriptionBackendRepairComposition,
  verifyComposition,
  verifyStaticAddonSchemas,
} = require("../src/services/installSubscriptionBackendRepairComposition");

const state = installSubscriptionBackendRepairComposition();
assert.strictEqual(state.status, "installed");
assert.ok(state.installedAt instanceof Date);
assert.deepStrictEqual(state.staticSchemaAuthority, {
  balanceLedgerStatic: true,
  subscriptionSelectionStatic: true,
  daySelectionStatic: true,
});
assert.deepStrictEqual(verifyStaticAddonSchemas(), state.staticSchemaAuthority);
assert.deepStrictEqual(state.legacyCarryoverProtection, {
  pricingCoreProtected: true,
  clientBalanceProtected: true,
  allowancesProtected: true,
});
assert.deepStrictEqual(verifyComposition(), {
  staticAddonSchemas: true,
  objectIdGuard: true,
  carryoverPricingCore: true,
  legacyCarryoverSuppressed: true,
  addonChoicesPricingCore: true,
  addonReservationLifecycle: true,
  addonOperationBoundary: true,
  readOnlyQueries: true,
  deliveryAppendSaga: true,
  pickupRequestRecovery: true,
  pickupAvailabilityDiagnosticsFailOpen: true,
  stableOpsAddonIdentity: true,
});
assert.strictEqual(globalThis[STATE_KEY], state);
assert.strictEqual(installSubscriptionBackendRepairComposition(), state, "composition re-entry after success must be idempotent");

const pricingService = require("../src/services/subscription/subscriptionAddonPricingService");
const addonChoicesService = require("../src/services/subscription/subscriptionAddonChoicesService");
assert.strictEqual(
  addonChoicesService.buildAddonChoicePricingPreview,
  pricingService.buildAddonChoicePricingPreviewCore,
  "the Add-on Choices service must capture the pure pricing core"
);
assert.strictEqual(
  addonChoicesService.buildAddonChoicePricingPreview[LEGACY_DAILY_ADDON_WRAP_KEY],
  true,
  "the pure pricing core must be protected before the legacy installer loads"
);

const productId = "64f000000000000000000001";
const planId = "64f000000000000000000002";
const bucketId = "64f000000000000000000003";
const entitlement = Object.freeze({
  addonPlanId: planId,
  addonId: planId,
  entitlementKey: `juice:${planId}`,
  category: "juice",
  allowanceCategory: "juice",
  quantityPerDay: 1,
  maxPerDay: 1,
  includedTotalQty: 5,
  unitPriceHalala: 500,
  currency: "SAR",
  menuProductIds: Object.freeze([productId]),
});
const subscription = {
  addonSubscriptions: [entitlement],
  addonBalance: [{
    _id: bucketId,
    addonPlanId: planId,
    addonId: planId,
    entitlementKey: entitlement.entitlementKey,
    category: "juice",
    includedTotalQty: 5,
    purchasedQty: 5,
    remainingQty: 4,
    reservedQty: 1,
    consumedQty: 0,
  }],
};

const preview = addonChoicesService.buildAddonChoicePricingPreview({
  subscription,
  entitlement,
  product: {
    _id: productId,
    priceHalala: 500,
    currency: "SAR",
  },
  quantity: 3,
});
assert.strictEqual(preview.coveredQty, 3);
assert.strictEqual(preview.paidQty, 0);
assert.strictEqual(preview.defaultDailyQty, 1);
assert.strictEqual(preview.walletRemainingQty, 4);
assert.strictEqual(entitlement.maxPerDay, 1, "frozen entitlement must remain unchanged");

console.log("subscription backend repair composition checks passed");
