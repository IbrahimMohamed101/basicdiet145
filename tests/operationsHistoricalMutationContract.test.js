"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = "true";

const assert = require("node:assert");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const Order = require("../src/models/Order");
const Delivery = require("../src/models/Delivery");
const User = require("../src/models/User");
const Zone = require("../src/models/Zone");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const dateUtils = require("../src/utils/date");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

let app;

const TODAY_STR = dateUtils.getTodayKSADate();
const PAST_STR = dateUtils.addDaysToKSADateString(TODAY_STR, -5);
const FUTURE_STR = dateUtils.addDaysToKSADateString(TODAY_STR, 5);
const TEST_TAG = `ops-hist-mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const results = { passed: 0, failed: 0 };
const dashboardUsers = new Map();

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
    phone: `+966599999002_${TEST_TAG}`,
    name: "Client Ops Hist",
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
  console.log("Running Operations Historical Mutation Guard Contract Verification...");
  await connectDatabase();
  app = createApp();
  await seedBaseData();
  await seedAuthUsers();

  await test("Courier cannot settle a past subscription delivery that was never prepared", async () => {
    const pastDay = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: PAST_STR,
      status: "open",
    });
    const pastDelivery = await Delivery.create({
      subscriptionId: seedData.deliverySub._id,
      dayId: pastDay._id,
      date: PAST_STR,
      status: "scheduled",
    });

    const subBefore = await Subscription.findById(seedData.deliverySub._id).lean();

    const res = await request(app)
      .put(`/api/courier/deliveries/${pastDelivery._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(res, 409, "courier mark past delivery delivered");
    assert.strictEqual(res.body.error.code, "HISTORICAL_MUTATION_FORBIDDEN");
    assert.strictEqual(res.body.messageAr.replace(/\u064B/g, ""), "لا يمكن تعديل سجلات تشغيلية تخص تاريخًا سابقًا".replace(/\u064B/g, ""));
    assert.strictEqual(res.body.status, false);

    // Verify balances unchanged
    const subAfter = await Subscription.findById(seedData.deliverySub._id).lean();
    assert.deepStrictEqual(subAfter.addonBalance, subBefore.addonBalance, "Addon balance must remain unchanged");
    assert.strictEqual(subAfter.remainingMeals, subBefore.remainingMeals, "Remaining meals must remain unchanged");
  });

  await test("Courier can settle an eligible historical subscription delivery", async () => {
    const date = dateUtils.addDaysToKSADateString(PAST_STR, -1);
    const day = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date,
      status: "out_for_delivery",
    });
    const delivery = await Delivery.create({
      subscriptionId: seedData.deliverySub._id,
      dayId: day._id,
      date,
      status: "out_for_delivery",
    });
    const before = await Subscription.findById(day.subscriptionId).lean();
    const res = await request(app)
      .put(`/api/courier/deliveries/${delivery._id}/delivered`)
      .set(auth("courier"));
    expectStatus(res, 200, "courier settles eligible historical delivery");
    assert.strictEqual(res.body.fulfillment.deductedCredits, 2);
    const after = await Subscription.findById(day.subscriptionId).lean();
    assert.strictEqual(after.remainingMeals, before.remainingMeals - 2);
  });

  // Test 2: Courier cannot mark past Order delivery as delivered
  await test("2: Courier cannot mark past Order delivery as delivered", async () => {
    const pastOrder = await Order.create({
      orderNumber: `ORD-PAST-${TEST_TAG}`,
      userId: seedData.client._id,
      status: "out_for_delivery",
      paymentStatus: "paid",
      fulfillmentMethod: "delivery",
      fulfillmentDate: PAST_STR,
    });
    const pastOrderDeliv = await Delivery.create({
      orderId: pastOrder._id,
      date: PAST_STR,
      status: "out_for_delivery",
    });

    const res = await request(app)
      .put(`/api/courier/orders/${pastOrder._id}/delivered`)
      .set(auth("courier"));

    expectStatus(res, 409, "courier mark past order delivered");
    assert.strictEqual(res.body.error.code, "HISTORICAL_MUTATION_FORBIDDEN");
    assert.strictEqual(res.body.messageAr.replace(/\u064B/g, ""), "لا يمكن تعديل سجلات تشغيلية تخص تاريخًا سابقًا".replace(/\u064B/g, ""));
  });

  // Test 3: Kitchen/courier cannot move a past operational record to ready/out_for_delivery
  await test("3: Kitchen/courier cannot move a past operational record to ready/out_for_delivery", async () => {
    const pastDay = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: PAST_STR,
      status: "in_preparation",
    });

    // Kitchen try to mark ready_for_delivery
    const readyRes = await request(app)
      .post("/api/dashboard/ops/actions/ready_for_delivery")
      .send({ entityId: pastDay._id, entityType: "subscription" })
      .set(auth("kitchen"));
    
    expectStatus(readyRes, 409, "kitchen mark past day ready_for_delivery");
    assert.strictEqual(readyRes.body.error.code, "HISTORICAL_MUTATION_FORBIDDEN");

    // Courier try to dispatch
    const dispatchRes = await request(app)
      .post("/api/dashboard/ops/actions/dispatch")
      .send({ entityId: pastDay._id, entityType: "subscription" })
      .set(auth("courier"));
    
    expectStatus(dispatchRes, 409, "courier dispatch past day");
    assert.strictEqual(dispatchRes.body.error.code, "HISTORICAL_MUTATION_FORBIDDEN");
  });

  // Test 4: Today’s SubscriptionDay delivery transition still works
  await test("4: Today’s SubscriptionDay delivery transition still works", async () => {
    const todayDay = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: TODAY_STR,
      status: "open",
    });

    const prepRes = await request(app)
      .post("/api/dashboard/ops/actions/prepare")
      .send({ entityId: todayDay._id, entityType: "subscription" })
      .set(auth("kitchen"));
    
    expectStatus(prepRes, 200, "prepare today day");
    assert.strictEqual(prepRes.body.data.status, "in_preparation");
  });

  // Test 5: Future SubscriptionDay delivery transition still works if current policy allows it
  await test("5: Future SubscriptionDay delivery transition still works if current policy allows it", async () => {
    const futureDay = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: FUTURE_STR,
      status: "open",
    });

    const prepRes = await request(app)
      .post("/api/dashboard/ops/actions/prepare")
      .send({ entityId: futureDay._id, entityType: "subscription" })
      .set(auth("kitchen"));
    
    expectStatus(prepRes, 200, "prepare future day");
    assert.strictEqual(prepRes.body.data.status, "in_preparation");
  });

  // Test 6: Already terminal delivered/cancelled idempotent replay behavior remains unchanged if currently supported
  await test("6: Already terminal delivered/cancelled idempotent replay behavior remains unchanged if currently supported", async () => {
    // 1. Terminal delivered SubscriptionDay
    const terminalDay = await SubscriptionDay.create({
      subscriptionId: seedData.deliverySub._id,
      date: PAST_STR,
      status: "fulfilled",
    });
    const terminalDelivery = await Delivery.create({
      subscriptionId: seedData.deliverySub._id,
      dayId: terminalDay._id,
      date: PAST_STR,
      status: "delivered",
    });

    const resDeliv = await request(app)
      .put(`/api/courier/deliveries/${terminalDelivery._id}/delivered`)
      .set(auth("courier"));
    
    expectStatus(resDeliv, 200, "terminal day idempotent replay");

    // 2. Terminal cancelled Order
    const terminalOrder = await Order.create({
      orderNumber: `ORD-TERM-${TEST_TAG}`,
      userId: seedData.client._id,
      status: "cancelled",
      paymentStatus: "paid",
      fulfillmentMethod: "delivery",
      fulfillmentDate: PAST_STR,
    });
    const terminalOrderDeliv = await Delivery.create({
      orderId: terminalOrder._id,
      date: PAST_STR,
      status: "canceled",
    });

    const resOrderCancel = await request(app)
      .put(`/api/courier/orders/${terminalOrder._id}/cancel`)
      .set(auth("courier"));
    
    expectStatus(resOrderCancel, 200, "terminal order cancel idempotent replay");
  });

  // Test 9: Pickup historical mutation is blocked if pickup requests/days use the same transition service
  await test("9: Pickup historical mutation is blocked if pickup requests/days use the same transition service", async () => {
    const pastPickupSub = await Subscription.create({
      userId: seedData.client._id,
      planId: seedData.plan._id,
      status: "active",
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      totalMeals: 14,
      remainingMeals: 14,
      selectedGrams: 150,
      selectedMealsPerDay: 2,
      deliveryMode: "pickup",
      pickupLocationId: "branch_1",
    });

    const pastPickupDay = await SubscriptionDay.create({
      subscriptionId: pastPickupSub._id,
      date: PAST_STR,
      status: "open",
    });

    const pastPickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: pastPickupSub._id,
      subscriptionDayId: pastPickupDay._id,
      userId: seedData.client._id,
      date: PAST_STR,
      mealCount: 1,
      status: "locked",
    });

    const resPrep = await request(app)
      .post("/api/dashboard/ops/actions/prepare")
      .send({ entityId: pastPickupRequest._id, entityType: "subscription_pickup_request" })
      .set(auth("kitchen"));

    expectStatus(resPrep, 409, "prepare past pickup request");
    assert.strictEqual(resPrep.body.error.code, "HISTORICAL_MUTATION_FORBIDDEN");
    assert.strictEqual(resPrep.body.messageAr.replace(/\u064B/g, ""), "لا يمكن تعديل سجلات تشغيلية تخص تاريخًا سابقًا".replace(/\u064B/g, ""));
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
