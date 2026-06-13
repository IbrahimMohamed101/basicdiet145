"use strict";

require("dotenv").config();
const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");
const { createApp } = require("../src/app");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const dateUtils = require("../src/utils/date");

const TEST_TAG = `branch-pickup-guard-${Date.now()}`;
const TODAY = dateUtils.getTodayKSADate();

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  await mongoose.connect(mongoUri);
}

async function cleanup() {
  await User.deleteMany({ phone: { $regex: TEST_TAG } });
  await Plan.deleteMany({ key: { $regex: TEST_TAG } });
  const subs = await Subscription.find({ pickupLocationId: TEST_TAG }).lean();
  const subIds = subs.map(s => s._id);
  await SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } });
  await SubscriptionPickupRequest.deleteMany({ subscriptionId: { $in: subIds } });
  await Subscription.deleteMany({ _id: { $in: subIds } });
}

async function seedPlan() {
  return Plan.create({
    key: `${TEST_TAG}-plan`,
    name: { en: "Test Plan" },
    daysCount: 14,
    durationDays: 30,
    currency: "SAR",
    gramsOptions: [{ grams: 200, isActive: true, mealsOptions: [{ mealsPerDay: 1, priceHalala: 1000, compareAtHalala: 1200, isActive: true }] }]
  });
}

async function seedUser() {
    return User.create({
        phone: `${TEST_TAG}-user-${Math.random()}`,
        name: "Test User",
        role: "client"
    });
}

async function seedSubscription(user, plan, mode = "pickup") {
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    deliveryMode: mode,
    pickupLocationId: mode === "pickup" ? TEST_TAG : "",
    remainingMeals: 10,
    totalMeals: 10,
    selectedGrams: 200,
    selectedMealsPerDay: 1
  });
}

async function seedDay(subscription, status = "open", pickupRequested = false) {
    return SubscriptionDay.create({
        subscriptionId: subscription._id,
        date: TODAY,
        status,
        pickupRequested,
        plannerState: "confirmed",
        mealSlots: [{ slotIndex: 1, status: "complete", selectionType: "standard_meal", productKey: "test" }]
    });
}

async function testCase(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        console.error(`❌ ${name}`);
        console.error(err);
        process.exit(1);
    }
}

(async function run() {
  await connect();
  await cleanup();
  const api = request(createApp());
  const { headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG);
  const plan = await seedPlan();

  await testCase("Test 1: Branch pickup subscription_day without pickupRequestId rejected at PREPARE", async () => {
    const user = await seedUser();
    const subscription = await seedSubscription(user, plan, "pickup");
    const day = await seedDay(subscription, "open", false);

    const res = await api.post("/api/dashboard/ops/actions/prepare").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });

    assert.strictEqual(res.status, 422, `Expected 422 but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PICKUP_REQUEST_REQUIRED");
    
    const updated = await SubscriptionDay.findById(day._id).lean();
    assert.strictEqual(updated.status, "open", "Status should remain open");
    assert.strictEqual(updated.pickupPreparationStartedAt, null);
  });

  await testCase("Test 1b: Branch pickup subscription_day with pickupRequested=true but NO REQUEST rejected at PREPARE", async () => {
    const user = await seedUser();
    const subscription = await seedSubscription(user, plan, "pickup");
    const day = await seedDay(subscription, "open", true); // simulate inconsistent state

    const res = await api.post("/api/dashboard/ops/actions/prepare").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });

    assert.strictEqual(res.status, 422, `Expected 422 but got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.error.code, "PICKUP_REQUEST_REQUIRED");
  });

  await testCase("Test 2: Already invalid branch pickup day rejected at READY_FOR_PICKUP", async () => {
    const user = await seedUser();
    const subscription = await seedSubscription(user, plan, "pickup");
    const day = await seedDay(subscription, "in_preparation", true); 

    const res = await api.post("/api/dashboard/ops/actions/ready_for_pickup").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, "PICKUP_REQUEST_REQUIRED");
  });

  await testCase("Test 3: Already invalid branch pickup day rejected at FULFILL / NO_SHOW", async () => {
    const user = await seedUser();
    const subscription = await seedSubscription(user, plan, "pickup");
    const day = await seedDay(subscription, "ready_for_pickup", true); 

    let res = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, "PICKUP_REQUEST_REQUIRED");

    res = await api.post("/api/dashboard/ops/actions/no_show").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error.code, "PICKUP_REQUEST_REQUIRED");
  });

  await testCase("Test 4: Actual subscription_pickup_request still works", async () => {
    const user = await seedUser();
    const subscription = await seedSubscription(user, plan, "pickup");
    
    // Create request via API (this should set pickupRequested on the day if it correctly links, 
    // but here we just create the request object)
    const request = await SubscriptionPickupRequest.create({
        subscriptionId: subscription._id,
        userId: user._id,
        date: TODAY,
        mealCount: 1,
        status: "locked",
        creditsReserved: true
    });
    await Subscription.updateOne({ _id: subscription._id }, { $inc: { remainingMeals: -1 } });

    // Prepare
    let res = await api.post("/api/dashboard/ops/actions/start_preparation").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(request._id)
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.status, "in_preparation");

    // Ready
    res = await api.post("/api/dashboard/ops/actions/ready_for_pickup").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(request._id)
    });
    assert.strictEqual(res.status, 200);

    // Fulfill
    res = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(request._id)
    });
    assert.strictEqual(res.status, 200);

    const sub = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(sub.remainingMeals, 9, "Remaining meals should only be decremented once");
  });

  await testCase("Test 5: Home Delivery subscription_day still works", async () => {
    const user = await seedUser();
    const subscription = await seedSubscription(user, plan, "delivery");
    const day = await seedDay(subscription, "open", false);

    // Prepare
    let res = await api.post("/api/dashboard/ops/actions/prepare").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });
    assert.strictEqual(res.status, 200);

    // Dispatch (Home delivery uses dispatch -> fulfill)
    res = await api.post("/api/dashboard/ops/actions/dispatch").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });
    assert.strictEqual(res.status, 200);

    // Fulfill
    res = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id)
    });
    assert.strictEqual(res.status, 200);
  });

  await cleanup();
  await mongoose.disconnect();
})();
