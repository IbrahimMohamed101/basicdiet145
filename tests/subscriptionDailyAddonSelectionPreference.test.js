"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function buildCase({ deliveryMode, quantityPerDay, explicitCount }) {
  const userId = oid();
  const planId = oid();
  const addonPlanId = oid();
  const bucketId = oid();
  const productId = oid();
  const total = 8;
  const subscription = await Subscription.create({
    userId,
    planId,
    status: "active",
    totalMeals: 20,
    remainingMeals: 20,
    deliveryMode,
    deliveryWindow: deliveryMode === "delivery" ? "18:00-20:00" : undefined,
    pickupLocationId: deliveryMode === "pickup" ? "main" : "",
    addonSubscriptions: [{
      addonId: addonPlanId,
      addonPlanId,
      name: "عصير",
      addonPlanName: "عصير",
      addonPlanNameI18n: { ar: "عصير", en: "Juice" },
      category: "juice",
      allowanceCategory: "juice",
      entitlementKey: `juice:${String(addonPlanId)}`,
      maxPerDay: 1,
      quantityPerDay,
      purchasedDailyQty: quantityPerDay,
      includedTotalQty: total,
      unitPriceHalala: 500,
      currency: "SAR",
      menuProductIds: [productId],
      menuProductsSnapshot: [{
        id: productId,
        key: "orange_juice",
        nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
        priceHalala: 500,
        currency: "SAR",
      }],
    }],
    addonBalance: [{
      _id: bucketId,
      addonPlanId,
      addonId: addonPlanId,
      entitlementKey: `juice:${String(addonPlanId)}`,
      category: "juice",
      allowanceCategory: "juice",
      purchasedDailyQty: quantityPerDay,
      includedTotalQty: total,
      purchasedQty: total,
      remainingQty: total - explicitCount,
      consumedQty: explicitCount,
      reservedQty: 0,
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });

  const explicitSelections = Array.from({ length: explicitCount }, () => ({
    addonId: productId,
    productId,
    menuProductId: productId,
    addonPlanId,
    name: "عصير برتقال",
    nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
    category: "juice",
    entitlementCategory: "juice",
    entitlementKey: `juice:${String(addonPlanId)}`,
    balanceBucketId: bucketId,
    source: "subscription",
    qty: 1,
    quantity: 1,
    coveredQty: 1,
    paidQty: 0,
    pricingMode: "allowance_covered",
    maxPerDay: total,
    currency: "SAR",
  }));

  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: deliveryMode === "pickup" ? "2026-07-27" : "2026-07-26",
    status: "open",
    plannerState: "confirmed",
    plannerVersion: "v1",
    plannerRevisionHash: "revision-choice",
    mealSlots: [],
    addonSelections: explicitSelections,
  });
  return { subscription, day, bucketId };
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `daily-addon-choice-${Date.now()}` });

    const explicitWins = await buildCase({ deliveryMode: "delivery", quantityPerDay: 1, explicitCount: 1 });
    const explicitResult = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: explicitWins.day._id });
    assert.strictEqual(explicitResult.appliedCount, 0, "explicit customer choice must prevent a duplicate daily default");
    let day = await SubscriptionDay.findById(explicitWins.day._id).lean();
    assert.strictEqual(day.addonSelections.length, 1);
    assert.strictEqual(day.addonSelections[0].autoDailyAddon, false);

    await mongoose.connection.dropDatabase();

    const fillOnlyMissing = await buildCase({ deliveryMode: "delivery", quantityPerDay: 2, explicitCount: 1 });
    const fillResult = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fillOnlyMissing.day._id });
    assert.strictEqual(fillResult.appliedCount, 1, "only the missing daily quantity should be auto-reserved");
    day = await SubscriptionDay.findById(fillOnlyMissing.day._id).lean();
    assert.strictEqual(day.addonSelections.length, 2);
    assert.strictEqual(day.addonSelections.filter((selection) => selection.autoDailyAddon).length, 1);
    let subscription = await Subscription.findById(fillOnlyMissing.subscription._id).lean();
    let bucket = subscription.addonBalance.find((row) => String(row._id) === String(fillOnlyMissing.bucketId));
    assert.strictEqual(Number(bucket.remainingQty), 6);
    assert.strictEqual(Number(bucket.reservedQty), 1);
    assert.strictEqual(Number(bucket.consumedQty), 1);

    await mongoose.connection.dropDatabase();

    const pickupDefault = await buildCase({ deliveryMode: "pickup", quantityPerDay: 1, explicitCount: 0 });
    const pickupResult = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: pickupDefault.day._id });
    assert.strictEqual(pickupResult.appliedCount, 1, "the same daily entitlement applies to pickup subscriptions");
    day = await SubscriptionDay.findById(pickupDefault.day._id).lean();
    assert.strictEqual(day.addonSelections[0].autoDailyAddon, true);
    assert.match(day.addonSelections[0].name, /اشتراك/);

    console.log("subscription daily add-on customer preference checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
