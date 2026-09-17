"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDailyAddonPolicy");
require("../src/services/installSubscriptionAddonReservationClosure");
require("../src/services/installSubscriptionAddonReservationReconciliation");
require("../src/services/installSubscriptionAddonReopenClosure");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionDailyAddonOperation = require("../src/models/SubscriptionDailyAddonOperation");
const dailyAddonService = require("../src/services/subscription/subscriptionDailyAddonService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function buildReleasedCase({ orphanReservation = false, dailyQty = 1 } = {}) {
  const userId = oid();
  const addonPlanId = oid();
  const productId = oid();
  const bucketId = oid();
  const entitlementKey = `juice:${String(addonPlanId)}`;
  const allocationKey = `daily-addon:reopen:${String(addonPlanId)}:1`;
  const subscription = await Subscription.create({
    userId,
    planId: oid(),
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
      includedTotalQty: dailyQty,
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
      includedTotalQty: dailyQty,
      purchasedQty: dailyQty,
      remainingQty: orphanReservation ? dailyQty - 1 : dailyQty,
      reservedQty: orphanReservation ? 1 : 0,
      consumedQty: 0,
      reservationKeys: orphanReservation ? [allocationKey] : [],
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2099-01-04",
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "reopened-day",
    mealSlots: [],
    addonSelections: [{
      addonId: productId,
      productId,
      menuProductId: productId,
      addonPlanId,
      name: "عصير برتقال — اشتراك عصير",
      nameI18n: { ar: "عصير برتقال — اشتراك عصير", en: "Orange Juice — Juice Subscription" },
      category: "juice",
      entitlementCategory: "juice",
      entitlementKey,
      balanceBucketId: bucketId,
      source: "wallet",
      qty: 1,
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      autoDailyAddon: true,
      dailyEntitlement: true,
      selectionOrigin: "subscription_daily_default",
      dailyAllocationKey: allocationKey,
      addonSettlementState: "released",
      reservedAt: null,
      settledAt: new Date(),
      releasedAt: new Date(),
      settlementReason: "day_skipped_returned_to_balance",
    }],
  });
  await SubscriptionDailyAddonOperation.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    date: day.date,
    allocationKey,
    entitlementKey,
    balanceBucketId: bucketId,
    addonPlanId,
    productId,
    status: "released",
    releasedAt: new Date(),
  });
  return { subscription, day, bucketId, allocationKey };
}

async function stateFor(fixture) {
  const [subscription, day, operation] = await Promise.all([
    Subscription.findById(fixture.subscription._id).lean(),
    SubscriptionDay.findById(fixture.day._id).lean(),
    SubscriptionDailyAddonOperation.findOne({
      subscriptionDayId: fixture.day._id,
      allocationKey: fixture.allocationKey,
    }).lean(),
  ]);
  const bucket = subscription.addonBalance.find((row) => String(row._id) === String(fixture.bucketId));
  return { subscription, day, operation, bucket };
}

async function testNormalReopen() {
  const fixture = await buildReleasedCase();
  const result = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fixture.day._id });
  assert.strictEqual(result.reactivatedCount, 1);

  const state = await stateFor(fixture);
  assert.strictEqual(state.day.addonSelections.length, 1, "reopen must reuse the released row, not push a duplicate identity");
  assert.strictEqual(state.day.addonSelections[0].addonSettlementState, "reserved");
  assert.strictEqual(state.day.addonSelections[0].dailyAllocationKey, fixture.allocationKey);
  assert.strictEqual(state.day.addonSelections[0].releasedAt, null);
  assert.strictEqual(Number(state.bucket.remainingQty), 0);
  assert.strictEqual(Number(state.bucket.reservedQty), 1);
  assert.strictEqual(Number(state.bucket.consumedQty), 0);
  assert.deepStrictEqual(state.bucket.reservationKeys, [fixture.allocationKey]);
  assert.strictEqual(state.operation.status, "completed");
  assert.strictEqual(state.operation.releasedAt, null);

  const replay = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fixture.day._id });
  assert.strictEqual(replay.reactivatedCount, 0);
  const replayState = await stateFor(fixture);
  assert.strictEqual(replayState.day.addonSelections.length, 1);
  assert.strictEqual(Number(replayState.bucket.remainingQty), 0);
  assert.strictEqual(Number(replayState.bucket.reservedQty), 1);
}

async function testCrashAfterReservationBeforeDayUpdate() {
  const fixture = await buildReleasedCase({ orphanReservation: true });
  const result = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fixture.day._id });
  assert.strictEqual(result.reactivationResults.some((row) => row.reactivated && row.idempotent), true);

  const state = await stateFor(fixture);
  assert.strictEqual(state.day.addonSelections[0].addonSettlementState, "reserved");
  assert.strictEqual(Number(state.bucket.remainingQty), 0);
  assert.strictEqual(Number(state.bucket.reservedQty), 1);
  assert.deepStrictEqual(state.bucket.reservationKeys, [fixture.allocationKey]);
}

async function testConcurrentReopen() {
  const fixture = await buildReleasedCase();
  await Promise.all([
    dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fixture.day._id }),
    dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fixture.day._id }),
  ]);
  const state = await stateFor(fixture);
  assert.strictEqual(state.day.addonSelections.length, 1);
  assert.strictEqual(state.day.addonSelections[0].addonSettlementState, "reserved");
  assert.strictEqual(Number(state.bucket.remainingQty), 0);
  assert.strictEqual(Number(state.bucket.reservedQty), 1);
  assert.deepStrictEqual(state.bucket.reservationKeys, [fixture.allocationKey]);
}

async function testPartialDailyQuantityReusesOneAndCreatesMissingOne() {
  const fixture = await buildReleasedCase({ dailyQty: 2 });
  const result = await dailyAddonService.ensureDailyAddonDefaultsForDay({ dayId: fixture.day._id });
  assert.strictEqual(result.reactivatedCount, 1);
  const state = await stateFor(fixture);
  assert.strictEqual(state.day.addonSelections.length, 2);
  assert.strictEqual(state.day.addonSelections.filter((row) => row.addonSettlementState === "reserved").length, 2);
  assert.strictEqual(new Set(state.day.addonSelections.map((row) => row.dailyAllocationKey)).size, 2);
  assert.strictEqual(Number(state.bucket.remainingQty), 0);
  assert.strictEqual(Number(state.bucket.reservedQty), 2);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `addon-reopen-${Date.now()}` });
    await testNormalReopen();
    await mongoose.connection.dropDatabase();
    await testCrashAfterReservationBeforeDayUpdate();
    await mongoose.connection.dropDatabase();
    await testConcurrentReopen();
    await mongoose.connection.dropDatabase();
    await testPartialDailyQuantityReusesOneAndCreatesMissingOne();
    console.log("subscription daily add-on reopen checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
