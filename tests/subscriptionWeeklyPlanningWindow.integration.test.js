"use strict";

const { installFixedKsaClock } = require("./helpers/fixedClock");
const {
  setTemporaryEnvironment,
} = require("./helpers/temporaryEnvironment");

const restoreEnvironment = setTemporaryEnvironment({
  DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED: "true",
  CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED: "true",
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "true",
});
const restoreClock = installFixedKsaClock("2026-07-29");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "weekly-planning-integration-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET
  || "weekly-planning-integration-dashboard-secret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const dateUtils = require("../src/utils/date");
const {
  getRestaurantBusinessDate,
} = require("../src/services/restaurantHoursService");
const {
  PLANNING_WINDOW_REASONS,
  resolveCurrentMenuWeek,
} = require("../src/services/subscription/subscriptionPlanningWindowService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "weekly_planning_window_integration" },
  });
  const uri = mongoServer.getUri("weekly_planning_window_integration");
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
  if (mongoServer) await mongoServer.stop();
  mongoServer = null;
}

function asKsaDate(date) {
  return new Date(`${date}T00:00:00+03:00`);
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

function responseErrorCode(res) {
  return res && res.body && res.body.error && res.body.error.code
    ? res.body.error.code
    : res && res.body
      ? res.body.code
      : null;
}

async function run() {
  await connect();
  try {
    const businessDate = await getRestaurantBusinessDate();
    const week = resolveCurrentMenuWeek({ businessDate });
    const nextSaturday = dateUtils.addDaysToKSADateString(week.menuWeekEnd, 1);
    const subscriptionStartDate = dateUtils.addDaysToKSADateString(businessDate, -7);
    const subscriptionEndDate = dateUtils.addDaysToKSADateString(nextSaturday, 14);

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
      name: "Weekly Planning Integration",
      password: "Test12345",
      role: "client",
      isActive: true,
    });
    const subscription = await Subscription.create({
      userId: user._id,
      planId: new mongoose.Types.ObjectId(),
      contractMode: "canonical",
      status: "active",
      startDate: asKsaDate(subscriptionStartDate),
      endDate: asKsaDate(subscriptionEndDate),
      validityEndDate: asKsaDate(subscriptionEndDate),
      totalMeals: 10,
      remainingMeals: 10,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      entitlementVersion: 2,
      selectedMealsPerDay: 1,
      deliveryMode: "pickup",
      pickupLocationId: "main",
      premiumBalance: [],
    });
    const futureDay = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: nextSaturday,
      status: "open",
      plannerState: "draft",
      planningState: "draft",
      mealSlots: [],
      addonSelections: [],
      plannerMeta: {
        requiredSlotCount: 1,
        completeSlotCount: 0,
        partialSlotCount: 0,
        isDraftValid: false,
        isConfirmable: false,
      },
    });

    const app = createApp();
    const api = request(app);
    const headers = authHeader(user._id);

    let res = await api
      .get(`/api/subscriptions/${subscription._id}/timeline?lang=en`)
      .set(headers);
    assert.strictEqual(
      res.status,
      200,
      `timeline status: ${JSON.stringify(res.body)}`
    );
    const timeline = res.body.data;
    assert(timeline, "timeline response data must exist");
    assert(timeline.planningWindow, "timeline must expose enabled planning window");
    assert.strictEqual(timeline.planningWindow.businessDate, businessDate);
    assert.strictEqual(timeline.planningWindow.menuWeekStart, week.menuWeekStart);
    assert.strictEqual(timeline.planningWindow.menuWeekEnd, week.menuWeekEnd);
    assert.strictEqual(timeline.planningWindow.planningWindowEnd, week.menuWeekEnd);

    const friday = timeline.days.find((day) => day.date === week.menuWeekEnd);
    assert(friday, "current menu-week Friday must remain in timeline");
    assert.strictEqual(friday.canEdit, true, "current Friday remains editable");
    assert.strictEqual(friday.withinCurrentMenuWeek, true);

    const nextWeekDay = timeline.days.find((day) => day.date === nextSaturday);
    assert(nextWeekDay, "next Saturday remains visible in timeline");
    assert.strictEqual(nextWeekDay.canEdit, false);
    assert.strictEqual(nextWeekDay.status, "locked");
    assert.strictEqual(nextWeekDay.dayStatus, "locked");
    assert.strictEqual(
      nextWeekDay.lockedReason,
      PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK
    );
    assert.strictEqual(nextWeekDay.withinCurrentMenuWeek, false);

    const endpoints = [
      {
        label: "save",
        method: "put",
        url: `/api/subscriptions/${subscription._id}/days/${nextSaturday}/selection`,
        body: { contractVersion: "meal_planner_menu.v3", mealSlots: [] },
      },
      {
        label: "validate",
        method: "post",
        url: `/api/subscriptions/${subscription._id}/days/${nextSaturday}/selection/validate`,
        body: { contractVersion: "meal_planner_menu.v3", mealSlots: [] },
      },
      {
        label: "confirm",
        method: "post",
        url: `/api/subscriptions/${subscription._id}/days/${nextSaturday}/confirm`,
        body: {},
      },
    ];

    for (const endpoint of endpoints) {
      res = await api[endpoint.method](endpoint.url)
        .set(headers)
        .send(endpoint.body);
      assert.strictEqual(
        res.status,
        400,
        `${endpoint.label} status: ${JSON.stringify(res.body)}`
      );
      assert.strictEqual(
        responseErrorCode(res),
        PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK,
        `${endpoint.label} error code`
      );
      assert.strictEqual(res.body.error.details.menuWeekStart, week.menuWeekStart);
      assert.strictEqual(res.body.error.details.menuWeekEnd, week.menuWeekEnd);
      assert.strictEqual(res.body.error.details.requestedDate, nextSaturday);
    }

    const [subscriptionAfter, dayAfter] = await Promise.all([
      Subscription.findById(subscription._id).lean(),
      SubscriptionDay.findById(futureDay._id).lean(),
    ]);
    assert.strictEqual(subscriptionAfter.remainingMeals, 10);
    assert.strictEqual(subscriptionAfter.reservedMeals, 0);
    assert.strictEqual(subscriptionAfter.consumedMeals, 0);
    assert.strictEqual(dayAfter.status, "open");
    assert.strictEqual(dayAfter.plannerState, "draft");
    assert.deepStrictEqual(dayAfter.mealSlots || [], []);

    console.log(
      "subscriptionWeeklyPlanningWindow.integration.test.js passed"
    );
  } finally {
    await disconnect();
    restoreEnvironment();
    restoreClock();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
