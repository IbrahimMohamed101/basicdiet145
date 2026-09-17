"use strict";

require("./helpers/installMongoTestSafetyGuard");

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const { consumeSubscriptionMealBalance } = require("../src/services/subscription/subscriptionDayConsumptionService");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");

const TEST_TAG = `balance-concurrency-${Date.now()}`;
const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TEST_SUBSCRIPTION_ID = new mongoose.Types.ObjectId();

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
  try {
    await mongoose.connect(mongoUri);
  } catch (err) {
    console.error("Database connection failed with exact error:");
    console.error(err && err.stack ? err.stack : err);
    throw err;
  }
}

async function cleanup() {
  await Promise.all([
    ActivityLog.deleteMany({ entityId: TEST_SUBSCRIPTION_ID }),
    SubscriptionAuditLog.deleteMany({ entityId: TEST_SUBSCRIPTION_ID }),
    Subscription.deleteMany({ _id: TEST_SUBSCRIPTION_ID }),
  ]);
}

async function seedSubscription() {
  await Subscription.create({
    _id: TEST_SUBSCRIPTION_ID,
    userId: TEST_USER_ID,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-06-01T00:00:00Z"),
    validityEndDate: new Date("2026-06-01T00:00:00Z"),
    totalMeals: 1,
    remainingMeals: 1,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: TEST_TAG,
  });
}

(async function run() {
  try {
    await connect();
    await cleanup();
    await seedSubscription();

    await test("concurrent meal consumption permits exactly one deduction", async () => {
      const attempts = await Promise.allSettled([
        consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: 1,
          source: "concurrency_test",
          reason: "cashier_manual_consumption",
          note: TEST_TAG,
        }),
        consumeSubscriptionMealBalance({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          mealCount: 1,
          source: "concurrency_test",
          reason: "cashier_manual_consumption",
          note: TEST_TAG,
        }),
      ]);

      const successes = attempts.filter((attempt) => attempt.status === "fulfilled" && attempt.value.deducted);
      const insufficientCredits = attempts.filter((attempt) => (
        attempt.status === "rejected" && attempt.reason && attempt.reason.code === "INSUFFICIENT_CREDITS"
      ));

      assert.strictEqual(successes.length, 1, `expected exactly one success, got ${successes.length}`);
      assert.strictEqual(insufficientCredits.length, 1, `expected exactly one INSUFFICIENT_CREDITS failure, got ${insufficientCredits.length}`);

      const finalSubscription = await Subscription.findById(TEST_SUBSCRIPTION_ID).lean();
      assert(finalSubscription, "subscription should still exist");
      assert.strictEqual(finalSubscription.remainingMeals, 0);

      const auditLogs = await SubscriptionAuditLog.find({
        entityId: TEST_SUBSCRIPTION_ID,
        action: "cashier_manual_consumption",
      }).lean();
      assert.strictEqual(auditLogs.length, 1, `expected exactly one audit log, got ${auditLogs.length}`);
      assert.strictEqual(auditLogs[0].meta.mealCount, 1);
      assert.strictEqual(auditLogs[0].meta.remainingMealsBefore, 1);
      assert.strictEqual(auditLogs[0].meta.remainingMealsAfter, 0);
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
