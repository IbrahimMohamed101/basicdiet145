require("./helpers/installMongoTestSafetyGuard");
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const { ensureSafeForDestructiveOp } = require("../src/utils/dbSafety");

const DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
const TEST_PREFIX = "dashboard-accounting-report";
const TEST_DATE = "2026-05-15";
const TEST_PHONES = [
  "+966511110001",
  "+966511110002",
  "+966511110003",
];
const SETTING_KEYS = ["restaurant_open_time", "restaurant_close_time", "vat_percentage"];

let app;
let adminUser;
let kitchenUser;
let cashierUser;
let superadminUser;
let adminToken;
let kitchenToken;
let cashierToken;
let superadminToken;
let plan;
let customer;
let settingsSnapshot = [];

function issueDashboardToken(userId, role = "admin") {
  return jwt.sign(
    { userId: String(userId), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, token = adminToken) {
  return req.set("Authorization", `Bearer ${token}`).set("Accept-Language", "en");
}

async function connect() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  } else if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
  }
}

async function snapshotSettings() {
  settingsSnapshot = await Setting.find({ key: { $in: SETTING_KEYS } }).lean();
}

async function restoreSettings() {
  await Setting.deleteMany({ key: { $in: SETTING_KEYS } });
  if (settingsSnapshot.length) {
    await Setting.insertMany(settingsSnapshot.map((setting) => ({
      key: setting.key,
      value: setting.value,
      skipAllowance: setting.skipAllowance,
      description: setting.description,
    })));
  }
}

async function cleanup() {
  ensureSafeForDestructiveOp("dashboard accounting daily report test cleanup");
  const users = await User.find({ phone: { $in: TEST_PHONES } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((sub) => sub._id);
  const orders = await Order.find({ userId: { $in: userIds } }).select("_id").lean();
  const orderIds = orders.map((order) => order._id);

  await ActivityLog.deleteMany({
    $or: [
      { entityId: { $in: subscriptionIds } },
      { action: "manual_subscription_meal_deduction", "meta.customerId": { $in: userIds.map(String) } },
    ],
  });
  await Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { orderId: { $in: orderIds } }] });
  await Order.deleteMany({ userId: { $in: userIds } });
  await Subscription.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ phone: { $in: TEST_PHONES } });
  await Plan.deleteMany({ "name.en": TEST_PREFIX });
  await DashboardUser.deleteMany({ email: { $in: [
    `${TEST_PREFIX}@example.com`,
    `${TEST_PREFIX}-kitchen@example.com`,
    `${TEST_PREFIX}-cashier@example.com`,
    `${TEST_PREFIX}-superadmin@example.com`,
  ] } });
}

async function upsertSetting(key, value) {
  await Setting.findOneAndUpdate(
    { key },
    { $set: { value, description: `${TEST_PREFIX} setting` } },
    { upsert: true, new: true }
  );
}

async function setup() {
  await connect();
  await snapshotSettings();
  await cleanup();
  app = createApp();

  await upsertSetting("restaurant_open_time", "00:00");
  await upsertSetting("restaurant_close_time", "23:59");
  await upsertSetting("vat_percentage", 15);
  await ActivityLog.init();

  adminUser = await DashboardUser.create({
    email: `${TEST_PREFIX}@example.com`,
    passwordHash: "test",
    role: "admin",
    isActive: true,
  });
  kitchenUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-kitchen@example.com`,
    passwordHash: "test",
    role: "kitchen",
    isActive: true,
  });
  cashierUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-cashier@example.com`, passwordHash: "test", role: "cashier", isActive: true,
  });
  superadminUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-superadmin@example.com`, passwordHash: "test", role: "superadmin", isActive: true,
  });
  adminToken = issueDashboardToken(adminUser._id, "admin");
  kitchenToken = issueDashboardToken(kitchenUser._id, "kitchen");
  cashierToken = issueDashboardToken(cashierUser._id, "cashier");
  superadminToken = issueDashboardToken(superadminUser._id, "superadmin");

  plan = await Plan.create({
    name: { ar: TEST_PREFIX, en: TEST_PREFIX },
    daysCount: 28,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 300,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 50000, compareAtHalala: 50000, isActive: true }],
    }],
  });

  customer = await User.create({
    phone: TEST_PHONES[0],
    name: "Accounting Customer",
    role: "client",
    isActive: true,
  });
}

function orderPayload(overrides = {}) {
  return {
    userId: customer._id,
    status: "fulfilled",
    deliveryMode: "pickup",
    requestedDeliveryDate: TEST_DATE,
    deliveryDate: TEST_DATE,
    items: [{ mealId: new mongoose.Types.ObjectId(), name: "Meal", quantity: 1, unitPrice: 1000 }],
    pricing: { unitPrice: 1000, quantity: 1, subtotal: 10000, vatPercentage: 15, vatAmount: 1500, total: 11500, totalPrice: 11500, currency: "SAR" },
    paymentStatus: "paid",
    createdAt: new Date("2026-05-15T10:00:00.000Z"),
    updatedAt: new Date("2026-05-15T10:05:00.000Z"),
    ...overrides,
  };
}

async function insertLegacyTotalOnlyOrder(overrides = {}) {
  const doc = {
    userId: customer._id,
    status: "ready_for_pickup",
    deliveryMode: "pickup",
    requestedDeliveryDate: TEST_DATE,
    deliveryDate: TEST_DATE,
    items: [{ mealId: new mongoose.Types.ObjectId(), name: "Legacy Meal", quantity: 1, unitPrice: 1 }],
    pricing: { unitPrice: 1, quantity: 1, total: 11500, totalPrice: 11500, currency: "SAR" },
    paymentStatus: "paid",
    createdAt: new Date("2026-05-15T13:00:00.000Z"),
    updatedAt: new Date("2026-05-15T13:05:00.000Z"),
    ...overrides,
  };
  const result = await Order.collection.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function createSubscription({ user = customer, deliveryMode = "pickup", remainingMeals = 7, premiumRemaining = 2 } = {}) {
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-05-01T00:00:00.000Z"),
    endDate: new Date("2026-06-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-06-01T00:00:00.000Z"),
    totalMeals: 10,
    remainingMeals,
    selectedMealsPerDay: 2,
    deliveryMode,
    premiumBalance: [{
      premiumKey: "premium_1",
      proteinId: new mongoose.Types.ObjectId(),
      purchasedQty: premiumRemaining,
      remainingQty: premiumRemaining,
      unitExtraFeeHalala: 1000,
      currency: "SAR",
      purchasedAt: new Date("2026-05-01T00:00:00.000Z"),
    }],
  });
}

async function createManualDeductionLog({ subscription, regularMeals, premiumMeals, addons = [], fulfillmentMethod, actor = adminUser, createdAt }) {
  return ActivityLog.create({
    entityType: "subscription",
    entityId: subscription._id,
    action: "manual_subscription_meal_deduction",
    byUserId: actor ? actor._id : null,
    byRole: actor ? actor.role : "",
    meta: {
      subscriptionId: String(subscription._id),
      customerId: String(subscription.userId),
      deductedRegularMeals: regularMeals,
      deductedPremiumMeals: premiumMeals,
      deductedTotalMeals: regularMeals + premiumMeals,
      deductedAddons: addons,
      before: { remainingRegularMeals: 5, remainingPremiumMeals: 2, remainingMeals: 7 },
      after: { remainingRegularMeals: 5 - regularMeals, remainingPremiumMeals: 2 - premiumMeals, remainingMeals: 7 - regularMeals - premiumMeals },
      fulfillmentMethod,
      businessDate: TEST_DATE,
      reason: "Manual deduction",
      notes: "Test note",
    },
    createdAt,
    updatedAt: createdAt,
  });
}

async function testUnauthorizedAndRoleChecks() {
  let res = await request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`);
  assert.strictEqual(res.status, 401, "missing token cannot access report");

  res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`), kitchenToken);
  assert.strictEqual(res.status, 403, "kitchen role cannot access report");

  res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`), cashierToken);
  assert.strictEqual(res.status, 403, "cashier role cannot access report");

  res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`), superadminToken);
  assert.strictEqual(res.status, 200, "superadmin can access report");
}

async function testValidationContract() {
  let res = await auth(request(app).get("/api/dashboard/accounting/daily-report?date=15-05-2026"));
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.status, false);
  assert(res.body.messageAr, "date validation includes Arabic message");

  res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}&fulfillmentMethod=branch`));
  assert.strictEqual(res.status, 400);
  assert(res.body.messageAr, "fulfillment validation includes Arabic message");

  res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}&includeDetails=yes`));
  assert.strictEqual(res.status, 400);
  assert(res.body.messageAr, "boolean validation includes Arabic message");
}

async function testEmptyReportAndBusinessPeriod() {
  const res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`));
  assert.strictEqual(res.status, 200, "admin empty report status");
  assert.strictEqual(res.body.data.businessDate, TEST_DATE);
  assert.strictEqual(res.body.data.timezone, "Asia/Riyadh");
  assert.strictEqual(res.body.data.period.start, "2026-05-14T21:00:00.000Z");
  assert.strictEqual(res.body.data.period.end, "2026-05-15T20:59:59.999Z");
  assert.strictEqual(res.body.data.summary.grossSalesHalala, 0);
  assert.strictEqual(res.body.data.currency, "SAR");
  assert.strictEqual(res.body.data.moneyUnit, "halala");
  assert.strictEqual(res.body.data.filters.includeDetails, true, "legacy details default is preserved");
  assert(Array.isArray(res.body.data.details.orders));
}

async function testOrdersMoneyVatAndWarnings() {
  const paidFulfilled = await Order.create(orderPayload());
  await Payment.create({
    provider: "moyasar",
    type: "one_time_order",
    status: "paid",
    amount: 11500,
    currency: "SAR",
    userId: customer._id,
    orderId: paidFulfilled._id,
    applied: true,
    paidAt: new Date("2026-05-15T10:01:00.000Z"),
  });
  await insertLegacyTotalOnlyOrder({
    status: "confirmed",
    paymentStatus: "initiated",
    pricing: { unitPrice: 1, quantity: 1, total: 5000, totalPrice: 5000, currency: "SAR" },
    createdAt: new Date("2026-05-15T11:00:00.000Z"),
  });
  await insertLegacyTotalOnlyOrder({
    status: "canceled",
    paymentStatus: "paid",
    pricing: { unitPrice: 1, quantity: 1, total: 2300, totalPrice: 2300, currency: "SAR" },
    createdAt: new Date("2026-05-15T12:00:00.000Z"),
  });
  await insertLegacyTotalOnlyOrder({
    status: "ready_for_pickup",
    paymentStatus: "paid",
    pricing: { unitPrice: 1, quantity: 1, total: 11500, totalPrice: 11500, currency: "SAR" },
    createdAt: new Date("2026-05-15T13:00:00.000Z"),
  });

  const res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`));
  assert.strictEqual(res.status, 200, "orders report status");
  assert.strictEqual(res.body.data.summary.paidOneTimeOrdersCount, 3);
  assert.strictEqual(res.body.data.summary.grossSalesHalala, 25300);
  assert.strictEqual(res.body.data.summary.vatHalala, 3403);
  assert.strictEqual(res.body.data.summary.netSalesHalala, 21897);
  assert.strictEqual(res.body.data.summary.totalCollectedHalala, 25300);
  assert.strictEqual(res.body.data.summary.taxHalala, 3403);
  assert.strictEqual(res.body.data.summary.cancelledOrdersCount, 1);
  assert.strictEqual(res.body.data.oneTimeOrders.summary.createdCount, 4);
  assert.strictEqual(res.body.data.oneTimeOrders.summary.fulfilledCount, 1);
  assert(res.body.data.warnings.some((warning) => warning.code === "PAID_ORDER_NOT_FULFILLED"), "paid not fulfilled warning is returned");
  assert(res.body.data.warnings.some((warning) => warning.code === "CANCELLED_PAID_ORDER_NO_REFUND"), "cancelled paid warning is returned");
}

async function testManualDeductionsAndDeliveryRestrictionUnchanged() {
  const pickupSub = await createSubscription({ deliveryMode: "pickup" });
  await createManualDeductionLog({
    subscription: pickupSub,
    regularMeals: 1,
    premiumMeals: 2,
    addons: [{ addonId: new mongoose.Types.ObjectId(), qty: 2, remainingBefore: 4, remainingAfter: 2 }],
    fulfillmentMethod: "pickup",
    createdAt: new Date("2026-05-15T08:00:00.000Z"),
  });

  const deliveryUser = await User.create({ phone: TEST_PHONES[1], name: "Accounting Delivery", role: "client", isActive: true });
  const deliverySub = await createSubscription({ user: deliveryUser, deliveryMode: "delivery", remainingMeals: 4, premiumRemaining: 1 });
  await createManualDeductionLog({
    subscription: deliverySub,
    regularMeals: 1,
    premiumMeals: 0,
    fulfillmentMethod: "delivery",
    createdAt: new Date("2026-05-15T09:00:00.000Z"),
  });
  await assert.rejects(
    () => createManualDeductionLog({
      subscription: deliverySub,
      regularMeals: 1,
      premiumMeals: 0,
      fulfillmentMethod: "delivery",
      createdAt: new Date("2026-05-15T09:05:00.000Z"),
    }),
    /E11000/,
    "delivery duplicate unique index is unchanged"
  );

  const res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`));
  assert.strictEqual(res.status, 200, "deductions report status");
  assert.strictEqual(res.body.data.subscriptions.summary.manualDeductionsCount, 2);
  assert.strictEqual(res.body.data.subscriptions.summary.pickupDeductionsCount, 1);
  assert.strictEqual(res.body.data.subscriptions.summary.deliveryDeductionsCount, 1);
  assert.strictEqual(res.body.data.subscriptions.summary.regularMealsDeducted, 2);
  assert.strictEqual(res.body.data.subscriptions.summary.premiumMealsDeducted, 2);
  assert.strictEqual(res.body.data.subscriptions.summary.totalMealsDeducted, 4);
  assert.strictEqual(res.body.data.breakdown.manualDeductions.addons.length, 1);
  assert.strictEqual(res.body.data.breakdown.manualDeductions.addons[0].qty, 2);
  assert.strictEqual(res.body.data.details.manualDeductions[0].addons[0].qty, 2);
}

async function testDetailsAndFulfillmentFilters() {
  let res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}&includeDetails=false`));
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.data.details.orders, []);
  assert.deepStrictEqual(res.body.data.details.manualDeductions, []);
  assert.deepStrictEqual(res.body.data.oneTimeOrders.items, []);

  res = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}&includeDetails=true&fulfillmentMethod=pickup`));
  assert.strictEqual(res.status, 200);
  assert(res.body.data.details.orders.every((row) => row.fulfillmentMethod === "pickup"));
  assert(res.body.data.details.manualDeductions.every((row) => row.fulfillmentMethod === "pickup"));
}

async function testCsvExport() {
  const jsonRes = await auth(request(app).get(`/api/dashboard/accounting/daily-report?date=${TEST_DATE}`));
  const csvRes = await auth(request(app).get(`/api/dashboard/accounting/daily-report/export?date=${TEST_DATE}&format=csv`));
  assert.strictEqual(csvRes.status, 200, "csv export status");
  assert.match(csvRes.headers["content-type"], /text\/csv/);
  assert.match(csvRes.headers["content-disposition"], /daily-accountant-report-2026-05-15\.csv/);
  assert(csvRes.text.includes("Summary"), "csv includes summary section");
  assert(csvRes.text.includes("One-Time Orders"), "csv includes orders section");
  assert(csvRes.text.includes(String(jsonRes.body.data.summary.grossSalesHalala)), "csv uses same gross sales as JSON");

  const unsupported = await auth(request(app).get(`/api/dashboard/accounting/daily-report/export?date=${TEST_DATE}&format=pdf`));
  assert.strictEqual(unsupported.status, 400, "unsupported export format blocked");
}

async function run() {
  await setup();
  try {
    await testUnauthorizedAndRoleChecks();
    await testValidationContract();
    await testEmptyReportAndBusinessPeriod();
    await testOrdersMoneyVatAndWarnings();
    await testManualDeductionsAndDeliveryRestrictionUnchanged();
    await testDetailsAndFulfillmentFilters();
    await testCsvExport();
    console.log("dashboard accounting daily report tests passed");
  } finally {
    await cleanup();
    await restoreSettings();
    await mongoose.disconnect();
  }
}

run().catch(async (err) => {
  console.error(`dashboard accounting daily report tests failed: ${err.stack || err.message}`);
  try {
    await restoreSettings();
  } catch (_restoreErr) {
    // Best-effort cleanup for failed test runs.
  }
  process.exit(1);
});
