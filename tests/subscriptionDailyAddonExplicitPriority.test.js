"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function buildCase({ dailyQty }) {
  const userId = oid();
  const planId = oid();
  const addonPlanId = oid();
  const productId = oid();
  const bucketId = oid();
  const entitlementKey = `juice:${String(addonPlanId)}`;
  const subscription = await Subscription.create({
    userId,
    planId,
    status: "active",
    totalMeals: 20,
    remainingMeals: 20,
    deliveryMode: "delivery",
    deliveryWindow: "18:00-20:00",
    addonSubscriptions: [{
      addonId: addonPlanId,
      addonPlanId,
      name: "عصير",
      addonPlanName: "عصير",
      category: "juice",
      allowanceCategory: "juice",
      entitlementKey,
      quantityPerDay: dailyQty,
      purchasedDailyQty: dailyQty,
      includedTotalQty: 6,
      menuProductIds: [productId],
      menuProductsSnapshot: [{
        id: productId,
        key: "orange_juice",
        nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
      }],
    }],
    addonBalance: [{
      _id: bucketId,
      addonPlanId,
      addonId: addonPlanId,
      entitlementKey,
      category: "juice",
      allowanceCategory: "juice",
      includedTotalQty: 6,
      purchasedQty: 6,
      remainingQty: 6,
      reservedQty: 0,
      consumedQty: 0,
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });

  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-29",
    status: "open",
    plannerState: "confirmed",
    plannerVersion: "v1",
    plannerRevisionHash: `explicit-priority-${dailyQty}`,
    mealSlots: [],
    addonSelections: [{
      addonId: productId,
      productId,
      menuProductId: productId,
      addonPlanId,
      name: "عصير برتقال",
      nameI18n: { ar: "عصير برتقال", en: "Orange Juice" },
      category: "juice",
      entitlementCategory: "juice",
      entitlementKey,
      balanceBucketId: bucketId,
      source: "pending_payment",
      qty: 1,
      quantity: 1,
      coveredQty: 0,
      paidQty: 1,
      pricingMode: "paid_overage",
      currency: "SAR",
    }],
  });

  return { subscription, day, bucketId };
}

async function bucketFor(subscriptionId, bucketId) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  return subscription.addonBalance.find((row) => String(row._id) === String(bucketId));
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `addon-explicit-priority-${Date.now()}` });

    const fullExplicit = await buildCase({ dailyQty: 1 });
    const result = await dailyAddonService.ensureDailyAddonDefaultsForDay({
      dayId: fullExplicit.day._id,
    });
    assert.strictEqual(result.releasedForExplicitPriority, 1, "temporary default must be removed after explicit choice wins");

    let day = await SubscriptionDay.findById(fullExplicit.day._id).lean();
    assert.strictEqual(day.addonSelections.length, 1);
    assert.strictEqual(day.addonSelections[0].source, "pending_payment");
    assert.strictEqual(day.addonSelections.filter((selection) => selection.autoDailyAddon).length, 0);

    let bucket = await bucketFor(fullExplicit.subscription._id, fullExplicit.bucketId);
    assert.strictEqual(Number(bucket.remainingQty), 6);
    assert.strictEqual(Number(bucket.reservedQty), 0);
    assert.strictEqual(Number(bucket.consumedQty), 0);

    await mongoose.connection.dropDatabase();

    const partialExplicit = await buildCase({ dailyQty: 2 });
    await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: partialExplicit.day._id });

    day = await SubscriptionDay.findById(partialExplicit.day._id).lean();
    assert.strictEqual(day.addonSelections.length, 2, "one explicit choice plus one missing daily entitlement must remain");
    assert.strictEqual(day.addonSelections.filter((selection) => selection.autoDailyAddon).length, 1);
    assert.strictEqual(day.addonSelections.filter((selection) => selection.source === "pending_payment").length, 1);

    bucket = await bucketFor(partialExplicit.subscription._id, partialExplicit.bucketId);
    assert.strictEqual(Number(bucket.remainingQty), 5);
    assert.strictEqual(Number(bucket.reservedQty), 1);
    assert.strictEqual(Number(bucket.consumedQty), 0);

    console.log("subscription daily add-on explicit priority checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
