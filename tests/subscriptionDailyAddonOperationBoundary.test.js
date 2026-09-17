"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionDailyAddonOperationBoundary");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");
const {
  canCreateDailyAddonDefaultsForStatus,
} = require("../src/services/installSubscriptionDailyAddonOperationBoundary");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function buildCase(status) {
  const addonPlanId = oid();
  const productId = oid();
  const bucketId = oid();
  const subscription = await Subscription.create({
    userId: oid(),
    planId: oid(),
    status: "active",
    totalMeals: 20,
    remainingMeals: 20,
    deliveryMode: "pickup",
    pickupLocationId: "main",
    addonSubscriptions: [{
      addonId: addonPlanId,
      addonPlanId,
      name: "عصير",
      addonPlanName: "عصير",
      addonPlanNameI18n: { ar: "اشتراك عصير", en: "Juice Subscription" },
      category: "juice",
      allowanceCategory: "juice",
      entitlementKey: `juice:${String(addonPlanId)}`,
      quantityPerDay: 1,
      includedTotalQty: 4,
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
      includedTotalQty: 4,
      purchasedQty: 4,
      remainingQty: 4,
      reservedQty: 0,
      consumedQty: 0,
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-29",
    status,
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerVersion: "v1",
    plannerRevisionHash: `operation-boundary-${status}`,
    mealSlots: [],
    addonSelections: [],
  });
  return { subscription, day, bucketId };
}

async function bucket(subscriptionId, bucketId) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  return subscription.addonBalance.find((row) => String(row._id) === String(bucketId));
}

async function run() {
  assert.strictEqual(canCreateDailyAddonDefaultsForStatus("open"), true);
  assert.strictEqual(canCreateDailyAddonDefaultsForStatus("locked"), true);
  for (const status of ["in_preparation", "ready_for_pickup", "ready_for_delivery", "out_for_delivery", "fulfilled"]) {
    assert.strictEqual(canCreateDailyAddonDefaultsForStatus(status), false, `${status} must not accept new daily defaults`);
  }

  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `addon-operation-boundary-${Date.now()}` });

    const lateCase = await buildCase("in_preparation");
    const beforeBucket = await bucket(lateCase.subscription._id, lateCase.bucketId);
    const lateResult = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: lateCase.day._id });
    assert.strictEqual(lateResult.skipped, true);
    assert.strictEqual(lateResult.reason, "operations_already_started");
    assert.strictEqual(lateResult.operationBoundary.reconciliationRequired, true);
    assert.strictEqual(lateResult.operationBoundary.recommendedAction, "review_missing_daily_addon_before_next_transition");

    const lateDay = await SubscriptionDay.findById(lateCase.day._id).lean();
    const afterBucket = await bucket(lateCase.subscription._id, lateCase.bucketId);
    assert.strictEqual(lateDay.addonSelections.length, 0, "late operation reads/transitions must not inject a kitchen item");
    assert.strictEqual(Number(afterBucket.remainingQty), Number(beforeBucket.remainingQty));
    assert.strictEqual(Number(afterBucket.reservedQty), Number(beforeBucket.reservedQty));

    await mongoose.connection.dropDatabase();

    const lockedCase = await buildCase("locked");
    const lockedResult = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: lockedCase.day._id });
    assert.strictEqual(Boolean(lockedResult.skipped), false, "locked is the last allowed boundary before preparation");
    const lockedDay = await SubscriptionDay.findById(lockedCase.day._id).lean();
    const lockedBucket = await bucket(lockedCase.subscription._id, lockedCase.bucketId);
    assert.strictEqual(lockedDay.addonSelections.length, 1);
    assert.strictEqual(lockedDay.addonSelections[0].addonSettlementState, "reserved");
    assert.strictEqual(Number(lockedBucket.remainingQty), 3);
    assert.strictEqual(Number(lockedBucket.reservedQty), 1);

    await SubscriptionDay.updateOne(
      { _id: lockedCase.day._id },
      { $set: { status: "ready_for_pickup" } }
    );
    const idempotentLate = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: lockedCase.day._id });
    assert.strictEqual(idempotentLate.skipped, true);
    assert.strictEqual(idempotentLate.operationBoundary.reconciliationRequired, false, "an existing reservation is reported, not recreated");
    const lockedBucketAfter = await bucket(lockedCase.subscription._id, lockedCase.bucketId);
    assert.strictEqual(Number(lockedBucketAfter.remainingQty), 3);
    assert.strictEqual(Number(lockedBucketAfter.reservedQty), 1);

    console.log("subscription daily add-on operation boundary checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
