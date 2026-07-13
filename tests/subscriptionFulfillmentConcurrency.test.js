"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");
require("../src/models/Plan");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");

const TEST_SUBSCRIPTION_ID = new mongoose.Types.ObjectId();
const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TEST_TAG = `fulfillment-concurrency-${Date.now()}`;
const TEST_DB_NAME = TEST_TAG.replace(/-/g, "_");
let replSet;

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

async function cleanup() {
  await Promise.all([
    SubscriptionAuditLog.deleteMany({
      $or: [
        { entityId: TEST_SUBSCRIPTION_ID },
        { "meta.subscriptionId": String(TEST_SUBSCRIPTION_ID) },
      ],
    }),
    ActivityLog.deleteMany({
      $or: [
        { entityId: TEST_SUBSCRIPTION_ID },
        { "meta.subscriptionId": String(TEST_SUBSCRIPTION_ID) },
      ],
    }),
    SubscriptionDay.deleteMany({ subscriptionId: TEST_SUBSCRIPTION_ID }),
    Subscription.deleteMany({ _id: TEST_SUBSCRIPTION_ID }),
  ]);
}

async function seed() {
  await Subscription.create({
    _id: TEST_SUBSCRIPTION_ID,
    userId: TEST_USER_ID,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-05-08T00:00:00Z"),
    validityEndDate: new Date("2026-05-08T00:00:00Z"),
    totalMeals: 7,
    remainingMeals: 7,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "delivery",
    deliveryAddress: { line1: TEST_TAG },
    deliveryWindow: "13:00-16:00",
  });

  await SubscriptionDay.create({
    subscriptionId: TEST_SUBSCRIPTION_ID,
    date: "2026-05-01",
    status: "out_for_delivery",
    lockedSnapshot: { mealsPerDay: 1, requiredMealCount: 1 },
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", status: "complete", selectionType: "standard_meal" },
      { slotIndex: 2, slotKey: "slot_2", status: "complete", selectionType: "standard_meal" },
    ],
    plannerMeta: {
      requiredSlotCount: 1,
      maxSlotCount: 7,
      completeSlotCount: 2,
      premiumSlotCount: 0,
      isDraftValid: true,
      isConfirmable: true,
    },
    planningMeta: {
      requiredMealCount: 1,
      selectedTotalMealCount: 2,
      isExactCountSatisfied: true,
    },
  });
}

(async function run() {
  try {
    await connect();
    await cleanup();
    await seed();

    const results = await Promise.all([
      fulfillSubscriptionDay({ subscriptionId: TEST_SUBSCRIPTION_ID, date: "2026-05-01" }),
      fulfillSubscriptionDay({ subscriptionId: TEST_SUBSCRIPTION_ID, date: "2026-05-01" }),
      fulfillSubscriptionDay({ subscriptionId: TEST_SUBSCRIPTION_ID, date: "2026-05-01" }),
      fulfillSubscriptionDay({ subscriptionId: TEST_SUBSCRIPTION_ID, date: "2026-05-01" }),
      fulfillSubscriptionDay({ subscriptionId: TEST_SUBSCRIPTION_ID, date: "2026-05-01" }),
    ]);

    assert(results.every((result) => result.ok), "all concurrent fulfillment calls should be idempotently successful");

    const finalSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
    assert.strictEqual(finalSubscription.remainingMeals, 5, "concurrent fulfillment deducts the fulfilled count exactly once");

    const day = await SubscriptionDay.findOne({ subscriptionId: TEST_SUBSCRIPTION_ID, date: "2026-05-01" }).lean();
    assert.strictEqual(day.status, "fulfilled", "day should be fulfilled");
    assert.strictEqual(day.creditsDeducted, true, "day.creditsDeducted should be true");
    assert(day.fulfilledSnapshot, "fulfilledSnapshot should be written");
    assert.strictEqual(day.fulfilledSnapshot.deductedCredits, 2, "fulfilledSnapshot.deductedCredits should match fulfilled meal count");

    const manualConsumptionLogs = await SubscriptionAuditLog.find({
      entityId: TEST_SUBSCRIPTION_ID,
      action: "cashier_manual_consumption",
    }).lean();
    assert.strictEqual(manualConsumptionLogs.length, 0, "fulfillment must not create duplicate manual consumption logs");

    console.log("subscriptionFulfillmentConcurrency.test.js passed");
  } finally {
    await cleanup().catch(() => {});
    await disconnect();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
