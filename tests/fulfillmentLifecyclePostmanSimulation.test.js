"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");
const dateUtils = require("../src/utils/date");

const TEST_TAG = `fulfillment-postman-${Date.now()}`;
const TODAY = dateUtils.getTodayKSADate();
const TOMORROW = dateUtils.addDaysToKSADateString(TODAY, 1);
const results = { passed: 0, failed: 0 };
const dashboardUserIds = [];

function appToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "31d" }
  );
}

async function dashboardToken(role) {
  const user = await DashboardUser.create({
    email: `${TEST_TAG}-${role}-${Math.random().toString(36).slice(2)}@example.com`,
    passwordHash: "test-only",
    role,
    isActive: true,
  });
  dashboardUserIds.push(user._id);
  return issueDashboardAccessToken(user);
}

function auth(token) {
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
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
    $or: [{ userId: { $in: userIds } }, { planId: { $in: planIds } }, { pickupLocationId: TEST_TAG }],
  }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);

  await Promise.all([
    Delivery.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subscriptionIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    DashboardUser.deleteMany({ $or: [{ _id: { $in: dashboardUserIds } }, { email: { $regex: `^${TEST_TAG}` } }] }),
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
    name: { ar: `${label}`, en: `${label}` },
    daysCount: 14,
    durationDays: 30,
    currency: "SAR",
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 1, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
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

async function seedSubscription(user, label, deliveryMode, remainingMeals = 8) {
  const plan = await seedPlan(label);
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-06-01T00:00:00Z"),
    endDate: new Date("2026-07-01T00:00:00Z"),
    validityEndDate: new Date("2026-07-15T00:00:00Z"),
    totalMeals: remainingMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode,
    pickupLocationId: deliveryMode === "pickup" ? "main" : "",
    deliveryAddress: deliveryMode === "delivery" ? { line1: `${TEST_TAG} address ${label}` } : undefined,
    deliveryWindow: "12:00-14:00",
  });
}

function mealSlots(count) {
  const kinds = ["standard_meal", "premium_meal", "premium_large_salad"];
  return Array.from({ length: count }, (_, index) => {
    const selectionType = kinds[index % kinds.length];
    return {
      slotIndex: index + 1,
      slotKey: `slot_${index + 1}`,
      status: "complete",
      selectionType,
      productKey: `${selectionType}_${index + 1}`,
      isPremium: selectionType !== "standard_meal",
      premiumKey: selectionType !== "standard_meal" ? selectionType : null,
      confirmationSnapshot: {
        product: { key: `${selectionType}_${index + 1}`, name: { en: `Meal ${index + 1}`, ar: `Meal ${index + 1}` } },
      },
    };
  });
}

async function seedDay(subscription, date, status = "open", count = 1) {
  const slots = mealSlots(count);
  return SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status,
    plannerState: "confirmed",
    planningState: "confirmed",
    mealSlots: slots,
    materializedMeals: slots.map((slot) => ({
      slotKey: slot.slotKey,
      selectionType: slot.selectionType,
      isPremium: slot.isPremium,
      premiumKey: slot.premiumKey,
      operationalSku: slot.productKey,
    })),
    plannerMeta: { requiredSlotCount: count, completeSlotCount: count, isDraftValid: true, isConfirmable: true, confirmedAt: new Date() },
    planningMeta: { requiredMealCount: count, selectedTotalMealCount: count, isExactCountSatisfied: true, confirmedAt: new Date() },
  });
}

async function remainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

function assertNoDirtyDisplay(row) {
  const serialized = JSON.stringify(row);
  const dirtyPaths = [];
  function walk(value, path) {
    if (typeof value === "string" && value.includes("[object Object]")) dirtyPaths.push(path);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => walk(entry, path ? `${path}.${key}` : key));
    }
  }
  walk(row, "row");
  assert.strictEqual(dirtyPaths.length, 0, `queue response must not contain [object Object]: ${dirtyPaths.join(", ")}`);
  assert(!serialized.includes("MISSING_PRODUCT"), "semantic premium/standard products must not emit false MISSING_PRODUCT warnings");
  assert(!serialized.includes("unknown"), "known catalog snapshots should not render as unknown");
}

async function dashboardAction(api, headers, action, entityType, entityId, payload = {}) {
  return api.post(`/api/dashboard/ops/actions/${action}`).set(headers).send({
    entityType,
    entityId: String(entityId),
    payload,
  });
}

async function createPickupRequest(api, headers, subscriptionId, mealCount, idempotencyKey) {
  return api
    .post(`/api/subscriptions/${subscriptionId}/pickup-requests`)
    .set(headers)
    .send({ date: TODAY, mealCount, idempotencyKey });
}

(async function run() {
  await connect();
  await cleanup();
  await seedSettings();

  const api = request(createApp());
  const userA = await seedUser("client-a");
  const userB = await seedUser("client-b");
  const tokens = {
    clientA: appToken(userA._id),
    clientB: appToken(userB._id),
    admin: await dashboardToken("admin"),
    kitchen: await dashboardToken("kitchen"),
    courier: await dashboardToken("courier"),
  };
  const headers = {
    clientA: auth(tokens.clientA),
    clientB: auth(tokens.clientB),
    admin: auth(tokens.admin),
    kitchen: auth(tokens.kitchen),
    courier: auth(tokens.courier),
  };

  const pickupA = await seedSubscription(userA, "pickup-a", "pickup", 8);
  const pickupB = await seedSubscription(userB, "pickup-b", "pickup", 8);
  const deliveryA = await seedSubscription(userA, "delivery-a", "delivery", 8);
  const deliveryB = await seedSubscription(userB, "delivery-b", "delivery", 8);
  const pickupDayA = await seedDay(pickupA, TODAY, "open", 3);
  await seedDay(pickupB, TODAY, "open", 1);
  const deliveryDayA = await seedDay(deliveryA, TODAY, "open", 3);
  await seedDay(deliveryB, TOMORROW, "open", 1);

  try {
    await test("branch pickup planned subscription_day is visible but not operationally actionable", async () => {
      const queueRes = await api.get(`/api/dashboard/kitchen/queue?date=${TODAY}&method=pickup`).set(headers.kitchen);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const row = queueRes.body.data.items.find((item) => item.ids.subscriptionDayId === String(pickupDayA._id));
      assert(row, "planned pickup day should be visible in kitchen queue");
      assert.strictEqual(row.ids.entityType, "subscription_day");
      assert.strictEqual(row.ids.pickupRequestId, null);
      assert.strictEqual(row.payment.canPrepare, false);
      assert.strictEqual(row.payment.canFulfill, false);
      assert.strictEqual(row.actions.canPrepare, false);
      assert.strictEqual(row.actions.canReadyForPickup, false);
      assert.strictEqual(row.actions.canFulfill, false);
      assert.strictEqual(row.actions.canNoShow, false);
      assert(!row.actions.allowed.some((action) => ["prepare", "ready_for_pickup", "fulfill", "no_show"].includes(action.id)));
      assert(row.actions.disabled.some((action) => action.id === "prepare" && action.reason === "PICKUP_REQUEST_REQUIRED"));
      assertNoDirtyDisplay(row);

      const beforeRemaining = await remainingMeals(pickupA._id);
      const directPrepare = await dashboardAction(api, headers.admin, "prepare", "subscription_day", pickupDayA._id);
      assert.strictEqual(directPrepare.status, 422, JSON.stringify(directPrepare.body));
      assert.strictEqual(directPrepare.body.error.code, "PICKUP_REQUEST_REQUIRED");
      const boardPrepare = await api.post("/api/dashboard/pickup/actions/prepare").set(headers.admin).send({
        entityType: "subscription_day",
        entityId: String(pickupDayA._id),
      });
      assert.strictEqual(boardPrepare.status, 422, JSON.stringify(boardPrepare.body));
      assert.strictEqual(boardPrepare.body.error.code, "PICKUP_REQUEST_REQUIRED");
      assert.strictEqual((await SubscriptionDay.findById(pickupDayA._id).lean()).status, "open");
      assert.strictEqual(await remainingMeals(pickupA._id), beforeRemaining);
    });

    await test("client pickup request endpoint is client-only and owner-scoped", async () => {
      const adminRes = await createPickupRequest(api, headers.admin, pickupA._id, 1, `${TEST_TAG}-admin`);
      assert.strictEqual(adminRes.status, 403, JSON.stringify(adminRes.body));
      assert.strictEqual(adminRes.body.error.code, "FORBIDDEN");

      const kitchenRes = await createPickupRequest(api, headers.kitchen, pickupA._id, 1, `${TEST_TAG}-kitchen`);
      assert.strictEqual(kitchenRes.status, 403, JSON.stringify(kitchenRes.body));
      assert.strictEqual(kitchenRes.body.error.code, "FORBIDDEN");

      const wrongUser = await createPickupRequest(api, headers.clientB, pickupA._id, 1, `${TEST_TAG}-wrong-user`);
      assert([403, 404].includes(wrongUser.status), JSON.stringify(wrongUser.body));
      assert.strictEqual(await SubscriptionPickupRequest.countDocuments({ subscriptionId: pickupA._id }), 0);
      assert.strictEqual(await remainingMeals(pickupA._id), 8);
    });

    let pickupRequestAId;
    let pickupRequestBId;
    await test("branch pickup request reserves once, queues as request, and fulfills without double decrement", async () => {
      const createA = await createPickupRequest(api, headers.clientA, pickupA._id, 1, `${TEST_TAG}-pickup-a-1`);
      assert.strictEqual(createA.status, 200, JSON.stringify(createA.body));
      pickupRequestAId = createA.body.data.requestId;
      assert(pickupRequestAId, "pickup request id should be returned");
      assert.strictEqual(await remainingMeals(pickupA._id), 7);

      const retryA = await createPickupRequest(api, headers.clientA, pickupA._id, 1, `${TEST_TAG}-pickup-a-1`);
      assert.strictEqual(retryA.status, 200, JSON.stringify(retryA.body));
      assert.strictEqual(retryA.body.data.requestId, pickupRequestAId);
      assert.strictEqual(await remainingMeals(pickupA._id), 7);

      const queueRes = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(headers.kitchen);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const requestRow = queueRes.body.data.items.find((item) => item.ids.pickupRequestId === pickupRequestAId);
      assert(requestRow, "actual pickup request should appear in pickup queue");
      assert.strictEqual(requestRow.ids.entityType, "subscription_pickup_request");
      assert.strictEqual(requestRow.fulfillment.pickup.mealCount, 1);
      assert.strictEqual(requestRow.fulfillment.pickup.reserved, true);
      assertNoDirtyDisplay(requestRow);

      let action = await dashboardAction(api, headers.kitchen, "start_preparation", "subscription_pickup_request", pickupRequestAId);
      assert.strictEqual(action.status, 200, JSON.stringify(action.body));
      action = await dashboardAction(api, headers.kitchen, "ready_for_pickup", "subscription_pickup_request", pickupRequestAId);
      assert.strictEqual(action.status, 200, JSON.stringify(action.body));
      action = await dashboardAction(api, headers.kitchen, "fulfill", "subscription_pickup_request", pickupRequestAId);
      assert.strictEqual(action.status, 200, JSON.stringify(action.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 7);

      const duplicateFulfill = await dashboardAction(api, headers.kitchen, "fulfill", "subscription_pickup_request", pickupRequestAId);
      assert([200, 409].includes(duplicateFulfill.status), JSON.stringify(duplicateFulfill.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 7);
    });

    await test("branch pickup no_show consumes reserved balance and cancel releases before consumption", async () => {
      const noShow = await createPickupRequest(api, headers.clientA, pickupA._id, 2, `${TEST_TAG}-pickup-a-noshow`);
      assert.strictEqual(noShow.status, 200, JSON.stringify(noShow.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 5);
      await dashboardAction(api, headers.kitchen, "start_preparation", "subscription_pickup_request", noShow.body.data.requestId);
      await dashboardAction(api, headers.kitchen, "ready_for_pickup", "subscription_pickup_request", noShow.body.data.requestId);
      const noShowRes = await dashboardAction(api, headers.admin, "no_show", "subscription_pickup_request", noShow.body.data.requestId, {
        reason: "customer_no_show",
      });
      assert.strictEqual(noShowRes.status, 200, JSON.stringify(noShowRes.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 5);
      assert((await SubscriptionPickupRequest.findById(noShow.body.data.requestId).lean()).creditsConsumedAt);

      const cancel = await createPickupRequest(api, headers.clientA, pickupA._id, 1, `${TEST_TAG}-pickup-a-cancel`);
      assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 4);
      const cancelRes = await dashboardAction(api, headers.admin, "cancel", "subscription_pickup_request", cancel.body.data.requestId, {
        reason: "customer_cancelled",
      });
      assert.strictEqual(cancelRes.status, 200, JSON.stringify(cancelRes.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 5);
      const fulfillCanceled = await dashboardAction(api, headers.admin, "fulfill", "subscription_pickup_request", cancel.body.data.requestId);
      assert.strictEqual(fulfillCanceled.status, 409, JSON.stringify(fulfillCanceled.body));
      assert.strictEqual(await remainingMeals(pickupA._id), 5);
    });

    await test("multiple same-day pickup requests remain independent", async () => {
      const requestB = await createPickupRequest(api, headers.clientA, pickupA._id, 1, `${TEST_TAG}-pickup-a-b`);
      const requestC = await createPickupRequest(api, headers.clientA, pickupA._id, 2, `${TEST_TAG}-pickup-a-c`);
      assert.strictEqual(requestB.status, 200, JSON.stringify(requestB.body));
      assert.strictEqual(requestC.status, 200, JSON.stringify(requestC.body));
      pickupRequestBId = requestB.body.data.requestId;
      assert.notStrictEqual(pickupRequestBId, requestC.body.data.requestId);
      assert.strictEqual(await remainingMeals(pickupA._id), 2);

      await dashboardAction(api, headers.kitchen, "start_preparation", "subscription_pickup_request", pickupRequestBId);
      await dashboardAction(api, headers.kitchen, "ready_for_pickup", "subscription_pickup_request", pickupRequestBId);
      const fulfillB = await dashboardAction(api, headers.kitchen, "fulfill", "subscription_pickup_request", pickupRequestBId);
      assert.strictEqual(fulfillB.status, 200, JSON.stringify(fulfillB.body));
      const stillActive = await SubscriptionPickupRequest.findById(requestC.body.data.requestId).lean();
      assert.strictEqual(stillActive.status, "locked");
      assert.strictEqual(await remainingMeals(pickupA._id), 2);
    });

    await test("home delivery lifecycle works without pickup request and creates one delivery visit", async () => {
      const queueRes = await api.get(`/api/dashboard/kitchen/queue?date=${TODAY}&method=delivery`).set(headers.admin);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const row = queueRes.body.data.items.find((item) => item.ids.subscriptionDayId === String(deliveryDayA._id));
      assert(row, "home delivery day should be visible");
      assert.strictEqual(row.ids.entityType, "subscription_day");
      assert.strictEqual(row.fulfillment.type, "home_delivery");
      assert.strictEqual(row.orderSummary.mealCount, 3);
      assert.strictEqual(row.actions.disabled.some((action) => action.reason === "PICKUP_REQUEST_REQUIRED"), false);
      assertNoDirtyDisplay(row);

      let action = await dashboardAction(api, headers.admin, "prepare", "subscription_day", deliveryDayA._id);
      assert.strictEqual(action.status, 200, JSON.stringify(action.body));
      action = await dashboardAction(api, headers.admin, "dispatch", "subscription_day", deliveryDayA._id);
      assert.strictEqual(action.status, 200, JSON.stringify(action.body));
      assert.strictEqual(await Delivery.countDocuments({ subscriptionId: deliveryA._id, date: TODAY }), 1);
      action = await dashboardAction(api, headers.admin, "fulfill", "subscription_day", deliveryDayA._id);
      assert.strictEqual(action.status, 200, JSON.stringify(action.body));
      assert.strictEqual(await remainingMeals(deliveryA._id), 5);
      const duplicateFulfill = await dashboardAction(api, headers.admin, "fulfill", "subscription_day", deliveryDayA._id);
      assert([200, 409].includes(duplicateFulfill.status), JSON.stringify(duplicateFulfill.body));
      assert.strictEqual(await remainingMeals(deliveryA._id), 5);
    });

    await test("multi-user and role isolation holds for client and courier views", async () => {
      const userBReq = await createPickupRequest(api, headers.clientB, pickupB._id, 1, `${TEST_TAG}-pickup-b`);
      assert.strictEqual(userBReq.status, 200, JSON.stringify(userBReq.body));
      const userAStatusOnB = await api
        .get(`/api/subscriptions/${pickupB._id}/pickup-requests/${userBReq.body.data.requestId}/status`)
        .set(headers.clientA);
      assert([403, 404].includes(userAStatusOnB.status), JSON.stringify(userAStatusOnB.body));

      const courierPickupQueue = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(headers.courier);
      assert.strictEqual(courierPickupQueue.status, 403, JSON.stringify(courierPickupQueue.body));

      const courierDeliveryQueue = await api.get(`/api/dashboard/courier/queue?date=${TODAY}&method=delivery`).set(headers.courier);
      assert.strictEqual(courierDeliveryQueue.status, 200, JSON.stringify(courierDeliveryQueue.body));
      assert(!courierDeliveryQueue.body.data.items.some((item) => item.ids.subscriptionId === String(deliveryB._id)));
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
