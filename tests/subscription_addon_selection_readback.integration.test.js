"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "subscription-addon-readback-secret";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "subscription-addon-dashboard-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { createApp } = require("../src/app");
const { issueAppAccessToken } = require("../src/services/appTokenService");
const { issueDashboardAccessToken } = require("../src/services/dashboardTokenService");
const Addon = require("../src/models/Addon");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const DashboardUser = require("../src/models/DashboardUser");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");

const TEST_DB_NAME = "basicdiet_subscription_addon_readback";
const TEST_TAG = `subscription-addon-readback-${Date.now()}`;

let replSet = null;
let api = null;

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function requestWithRetry(method, url, body, token) {
  let attempts = 0;
  const maxAttempts = 10;
  while (attempts < maxAttempts) {
    let req = api[method.toLowerCase()](url);
    if (token) req = req.set("Authorization", `Bearer ${token}`);
    if (body) req = req.send(body);
    const res = await req;
    
    const bodyStr = JSON.stringify(res.body || {});
    const isTransient = res.status >= 500 && (
      bodyStr.includes("Unable to acquire IX lock") || 
      bodyStr.includes("catalog changes") ||
      bodyStr.includes("WriteConflict") ||
      bodyStr.includes("retry the operation")
    );

    if (isTransient && attempts < maxAttempts) {
      attempts += 1;
      await new Promise(r => setTimeout(r, 200 + attempts * 200));
      continue;
    }
    return res;
  }
}

function ksaDateOffset(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function dateStart(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateEnd(date) {
  return new Date(`${date}T23:59:59.999Z`);
}

function assertErrorCode(res, status, code, label) {
  assert.strictEqual(res.status, status, `${label}: HTTP status`);
  assert.strictEqual(res.body && res.body.error && res.body.error.code, code, `${label}: error code`);
}

async function startMongo() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function stopMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

async function seedCatalog() {
  const builderCategoryId = new mongoose.Types.ObjectId();
  const carbCategoryId = new mongoose.Types.ObjectId();

  const protein = await BuilderProtein.create({
    key: `${TEST_TAG}-chicken`,
    name: { en: "QA Chicken", ar: "QA Chicken" },
    displayCategoryId: builderCategoryId,
    displayCategoryKey: "chicken",
    proteinFamilyKey: "chicken",
    isPremium: false,
    premiumKey: `${TEST_TAG}-chicken`,
    extraFeeHalala: 0,
    currency: "SAR",
    availableForSubscription: true,
    isActive: true,
  });

  const carb = await BuilderCarb.create({
    key: `${TEST_TAG}-rice`,
    name: { en: "QA Rice", ar: "QA Rice" },
    displayCategoryId: carbCategoryId,
    displayCategoryKey: "standard_carbs",
    availableForSubscription: true,
    isActive: true,
  });

  const juiceCategory = await MenuCategory.create({
    key: `${TEST_TAG}-juices`.replace(`${TEST_TAG}-`, ""),
    name: { en: "Juices", ar: "Juices" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  const lightOptionsCategory = await MenuCategory.create({
    key: "light_options",
    name: { en: "Light Options", ar: "Light Options" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  const juiceProduct = await MenuProduct.create({
    categoryId: juiceCategory._id,
    key: `${TEST_TAG}-berry`.slice(0, 90),
    name: { en: "QA Berry Juice", ar: "QA Berry Juice" },
    itemType: "juice",
    pricingModel: "fixed",
    priceHalala: 1100,
    currency: "SAR",
    availableFor: ["one_time"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  const disallowedProduct = await MenuProduct.create({
    categoryId: lightOptionsCategory._id,
    key: `${TEST_TAG}-yogurt`.slice(0, 90),
    name: { en: "QA Yogurt", ar: "QA Yogurt" },
    itemType: "greek_yogurt",
    pricingModel: "fixed",
    priceHalala: 900,
    currency: "SAR",
    availableFor: ["one_time"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });

  const addonPlan = await Addon.create({
    name: { en: "QA Daily Juice", ar: "QA Daily Juice" },
    category: "juice",
    kind: "plan",
    type: "subscription",
    billingMode: "per_day",
    priceHalala: 500,
    currency: "SAR",
    isActive: true,
  });

  return {
    addonPlan,
    carb,
    disallowedProduct,
    juiceProduct,
    protein,
  };
}

async function seedUserAndSubscriptions({ addonPlan, date }) {
  const user = await User.create({
    phone: `+9665${String(Date.now()).slice(-8)}`,
    name: `${TEST_TAG} client`,
    role: "client",
    isActive: true,
  });
  const dashboardUser = await DashboardUser.create({
    email: `${TEST_TAG}@example.com`,
    passwordHash: "not-used-in-test",
    role: "kitchen",
    isActive: true,
  });
  const token = issueAppAccessToken(user);
  const dashboardToken = issueDashboardAccessToken(dashboardUser);
  const planId = new mongoose.Types.ObjectId();

  const baseSubscription = {
    userId: user._id,
    planId,
    status: "active",
    startDate: dateStart(ksaDateOffset(-1)),
    endDate: dateEnd(ksaDateOffset(10)),
    validityEndDate: dateEnd(ksaDateOffset(10)),
    totalMeals: 10,
    remainingMeals: 10,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: TEST_TAG,
  };

  const subscription = await Subscription.create({
    ...baseSubscription,
    addonSubscriptions: [{
      addonId: addonPlan._id,
      name: "QA Daily Juice",
      category: "juice",
      maxPerDay: 1,
    }],
  });

  const noEntitlementSubscription = await Subscription.create({
    ...baseSubscription,
    addonSubscriptions: [],
  });

  await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status: "open",
    addonSelections: [],
  });

  return {
    dashboardToken,
    noEntitlementSubscription,
    subscription,
    token,
  };
}

function buildPayload({ protein, carb, addonIds }) {
  return {
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      selectionType: "standard_meal",
      proteinId: String(protein._id),
      carbs: [{ carbId: String(carb._id), grams: 150 }],
    }],
    addonsOneTime: addonIds.map(String),
  };
}

function assertPendingJuice(day, label) {
  const juice = day && day.addonEntitlements && day.addonEntitlements.juice;
  assert(juice, `${label}: juice entitlement exists`);
  assert.strictEqual(juice.subscribed, true, `${label}: juice subscribed`);
  assert.strictEqual(juice.selectedItem, null, `${label}: selected item null`);
  assert.strictEqual(juice.status, "pending_selection", `${label}: pending status`);
}

function assertSelectedJuice(day, productId, label) {
  const juice = day && day.addonEntitlements && day.addonEntitlements.juice;
  assert(juice, `${label}: juice entitlement exists`);
  assert.strictEqual(juice.status, "selected", `${label}: selected status`);
  assert(juice.selectedItem, `${label}: selected item exists`);
  assert.strictEqual(juice.selectedItem.menuProductId, String(productId), `${label}: selected MenuProduct id`);
  assert.strictEqual(juice.selectedItem.source, "subscription", `${label}: selected source`);
  assert.strictEqual(Number(juice.selectedItem.priceHalala || 0), 0, `${label}: selected price`);
}

async function run() {
  const results = { passed: 0, failed: 0, skipped: 0 };
  const test = async (name, fn) => {
    try {
      await fn();
      results.passed += 1;
      console.log(`✅ ${name}`);
    } catch (err) {
      results.failed += 1;
      console.error(`❌ ${name}`);
      console.error(err && err.stack ? err.stack : err);
    }
  };

  try {
    await startMongo();
  } catch (err) {
    results.skipped += 1;
    console.error(`⏭️ MongoMemoryReplSet unavailable: ${err.message}`);
    console.log(`Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
    process.exit(1);
  }

  try {
    api = request(createApp());
    const date = ksaDateOffset(2);
    const catalog = await seedCatalog();
    const fixtures = await seedUserAndSubscriptions({ addonPlan: catalog.addonPlan, date });
    const appAuth = authHeader(fixtures.token);
    const kitchenAuth = authHeader(fixtures.dashboardToken);
    const selectedPayload = buildPayload({
      protein: catalog.protein,
      carb: catalog.carb,
      addonIds: [catalog.juiceProduct._id],
    });
    const clearPayload = buildPayload({
      protein: catalog.protein,
      carb: catalog.carb,
      addonIds: [],
    });

    await test("initial day detail exposes pending juice entitlement", async () => {
      const res = await requestWithRetry("GET", `/api/subscriptions/${fixtures.subscription._id}/days/${date}`, null, fixtures.token);
      assert.strictEqual(res.status, 200, "day detail status");
      assertPendingJuice(res.body.data, "initial day detail");
    });

    await test("validate accepts canonical mealSlots plus addonsOneTime MenuProduct id", async () => {
      const res = await requestWithRetry("POST", `/api/subscriptions/${fixtures.subscription._id}/days/${date}/selection/validate`, selectedPayload, fixtures.token);
      assert.strictEqual(res.status, 200, "validate status");
      assert.strictEqual(res.body.data.addonSelections[0].addonId, String(catalog.juiceProduct._id), "validate addonId");
      assert.strictEqual(res.body.data.addonSelections[0].source, "subscription", "validate source");
      assert.strictEqual(Number(res.body.data.addonSelections[0].priceHalala || 0), 0, "validate price");
      assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 0, "validate pending add-on count");
      assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, 0, "validate pending amount");
    });

    await test("save persists selected daily MenuProduct without double charging", async () => {
      const res = await requestWithRetry("PUT", `/api/subscriptions/${fixtures.subscription._id}/days/${date}/selection`, selectedPayload, fixtures.token);
      assert.strictEqual(res.status, 200, "save status");
      assertSelectedJuice(res.body.data, catalog.juiceProduct._id, "save response");
      assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 0, "save pending add-on count");
      assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, 0, "save pending amount");

      const stored = await SubscriptionDay.findOne({ subscriptionId: fixtures.subscription._id, date }).lean();
      assert(stored, "stored day exists");
      assert.strictEqual(stored.addonSelections.length, 1, "stored selection count");
      assert.strictEqual(String(stored.addonSelections[0].addonId), String(catalog.juiceProduct._id), "stored MenuProduct id");
      assert.strictEqual(stored.addonSelections[0].source, "subscription", "stored source");
      assert.strictEqual(Number(stored.addonSelections[0].priceHalala || 0), 0, "stored price");
    });

    await test("day detail returns persisted selected MenuProduct", async () => {
      const res = await requestWithRetry("GET", `/api/subscriptions/${fixtures.subscription._id}/days/${date}`, null, fixtures.token);
      assert.strictEqual(res.status, 200, "day detail status");
      assertSelectedJuice(res.body.data, catalog.juiceProduct._id, "saved day detail");
    });

    await test("kitchen output returns entitlement and selected MenuProduct", async () => {
      const res = await requestWithRetry("GET", `/api/dashboard/kitchen/production-days/subscription/${date}/all`, null, fixtures.dashboardToken);
      assert.strictEqual(res.status, 200, "kitchen detail status");
      const subRow = (res.body.data || []).find((r) => String(r.subscriptionId) === String(fixtures.subscription._id));
      assert(subRow, "kitchen row exists for subscription");
      assertSelectedJuice(subRow, catalog.juiceProduct._id, "kitchen row");
    });

    await test("clear selection preserves entitlement and returns pending state", async () => {
      const res = await requestWithRetry("PUT", `/api/subscriptions/${fixtures.subscription._id}/days/${date}/selection`, clearPayload, fixtures.token);
      assert.strictEqual(res.status, 200, "clear status");
      const getRes = await requestWithRetry("GET", `/api/subscriptions/${fixtures.subscription._id}/days/${date}`, null, fixtures.token);
      assertPendingJuice(getRes.body.data, "cleared day detail");
      assert.deepStrictEqual(getRes.body.data.addonSelections || [], [], "addon selections cleared");
    });

    await test("subscription without entitlement can select one-time add-on as pending payment", async () => {
      const res = await requestWithRetry("POST", `/api/subscriptions/${fixtures.noEntitlementSubscription._id}/days/${date}/selection/validate`, selectedPayload, fixtures.token);
      assert.strictEqual(res.status, 200, "validate status");
      assert.strictEqual(res.body.data.addonSelections[0].source, "pending_payment", "validate source");
      assert.strictEqual(Number(res.body.data.addonSelections[0].priceHalala || 0), Number(catalog.juiceProduct.priceHalala || 0), "validate price");
      assert.strictEqual(res.body.data.paymentRequirement.addonPendingPaymentCount, 1, "validate pending add-on count");
      assert.strictEqual(res.body.data.paymentRequirement.pendingAmountHalala, Number(catalog.juiceProduct.priceHalala || 0), "validate pending amount");
    });

    await test("Addon plan id cannot be used as daily MenuProduct selection", async () => {
      const invalidPayload = buildPayload({ protein: catalog.protein, carb: catalog.carb, addonIds: [catalog.addonPlan._id] });
      const res = await requestWithRetry("POST", `/api/subscriptions/${fixtures.subscription._id}/days/${date}/selection/validate`, invalidPayload, fixtures.token);
      assertErrorCode(res, 400, "INVALID_ONE_TIME_ADDON_SELECTION", "disallowed addon plan item");
    });

    await test("invalid or disallowed MenuProduct is rejected", async () => {
      const invalidPayload = buildPayload({
        protein: catalog.protein,
        carb: catalog.carb,
        addonIds: [catalog.disallowedProduct._id],
      });
      const res = await requestWithRetry("POST", `/api/subscriptions/${fixtures.subscription._id}/days/${date}/selection/validate`, invalidPayload, fixtures.token);
      assertErrorCode(res, 400, "INVALID_ONE_TIME_ADDON_SELECTION", "disallowed MenuProduct");
    });
  } finally {
    await stopMongo();
  }

  console.log(`Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  if (results.failed || results.skipped) {
    process.exit(1);
  }
}

run().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  await stopMongo().catch(() => {});
  process.exit(1);
});
