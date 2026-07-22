"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");
const closure = require("../src/services/installSubscriptionAddonReservationClosure");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function buildExplicitCase({
  remainingQty = 3,
  reservedQty = 0,
  consumedQty = 1,
  purchasedQty = 4,
} = {}) {
  const userId = oid();
  const planId = oid();
  const addonPlanId = oid();
  const productId = oid();
  const bucketId = oid();
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
      entitlementKey: `juice:${String(addonPlanId)}`,
      quantityPerDay: 1,
      includedTotalQty: purchasedQty,
      menuProductIds: [productId],
    }],
    addonBalance: [{
      _id: bucketId,
      addonPlanId,
      addonId: addonPlanId,
      entitlementKey: `juice:${String(addonPlanId)}`,
      category: "juice",
      allowanceCategory: "juice",
      includedTotalQty: purchasedQty,
      purchasedQty,
      remainingQty,
      reservedQty,
      consumedQty,
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });

  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-28",
    status: "open",
    plannerState: "confirmed",
    plannerVersion: "v1",
    plannerRevisionHash: "explicit-reservation-lifecycle",
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
      entitlementKey: `juice:${String(addonPlanId)}`,
      balanceBucketId: bucketId,
      source: "subscription",
      qty: 1,
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      pricingMode: "allowance_covered",
      currency: "SAR",
    }],
  });

  return { subscription, day, bucketId };
}

async function getBucket(subscriptionId, bucketId) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  return subscription.addonBalance.find((row) => String(row._id) === String(bucketId));
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `addon-reservation-${Date.now()}` });

    const fulfillmentCase = await buildExplicitCase();
    const reserved = await closure.reserveExplicitSubscriptionSelectionsForDay({
      dayId: fulfillmentCase.day._id,
    });
    assert.strictEqual(reserved.reservedCount, 1);

    let bucket = await getBucket(fulfillmentCase.subscription._id, fulfillmentCase.bucketId);
    assert.strictEqual(Number(bucket.remainingQty), 3, "planning must not spend another remaining unit");
    assert.strictEqual(Number(bucket.reservedQty), 1, "explicit choice must be reserved until fulfillment");
    assert.strictEqual(Number(bucket.consumedQty), 0, "explicit choice must not remain consumed before fulfillment");
    assert.strictEqual(bucket.reservationKeys.length, 1);

    let day = await SubscriptionDay.findById(fulfillmentCase.day._id).lean();
    assert.strictEqual(day.addonSelections[0].addonSettlementState, "reserved");
    assert.strictEqual(day.addonSelections[0].selectionOrigin, "customer_selected");
    assert.ok(day.addonSelections[0].dailyAllocationKey);
    assert.strictEqual(day.addonSelections[0].consumedAt, null);

    const walletBeforeFulfill = dailyAddonService.buildDailyAddonWallet(
      await Subscription.findById(fulfillmentCase.subscription._id).lean()
    );
    assert.strictEqual(walletBeforeFulfill.invariantValid, true);
    assert.strictEqual(walletBeforeFulfill.rows[0].accountedQty, 4);

    const fulfilled = await dailyAddonService.consumeDailyAddonReservationsForDay({
      dayId: fulfillmentCase.day._id,
      reason: "fulfilled",
    });
    assert.strictEqual(fulfilled.consumedCount, 1);

    bucket = await getBucket(fulfillmentCase.subscription._id, fulfillmentCase.bucketId);
    assert.strictEqual(Number(bucket.remainingQty), 3);
    assert.strictEqual(Number(bucket.reservedQty), 0);
    assert.strictEqual(Number(bucket.consumedQty), 1);
    assert.strictEqual(bucket.reservationKeys.length, 0);
    assert.strictEqual(bucket.consumedAllocationKeys.length, 1);

    day = await SubscriptionDay.findById(fulfillmentCase.day._id).lean();
    assert.strictEqual(day.addonSelections[0].addonSettlementState, "consumed");
    assert.ok(day.addonSelections[0].consumedAt);

    const duplicateFulfill = await dailyAddonService.consumeDailyAddonReservationsForDay({
      dayId: fulfillmentCase.day._id,
      reason: "fulfilled",
    });
    assert.strictEqual(duplicateFulfill.consumedCount, 0, "fulfill retry must be idempotent");

    await mongoose.connection.dropDatabase();

    const releaseCase = await buildExplicitCase();
    await closure.reserveExplicitSubscriptionSelectionsForDay({ dayId: releaseCase.day._id });
    const released = await dailyAddonService.releaseSubscriptionAddonSelectionsForDay({
      dayId: releaseCase.day._id,
      reason: "day_skipped_returned_to_balance",
    });
    assert.strictEqual(released.releasedCount, 1);

    bucket = await getBucket(releaseCase.subscription._id, releaseCase.bucketId);
    assert.strictEqual(Number(bucket.remainingQty), 4);
    assert.strictEqual(Number(bucket.reservedQty), 0);
    assert.strictEqual(Number(bucket.consumedQty), 0);

    day = await SubscriptionDay.findById(releaseCase.day._id).lean();
    assert.strictEqual(day.addonSelections[0].addonSettlementState, "released");

    const duplicateRelease = await dailyAddonService.releaseSubscriptionAddonSelectionsForDay({
      dayId: releaseCase.day._id,
      reason: "day_skipped_returned_to_balance",
    });
    assert.strictEqual(duplicateRelease.releasedCount, 0, "release retry must be idempotent");

    await mongoose.connection.dropDatabase();

    const detachedCase = await buildExplicitCase({
      remainingQty: 2,
      reservedQty: 2,
      consumedQty: 0,
      purchasedQty: 4,
    });
    const explicitSelection = (await SubscriptionDay.findById(detachedCase.day._id).lean()).addonSelections[0];
    const explicitKey = closure.explicitAllocationKey({
      subscriptionId: detachedCase.subscription._id,
      date: detachedCase.day.date,
      selectionId: explicitSelection._id,
      bucketId: detachedCase.bucketId,
    });
    await Subscription.updateOne(
      { _id: detachedCase.subscription._id, "addonBalance._id": detachedCase.bucketId },
      {
        $set: {
          "addonBalance.$.reservationKeys": ["old-auto-allocation", explicitKey],
        },
      }
    );
    await SubscriptionDay.updateOne(
      { _id: detachedCase.day._id, "addonSelections._id": explicitSelection._id },
      {
        $set: {
          "addonSelections.$.dailyAllocationKey": explicitKey,
          "addonSelections.$.addonSettlementState": "reserved",
        },
      }
    );

    const detached = await closure.releaseDetachedAutoReservations({
      dayId: detachedCase.day._id,
      previousSelections: [{
        autoDailyAddon: true,
        addonSettlementState: "reserved",
        dailyAllocationKey: "old-auto-allocation",
        balanceBucketId: detachedCase.bucketId,
      }],
    });
    assert.strictEqual(detached.releasedCount, 1);

    bucket = await getBucket(detachedCase.subscription._id, detachedCase.bucketId);
    assert.strictEqual(Number(bucket.remainingQty), 3);
    assert.strictEqual(Number(bucket.reservedQty), 1);
    assert.deepStrictEqual(bucket.reservationKeys, [explicitKey]);

    const invalidWallet = closure.buildExactDailyAddonWallet({
      addonBalance: [{
        _id: oid(),
        addonId: oid(),
        purchasedQty: 4,
        remainingQty: 1,
        reservedQty: 1,
        consumedQty: 1,
      }],
    });
    assert.strictEqual(invalidWallet.invariantValid, false);
    assert.strictEqual(invalidWallet.rows[0].balanceDriftQty, 1);

    console.log("subscription daily add-on reservation lifecycle checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
