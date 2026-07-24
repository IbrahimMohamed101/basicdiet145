"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-payment-report-secret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const { ensureSafeForDestructiveOp } = require("../src/utils/dbSafety");

const TEST_PREFIX = "dashboard-subscription-payment-report";
const TEST_DATE = "2026-07-24";
const TEST_PHONES = ["+966511119901", "+966511119902"];

let app;
let admin;
let cashier;
let plan;
let cashUser;
let visaUser;
let cashSubscription;
let visaSubscription;

function tokenFor(user, role) {
  return jwt.sign(
    { userId: String(user._id), role, tokenType: "dashboard_access" },
    process.env.DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(req, token) {
  return req.set("Authorization", `Bearer ${token}`).set("Accept-Language", "en");
}

async function connect() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/basicdiet_test";
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
}

async function cleanup() {
  ensureSafeForDestructiveOp("dashboard subscription payment report cleanup");
  const users = await User.find({ phone: { $in: TEST_PHONES } }).select("_id").lean();
  const userIds = users.map((row) => row._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((row) => row._id);
  await Payment.deleteMany({ subscriptionId: { $in: subscriptionIds } });
  await Subscription.deleteMany({ _id: { $in: subscriptionIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await Plan.deleteMany({ "name.en": TEST_PREFIX });
  await DashboardUser.deleteMany({ email: { $in: [`${TEST_PREFIX}@example.com`, `${TEST_PREFIX}-cashier@example.com`] } });
}

async function setup() {
  await connect();
  await cleanup();
  app = createApp();

  admin = await DashboardUser.create({
    email: `${TEST_PREFIX}@example.com`,
    passwordHash: "test",
    role: "admin",
    isActive: true,
  });
  cashier = await DashboardUser.create({
    email: `${TEST_PREFIX}-cashier@example.com`,
    passwordHash: "test",
    role: "cashier",
    isActive: true,
  });
  plan = await Plan.create({
    name: { ar: TEST_PREFIX, en: TEST_PREFIX },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 100,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 1, priceHalala: 10000, compareAtHalala: 10000, isActive: true }],
    }],
  });
  cashUser = await User.create({ phone: TEST_PHONES[0], name: "Cash Customer", role: "client", isActive: true });
  visaUser = await User.create({ phone: TEST_PHONES[1], name: "Visa Customer", role: "client", isActive: true });

  cashSubscription = await Subscription.create({
    userId: cashUser._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-07-24T00:00:00.000Z"),
    endDate: new Date("2026-08-20T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-20T00:00:00.000Z"),
    totalMeals: 28,
    remainingMeals: 28,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
  });
  visaSubscription = await Subscription.create({
    userId: visaUser._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-07-24T00:00:00.000Z"),
    endDate: new Date("2026-08-20T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-20T00:00:00.000Z"),
    totalMeals: 28,
    remainingMeals: 28,
    selectedMealsPerDay: 1,
    deliveryMode: "delivery",
  });

  await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: 10000,
    currency: "SAR",
    userId: cashUser._id,
    subscriptionId: cashSubscription._id,
    source: Payment.DASHBOARD_SUBSCRIPTION_CASH_SOURCE,
    applied: true,
    paidAt: new Date("2026-07-24T10:00:00.000Z"),
  });
  await Payment.create({
    provider: "cash",
    type: "subscription_activation",
    status: "paid",
    amount: 20000,
    currency: "SAR",
    userId: visaUser._id,
    subscriptionId: visaSubscription._id,
    source: Payment.DASHBOARD_SUBSCRIPTION_VISA_SOURCE,
    applied: true,
    paidAt: new Date("2026-07-24T11:00:00.000Z"),
  });
}

async function run() {
  await setup();
  try {
    const adminToken = tokenFor(admin, "admin");
    const cashierToken = tokenFor(cashier, "cashier");

    let res = await auth(
      request(app).get(`/api/dashboard/accounting/subscription-payments/daily?date=${TEST_DATE}`),
      adminToken
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, true);
    assert.strictEqual(res.body.data.summary.totalPaymentsCount, 2);
    assert.strictEqual(res.body.data.summary.uniqueCustomersCount, 2);
    assert.strictEqual(res.body.data.summary.cashCount, 1);
    assert.strictEqual(res.body.data.summary.cashCustomersCount, 1);
    assert.strictEqual(res.body.data.summary.cashTotalHalala, 10000);
    assert.strictEqual(res.body.data.summary.visaCount, 1);
    assert.strictEqual(res.body.data.summary.visaCustomersCount, 1);
    assert.strictEqual(res.body.data.summary.visaTotalHalala, 20000);
    assert.strictEqual(res.body.data.summary.totalHalala, 30000);
    assert.strictEqual(res.body.data.items.length, 2);
    assert(res.body.data.items.some((row) => row.paymentMethod === "cash" && row.provider === "cash"));
    assert(res.body.data.items.some((row) => row.paymentMethod === "visa" && row.provider === "manual"));
    assert(res.body.data.items.every((row) => row.gatewayUsed === false));

    res = await auth(
      request(app).get(`/api/dashboard/accounting/subscription-payments/daily?date=${TEST_DATE}&fulfillmentMethod=pickup&includeDetails=false`),
      adminToken
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.summary.totalPaymentsCount, 1);
    assert.strictEqual(res.body.data.summary.cashCount, 1);
    assert.strictEqual(res.body.data.summary.visaCount, 0);
    assert.deepStrictEqual(res.body.data.items, []);

    res = await auth(
      request(app).get(`/api/dashboard/accounting/subscription-payments/daily?date=${TEST_DATE}`),
      cashierToken
    );
    assert.strictEqual(res.status, 403);

    res = await auth(
      request(app).get("/api/dashboard/accounting/subscription-payments/daily?date=24-07-2026"),
      adminToken
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, "INVALID_DATE");

    console.log("dashboard subscription payment daily report tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

run().catch(async (err) => {
  console.error(`dashboard subscription payment daily report tests failed: ${err.stack || err.message}`);
  try {
    await cleanup();
  } catch (_err) {
    // Best-effort cleanup.
  }
  try {
    await mongoose.disconnect();
  } catch (_err) {
    // Best-effort disconnect.
  }
  process.exit(1);
});
