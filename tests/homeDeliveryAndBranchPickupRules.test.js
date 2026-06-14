"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const Delivery = require("../src/models/Delivery");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const dateUtils = require("../src/utils/date");

const TEST_TAG = `home-delivery-branch-pickup-${Date.now()}`;
const TODAY = dateUtils.getTodayKSADate();
const results = { passed: 0, failed: 0 };

function appToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "31d" }
  );
}

function clientAuth(userId) {
  return {
    Authorization: `Bearer ${appToken(userId)}`,
    "Accept-Language": "en",
  };
}

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
  const plans = await Plan.find({ key: { $regex: `^${TEST_TAG}` } }).select("_id").lean();
  const planIds = plans.map((plan) => plan._id);
  const subscriptions = await Subscription.find({
    $or: [
      { userId: { $in: userIds } },
      { pickupLocationId: TEST_TAG },
      { planId: { $in: planIds } },
    ],
  }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);

  await Promise.all([
    Delivery.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    SubscriptionPickupRequest.deleteMany({
      $or: [
        { userId: { $in: userIds } },
        { subscriptionId: { $in: subscriptionIds } },
      ],
    }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    Setting.deleteMany({ key: { $in: ["restaurant_open_time", "restaurant_close_time", "restaurant_is_open"] } }),
  ]);
}

async function seedSettings() {
  await Setting.deleteMany({ key: { $in: ["restaurant_open_time", "restaurant_close_time", "restaurant_is_open"] } });
  await Setting.create([
    { key: "restaurant_open_time", value: "00:00" },
    { key: "restaurant_close_time", value: "00:00" },
    { key: "restaurant_is_open", value: true },
  ]);
}

async function seedPlan(label) {
  return Plan.create({
    key: `${TEST_TAG}-${label}`,
    name: { ar: "", en: `${TEST_TAG} ${label}` },
    daysCount: 14,
    durationDays: 30,
    currency: "SAR",
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{
        mealsPerDay: 1,
        priceHalala: 70000,
        compareAtHalala: 80000,
        isActive: true,
      }],
    }],
  });
}

async function seedUser(label) {
  return User.create({
    phone: `${TEST_TAG}-${label}`,
    name: `${TEST_TAG} ${label}`,
    role: "client",
    isActive: true,
  });
}

async function seedSubscription({ label, deliveryMode, remainingMeals, selectedMealsPerDay = 1 }) {
  const [user, plan] = await Promise.all([
    seedUser(label),
    seedPlan(label),
  ]);
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-06-01T00:00:00Z"),
    endDate: new Date("2026-07-01T00:00:00Z"),
    validityEndDate: new Date("2026-07-15T00:00:00Z"),
    totalMeals: remainingMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay,
    deliveryMode,
    pickupLocationId: deliveryMode === "pickup" ? "main" : "",
    deliveryAddress: deliveryMode === "delivery" ? { line1: `${TEST_TAG} delivery address` } : undefined,
    deliveryWindow: "12:00-14:00",
  });
  return { user, plan, subscription };
}

function completeSlots(count) {
  return Array.from({ length: count }, (_, index) => ({
    slotIndex: index + 1,
    slotKey: `slot_${index + 1}`,
    status: "complete",
    selectionType: "standard_meal",
    productKey: `test_product_${index + 1}`,
    confirmationSnapshot: {
      product: { key: `test_product_${index + 1}`, name: { en: `Meal ${index + 1}`, ar: `Meal ${index + 1}` } },
    },
  }));
}

async function remainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

async function createPickupRequest(api, userId, subscriptionId, mealCount, idempotencyKey) {
  return api
    .post(`/api/subscriptions/${subscriptionId}/pickup-requests`)
    .set(clientAuth(userId))
    .send({ date: TODAY, mealCount, idempotencyKey });
}

async function dashboardAction(api, headers, action, entityId, payload = {}) {
  return api.post(`/api/dashboard/ops/actions/${action}`).set(headers).send({
    entityType: "subscription_pickup_request",
    entityId: String(entityId),
    payload,
  });
}

async function fulfillPickupRequest(api, headers, pickupRequestId) {
  await dashboardAction(api, headers, "start_preparation", pickupRequestId);
  await dashboardAction(api, headers, "ready_for_pickup", pickupRequestId);
  return dashboardAction(api, headers, "fulfill", pickupRequestId);
}

async function sumPickupMealCounts(subscriptionId) {
  const rows = await SubscriptionPickupRequest.find({ subscriptionId }).lean();
  return rows.reduce((sum, row) => {
    return sum + (row.creditsReserved ? Number(row.mealCount || 0) : 0);
  }, 0);
}

(async function run() {
  await connect();
  await cleanup();
  await seedSettings();

  const api = request(createApp());
  const { headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG);
  const { headers: kitchenHeaders } = await dashboardAuth("kitchen", TEST_TAG);

  try {
    await test("home delivery keeps three same-day meals in one delivery visit", async () => {
      const { subscription } = await seedSubscription({
        label: "home-delivery",
        deliveryMode: "delivery",
        remainingMeals: 5,
      });
      const day = await SubscriptionDay.create({
        subscriptionId: subscription._id,
        date: TODAY,
        status: "open",
        plannerState: "confirmed",
        planningState: "confirmed",
        mealSlots: completeSlots(3),
        materializedMeals: completeSlots(3).map((slot) => ({
          slotKey: slot.slotKey,
          selectionType: "standard_meal",
          operationalSku: slot.productKey,
        })),
        plannerMeta: { completeSlotCount: 3 },
        planningMeta: { selectedTotalMealCount: 3 },
      });

      const queueRes = await api.get(`/api/dashboard/kitchen/queue?date=${TODAY}&method=delivery`).set(adminHeaders);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const queueRow = queueRes.body.data.items.find((item) => item.ids.subscriptionDayId === String(day._id));
      assert(queueRow, "home delivery queue row should be present");
      assert.strictEqual(queueRow.orderSummary.mealCount, 3);
      assert.strictEqual(queueRow.kitchen.meals.length, 3);
      assert.strictEqual(queueRow.fulfillment.type, "home_delivery");

      let actionRes = await api.post("/api/dashboard/ops/actions/prepare").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert.strictEqual(actionRes.status, 200, JSON.stringify(actionRes.body));

      actionRes = await api.post("/api/dashboard/ops/actions/dispatch").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert.strictEqual(actionRes.status, 200, JSON.stringify(actionRes.body));
      assert.strictEqual(await Delivery.countDocuments({ subscriptionId: subscription._id, date: TODAY }), 1);

      const duplicateDispatch = await api.post("/api/dashboard/ops/actions/dispatch").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert([200, 409].includes(duplicateDispatch.status), JSON.stringify(duplicateDispatch.body));
      assert.strictEqual(await Delivery.countDocuments({ subscriptionId: subscription._id, date: TODAY }), 1);

      const courierRes = await api.get(`/api/dashboard/courier/queue?date=${TODAY}&method=delivery`).set(adminHeaders);
      assert.strictEqual(courierRes.status, 200, JSON.stringify(courierRes.body));
      const courierRow = courierRes.body.data.items.find((item) => item.ids.subscriptionDayId === String(day._id));
      assert(courierRow, "courier queue row should be present");
      assert.strictEqual(courierRow.orderSummary.mealCount, 3);

      const fulfillRes = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert.strictEqual(fulfillRes.status, 200, JSON.stringify(fulfillRes.body));
      assert.strictEqual(await remainingMeals(subscription._id), 2);

      const duplicateFulfill = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert([200, 409].includes(duplicateFulfill.status), JSON.stringify(duplicateFulfill.body));
      assert.strictEqual(await remainingMeals(subscription._id), 2);
    });

    await test("home delivery chef choice lifecycle deducts entitlement once", async () => {
      const { subscription } = await seedSubscription({
        label: "home-delivery-chef-choice",
        deliveryMode: "delivery",
        remainingMeals: 10,
        selectedMealsPerDay: 2,
      });
      const day = await SubscriptionDay.create({
        subscriptionId: subscription._id,
        date: TODAY,
        status: "open",
        plannerState: "confirmed",
        planningState: "confirmed",
        mealSlots: [],
        materializedMeals: [],
        plannerMeta: {
          requiredSlotCount: 2,
          emptySlotCount: 2,
          completeSlotCount: 0,
          isDraftValid: true,
          isConfirmable: true,
          confirmedAt: new Date(),
          confirmedByRole: "client",
        },
        planningMeta: {
          requiredMealCount: 2,
          selectedTotalMealCount: 0,
          isExactCountSatisfied: false,
        },
      });

      const queueRes = await api.get(`/api/dashboard/kitchen/queue?date=${TODAY}&method=delivery`).set(adminHeaders);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const queueRow = queueRes.body.data.items.find((item) => item.ids.subscriptionDayId === String(day._id));
      assert(queueRow, "chef choice row should be present");
      assert.strictEqual(queueRow.orderSummary.mealCount, 2);
      assert.strictEqual(queueRow.kitchen.meals.length, 2);
      assert.strictEqual(queueRow.kitchen.meals[0].display.titleAr, "اختيار الشيف");
      assert.strictEqual(queueRow.selectionMode, "chef_choice");
      assert.strictEqual(queueRow.customer.phone, `${TEST_TAG}-home-delivery-chef-choice`);
      assert.strictEqual(queueRow.fulfillment.delivery.windowTextAr, "من 12:00 إلى 14:00");
      assert(queueRow.fulfillment.delivery.address.displayAddressAr.includes("delivery address"));

      let actionRes = await api.post("/api/dashboard/ops/actions/prepare").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert.strictEqual(actionRes.status, 200, JSON.stringify(actionRes.body));

      actionRes = await api.post("/api/dashboard/ops/actions/dispatch").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert.strictEqual(actionRes.status, 200, JSON.stringify(actionRes.body));

      actionRes = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert.strictEqual(actionRes.status, 200, JSON.stringify(actionRes.body));
      assert.strictEqual(await remainingMeals(subscription._id), 8);

      const duplicateFulfill = await api.post("/api/dashboard/ops/actions/fulfill").set(adminHeaders).send({
        entityType: "subscription_day",
        entityId: String(day._id),
      });
      assert([200, 409].includes(duplicateFulfill.status), JSON.stringify(duplicateFulfill.body));
      assert.strictEqual(await remainingMeals(subscription._id), 8);
    });

    await test("branch pickup reserves on creation and fulfills without double deduction", async () => {
      const { user, subscription } = await seedSubscription({
        label: "branch-pickup",
        deliveryMode: "pickup",
        remainingMeals: 5,
      });

      const requestA = await createPickupRequest(api, user._id, subscription._id, 1, `${TEST_TAG}-A`);
      assert.strictEqual(requestA.status, 200, JSON.stringify(requestA.body));
      const requestAId = requestA.body.data.requestId;
      assert.strictEqual(await remainingMeals(subscription._id), 4);
      let storedA = await SubscriptionPickupRequest.findById(requestAId).lean();
      assert.strictEqual(Boolean(storedA.creditsReserved), true);
      assert.strictEqual(storedA.subscriptionDayId || null, null);

      const retryA = await createPickupRequest(api, user._id, subscription._id, 1, `${TEST_TAG}-A`);
      assert.strictEqual(retryA.status, 200, JSON.stringify(retryA.body));
      assert.strictEqual(retryA.body.data.requestId, requestAId);
      assert.strictEqual(await remainingMeals(subscription._id), 4);

      const fulfillA = await fulfillPickupRequest(api, kitchenHeaders, requestAId);
      assert.strictEqual(fulfillA.status, 200, JSON.stringify(fulfillA.body));
      storedA = await SubscriptionPickupRequest.findById(requestAId).lean();
      assert.strictEqual(storedA.status, "fulfilled");
      assert(storedA.creditsConsumedAt, "request A should be marked consumed");
      assert.strictEqual(await remainingMeals(subscription._id), 4);

      const requestB = await createPickupRequest(api, user._id, subscription._id, 1, `${TEST_TAG}-B`);
      const requestC = await createPickupRequest(api, user._id, subscription._id, 3, `${TEST_TAG}-C`);
      assert.strictEqual(requestB.status, 200, JSON.stringify(requestB.body));
      assert.strictEqual(requestC.status, 200, JSON.stringify(requestC.body));
      assert.notStrictEqual(requestB.body.data.requestId, requestC.body.data.requestId);
      assert.strictEqual(await remainingMeals(subscription._id), 0);
      assert.strictEqual(await sumPickupMealCounts(subscription._id), 5);

      const requestD = await createPickupRequest(api, user._id, subscription._id, 1, `${TEST_TAG}-D`);
      assert.strictEqual(requestD.status, 422, JSON.stringify(requestD.body));
      assert.strictEqual(requestD.body.error.code, "INSUFFICIENT_CREDITS");

      const queueRes = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(kitchenHeaders);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const requestIds = [requestAId, requestB.body.data.requestId, requestC.body.data.requestId];
      for (const pickupRequestId of requestIds) {
        const row = queueRes.body.data.items.find((item) => item.ids.pickupRequestId === pickupRequestId);
        assert(row, `pickup queue row should exist for ${pickupRequestId}`);
        assert.strictEqual(row.fulfillment.type, "branch_pickup");
        assert.strictEqual(row.fulfillment.pickup.pickupRequestId, pickupRequestId);
        assert(row.fulfillment.pickup.mealCount > 0, "pickup mealCount should be exposed");
        assert.strictEqual(row.fulfillment.pickup.reserved, true);
      }

      const fulfillB = await fulfillPickupRequest(api, kitchenHeaders, requestB.body.data.requestId);
      const fulfillC = await fulfillPickupRequest(api, kitchenHeaders, requestC.body.data.requestId);
      assert.strictEqual(fulfillB.status, 200, JSON.stringify(fulfillB.body));
      assert.strictEqual(fulfillC.status, 200, JSON.stringify(fulfillC.body));
      assert.strictEqual(await remainingMeals(subscription._id), 0);

      const duplicateFulfillC = await dashboardAction(api, kitchenHeaders, "fulfill", requestC.body.data.requestId);
      assert([200, 409].includes(duplicateFulfillC.status), JSON.stringify(duplicateFulfillC.body));
      assert.strictEqual(await remainingMeals(subscription._id), 0);
    });

    await test("branch pickup cancel releases and no_show consumes reserved balance", async () => {
      const { user, subscription } = await seedSubscription({
        label: "branch-pickup-release",
        deliveryMode: "pickup",
        remainingMeals: 3,
      });

      const cancelRequest = await createPickupRequest(api, user._id, subscription._id, 1, `${TEST_TAG}-cancel`);
      assert.strictEqual(cancelRequest.status, 200, JSON.stringify(cancelRequest.body));
      assert.strictEqual(await remainingMeals(subscription._id), 2);
      const cancelRes = await dashboardAction(api, adminHeaders, "cancel", cancelRequest.body.data.requestId, {
        reason: "customer_cancelled",
      });
      assert.strictEqual(cancelRes.status, 200, JSON.stringify(cancelRes.body));
      assert.strictEqual(await remainingMeals(subscription._id), 3);

      const noShowRequest = await createPickupRequest(api, user._id, subscription._id, 2, `${TEST_TAG}-no-show`);
      assert.strictEqual(noShowRequest.status, 200, JSON.stringify(noShowRequest.body));
      assert.strictEqual(await remainingMeals(subscription._id), 1);
      await dashboardAction(api, kitchenHeaders, "start_preparation", noShowRequest.body.data.requestId);
      await dashboardAction(api, kitchenHeaders, "ready_for_pickup", noShowRequest.body.data.requestId);
      const noShowRes = await dashboardAction(api, adminHeaders, "no_show", noShowRequest.body.data.requestId, {
        reason: "customer_no_show",
      });
      assert.strictEqual(noShowRes.status, 200, JSON.stringify(noShowRes.body));
      const noShowRow = await SubscriptionPickupRequest.findById(noShowRequest.body.data.requestId).lean();
      assert.strictEqual(noShowRow.status, "no_show");
      assert(noShowRow.creditsConsumedAt, "no_show should consume reserved credits");
      assert.strictEqual(await remainingMeals(subscription._id), 1);
    });
  } finally {
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})();
