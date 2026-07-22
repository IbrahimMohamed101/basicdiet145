"use strict";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  settleOpenSubscriptionPickupRequestsForDate,
} = require("../src/services/subscription/subscriptionPickupRequestSettlementService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const { processDailyCutoff } = require("../src/services/automationService");

const TEST_TAG = `pickup-request-settlement-${Date.now()}`;
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TARGET_DATE = "2026-05-18";
const OPEN_PICKUP_REQUEST_STATUSES_FOR_TEST = new Set([
  "locked",
  "in_preparation",
  "ready_for_pickup",
]);
const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  await mongoose.connect(mongoUri);
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: `^${TEST_TAG}` } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ pickupLocationId: TEST_TAG }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);

  await Promise.all([
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subscriptionIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedContext({ remainingMeals = 8, dayStatus = "open" } = {}) {
  const user = await User.create({
    phone: `${TEST_TAG}-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    name: `${TEST_TAG} User`,
    role: "client",
    isActive: true,
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-06-01T00:00:00Z"),
    validityEndDate: new Date("2026-06-01T00:00:00Z"),
    totalMeals: 10,
    remainingMeals,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 10 - remainingMeals,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: TEST_TAG,
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: TARGET_DATE,
    status: dayStatus,
    plannerState: "confirmed",
    planningState: "confirmed",
    selections: [new mongoose.Types.ObjectId()],
  });
  return { user, subscription, day };
}

async function seedPickupRequest({
  status = "locked",
  remainingMeals = 8,
  mealCount = 2,
  date = TARGET_DATE,
  dayStatus = "open",
} = {}) {
  const { user, subscription, day } = await seedContext({ remainingMeals, dayStatus });
  const attrs = {
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: user._id,
    date,
    mealCount,
    status,
    creditsReserved: !OPEN_PICKUP_REQUEST_STATUSES_FOR_TEST.has(status),
    creditsReservedAt: !OPEN_PICKUP_REQUEST_STATUSES_FOR_TEST.has(status)
      ? new Date("2026-05-18T08:00:00Z")
      : null,
    snapshot: { createdFrom: "settlement_test" },
  };
  if (status === "fulfilled") {
    attrs.fulfilledAt = new Date("2026-05-18T12:00:00Z");
    attrs.creditsConsumedAt = new Date("2026-05-18T12:00:00Z");
  }
  if (status === "no_show") {
    attrs.pickupNoShowAt = new Date("2026-05-18T23:00:00Z");
    attrs.creditsConsumedAt = new Date("2026-05-18T23:00:00Z");
  }
  if (status === "canceled") {
    attrs.canceledAt = new Date("2026-05-18T10:00:00Z");
    attrs.creditsReleasedAt = new Date("2026-05-18T10:00:00Z");
  }
  const pickupRequest = await SubscriptionPickupRequest.create(attrs);
  if (OPEN_PICKUP_REQUEST_STATUSES_FOR_TEST.has(status)) {
    const reservation = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount,
    });
    return { user, subscription, day, pickupRequest: reservation.pickupRequest };
  }
  return { user, subscription, day, pickupRequest };
}

async function getRequest(id) {
  const request = await SubscriptionPickupRequest.findById(id).lean();
  assert(request, "pickup request should exist");
  return request;
}

async function getRemainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

(async function run() {
  await connect();
  await cleanup();

  try {
    await test("locked request becomes no_show at settlement", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "locked" });
      const result = await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE, now: new Date("2026-05-18T22:00:00Z") });
      const updated = await getRequest(pickupRequest._id);
      assert.strictEqual(result.settledCount, 1);
      assert.strictEqual(updated.status, "no_show");
      assert(updated.pickupNoShowAt, "pickupNoShowAt should be set");
      assert(updated.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(updated.creditsConsumedAt, null);
    });

    await test("in_preparation request becomes no_show", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "in_preparation" });
      await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const updated = await getRequest(pickupRequest._id);
      assert.strictEqual(updated.status, "no_show");
      assert(updated.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(updated.creditsConsumedAt, null);
    });

    await test("ready_for_pickup request becomes no_show", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "ready_for_pickup" });
      await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const updated = await getRequest(pickupRequest._id);
      assert.strictEqual(updated.status, "no_show");
      assert(updated.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(updated.creditsConsumedAt, null);
    });

    await test("fulfilled request is not changed", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "fulfilled" });
      const before = await getRequest(pickupRequest._id);
      const result = await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const after = await getRequest(pickupRequest._id);
      assert.strictEqual(result.matchedCount, 0);
      assert.strictEqual(after.status, "fulfilled");
      assert.strictEqual(String(after.creditsConsumedAt), String(before.creditsConsumedAt));
    });

    await test("canceled request is not changed", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "canceled" });
      const result = await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const updated = await getRequest(pickupRequest._id);
      assert.strictEqual(result.matchedCount, 0);
      assert.strictEqual(updated.status, "canceled");
      assert(updated.creditsReleasedAt, "creditsReleasedAt should remain set");
    });

    await test("no_show request is not changed", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "no_show" });
      const before = await getRequest(pickupRequest._id);
      const result = await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const after = await getRequest(pickupRequest._id);
      assert.strictEqual(result.matchedCount, 0);
      assert.strictEqual(after.status, "no_show");
      assert.strictEqual(String(after.creditsConsumedAt), String(before.creditsConsumedAt));
    });

    await test("settlement returns reserved credits without consuming them", async () => {
      const { subscription, pickupRequest, day } = await seedPickupRequest({
        status: "ready_for_pickup",
        remainingMeals: 8,
        dayStatus: "consumed_without_preparation",
      });
      await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const updated = await getRequest(pickupRequest._id);
      const updatedDay = await SubscriptionDay.findById(day._id).lean();
      assert.strictEqual(updated.status, "no_show");
      assert(updated.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(updated.creditsConsumedAt, null);
      assert.strictEqual(await getRemainingMeals(subscription._id), 8);
      assert.strictEqual(updatedDay.status, "consumed_without_preparation");
    });

    await test("settlement is idempotent if run twice", async () => {
      const { subscription, pickupRequest } = await seedPickupRequest({ status: "locked", remainingMeals: 8 });
      const first = await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const afterFirst = await getRequest(pickupRequest._id);
      const second = await settleOpenSubscriptionPickupRequestsForDate({ date: TARGET_DATE });
      const afterSecond = await getRequest(pickupRequest._id);
      assert.strictEqual(first.settledCount, 1);
      assert.strictEqual(second.matchedCount, 0);
      assert.strictEqual(second.settledCount, 0);
      assert.strictEqual(String(afterSecond.creditsReleasedAt), String(afterFirst.creditsReleasedAt));
      assert.strictEqual(afterSecond.creditsConsumedAt, null);
      assert.strictEqual(await getRemainingMeals(subscription._id), 8);
    });

    await test("processDailyCutoff integrates pickup request settlement", async () => {
      const { pickupRequest } = await seedPickupRequest({ status: "locked", date: TARGET_DATE });
      const result = await processDailyCutoff({ date: TARGET_DATE, now: new Date("2026-05-18T22:30:00Z") });
      const updated = await getRequest(pickupRequest._id);
      assert.strictEqual(result.status, true);
      assert.strictEqual(result.pickupRequestSettlement.settledCount, 1);
      assert.strictEqual(updated.status, "no_show");
      assert(updated.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(updated.creditsConsumedAt, null);
    });
  } finally {
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
