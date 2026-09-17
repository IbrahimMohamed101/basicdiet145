"use strict";

require("./helpers/installMongoTestSafetyGuard");

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const Subscription = require("../src/models/Subscription");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  consumeReservedPickupMeals,
  releaseReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");

const TEST_TAG = `pickup-request-balance-${Date.now()}`;
const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_PLAN_ID = new mongoose.Types.ObjectId();

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
  await Promise.all([
    SubscriptionPickupRequest.deleteMany({ userId: TEST_USER_ID }),
    Subscription.deleteMany({ userId: TEST_USER_ID, pickupLocationId: TEST_TAG }),
  ]);
}

async function seedSubscriptionAndRequest({ remainingMeals = 10, mealCount = 2 } = {}) {
  const subscription = await Subscription.create({
    userId: TEST_USER_ID,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-06-01T00:00:00Z"),
    validityEndDate: new Date("2026-06-01T00:00:00Z"),
    totalMeals: remainingMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: TEST_TAG,
  });

  const pickupRequest = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    userId: TEST_USER_ID,
    date: "2026-05-18",
    mealCount,
    status: "locked",
  });

  return { subscription, pickupRequest };
}

async function getRemainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

(async function run() {
  try {
    await connect();
    await cleanup();

    await test("reserve succeeds when remainingMeals is enough", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 3 });

      const result = await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 3,
      });

      assert.strictEqual(result.reserved, true);
      assert.strictEqual(result.alreadyReserved, false);
      assert.strictEqual(await getRemainingMeals(subscription._id), 7);

      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.creditsReserved, true);
      assert(updatedRequest.creditsReservedAt, "creditsReservedAt should be set");
    });

    await test("reserve fails with INSUFFICIENT_CREDITS when not enough balance", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 1, mealCount: 2 });

      await assert.rejects(
        () => reserveSubscriptionMealsForPickupRequest({
          subscriptionId: subscription._id,
          pickupRequestId: pickupRequest._id,
          mealCount: 2,
        }),
        (err) => err && err.code === "INSUFFICIENT_CREDITS"
      );

      assert.strictEqual(await getRemainingMeals(subscription._id), 1);
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(Boolean(updatedRequest.creditsReserved), false);
    });

    await test("reserve is idempotent for already reserved request", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 4 });

      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 4,
      });
      const second = await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 4,
      });

      assert.strictEqual(second.reserved, false);
      assert.strictEqual(second.alreadyReserved, true);
      assert.strictEqual(await getRemainingMeals(subscription._id), 6);
    });

    await test("consume does not decrement remainingMeals again", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 2 });

      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 2,
      });
      await consumeReservedPickupMeals({ pickupRequestId: pickupRequest._id });

      assert.strictEqual(await getRemainingMeals(subscription._id), 8);
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert(updatedRequest.creditsConsumedAt, "creditsConsumedAt should be set");
    });

    await test("consume is idempotent", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 2 });

      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 2,
      });
      await consumeReservedPickupMeals({ pickupRequestId: pickupRequest._id });
      const second = await consumeReservedPickupMeals({ pickupRequestId: pickupRequest._id });

      assert.strictEqual(second.consumed, false);
      assert.strictEqual(second.alreadyConsumed, true);
      assert.strictEqual(await getRemainingMeals(subscription._id), 8);
    });

    await test("release returns meals once", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 3 });

      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 3,
      });
      const release = await releaseReservedPickupMeals({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
      });

      assert.strictEqual(release.released, true);
      assert.strictEqual(await getRemainingMeals(subscription._id), 10);
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert(updatedRequest.creditsReleasedAt, "creditsReleasedAt should be set");
    });

    await test("release cannot happen after consume", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 3 });

      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 3,
      });
      await consumeReservedPickupMeals({ pickupRequestId: pickupRequest._id });

      await assert.rejects(
        () => releaseReservedPickupMeals({
          subscriptionId: subscription._id,
          pickupRequestId: pickupRequest._id,
        }),
        (err) => err && err.code === "CREDITS_CONSUMED"
      );

      assert.strictEqual(await getRemainingMeals(subscription._id), 7);
    });

    await test("double release does not increase balance twice", async () => {
      const { subscription, pickupRequest } = await seedSubscriptionAndRequest({ remainingMeals: 10, mealCount: 4 });

      await reserveSubscriptionMealsForPickupRequest({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
        mealCount: 4,
      });
      await releaseReservedPickupMeals({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
      });
      const second = await releaseReservedPickupMeals({
        subscriptionId: subscription._id,
        pickupRequestId: pickupRequest._id,
      });

      assert.strictEqual(second.released, false);
      assert.strictEqual(second.alreadyReleased, true);
      assert.strictEqual(await getRemainingMeals(subscription._id), 10);
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
