"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const {
  getFutureBusinessDate,
  getTestBusinessDate,
} = require("./helpers/businessDateHelper");

const TEST_TAG = `pickup-request-ops-${Date.now()}`;
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TODAY = getTestBusinessDate();
const SUBSCRIPTION_START_DATE = getFutureBusinessDate(-7);
const SUBSCRIPTION_END_DATE = getFutureBusinessDate(30);
const results = { passed: 0, failed: 0 };

function appToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "31d" }
  );
}

function clientAuth(userId) {
  return { Authorization: `Bearer ${appToken(userId)}`, "Accept-Language": "en" };
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
  const subscriptions = await Subscription.find({ pickupLocationId: TEST_TAG }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);
  await Promise.all([
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subscriptionIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedUser(label) {
  return User.create({
    phone: `${TEST_TAG}-${label}`,
    name: label,
    role: "client",
    isActive: true,
  });
}

async function seedSubscriptionContext({ remainingMeals = 8 } = {}) {
  const user = await seedUser(new mongoose.Types.ObjectId().toString().slice(-6));
  const subscription = await Subscription.create({
    userId: user._id,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date(`${SUBSCRIPTION_START_DATE}T00:00:00+03:00`),
    endDate: new Date(`${SUBSCRIPTION_END_DATE}T00:00:00+03:00`),
    validityEndDate: new Date(`${SUBSCRIPTION_END_DATE}T00:00:00+03:00`),
    totalMeals: 10,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    pickupLocationId: TEST_TAG,
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: TODAY,
    status: "open",
    plannerState: "confirmed",
    planningState: "confirmed",
    selections: [new mongoose.Types.ObjectId()],
  });
  return { user, subscription, day };
}

async function seedReservedPickupRequest({ status = "locked", remainingMeals = 8, mealCount = 2 } = {}) {
  const { user, subscription, day } = await seedSubscriptionContext({ remainingMeals });
  const pickupRequest = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: user._id,
    date: TODAY,
    mealCount,
    status,
    creditsReserved: true,
    creditsReservedAt: new Date(),
    snapshot: { createdFrom: "test" },
  });
  return { user, subscription, day, pickupRequest };
}

async function getRemainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

(async function run() {
  await connect();
  await cleanup();
  const app = createApp();
  const api = request(app);
  const { headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG);
  const { headers: kitchenHeaders } = await dashboardAuth("kitchen", TEST_TAG);

  try {
    await test("ops can move SubscriptionPickupRequest locked -> in_preparation", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "locked" });

      const res = await api.post("/api/dashboard/ops/actions/start_preparation").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.entityType, "subscription_pickup_request");
      assert.strictEqual(res.body.data.status, "in_preparation");
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert(updatedRequest.preparationStartedAt, "preparationStartedAt should be set by start_preparation");
      assert(updatedRequest.pickupPreparedAt, "pickupPreparedAt should be set by start_preparation");
      assert.strictEqual(updatedRequest.pickupCode || null, null);
      const queueRes = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(kitchenHeaders);
      assert.strictEqual(queueRes.status, 200, JSON.stringify(queueRes.body));
      const row = queueRes.body.data.items.find((item) => item.ids.pickupRequestId === String(pickupRequest._id));
      assert(row, "prepared pickup request should appear in pickup queue");
      assert.strictEqual(row.source.status, "in_preparation");
      assert(row.timestamps.preparedAt, "queue timestamps.preparedAt should be set after preparation");
      assert.strictEqual(row.fulfillment.pickup.pickupCodeState, "not_issued");
      assert.strictEqual(row.actions.canReadyForPickup, true);
      assert(row.actions.allowed.some((action) => action.id === "ready_for_pickup"), "ready_for_pickup should be allowed after preparation");
    });

    await test("legacy prepare endpoint remains an alias for pickup request preparation", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "locked" });

      const res = await api.post("/api/dashboard/ops/actions/prepare").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.status, "in_preparation");
      assert(updatedRequest.pickupPreparedAt, "prepare alias should set pickupPreparedAt");
    });

    await test("ops can move in_preparation -> ready_for_pickup and generate pickupCode on request only", async () => {
      const { pickupRequest, day } = await seedReservedPickupRequest({ status: "in_preparation" });
      const preparedAt = new Date(`${TODAY}T10:00:00.000+03:00`);
      await SubscriptionPickupRequest.updateOne(
        { _id: pickupRequest._id },
        { $set: { preparationStartedAt: preparedAt, pickupPreparedAt: preparedAt } }
      );

      const res = await api.post("/api/dashboard/ops/actions/ready_for_pickup").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      const updatedDay = await SubscriptionDay.findById(day._id).lean();
      assert.strictEqual(updatedRequest.status, "ready_for_pickup");
      assert.match(updatedRequest.pickupCode, /^\d{6}$/);
      assert(updatedRequest.pickupCodeIssuedAt, "pickupCodeIssuedAt should be set");
      assert.strictEqual(updatedRequest.pickupPreparedAt.toISOString(), preparedAt.toISOString());
      assert.strictEqual(updatedDay.pickupCode || null, null);
      assert.strictEqual(updatedDay.pickupCodeIssuedAt || null, null);
    });

    await test("ready_for_pickup is rejected before preparation and does not mutate request", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "locked" });

      const res = await api.post("/api/dashboard/ops/actions/ready_for_pickup").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "INVALID_TRANSITION");
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.status, "locked");
      assert.strictEqual(updatedRequest.pickupCode || null, null);
      assert.strictEqual(updatedRequest.pickupCodeIssuedAt || null, null);
      assert.strictEqual(updatedRequest.preparationStartedAt || null, null);
      assert.strictEqual(updatedRequest.pickupPreparedAt || null, null);
      assert.strictEqual(updatedRequest.fulfilledAt || null, null);
      assert.strictEqual(updatedRequest.creditsReserved, true);
    });

    await test("client status endpoint sees pickupCode after ready_for_pickup", async () => {
      const { user, subscription, pickupRequest } = await seedReservedPickupRequest({ status: "in_preparation" });
      await api.post("/api/dashboard/ops/actions/ready_for_pickup").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      const res = await api
        .get(`/api/subscriptions/${subscription._id}/pickup-requests/${pickupRequest._id}/status`)
        .set(clientAuth(user._id));

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.status, "ready_for_pickup");
      assert.match(res.body.data.pickupCode, /^\d{6}$/);
    });

    await test("ops can fulfill SubscriptionPickupRequest without decrementing remainingMeals again", async () => {
      const { subscription, pickupRequest } = await seedReservedPickupRequest({ status: "ready_for_pickup", remainingMeals: 8 });
      await SubscriptionPickupRequest.updateOne(
        { _id: pickupRequest._id },
        { $set: { pickupCode: "654321", pickupCodeIssuedAt: new Date() } }
      );

      const res = await api.post("/api/dashboard/ops/actions/fulfill").set(kitchenHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.status, "fulfilled");
      assert(updatedRequest.fulfilledAt, "fulfilledAt should be set");
      assert(updatedRequest.creditsConsumedAt, "creditsConsumedAt should be set");
      assert.strictEqual(await getRemainingMeals(subscription._id), 8);
    });

    await test("fulfill uses dashboard visual verification and ignores pickupCode payload", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "ready_for_pickup" });
      await SubscriptionPickupRequest.updateOne(
        { _id: pickupRequest._id },
        { $set: { pickupCode: "123456", pickupCodeIssuedAt: new Date() } }
      );

      const res = await api.post("/api/dashboard/ops/actions/fulfill").set(kitchenHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
        code: "654321",
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.status, "fulfilled");
    });

    await test("pickup action endpoint fulfills request without pickupCode payload", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "ready_for_pickup" });
      await SubscriptionPickupRequest.updateOne(
        { _id: pickupRequest._id },
        { $set: { pickupCode: "222333", pickupCodeIssuedAt: new Date() } }
      );

      const res = await api.post("/api/dashboard/pickup/actions/fulfill").set(kitchenHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.source.status, "fulfilled");
    });

    await test("fulfill requires ready_for_pickup status", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "locked" });

      const res = await api.post("/api/dashboard/ops/actions/fulfill").set(kitchenHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
        code: "123456",
      });

      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "INVALID_TRANSITION");
    });

    await test("no_show releases reserved credits without consuming balance", async () => {
      const { subscription, pickupRequest } = await seedReservedPickupRequest({ status: "ready_for_pickup", remainingMeals: 8 });

      const res = await api.post("/api/dashboard/ops/actions/no_show").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
        payload: { reason: "customer_no_show" },
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.status, "no_show");
      assert(updatedRequest.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(updatedRequest.creditsConsumedAt, null);
      assert.strictEqual(await getRemainingMeals(subscription._id), 10);
    });

    await test("cancel releases reserved credits once", async () => {
      const { subscription, pickupRequest } = await seedReservedPickupRequest({ status: "locked", remainingMeals: 8 });

      const first = await api.post("/api/dashboard/ops/actions/cancel").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
        payload: { reason: "customer_request" },
      });
      const second = await api.post("/api/dashboard/ops/actions/cancel").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(pickupRequest._id),
        payload: { reason: "customer_request" },
      });

      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(second.status, 409, JSON.stringify(second.body));
      const updatedRequest = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
      assert.strictEqual(updatedRequest.status, "canceled");
      assert(updatedRequest.creditsReleasedAt, "creditsReleasedAt should be set");
      assert.strictEqual(await getRemainingMeals(subscription._id), 10);
    });

    await test("cannot cancel after fulfilled/no_show", async () => {
      const fulfilled = await seedReservedPickupRequest({ status: "fulfilled", remainingMeals: 8 });
      await SubscriptionPickupRequest.updateOne(
        { _id: fulfilled.pickupRequest._id },
        { $set: { creditsConsumedAt: new Date(), fulfilledAt: new Date() } }
      );
      const noShow = await seedReservedPickupRequest({ status: "no_show", remainingMeals: 8 });
      await SubscriptionPickupRequest.updateOne(
        { _id: noShow.pickupRequest._id },
        { $set: { creditsConsumedAt: new Date(), pickupNoShowAt: new Date() } }
      );

      const fulfilledCancel = await api.post("/api/dashboard/ops/actions/cancel").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(fulfilled.pickupRequest._id),
      });
      const noShowCancel = await api.post("/api/dashboard/ops/actions/cancel").set(adminHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: String(noShow.pickupRequest._id),
      });

      assert.strictEqual(fulfilledCancel.status, 409, JSON.stringify(fulfilledCancel.body));
      assert.strictEqual(noShowCancel.status, 409, JSON.stringify(noShowCancel.body));
    });

    await test("pickup queue includes SubscriptionPickupRequest", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "locked" });

      const res = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(kitchenHeaders);

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const row = res.body.data.items.find((item) => item.ids.pickupRequestId === String(pickupRequest._id));
      assert(row, "pickup request should appear in pickup queue");
      assert.strictEqual(row.ids.entityType, "subscription_pickup_request");
      assert.deepStrictEqual(row.actions.allowed.map((action) => action.id), ["prepare", "cancel"]);
      assert.strictEqual(row.actions.allowed[0].endpoint, "/api/dashboard/ops/actions/prepare");
      assert.strictEqual(row.actions.canPrepare, true);
      assert.strictEqual(row.actions.canReadyForPickup, false);
      assert.strictEqual(row.actions.canFulfill, false);
      assert.strictEqual(row.actions.canNoShow, false);
      assert.strictEqual(row.fulfillment.pickup.pickupCodeState, "not_issued");
    });

    await test("pickup queue does not mix legacy SubscriptionDay rows with request-level rows", async () => {
      const { pickupRequest, day } = await seedReservedPickupRequest({ status: "locked" });
      await SubscriptionDay.updateOne(
        { _id: day._id },
        {
          $set: {
            status: "ready_for_pickup",
            pickupRequested: true,
            pickupCode: "111222",
            pickupCodeIssuedAt: new Date(),
          },
        }
      );

      const res = await api.get(`/api/dashboard/pickup/queue?date=${TODAY}`).set(kitchenHeaders);

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const requestRow = res.body.data.items.find((item) => item.ids.pickupRequestId === String(pickupRequest._id));
      const legacyDayRow = res.body.data.items.find((item) => item.ids.entityType === "subscription_day" && item.ids.entityId === String(day._id));
      assert(requestRow, "request row should appear");
      assert.strictEqual(legacyDayRow, undefined);
    });

    await test("invalid request entityId returns 400 instead of 500", async () => {
      const res = await api.post("/api/dashboard/ops/actions/fulfill").set(kitchenHeaders).send({
        entityType: "subscription_pickup_request",
        entityId: "REQUEST_ID_HERE",
        code: "123456",
      });

      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "INVALID_ENTITY_ID");
    });

    await test("ops list includes active SubscriptionPickupRequest", async () => {
      const { pickupRequest } = await seedReservedPickupRequest({ status: "in_preparation" });

      const res = await api.get(`/api/dashboard/ops/list?date=${TODAY}`).set(kitchenHeaders);

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const row = res.body.data.find((item) => item.requestId === String(pickupRequest._id));
      assert(row, "pickup request should appear in ops list");
      assert.strictEqual(row.entityType, "subscription_pickup_request");
      assert.strictEqual(row.status, "in_preparation");
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
