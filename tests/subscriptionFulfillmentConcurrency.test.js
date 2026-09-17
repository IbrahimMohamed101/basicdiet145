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
const { executeAction } = require("../src/services/dashboard/opsTransitionService");
const {
  canRecoverHistoricalDeliveryFulfillment,
} = require("../src/services/dashboard/historicalMutationPolicy");
const {
  markDelivered: markCourierDeliveryDelivered,
} = require("../src/controllers/courierDeliveryFulfillmentController");

const TEST_SUBSCRIPTION_ID = new mongoose.Types.ObjectId();
const TEST_DAY_ID = new mongoose.Types.ObjectId();
const TEST_DELIVERY_ID = new mongoose.Types.ObjectId();
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
        { _id: TEST_DELIVERY_ID },
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

async function seedDelivery() {
  await Delivery.create({
    _id: TEST_DELIVERY_ID,
    subscriptionId: TEST_SUBSCRIPTION_ID,
    dayId: TEST_DAY_ID,
    date: "2026-05-01",
    status: "out_for_delivery",
    address: { line1: TEST_TAG },
    window: "13:00-16:00",
  });
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function assertHistoricalRecoveryPolicy() {
  const base = {
    entityType: "subscription",
    actionId: "fulfill",
    role: "courier",
    mode: "delivery",
    businessDate: "2026-08-01",
    today: "2026-08-09",
  };

  assert.strictEqual(canRecoverHistoricalDeliveryFulfillment({
    ...base,
    status: "out_for_delivery",
  }), true, "courier may close a historical delivery already out for delivery");

  assert.strictEqual(canRecoverHistoricalDeliveryFulfillment({
    ...base,
    status: "ready_for_delivery",
  }), true, "courier may close a historical delivery already ready for delivery");

  assert.strictEqual(canRecoverHistoricalDeliveryFulfillment({
    ...base,
    role: "kitchen",
    status: "out_for_delivery",
  }), false, "kitchen cannot recover historical home delivery fulfillment");

  assert.strictEqual(canRecoverHistoricalDeliveryFulfillment({
    ...base,
    status: "in_preparation",
  }), false, "recovery cannot skip the delivery state machine from preparation");

  assert.strictEqual(canRecoverHistoricalDeliveryFulfillment({
    ...base,
    mode: "pickup",
    status: "ready_for_delivery",
  }), false, "pickup history remains protected");

  assert.strictEqual(canRecoverHistoricalDeliveryFulfillment({
    ...base,
    actionId: "dispatch",
    status: "ready_for_delivery",
  }), false, "only final fulfillment receives the historical exception");
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

    // This is the exact Delivery-tab contract: PUT /courier/deliveries/:id/delivered
    // must finish the linked SubscriptionDay and settle meal credits in one action.
    await cleanup();
    await seed();
    await seedDelivery();

    const req = {
      params: { id: String(TEST_DELIVERY_ID) },
      userRole: "courier",
      dashboardUserId: TEST_USER_ID,
      userId: TEST_USER_ID,
    };
    const firstResponse = createResponseRecorder();
    await markCourierDeliveryDelivered(req, firstResponse);

    assert.strictEqual(firstResponse.statusCode, 200, "courier delivered action should succeed");
    assert.strictEqual(firstResponse.body.status, true, "courier delivered response should be successful");
    assert.strictEqual(firstResponse.body.fulfillment.status, "fulfilled", "courier response should confirm canonical fulfillment");
    assert.strictEqual(firstResponse.body.fulfillment.deductedCredits, 2, "courier delivered action should report canonical deduction");

    const courierSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
    assert.strictEqual(courierSubscription.remainingMeals, 5, "delivery-tab completion must deduct meal credits immediately");

    const courierDay = await SubscriptionDay.findById(TEST_DAY_ID).lean();
    assert.strictEqual(courierDay.status, "fulfilled", "delivery-tab completion must set SubscriptionDay to fulfilled");
    assert.strictEqual(courierDay.creditsDeducted, true, "delivery-tab completion must persist credit settlement");

    const courierDelivery = await Delivery.findById(TEST_DELIVERY_ID).lean();
    assert.strictEqual(courierDelivery.status, "delivered", "delivery projection must be delivered in the same flow");
    assert(courierDelivery.deliveredAt, "delivery projection must record deliveredAt");

    const recoveryAudits = await SubscriptionAuditLog.find({
      entityId: TEST_DAY_ID,
      action: "dashboard_historical_fulfill",
    }).lean();
    assert.strictEqual(recoveryAudits.length, 1, "historical courier completion should leave one recovery audit");

    // Repeating the Delivery-tab action must be safe and must never debit twice.
    const replayResponse = createResponseRecorder();
    await markCourierDeliveryDelivered(req, replayResponse);
    assert.strictEqual(replayResponse.statusCode, 200, "repeated courier delivered action should be idempotently successful");

    const afterCourierReplay = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
    assert.strictEqual(afterCourierReplay.remainingMeals, 5, "repeated delivery-tab completion must not deduct twice");

    const replayAudits = await SubscriptionAuditLog.find({
      entityId: TEST_DAY_ID,
      action: "dashboard_historical_fulfill",
    }).lean();
    assert.strictEqual(replayAudits.length, 1, "repeated courier completion must not duplicate recovery audit rows");

    // The operations endpoint remains compatible after the courier flow has already
    // fulfilled the day and must also behave idempotently.
    await executeAction("fulfill", {
      entityId: TEST_DAY_ID,
      entityType: "subscription",
      userId: TEST_USER_ID,
      role: "courier",
      payload: {},
    });

    const afterOperationsReplay = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
    assert.strictEqual(afterOperationsReplay.remainingMeals, 5, "operations replay after courier completion must not deduct again");

    console.log("subscriptionFulfillmentConcurrency.test.js passed");
  } finally {
    await cleanup().catch(() => {});
    await disconnect();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
