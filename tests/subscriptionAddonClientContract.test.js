"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const pooledPolicy = require("../src/services/installSubscriptionPooledDayPlanningPolicy");
const addonContract = require("../src/services/installSubscriptionAddonClientContract");
const addonChoices = require("../src/services/subscription/subscriptionAddonChoicesService");
const addonPricing = require("../src/services/subscription/subscriptionAddonPricingService");

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
  }

  sort() {
    return this;
  }

  lean() {
    return this;
  }

  limit() {
    return this;
  }

  then(resolve, reject) {
    return Promise.resolve(this.rows).then(resolve, reject);
  }
}

function testMongoosePlanningViewKeepsWalletCapacity() {
  const mongooseLikePlanningView = {
    _doc: {
      totalMeals: 14,
      remainingMeals: 14,
      selectedMealsPerDay: 2,
    },
    premiumBalance: [],
  };

  assert.strictEqual(
    pooledPolicy.resolvePooledPlannerMax({
      subscription: mongooseLikePlanningView,
      maxSlotCount: 0,
    }),
    14,
    "delivery validation must not collapse a 14-meal Mongoose planning view to zero slots"
  );
  assert.strictEqual(
    pooledPolicy.plainSubscriptionView(mongooseLikePlanningView).remainingMeals,
    14
  );
}

async function testUpcomingSubscriptionIsUsedForAddonChoices() {
  const upcoming = {
    _id: "507f191e810c19729de86101",
    userId: "507f191e810c19729de86102",
    status: "active",
    startDate: new Date("2099-01-01T00:00:00.000Z"),
    endDate: new Date("2099-01-07T23:59:59.999Z"),
    validityEndDate: new Date("2099-01-07T23:59:59.999Z"),
    createdAt: new Date("2026-07-22T16:52:39.513Z"),
  };
  const SubscriptionModel = {
    find() {
      return new FakeQuery([upcoming]);
    },
  };

  const resolved = await addonChoices.findCurrentSubscriptionForUser(
    upcoming.userId,
    { SubscriptionModel }
  );

  assert.ok(resolved, "authenticated add-on choices must resolve an upcoming active subscription");
  assert.strictEqual(String(resolved._id), String(upcoming._id));
}

function addonFixture({ remainingQty = 7 } = {}) {
  const addonPlanId = "507f191e810c19729de86110";
  const productId = "507f191e810c19729de86111";
  const bucketId = "507f191e810c19729de86112";
  const entitlement = {
    addonId: addonPlanId,
    addonPlanId,
    category: "snack",
    allowanceCategory: "snack",
    includedTotalQty: 7,
    quantityPerDay: 1,
    maxPerDay: 1,
    unitPriceHalala: 0,
    unitPlanPriceHalala: 8000,
    priceHalala: 8000,
    menuProductIds: [productId],
  };
  const subscription = {
    addonSubscriptions: [entitlement],
    addonBalance: [{
      _id: bucketId,
      addonId: addonPlanId,
      addonPlanId,
      category: "snack",
      includedTotalQty: 7,
      purchasedQty: 7,
      remainingQty,
      consumedQty: 7 - remainingQty,
      reservedQty: 0,
      unitIncludedPriceHalala: 8000,
      overageUnitPriceHalala: 8000,
      unitPriceHalala: 8000,
      currency: "SAR",
    }],
  };
  const product = {
    _id: productId,
    priceHalala: 0,
    currency: "SAR",
  };
  return { addonPlanId, bucketId, entitlement, product, subscription };
}

function testCoveredZeroSnapshotUsesPurchasedPriceAuthority() {
  const fixture = addonFixture({ remainingQty: 7 });
  const preview = addonPricing.buildAddonChoicePricingPreview({
    subscription: fixture.subscription,
    entitlement: fixture.entitlement,
    product: fixture.product,
    addonPlanId: fixture.addonPlanId,
    balanceBucketId: fixture.bucketId,
    category: "snack",
    quantity: 1,
  });

  assert.strictEqual(preview.source, "subscription");
  assert.strictEqual(preview.pricingMode, "allowance_covered");
  assert.strictEqual(preview.coveredQty, 1);
  assert.strictEqual(preview.paidQty, 0);
  assert.strictEqual(preview.unitPriceHalala, 8000);
  assert.strictEqual(preview.priceHalala, 8000);
  assert.strictEqual(preview.payableTotalHalala, 0);
}

function testExhaustedAllowanceNeverCreatesZeroInvoice() {
  const fixture = addonFixture({ remainingQty: 0 });
  const preview = addonPricing.buildAddonChoicePricingPreview({
    subscription: fixture.subscription,
    entitlement: fixture.entitlement,
    product: fixture.product,
    addonPlanId: fixture.addonPlanId,
    balanceBucketId: fixture.bucketId,
    category: "snack",
    quantity: 1,
    remainingQtyOverride: 0,
  });

  assert.strictEqual(preview.source, "pending_payment");
  assert.strictEqual(preview.paidQty, 1);
  assert.strictEqual(preview.unitPriceHalala, 8000);
  assert.strictEqual(preview.payableTotalHalala, 8000);
}

function testUnpricedPayableAddonFailsClosed() {
  const product = {
    _id: "507f191e810c19729de86121",
    priceHalala: 0,
    currency: "SAR",
  };

  const listingPreview = addonPricing.buildAddonChoicePricingPreview({
    subscription: null,
    entitlement: null,
    product,
    category: "snack",
    quantity: 1,
  });
  assert.strictEqual(listingPreview.invalidPrice, true);
  assert.strictEqual(listingPreview.pricingMode, "invalid_price");

  assert.throws(
    () => addonPricing.buildAddonChoicePricingPreview({
      subscription: null,
      entitlement: null,
      product,
      category: "snack",
      quantity: 1,
      remainingQtyOverride: 0,
    }),
    (err) => err && err.code === "INVALID_ADDON_PRICE" && err.status === 422
  );
}

function testFlutterGroupsHideInvalidZeroPriceRows() {
  const groups = addonContract.normalizeAddonChoiceGroups([{
    groupId: "group",
    choicesCount: 2,
    choices: [
      {
        id: "invalid",
        pricingMode: "invalid_price",
        invalidPrice: true,
        priceHalala: 0,
        unitPriceHalala: 0,
      },
      {
        id: "covered",
        source: "subscription",
        pricingMode: "allowance_covered",
        coveredQty: 1,
        paidQty: 0,
        unitPriceHalala: 8000,
        payableTotalHalala: 0,
      },
    ],
  }]);

  assert.strictEqual(groups[0].choicesCount, 1);
  assert.strictEqual(groups[0].choices[0].id, "covered");
  assert.strictEqual(groups[0].choices[0].priceHalala, 8000);
  assert.strictEqual(groups[0].choices[0].priceSar, 80);
  assert.strictEqual(groups[0].choices[0].payableTotalHalala, 0);
}

async function run() {
  testMongoosePlanningViewKeepsWalletCapacity();
  await testUpcomingSubscriptionIsUsedForAddonChoices();
  testCoveredZeroSnapshotUsesPurchasedPriceAuthority();
  testExhaustedAllowanceNeverCreatesZeroInvoice();
  testUnpricedPayableAddonFailsClosed();
  testFlutterGroupsHideInvalidZeroPriceRows();
  console.log("subscription add-on client contract checks passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
