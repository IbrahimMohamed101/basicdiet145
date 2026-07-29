"use strict";

const assert = require("node:assert");
const crypto = require("node:crypto");
const { installFixedKsaClock } = require("./helpers/fixedClock");
const {
  setTemporaryEnvironment,
  withTemporaryEnvironment,
} = require("./helpers/temporaryEnvironment");

const restoreEnvironment = setTemporaryEnvironment({
  CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED: "true",
  DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED: "true",
  SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED: "false",
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "true",
});
const restoreClock = installFixedKsaClock("2026-07-29");

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET
  || "weekly-planning-http-matrix-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET
  || "weekly-planning-http-matrix-dashboard-secret";

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const dateUtils = require("../src/utils/date");
const {
  resolveCurrentMenuWeek,
  resolveSubscriptionPlanningWindow,
} = require("../src/services/subscription/subscriptionPlanningWindowService");

const BUSINESS_DATE = "2026-07-29";
const DATABASE_NAME = "weekly_planning_http_matrix_test";
const checks = { passed: 0, failed: 0 };
let replSet;

function asKsaDate(date) {
  return new Date(`${date}T00:00:00+03:00`);
}

function authHeader(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}` };
}

function errorCode(response) {
  return response?.body?.error?.code || response?.body?.code || null;
}

async function check(name, work) {
  try {
    const evidence = await work();
    checks.passed += 1;
    console.log(`PASS ${name}${evidence ? ` — ${evidence}` : ""}`);
  } catch (error) {
    checks.failed += 1;
    console.error(`FAIL ${name} — ${error.message}`);
  }
}

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: DATABASE_NAME },
  });
  const uri = replSet.getUri(DATABASE_NAME);
  const parsed = new URL(uri);
  assert(["127.0.0.1", "localhost"].includes(parsed.hostname));
  assert(!uri.toLowerCase().includes("railway"));
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  assert.strictEqual(mongoose.connection.name, DATABASE_NAME);
}

async function disconnect() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (replSet) await replSet.stop();
  replSet = null;
}

async function seedSettings() {
  await Setting.insertMany([
    { key: "restaurant_open_time", value: "00:00" },
    { key: "restaurant_close_time", value: "00:00" },
    { key: "restaurant_is_open", value: true },
    {
      key: "pickup_locations",
      value: [{
        id: "main",
        name: { ar: "فرع الاختبار", en: "Test Branch" },
        address: {
          line1: { ar: "محلي", en: "Local" },
          city: { ar: "الرياض", en: "Riyadh" },
        },
        isActive: true,
      }],
    },
  ]);
}

async function seedCatalog() {
  const [proteinCategory, carbCategory] = await Promise.all([
    BuilderCategory.create({
      key: "matrix_protein",
      dimension: "protein",
      name: { ar: "بروتين", en: "Protein" },
      isActive: true,
    }),
    BuilderCategory.create({
      key: "standard_carbs",
      dimension: "carb",
      name: { ar: "كربوهيدرات", en: "Carbs" },
      rules: { maxTypes: 2, maxTotalGrams: 300, unit: "grams" },
      isActive: true,
    }),
  ]);

  const [protein, carb, plan] = await Promise.all([
    BuilderProtein.create({
      key: "matrix_chicken",
      premiumKey: "matrix_chicken",
      name: { ar: "دجاج", en: "Chicken" },
      displayCategoryId: proteinCategory._id,
      displayCategoryKey: proteinCategory.key,
      proteinFamilyKey: "chicken",
      selectionType: "standard_meal",
      isPremium: false,
      availableForSubscription: true,
      isActive: true,
    }),
    BuilderCarb.create({
      key: "matrix_rice",
      name: { ar: "أرز", en: "Rice" },
      displayCategoryId: carbCategory._id,
      displayCategoryKey: carbCategory.key,
      availableForSubscription: true,
      isActive: true,
    }),
    Plan.create({
      key: "matrix_plan",
      name: { ar: "خطة المصفوفة", en: "Matrix Plan" },
      daysCount: 21,
      durationDays: 21,
      gramsOptions: [{
        grams: 200,
        mealsOptions: [{
          mealsPerDay: 1,
          priceHalala: 10000,
          compareAtHalala: 10000,
        }],
      }],
      isActive: true,
      active: true,
      available: true,
      isAvailable: true,
    }),
  ]);

  return { protein, carb, plan };
}

function selectionPayload(catalog) {
  return {
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "standard_meal",
      proteinId: String(catalog.protein._id),
      carbs: [{ carbId: String(catalog.carb._id), grams: 150 }],
    }],
  };
}

async function createUser(sequence) {
  return User.create({
    phone: `+9665000000${String(sequence).padStart(2, "0")}`,
    name: `Weekly Matrix ${sequence}`,
    role: "client",
    isActive: true,
  });
}

async function createSubscription({
  user,
  plan,
  startDate,
  endDate,
  totalMeals = 10,
}) {
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    contractMode: "canonical",
    status: "active",
    startDate: asKsaDate(startDate),
    endDate: asKsaDate(endDate),
    validityEndDate: asKsaDate(endDate),
    totalMeals,
    remainingMeals: totalMeals,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    baseMealAllocations: [],
    selectedMealsPerDay: 1,
    selectedGrams: 200,
    deliveryMode: "pickup",
    pickupLocationId: "main",
    premiumBalance: [],
  });
}

async function createOpenDay(subscriptionId, date) {
  return SubscriptionDay.create({
    subscriptionId,
    date,
    status: "open",
    fulfillmentModeOverride: "pickup",
    pickupLocationIdOverride: "main",
    plannerState: "draft",
    planningState: "draft",
    mealSlots: [],
    addonSelections: [],
  });
}

async function persistenceFingerprint(subscriptionId) {
  const [subscription, days, activityCount, auditCount] = await Promise.all([
    Subscription.findById(subscriptionId)
      .select(
        "remainingMeals reservedMeals consumedMeals forfeitedMeals "
          + "baseMealAllocations __v"
      )
      .lean(),
    SubscriptionDay.find({ subscriptionId })
      .select(
        "date status plannerState planningState mealSlots "
          + "baseAllocationKeys entitlementTransitionState __v"
      )
      .sort({ date: 1 })
      .lean(),
    ActivityLog.countDocuments({}),
    SubscriptionAuditLog.countDocuments({}),
  ]);
  return JSON.stringify({ subscription, days, activityCount, auditCount });
}

async function requestOnce({
  api,
  headers,
  subscriptionId,
  date,
  endpoint,
  payload,
}) {
  const base = `/api/subscriptions/${subscriptionId}/days/${date}`;
  if (endpoint === "validate") {
    return api.post(`${base}/selection/validate`).set(headers).send(payload);
  }
  if (endpoint === "save") {
    return api.put(`${base}/selection`).set(headers).send(payload);
  }
  return api.post(`${base}/confirm`).set(headers).send({});
}

async function requestWithTransactionRetry(requestOptions) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await requestOnce(requestOptions);
    if (response.status !== 500) return response;
    await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return response;
}

async function assertRejectedWithoutWrites({
  api,
  headers,
  subscription,
  date,
  payload,
  expectations,
}) {
  const before = await persistenceFingerprint(subscription._id);
  const observations = [];

  for (const endpoint of Object.keys(expectations)) {
    const response = await requestWithTransactionRetry({
      api,
      headers,
      subscriptionId: subscription._id,
      date,
      endpoint,
      payload,
    });
    const expected = expectations[endpoint];
    observations.push({
      endpoint,
      status: response.status,
      code: errorCode(response),
    });
    assert.strictEqual(response.status, expected.status, endpoint);
    assert.strictEqual(errorCode(response), expected.code, endpoint);
  }

  assert.strictEqual(
    await persistenceFingerprint(subscription._id),
    before,
    "rejected requests must not write"
  );
  return JSON.stringify(observations);
}

async function assertAllowedLifecycle({
  api,
  headers,
  subscription,
  date,
  payload,
}) {
  for (const endpoint of ["validate", "save", "confirm"]) {
    const response = await requestWithTransactionRetry({
      api,
      headers,
      subscriptionId: subscription._id,
      date,
      endpoint,
      payload,
    });
    assert.strictEqual(
      response.status,
      200,
      `${date}/${endpoint} ${JSON.stringify(response.body)}`
    );
  }

  const beforeRepeat = await persistenceFingerprint(subscription._id);
  const repeated = await requestWithTransactionRetry({
    api,
    headers,
    subscriptionId: subscription._id,
    date,
    endpoint: "confirm",
    payload,
  });
  assert.strictEqual(repeated.status, 200);
  assert.strictEqual(repeated.body.idempotent, true);
  assert.strictEqual(await persistenceFingerprint(subscription._id), beforeRepeat);
}

async function run() {
  await connect();
  await seedSettings();
  const catalog = await seedCatalog();
  const payload = selectionPayload(catalog);
  const week = resolveCurrentMenuWeek({ businessDate: BUSINESS_DATE });
  const tomorrow = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 1);
  const pastDate = dateUtils.addDaysToKSADateString(BUSINESS_DATE, -1);
  const missingPastDate = dateUtils.addDaysToKSADateString(BUSINESS_DATE, -2);
  const nextSaturday = dateUtils.addDaysToKSADateString(week.menuWeekEnd, 1);
  const subscriptionStart = dateUtils.addDaysToKSADateString(BUSINESS_DATE, -7);
  const subscriptionEnd = dateUtils.addDaysToKSADateString(nextSaturday, 14);
  const api = request(createApp());

  assert.deepStrictEqual(week, {
    businessDate: BUSINESS_DATE,
    menuWeekStart: "2026-07-25",
    menuWeekEnd: "2026-07-31",
  });

  const mainUser = await createUser(1);
  const main = await createSubscription({
    user: mainUser,
    plan: catalog.plan,
    startDate: subscriptionStart,
    endDate: subscriptionEnd,
  });
  const mainHeaders = authHeader(mainUser._id);
  for (const date of [
    pastDate,
    BUSINESS_DATE,
    tomorrow,
    week.menuWeekEnd,
    nextSaturday,
  ]) {
    await createOpenDay(main._id, date);
  }

  for (const date of [BUSINESS_DATE, tomorrow, week.menuWeekEnd]) {
    await check(`flag ON allows ${date}`, async () => {
      await assertAllowedLifecycle({
        api,
        headers: mainHeaders,
        subscription: main,
        date,
        payload,
      });
      return "validate/save/confirm 200; repeat confirm idempotent";
    });
  }

  await check("flag ON counters and client balance", async () => {
    const stored = await Subscription.findById(main._id).lean();
    assert.strictEqual(stored.remainingMeals, 7);
    assert.strictEqual(stored.reservedMeals, 3);
    assert.strictEqual(stored.consumedMeals, 0);
    assert.strictEqual(stored.forfeitedMeals, 0);
    assert.strictEqual(stored.baseMealAllocations.length, 3);
    assert.strictEqual(
      stored.remainingMeals
        + stored.reservedMeals
        + stored.consumedMeals
        + stored.forfeitedMeals,
      stored.totalMeals
    );

    const overview = await api
      .get("/api/subscriptions/current/overview?lang=en")
      .set(mainHeaders);
    assert.strictEqual(overview.status, 200);
    assert.strictEqual(overview.body.data.remainingMeals, 7);
    assert.strictEqual(overview.body.data.mealBalance.availableMeals, 7);
    assert.strictEqual(overview.body.data.mealBalance.remainingMeals, 10);
    assert.strictEqual(
      overview.body.data.mealBalance.displayRemainingMeals,
      10
    );
    assert(
      overview.body.data.mealBalance.maxConsumableMealsNow
        <= overview.body.data.mealBalance.availableMeals
    );
    return "available=7 reserved=3 display=10 allocations=3";
  });

  await check("flag ON GET read purity", async () => {
    const before = await persistenceFingerprint(main._id);
    const [overview, timeline] = await Promise.all([
      api.get("/api/subscriptions/current/overview?lang=en").set(mainHeaders),
      api
        .get(`/api/subscriptions/${main._id}/timeline?lang=en`)
        .set(mainHeaders),
    ]);
    assert.strictEqual(overview.status, 200);
    assert.strictEqual(timeline.status, 200);
    assert.strictEqual(await persistenceFingerprint(main._id), before);
    return "overview/timeline performed no writes";
  });

  await check("flag ON rejects existing past day", () => (
    assertRejectedWithoutWrites({
      api,
      headers: mainHeaders,
      subscription: main,
      date: pastDate,
      payload,
      expectations: {
        validate: { status: 400, code: "INVALID_DATE" },
        save: { status: 400, code: "INVALID_DATE" },
        confirm: { status: 400, code: "INVALID_DATE" },
      },
    })
  ));

  await check("confirm preserves missing-day NOT_FOUND", () => (
    assertRejectedWithoutWrites({
      api,
      headers: mainHeaders,
      subscription: main,
      date: missingPastDate,
      payload,
      expectations: {
        confirm: { status: 404, code: "NOT_FOUND" },
      },
    })
  ));

  const futureUser = await createUser(2);
  const futureStart = week.menuWeekEnd;
  const future = await createSubscription({
    user: futureUser,
    plan: catalog.plan,
    startDate: futureStart,
    endDate: subscriptionEnd,
  });
  await createOpenDay(future._id, tomorrow);
  await check("flag ON preserves before-start HTTP contracts", () => (
    assertRejectedWithoutWrites({
      api,
      headers: authHeader(futureUser._id),
      subscription: future,
      date: tomorrow,
      payload,
      expectations: {
        validate: { status: 422, code: "SUB_NOT_STARTED" },
        save: { status: 422, code: "SUBSCRIPTION_NOT_STARTED" },
        confirm: { status: 422, code: "SUB_NOT_STARTED" },
      },
    })
  ));

  const endedUser = await createUser(3);
  const ended = await createSubscription({
    user: endedUser,
    plan: catalog.plan,
    startDate: subscriptionStart,
    endDate: tomorrow,
  });
  await createOpenDay(ended._id, week.menuWeekEnd);
  await check("flag ON preserves after-validity HTTP contracts", () => (
    assertRejectedWithoutWrites({
      api,
      headers: authHeader(endedUser._id),
      subscription: ended,
      date: week.menuWeekEnd,
      payload,
      expectations: {
        validate: { status: 422, code: "SUB_EXPIRED" },
        save: { status: 422, code: "SUBSCRIPTION_EXPIRED" },
        confirm: { status: 422, code: "SUB_EXPIRED" },
      },
    })
  ));

  await check("flag ON rejects next Saturday", () => (
    assertRejectedWithoutWrites({
      api,
      headers: mainHeaders,
      subscription: main,
      date: nextSaturday,
      payload,
      expectations: {
        validate: { status: 400, code: "OUTSIDE_CURRENT_MENU_WEEK" },
        save: { status: 400, code: "OUTSIDE_CURRENT_MENU_WEEK" },
        confirm: { status: 400, code: "OUTSIDE_CURRENT_MENU_WEEK" },
      },
    })
  ));

  await check("flag ON hasSelectableDates=false", async () => {
    const window = resolveSubscriptionPlanningWindow({
      businessDate: BUSINESS_DATE,
      subscriptionStartDate: nextSaturday,
      subscriptionValidityEndDate: subscriptionEnd,
    });
    assert.strictEqual(window.hasSelectableDates, false);
    return `${window.planningWindowStart}>${window.planningWindowEnd}`;
  });

  const legacyUser = await createUser(4);
  const legacy = await createSubscription({
    user: legacyUser,
    plan: catalog.plan,
    startDate: subscriptionStart,
    endDate: subscriptionEnd,
  });
  await createOpenDay(legacy._id, nextSaturday);
  await check("flag OFF preserves planning beyond current week", () => (
    withTemporaryEnvironment(
      { SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED: "false" },
      async () => {
        await assertAllowedLifecycle({
          api,
          headers: authHeader(legacyUser._id),
          subscription: legacy,
          date: nextSaturday,
          payload,
        });
        const stored = await Subscription.findById(legacy._id).lean();
        assert.strictEqual(stored.remainingMeals, 9);
        assert.strictEqual(stored.reservedMeals, 1);
        assert.strictEqual(stored.baseMealAllocations.length, 1);
        return "next Saturday validate/save/confirm allowed";
      }
    )
  ));

  console.log(
    `subscriptionWeeklyPlanningWindowHttpMatrix.integration.test.js: `
      + `${checks.passed} passed, ${checks.failed} failed`
  );
  if (checks.failed) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect().catch((error) => {
      console.error(`cleanup failed: ${error.message}`);
      process.exitCode = 1;
    });
    restoreEnvironment();
    restoreClock();
  });
