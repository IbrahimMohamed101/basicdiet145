"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const {
  ensureLegacyEntitlementBatch,
  ensurePaidPurchaseEntitlementBatch,
} = require("../src/services/subscription/subscriptionEntitlementBatchPersistenceService");

let replSet;

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "subscription_stacking_batch_persistence" },
  });
  await mongoose.connect(replSet.getUri("subscription_stacking_batch_persistence"), {
    serverSelectionTimeoutMS: 10000,
  });
  await SubscriptionEntitlementBatch.syncIndexes();
}

async function disconnect() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

function buildLegacySubscription() {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    totalMeals: 78,
    remainingMeals: 20,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
    deliveryAddress: { city: "Riyadh", district: "Olaya", street: "A" },
  };
}

function buildPaidPurchase(containerSubscriptionId, userId) {
  const draftId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  return {
    draft: {
      _id: draftId,
      userId,
      planId,
      daysCount: 26,
      mealsPerDay: 2,
      startDate: new Date("2026-08-10T00:00:00+03:00"),
      contractSnapshot: null,
    },
    payment: {
      _id: paymentId,
      userId,
      status: "paid",
    },
    subscriptionPayload: {
      userId,
      planId,
      startDate: new Date("2026-08-10T00:00:00+03:00"),
      endDate: new Date("2026-09-04T00:00:00+03:00"),
      validityEndDate: new Date("2026-09-04T00:00:00+03:00"),
      totalMeals: 52,
      remainingMeals: 52,
      selectedMealsPerDay: 2,
      selectedGrams: 150,
      deliveryMode: "delivery",
      deliveryWindow: "13:00-15:00",
      deliverySlot: { type: "delivery", window: "13:00-15:00" },
      deliveryAddress: { city: "Riyadh", district: "Olaya", street: "A" },
      premiumBalance: [],
      addonSubscriptions: [],
      addonBalance: [],
      checkoutCurrency: "SAR",
    },
    containerSubscriptionId,
  };
}

async function testConcurrentLegacySeedCreatesOneBatch() {
  const subscription = buildLegacySubscription();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => ensureLegacyEntitlementBatch({
      subscription,
      businessDate: "2026-08-06",
    }))
  );

  const rows = await SubscriptionEntitlementBatch.find({
    sourceKey: `legacy:${subscription._id}`,
  }).lean();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].remainingMeals, 20);
  assert.strictEqual(rows[0].proteinGrams, 200);
  assert.strictEqual(results.filter((result) => result.created).length, 1);
  assert.strictEqual(results.filter((result) => result.idempotent).length, 7);
}

async function testConcurrentPaidPurchaseCreatesOneScheduledBatch() {
  const legacy = buildLegacySubscription();
  const purchase = buildPaidPurchase(legacy._id, legacy.userId);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => ensurePaidPurchaseEntitlementBatch({
      ...purchase,
      businessDate: "2026-08-06",
    }))
  );

  const rows = await SubscriptionEntitlementBatch.find({
    paymentId: purchase.payment._id,
  }).lean();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, "paid_scheduled");
  assert.strictEqual(rows[0].remainingMeals, 52);
  assert.strictEqual(rows[0].proteinGrams, 150);
  assert.strictEqual(results.filter((result) => result.created).length, 1);
  assert.strictEqual(results.filter((result) => result.idempotent).length, 7);
}

async function testUnpaidPaymentCannotCreateBatch() {
  const legacy = buildLegacySubscription();
  const purchase = buildPaidPurchase(legacy._id, legacy.userId);
  purchase.payment.status = "initiated";

  await assert.rejects(
    () => ensurePaidPurchaseEntitlementBatch({
      ...purchase,
      businessDate: "2026-08-06",
    }),
    (err) => Boolean(err && err.code === "STACKING_PAYMENT_NOT_PAID")
  );

  const count = await SubscriptionEntitlementBatch.countDocuments({
    paymentId: purchase.payment._id,
  });
  assert.strictEqual(count, 0);
}

async function run() {
  try {
    await connect();
    await testConcurrentLegacySeedCreatesOneBatch();
    await testConcurrentPaidPurchaseCreatesOneScheduledBatch();
    await testUnpaidPaymentCannotCreateBatch();
    console.log("subscription entitlement batch persistence integration tests passed");
  } finally {
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
