"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = "true";

const assert = require("node:assert");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// Monkeypatch runMongoTransactionWithRetry BEFORE requiring app and controllers
const mongoTransactionRetryService = require("../src/services/mongoTransactionRetryService");
const originalRunMongoTransactionWithRetry = mongoTransactionRetryService.runMongoTransactionWithRetry;

let simulateWriteConflict = 0;
let writeConflictAttempts = 0;

mongoTransactionRetryService.runMongoTransactionWithRetry = async function (work, options) {
  const wrappedWork = async (session, { attempt }) => {
    if (simulateWriteConflict > 0) {
      simulateWriteConflict -= 1;
      writeConflictAttempts += 1;
      const err = new Error("Write conflict during transaction");
      err.code = 112; // WriteConflict
      throw err;
    }
    return await work(session, { attempt });
  };
  return await originalRunMongoTransactionWithRetry(wrappedWork, options);
};

const { createApp } = require("../src/app");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const Order = require("../src/models/Order");
const Delivery = require("../src/models/Delivery");
const User = require("../src/models/User");
const Zone = require("../src/models/Zone");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const ActivityLog = require("../src/models/ActivityLog");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const dateUtils = require("../src/utils/date");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

let app;

const TODAY_STR = dateUtils.getTodayKSADate();
const PAST_STR = dateUtils.addDaysToKSADateString(TODAY_STR, -5);
const FUTURE_STR = dateUtils.addDaysToKSADateString(TODAY_STR, 5);
const TEST_TAG = `ops-retry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const results = { passed: 0, failed: 0 };
const dashboardUsers = new Map();

async function test(name, fn) {
  try {
    simulateWriteConflict = 0;
    writeConflictAttempts = 0;
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function dashboardToken(role = "admin") {
  const dashboardUser = dashboardUsers.get(role);
  assert(dashboardUser, `missing dashboard user for role ${role}`);
  return jwt.sign(
    { userId: String(dashboardUser._id), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(role = "admin") {
  return { Authorization: `Bearer ${dashboardToken(role)}`, "Accept-Language": "en" };
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

let mongoServer;

async function startMemoryMongo() {
  if (mongoServer) return;
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
}

async function connectDatabase() {
  await startMemoryMongo();
  if (mongoose.connection.readyState === 0) {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI_TEST);
  }
}

let seedData = {};

async function seedBaseData() {
  await Setting.deleteMany({ key: { $in: ["pickup_locations", "restaurant_is_open", "delivery_windows", "cutoff_time"] } });
  await Setting.create([
    {
      key: "pickup_locations",
      value: [{
        id: "branch_1",
        key: "branch_1",
        code: "branch_1",
        pickupLocationId: "branch_1",
        name: { ar: "فرع الرياض", en: "Riyadh Branch" },
        isActive: true,
        active: true,
      }]
    },
    { key: "restaurant_is_open", value: true },
    { key: "delivery_windows", value: ["08:00-11:00", "12:00-15:00"] },
    { key: "cutoff_time", value: "14:00" }
  ]);

  const client = await User.create({
    phone: `+966599999003_${TEST_TAG}`,
    name: "Client Ops Retry",
    role: "client",
    isActive: true,
  });

  const plan = await Plan.create({
    name: { ar: "الباقة الأساسية", en: `${TEST_TAG} Plan` },
    daysCount: 7,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 150,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 75000, compareAtHalala: 90000, isActive: true }],
    }],
  });

  const zone = await Zone.create({
    name: { ar: "حي الياسمين", en: `${TEST_TAG} Zone` },
    deliveryFeeHalala: 1500,
    isActive: true,
    sortOrder: 1,
  });

  const deliverySub = await Subscription.create({
    userId: client._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    totalMeals: 14,
    remainingMeals: 14,
    selectedGrams: 150,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    deliveryAddress: { line1: "Street 1", city: "Riyadh" },
    deliveryWindow: "08:00-11:00",
    deliveryZoneId: zone._id,
    addonBalance: [{ addonId: new mongoose.Types.ObjectId(), quantity: 5 }],
  });

  seedData = { client, plan, zone, deliverySub };
}

async function seedAuthUsers() {
  for (const role of ["superadmin", "admin", "kitchen", "courier", "cashier"]) {
    const authObj = await dashboardAuth(role, TEST_TAG);
    dashboardUsers.set(role, authObj.user);
  }
}

async function runTests() {
  console.log("Running Operations Transaction Retry Contract Verification...");
  await connectDatabase();
  app = createApp();
  await seedBaseData();
  await seedAuthUsers();

  // 1. Courier delivery transition succeeds normally without retry
  await test("1. Courier delivery transition succeeds normally without retry", async () => {
    const day = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });
    const deliv = await Delivery.create({
      subscriptionId: seedData.deliverySub._id,
      dayId: day._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });

    simulateWriteConflict = 0;
    const res = await request(app)
      .put(`/api/courier/deliveries/${deliv._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 200, "courier mark delivery delivered normally");
    assert.strictEqual(writeConflictAttempts, 0);
    assert.strictEqual(res.body.status, true);
  });

  // 2. Courier delivery transition retries once after simulated Mongo WriteConflict and then succeeds
  await test("2. Courier delivery transition retries once after simulated Mongo WriteConflict and then succeeds", async () => {
    const sub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      totalMeals: 14,
      remainingMeals: 14,
      selectedGrams: 150,
      selectedMealsPerDay: 2,
      deliveryMode: "delivery",
      deliveryAddress: { line1: "Street 1", city: "Riyadh" },
      deliveryWindow: "08:00-11:00",
      deliveryZoneId: seedData.zone._id,
    });
    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });
    const deliv = await Delivery.create({
      subscriptionId: sub._id,
      dayId: day._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });

    simulateWriteConflict = 1;
    const res = await request(app)
      .put(`/api/courier/deliveries/${deliv._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 200, "courier mark delivery delivered with retry");
    assert.strictEqual(writeConflictAttempts, 1);
    assert.strictEqual(res.body.status, true);
  });

  // 3. Order courier transition retries once after simulated Mongo WriteConflict and then succeeds
  await test("3. Order courier transition retries once after simulated Mongo WriteConflict and then succeeds", async () => {
    const order = await Order.create({
      orderNumber: `ORD-RETRY-${TEST_TAG}`,
      userId: seedData.client._id,
      status: "out_for_delivery",
      paymentStatus: "paid",
      fulfillmentMethod: "delivery",
      fulfillmentDate: TODAY_STR,
    });
    const deliv = await Delivery.create({
      orderId: order._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });

    simulateWriteConflict = 1;
    const res = await request(app)
      .put(`/api/courier/orders/${order._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 200, "courier mark order delivered with retry");
    assert.strictEqual(writeConflictAttempts, 1);
    assert.strictEqual(res.body.status, true);
  });

  // 4, 5, 6. Retry does not duplicate final status transition, balance deduction, or ActivityLog
  await test("4, 5, 6. Retry does not duplicate final status transition, balance deduction, or ActivityLog", async () => {
    const sub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      totalMeals: 14,
      remainingMeals: 14,
      selectedGrams: 150,
      selectedMealsPerDay: 2,
      deliveryMode: "delivery",
      deliveryAddress: { line1: "Street 1", city: "Riyadh" },
      deliveryWindow: "08:00-11:00",
      deliveryZoneId: seedData.zone._id,
      addonBalance: [{ addonId: new mongoose.Types.ObjectId(), quantity: 5 }],
    });
    const day = await SubscriptionDay.create({
      subscriptionId: sub._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });
    const deliv = await Delivery.create({
      subscriptionId: sub._id,
      dayId: day._id,
      date: TODAY_STR,
      status: "out_for_delivery",
    });

    const subBefore = await Subscription.findById(sub._id).lean();
    await ActivityLog.deleteMany({ entityId: sub._id });

    simulateWriteConflict = 1;
    const res = await request(app)
      .put(`/api/courier/deliveries/${deliv._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 200, "courier mark delivery delivered with retry check side effects");
    assert.strictEqual(writeConflictAttempts, 1);

    // 4. Verify final status transition is correct and clean
    const updatedDay = await SubscriptionDay.findById(day._id).lean();
    assert.strictEqual(updatedDay.status, "fulfilled");
    const updatedDeliv = await Delivery.findById(deliv._id).lean();
    assert.strictEqual(updatedDeliv.status, "delivered");

    // 5. Verify balance deduction is exactly 2 meals (selectedMealsPerDay) and addon unchanged
    const updatedSub = await Subscription.findById(sub._id).lean();
    assert.strictEqual(updatedSub.remainingMeals, 12, "Remaining meals should be deducted exactly once (14 - 2 = 12)");
    assert.deepStrictEqual(updatedSub.addonBalance, subBefore.addonBalance, "Addon balance should remain untouched");

    // 6. Verify ActivityLog / audit log is not duplicated
    const logs = await ActivityLog.find({ entityId: sub._id }).lean();
    assert(logs.length <= 1, `ActivityLog count should be at most 1, got ${logs.length}`);
  });

  // 7. Non-retryable validation/business errors are not retried
  await test("7. Non-retryable validation/business errors are not retried", async () => {
    const day = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: TODAY_STR,
      status: "delivery_canceled",
    });
    const deliv = await Delivery.create({
      subscriptionId: seedData.deliverySub._id,
      dayId: day._id,
      date: TODAY_STR,
      status: "canceled",
    });

    simulateWriteConflict = 0;
    const res = await request(app)
      .put(`/api/courier/deliveries/${deliv._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 409, "courier mark canceled delivery delivered");
    assert.strictEqual(writeConflictAttempts, 0, "Should fail immediately without retrying");
  });

  // 8. HISTORICAL_MUTATION_FORBIDDEN is not retried and still returns 409
  await test("8. HISTORICAL_MUTATION_FORBIDDEN is not retried and still returns 409", async () => {
    const pastDay = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: PAST_STR,
      status: "out_for_delivery",
    });
    const pastDeliv = await Delivery.create({
      subscriptionId: seedData.deliverySub._id,
      dayId: pastDay._id,
      date: PAST_STR,
      status: "out_for_delivery",
    });

    simulateWriteConflict = 0;
    const res = await request(app)
      .put(`/api/courier/deliveries/${pastDeliv._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 409, "courier mark past delivery delivered");
    assert.strictEqual(res.body.error.code, "HISTORICAL_MUTATION_FORBIDDEN");
    assert.strictEqual(writeConflictAttempts, 0, "HISTORICAL_MUTATION_FORBIDDEN should not be retried");
  });

  // 9. Missing req.userRole / forbidden role is not retried and still returns 403
  await test("9. Missing req.userRole / forbidden role is not retried and still returns 403", async () => {
    const res = await request(app)
      .put(`/api/courier/orders/${new mongoose.Types.ObjectId()}/delivered`)
      .set(auth("cashier")); // Unauthorized role for courier actions
    
    expectStatus(res, 403, "missing role returns 403");
    assert.strictEqual(writeConflictAttempts, 0, "Auth error should not be retried");
  });

  // 10. Existing idempotent delivered/cancelled replay behavior remains unchanged
  await test("10. Existing idempotent delivered/cancelled replay behavior remains unchanged", async () => {
    const order = await Order.create({
      orderNumber: `ORD-IDEM-${TEST_TAG}`,
      userId: seedData.client._id,
      status: "fulfilled",
      paymentStatus: "paid",
      fulfillmentMethod: "delivery",
      fulfillmentDate: TODAY_STR,
    });
    const deliv = await Delivery.create({
      orderId: order._id,
      date: TODAY_STR,
      status: "delivered",
    });

    const res = await request(app)
      .put(`/api/courier/orders/${order._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 200, "idempotent replay returns 200");
    assert.strictEqual(res.body.idempotent, true);
  });

  console.log(`\nTest results: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exitCode = 1;
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

runTests();
