"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Delivery = require("../src/models/Delivery");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");
require("../src/models/Plan");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const {
  evaluateHistoricalDeliveryFulfillmentEligibility,
  fulfillHistoricalDeliveryDay,
} = require("../src/services/dashboard/historicalDeliveryFulfillmentService");

const TEST_SUBSCRIPTION_ID = new mongoose.Types.ObjectId();
const TEST_DAY_ID = new mongoose.Types.ObjectId();
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
        { entityId: TEST_DAY_ID },
        { "meta.subscriptionId": String(TEST_SUBSCRIPTION_ID) },
      ],
    }),
    ActivityLog.deleteMany({
      $or: [
        { entityId: TEST_SUBSCRIPTION_ID },
        { entityId: TEST_DAY_ID },
        { "meta.subscriptionId": String(TEST_SUBSCRIPTION_ID) },
      ],
    }),
    Delivery.deleteMany({
      $or: [
        { dayId: TEST_DAY_ID },
        { subscriptionId: TEST_SUBSCRIPTION_ID },
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
    _id: TEST_DAY_ID,
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

function assertHistoricalRecoveryPolicy() {
  const base = {
    entityType: "subscription",
    actionId: "fulfill",
    role: "courier",
    today: "2026-08-09",
  };

  assert.strictEqual(evaluateHistoricalDeliveryFulfillmentEligibility({
    ...base,
    day: { date: "2026-08-01", status: "out_for_delivery" },
  }).allowed, true, "courier may close a historical delivery already out for delivery");

  assert.strictEqual(evaluateHistoricalDeliveryFulfillmentEligibility({
    ...base,
    day: { date: "2026-08-01", status: "ready_for_delivery" },
  }).allowed, true, "courier may close a historical delivery already ready for delivery");

  assert.strictEqual(evaluateHistoricalDeliveryFulfillmentEligibility({
    ...base,
    role: "kitchen",
    day: { date: "2026-08-01", status: "out_for_delivery" },
  }).allowed, false, "kitchen cannot recover historical home delivery fulfillment");

  assert.strictEqual(evaluateHistoricalDeliveryFulfillmentEligibility({
    ...base,
    day: { date: "2026-08-01", status: "in_preparation" },
  }).allowed, false, "recovery cannot skip the delivery state machine from preparation");

  assert.strictEqual(evaluateHistoricalDeliveryFulfillmentEligibility({
    ...base,
    entityType: "subscription_pickup_request",
    day: { date: "2026-08-01", status: "ready_for_pickup" },
  }).allowed, false, "pickup history remains protected");
}

(async function run() {
  try {
    assertHistoricalRecoveryPolicy();
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

    // Re-seed the exact same historical delivery and exercise the dashboard
    // recovery service. It must use the canonical fulfillment debit and keep the
    // delivery projection/audit in sync without allowing broader history edits.
    await cleanup();
    await seed();

    const recovery = await fulfillHistoricalDeliveryDay({
      dayId: TEST_DAY_ID,
      userId: TEST_USER_ID,
      role: "courier",
    });
    assert.strictEqual(recovery.alreadyFulfilled, false, "first recovery should perform fulfillment");
    assert.strictEqual(recovery.deductedCredits, 2, "historical recovery should deduct the canonical fulfilled count");

    const recoveredSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
    assert.strictEqual(recoveredSubscription.remainingMeals, 5, "historical recovery deducts exactly once");

    const recoveredDay = await SubscriptionDay.findById(TEST_DAY_ID).lean();
    assert.strictEqual(recoveredDay.status, "fulfilled", "historical recovery closes the operational day");
    assert.strictEqual(recoveredDay.creditsDeducted, true, "historical recovery records credit settlement");

    const delivery = await Delivery.findOne({ dayId: TEST_DAY_ID }).lean();
    assert(delivery, "historical recovery should create or reconcile the delivery projection");
    assert.strictEqual(delivery.status, "delivered", "delivery projection should be delivered");
    assert(delivery.deliveredAt, "delivery projection should record reconciliation time");

    const recoveryAudits = await SubscriptionAuditLog.find({
      entityId: TEST_DAY_ID,
      action: "dashboard_historical_fulfill",
    }).lean();
    assert.strictEqual(recoveryAudits.length, 1, "historical recovery should leave one explicit audit record");
    assert.strictEqual(recoveryAudits[0].meta.businessDate, "2026-05-01");
    assert.strictEqual(recoveryAudits[0].meta.recovery, true);

    const replay = await fulfillHistoricalDeliveryDay({
      dayId: TEST_DAY_ID,
      userId: TEST_USER_ID,
      role: "courier",
    });
    assert.strictEqual(replay.alreadyFulfilled, true, "recovery replay should be idempotent");

    const afterReplay = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
    assert.strictEqual(afterReplay.remainingMeals, 5, "recovery replay must not deduct a second time");

    const replayAudits = await SubscriptionAuditLog.find({
      entityId: TEST_DAY_ID,
      action: "dashboard_historical_fulfill",
    }).lean();
    assert.strictEqual(replayAudits.length, 1, "idempotent replay must not duplicate recovery audit rows");

    console.log("subscriptionFulfillmentConcurrency.test.js passed");
  } finally {
    await cleanup().catch(() => {});
    await disconnect();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
