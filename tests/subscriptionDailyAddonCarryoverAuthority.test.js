"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonCarryoverAuthority");

const pricingService = require("../src/services/subscription/subscriptionAddonPricingService");
const balanceService = require("../src/services/subscription/subscriptionAddonBalanceService");
const { decorateAllowance } = require("../src/services/installSubscriptionAddonCarryoverAuthority");

const productId = "64b000000000000000000001";
const addonPlanId = "64b000000000000000000002";
const bucketId = "64b000000000000000000003";

const entitlement = {
  addonPlanId,
  addonId: addonPlanId,
  entitlementKey: `juice:${addonPlanId}`,
  category: "juice",
  allowanceCategory: "juice",
  quantityPerDay: 1,
  maxPerDay: 1,
  includedTotalQty: 10,
  unitPriceHalala: 500,
  currency: "SAR",
  menuProductIds: [productId],
  menuProductsSnapshot: [{ id: productId, key: "orange_juice", priceHalala: 500 }],
};

const subscription = {
  addonSubscriptions: [entitlement],
  addonBalance: [{
    _id: bucketId,
    addonPlanId,
    addonId: addonPlanId,
    entitlementKey: `juice:${addonPlanId}`,
    category: "juice",
    includedTotalQty: 10,
    purchasedQty: 10,
    consumedQty: 3,
    reservedQty: 2,
    remainingQty: 5,
    unitPriceHalala: 500,
    currency: "SAR",
  }],
};

assert.strictEqual(
  pricingService.buildAddonChoicePricingPreview,
  pricingService.buildAddonChoicePricingPreviewCore,
  "final startup composition must restore the pure core pricing implementation"
);

const entitlementBefore = JSON.stringify(entitlement);
const limits = pricingService.resolveAddonSpendLimits({ subscription, entitlement });
assert.deepStrictEqual(
  {
    defaultDailyQty: limits.defaultDailyQty,
    walletRemainingQty: limits.walletRemainingQty,
    maximumSpendableFromWallet: limits.maximumSpendableFromWallet,
    legacyMaxPerDay: limits.legacyMaxPerDay,
  },
  {
    defaultDailyQty: 1,
    walletRemainingQty: 5,
    maximumSpendableFromWallet: 5,
    legacyMaxPerDay: 5,
  }
);
assert.strictEqual(JSON.stringify(entitlement), entitlementBefore, "limit resolution must not mutate the entitlement");

const preview = pricingService.buildAddonChoicePricingPreview({
  subscription,
  entitlement,
  product: {
    _id: productId,
    key: "orange_juice",
    priceHalala: 500,
    currency: "SAR",
  },
  addonPlanId,
  entitlementKey: entitlement.entitlementKey,
  balanceBucketId: bucketId,
  category: "juice",
  quantity: 7,
});

assert.strictEqual(preview.requestedQty, 7);
assert.strictEqual(preview.coveredQty, 5, "all remaining wallet units must be spendable as carryover");
assert.strictEqual(preview.paidQty, 2, "quantity above the wallet must remain payable, not rejected by the daily default");
assert.strictEqual(preview.payableTotalHalala, 1000);
assert.strictEqual(preview.defaultDailyQty, 1);
assert.strictEqual(preview.walletRemainingQty, 5);
assert.strictEqual(preview.maximumSpendableFromWallet, 5);
assert.strictEqual(preview.maxPerDay, 5, "Flutter compatibility alias must remain present");
assert.strictEqual(preview.pooledCarryoverEnabled, true);
assert.strictEqual(JSON.stringify(entitlement), entitlementBefore, "pricing preview must not mutate the entitlement");

const decorated = decorateAllowance(subscription, {
  entitlementIndex: 0,
  entitlementKey: entitlement.entitlementKey,
  addonPlanId,
  remainingIncludedQty: 5,
  maxPerDay: 1,
});
assert.strictEqual(decorated.defaultDailyQty, 1);
assert.strictEqual(decorated.walletRemainingQty, 5);
assert.strictEqual(decorated.maximumSpendableFromWallet, 5);
assert.strictEqual(decorated.maxPerDay, 5);
assert.strictEqual(decorated.carryoverPolicy, "TOTAL_BALANCE_WITHIN_VALIDITY");

const allowances = balanceService.buildAddonSubscriptionAllowances(subscription, { addonSelections: [] });
assert.strictEqual(allowances.length, 1);
assert.strictEqual(allowances[0].defaultDailyQty, 1);
assert.strictEqual(allowances[0].walletRemainingQty, 5);
assert.strictEqual(allowances[0].maximumSpendableFromWallet, 5);
assert.strictEqual(allowances[0].maxPerDay, 5);

console.log("subscription daily add-on carryover authority checks passed");
