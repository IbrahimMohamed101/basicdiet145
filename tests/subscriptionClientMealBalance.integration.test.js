"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-meal-balance-integration-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET
  || "client-meal-balance-integration-dashboard-secret";
process.env.CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED = "true";
process.env.SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED = "false";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const {
  getRestaurantBusinessDate,
} = require("../src/services/restaurantHoursService");
const dateUtils = require("../src/utils/date");

let replSet;

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "client_unconsumed_balance" },
  });
  const uri = replSet.getUri("client_unconsumed_balance");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (replSet) await replSet.stop();
  replSet = null;
}

function authHeader(userId) {
  const token = jwt.sign(
    {
      userId: String(userId),
      role: "client",
      tokenType: "app_access",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

function ksaDate(dateString) {
  return new Date(`${dateString}T00:00:00+03:00`);
}

function assertBalance(balance, expected, label) {
  assert(balance && typeof balance === "object", `${label}: mealBalance exists`);
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(balance[key], value, `${label}: ${key}`);
  }
  assert.strictEqual(
    balance.mealBalancePolicy,
    "UNCONSUMED_INCLUDING_RESERVED_WITH_AVAILABLE_CAPACITY",
    `${label}: policy`
  );
  assert.strictEqual(
    balance.balanceProjection && balance.balanceProjection.applied,
    true,
    `${label}: projection applied`
  );
}

async function getOverview(api, headers) {
  const res = await api
    .get("/api/subscriptions/current/overview?lang=en")
    .set(headers);
  assert.strictEqual(
    res.status,
    200,
    `current overview status: ${JSON.stringify(res.body)}`
  );
  assert(res.body && res.body.data, "current overview data exists");
  return res.body.data;
}

async function getTimeline(api, headers, subscriptionId) {
  const res = await api
    .get(`/api/subscriptions/${subscriptionId}/timeline?lang=en`)
    .set(headers);
  assert.strictEqual(
    res.status,
    200,
    `timeline status: ${JSON.stringify(res.body)}`
  );
  assert(res.body && res.body.data, "timeline data exists");
  return res.body.data;
}

async function getDay(api, headers, subscriptionId, date) {
  const res = await api
    .get(`/api/subscriptions/${subscriptionId}/days/${date}?lang=en`)
    .set(headers);
  assert.strictEqual(
    res.status,
    200,
    `day status: ${JSON.stringify(res.body)}`
  );
  assert(res.body && res.body.data, "day data exists");
  return res.body.data;
}

async function assertPersistedCounters(subscriptionId, expected, label) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  assert(subscription, `${label}: subscription exists`);
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(subscription[key], value, `${label}: persisted ${key}`);
  }
}

async function run() {
  await connect();
  try {
    const businessDate = await getRestaurantBusinessDate();
    const startDate = dateUtils.addDaysToKSADateString(businessDate, -2);
    const endDate = dateUtils.addDaysToKSADateString(businessDate, 20);

    await Setting.create({
      key: "pickup_locations",
      value: [{
        id: "main",
        locationId: "main",
        name: { ar: "الفرع الرئيسي", en: "Main Branch" },
        label: { ar: "الفرع الرئيسي", en: "Main Branch" },
        address: {
          line1: { ar: "الفرع الرئيسي", en: "Main Branch" },
          city: { ar: "الرياض", en: "Riyadh" },
        },
      }],
    });

    const user = await User.create({
      phone: `+9665${String(Date.now()).slice(-8)}`,
      name: "Client Balance Integration",
      password: "Test12345",
      role: "client",
      isActive: true,
    });
    const plan = await Plan.create({
      name: { ar: "خطة اختبار الرصيد", en: "Balance Integration Plan" },
      daysCount: 10,
      durationDays: 10,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{
        grams: 200,
        isActive: true,
        mealsOptions: [{
          mealsPerDay: 2,
          priceHalala: 50000,
          compareAtHalala: 50000,
          isActive: true,
        }],
      }],
    });
    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      contractMode: "canonical",
      status: "active",
      startDate: ksaDate(startDate),
      endDate: ksaDate(endDate),
      validityEndDate: ksaDate(endDate),
      totalMeals: 10,
      remainingMeals: 10,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      entitlementVersion: 2,
      selectedGrams: 200,
      selectedMealsPerDay: 2,
      deliveryMode: "pickup",
      pickupLocationId: "main",
      premiumBalance: [],
    });
    const day = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: businessDate,
      status: "ready_for_pickup",
      pickupRequested: true,
      plannerState: "confirmed",
      planningState: "confirmed",
      lockedSnapshot: {
        mealsPerDay: 2,
        requiredMealCount: 2,
      },
      mealSlots: [],
      addonSelections: [],
    });
    const pickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: subscription._id,
      subscriptionDayId: day._id,
      userId: user._id,
      date: businessDate,
      mealCount: 2,
      status: "ready_for_pickup",
    });

    const api = request(createApp());
    const headers = authHeader(user._id);

    const initialOverview = await getOverview(api, headers);
    assert.strictEqual(initialOverview.remainingMeals, 10, "initial top-level stored balance");
    assertBalance(initialOverview.mealBalance, {
      totalMeals: 10,
      remainingMeals: 10,
      displayRemainingMeals: 10,
      availableMeals: 10,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      canConsumeNow: true,
      maxConsumableMealsNow: 10,
    }, "initial overview");

    const reservation = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 2,
    });
    assert.strictEqual(reservation.reserved, true, "pickup meals reserved once");
    await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 2,
      consumedMeals: 0,
      forfeitedMeals: 0,
    }, "after reservation");

    const reservedOverview = await getOverview(api, headers);
    assert.strictEqual(
      reservedOverview.remainingMeals,
      8,
      "top-level compatibility field remains the persisted available balance"
    );
    assertBalance(reservedOverview.mealBalance, {
      totalMeals: 10,
      remainingMeals: 10,
      displayRemainingMeals: 10,
      availableMeals: 8,
      reservedMeals: 2,
      consumedMeals: 0,
      forfeitedMeals: 0,
      canConsumeNow: true,
      maxConsumableMealsNow: 8,
    }, "reserved overview");

    const reservedTimeline = await getTimeline(
      api,
      headers,
      subscription._id
    );
    assertBalance(reservedTimeline.mealBalance, {
      totalMeals: 10,
      remainingMeals: 10,
      displayRemainingMeals: 10,
      availableMeals: 8,
      reservedMeals: 2,
      consumedMeals: 0,
      forfeitedMeals: 0,
      canConsumeNow: true,
      maxConsumableMealsNow: 8,
    }, "reserved timeline");

    const reservedDay = await getDay(
      api,
      headers,
      subscription._id,
      businessDate
    );
    assertBalance(reservedDay.mealBalance, {
      totalMeals: 10,
      remainingMeals: 10,
      displayRemainingMeals: 10,
      availableMeals: 8,
      reservedMeals: 2,
      consumedMeals: 0,
      forfeitedMeals: 0,
      canConsumeNow: true,
      maxConsumableMealsNow: 8,
    }, "reserved day");

    const fulfillment = await fulfillSubscriptionDay({ dayId: day._id });
    assert.strictEqual(fulfillment.ok, true, "pickup fulfillment succeeds");
    await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 0,
      consumedMeals: 2,
      forfeitedMeals: 0,
    }, "after fulfillment");

    const fulfilledOverview = await getOverview(api, headers);
    assert.strictEqual(fulfilledOverview.remainingMeals, 8);
    assertBalance(fulfilledOverview.mealBalance, {
      totalMeals: 10,
      remainingMeals: 8,
      displayRemainingMeals: 8,
      availableMeals: 8,
      reservedMeals: 0,
      consumedMeals: 2,
      forfeitedMeals: 0,
      canConsumeNow: true,
      maxConsumableMealsNow: 8,
    }, "fulfilled overview");

    const repeatedFulfillment = await fulfillSubscriptionDay({ dayId: day._id });
    assert.strictEqual(repeatedFulfillment.ok, true, "repeated fulfillment is idempotent");
    await assertPersistedCounters(subscription._id, {
      remainingMeals: 8,
      reservedMeals: 0,
      consumedMeals: 2,
      forfeitedMeals: 0,
    }, "after repeated fulfillment");

    console.log("subscriptionClientMealBalance.integration.test.js passed");
  } finally {
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
