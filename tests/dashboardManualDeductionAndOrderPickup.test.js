process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const dateUtils = require("../src/utils/date");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const Order = require("../src/models/Order");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const { ensureSafeForDestructiveOp } = require("../src/utils/dbSafety");

const DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
const TEST_PREFIX = "dashboard-manual-deduction";
const TEST_PHONES = [
  "+966500001001",
  "+966500001002",
  "+966500001003",
  "+966500001004",
  "+966500001005",
  "+966500001006",
];

let app;
let dashboardUser;
let adminToken;
let kitchenToken;
let plan;
let customer;

function issueDashboardToken(userId, role = "admin") {
  return jwt.sign(
    { userId: String(userId), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function connect() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  } else if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
  }
}

async function cleanup() {
  ensureSafeForDestructiveOp("dashboard manual deduction test cleanup");
  const users = await User.find({ phone: { $in: TEST_PHONES } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((sub) => sub._id);
  await ActivityLog.deleteMany({
    $or: [
      { entityId: { $in: subscriptionIds } },
      { action: "manual_subscription_meal_deduction", "meta.subscriptionId": { $in: subscriptionIds.map(String) } },
    ],
  });
  await Order.deleteMany({ userId: { $in: userIds } });
  await Subscription.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ phone: { $in: TEST_PHONES } });
  await Plan.deleteMany({ "name.en": TEST_PREFIX });
  await DashboardUser.deleteMany({ email: { $in: [`${TEST_PREFIX}@example.com`, `${TEST_PREFIX}-kitchen@example.com`] } });
}

async function setup() {
  await connect();
  await cleanup();
  app = createApp();

  dashboardUser = await DashboardUser.create({
    email: `${TEST_PREFIX}@example.com`,
    passwordHash: "test",
    role: "admin",
    isActive: true,
  });
  const kitchenUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-kitchen@example.com`,
    passwordHash: "test",
    role: "kitchen",
    isActive: true,
  });
  adminToken = issueDashboardToken(dashboardUser._id, "admin");
  kitchenToken = issueDashboardToken(kitchenUser._id, "kitchen");

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
    name: "Dashboard Deduction Customer",
    role: "client",
    isActive: true,
  });
}

function auth(req, token = adminToken) {
  return req.set("Authorization", `Bearer ${token}`).set("Accept-Language", "en");
}

function authAr(req, token = adminToken) {
  return req.set("Authorization", `Bearer ${token}`).set("Accept-Language", "ar");
}

function orderPayload(overrides = {}) {
  return {
    userId: customer._id,
    status: "confirmed",
    deliveryMode: "pickup",
    requestedDeliveryDate: dateUtils.getTodayKSADate(),
    deliveryDate: dateUtils.getTodayKSADate(),
    items: [{ mealId: new mongoose.Types.ObjectId(), name: "Chicken", quantity: 1, unitPrice: 1000 }],
    pricing: { unitPrice: 1000, quantity: 1, subtotal: 1000, total: 1000, totalPrice: 1000, currency: "SAR" },
    paymentStatus: "paid",
    ...overrides,
  };
}

async function createSubscription({ user = customer, deliveryMode = "pickup", status = "active", remainingMeals = 7, premiumRemaining = [2] } = {}) {
  return Subscription.create({
    userId: user._id,
    planId: plan._id,
    status,
    startDate: new Date(Date.now() - 5 * 86400000),
    endDate: new Date(Date.now() + 30 * 86400000),
    validityEndDate: new Date(Date.now() + 30 * 86400000),
    totalMeals: 10,
    remainingMeals,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 10 - remainingMeals,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    selectedMealsPerDay: 2,
    deliveryMode,
    premiumBalance: premiumRemaining.map((remainingQty, index) => ({
      premiumKey: `premium_${index + 1}`,
      proteinId: new mongoose.Types.ObjectId(),
      purchasedQty: remainingQty,
      remainingQty,
      unitExtraFeeHalala: 1000,
      currency: "SAR",
      purchasedAt: new Date(Date.UTC(2026, 0, index + 1)),
    })),
  });
}

async function assertError(res, code, message) {
  assert.strictEqual(res.body.error && res.body.error.code, code, message || code);
}

function resolveDashboardPickupCode(data = {}) {
  return data.fulfillment && data.fulfillment.pickup && data.fulfillment.pickup.pickupCode
    ? data.fulfillment.pickup.pickupCode
    : data.pickup && data.pickup.pickupCode
      ? data.pickup.pickupCode
      : data.context && data.context.pickupCode
        ? data.context.pickupCode
        : undefined;
}

async function testOrderPickupFlow() {
  const order = await Order.create(orderPayload());

  let res = await auth(request(app).post("/api/dashboard/ops/actions/prepare"))
    .send({ entityId: String(order._id), entityType: "order", payload: {} });
  assert.strictEqual(res.status, 200, "paid order prepare status");
  assert.strictEqual(res.body.data.status, "in_preparation", "uses current operational preparation status");

  res = await auth(request(app).post("/api/dashboard/ops/actions/ready_for_pickup"))
    .send({ entityId: String(order._id), entityType: "order", payload: {} });
  assert.strictEqual(res.status, 200, "ready_for_pickup status");
  assert.strictEqual(res.body.data.source, "one_time_order");
  assert.strictEqual(res.body.data.entityType, "order");
  assert.match(resolveDashboardPickupCode(res.body.data), /^\d{6}$/, "pickup code exposed in dashboard DTO");

  res = await auth(request(app).post("/api/dashboard/ops/actions/fulfill"))
    .send({ entityId: String(order._id), entityType: "order", payload: {} });
  assert.strictEqual(res.status, 200, "fulfill without pickupCode status");
  assert.strictEqual(res.body.data.status, "fulfilled");
  assert.match(resolveDashboardPickupCode(res.body.data), /^\d{6}$/, "pickup code remains visible after fulfill");

  const invalidOrder = await Order.create(orderPayload());
  res = await auth(request(app).post("/api/dashboard/ops/actions/fulfill"))
    .send({ entityId: String(invalidOrder._id), entityType: "order", payload: {} });
  assert.strictEqual(res.status, 409, "invalid transition status");
  await assertError(res, "INVALID_TRANSITION");

  const unpaidOrder = await Order.create(orderPayload({ paymentStatus: "initiated" }));
  res = await auth(request(app).post("/api/dashboard/ops/actions/prepare"))
    .send({ entityId: String(unpaidOrder._id), entityType: "order", payload: {} });
  assert.strictEqual(res.status, 409, "unpaid prepare status");
  await assertError(res, "ORDER_PAYMENT_REQUIRED");

  const unpaidReadyOrder = await Order.create(orderPayload({ status: "ready_for_pickup", paymentStatus: "initiated" }));
  res = await auth(request(app).post("/api/dashboard/ops/actions/fulfill"))
    .send({ entityId: String(unpaidReadyOrder._id), entityType: "order", payload: {} });
  assert.strictEqual(res.status, 409, "unpaid fulfill status");
  await assertError(res, "ORDER_PAYMENT_REQUIRED");
}

async function testManualSubscriptionSearchAndPickupDeductions() {
  const sub = await createSubscription({ deliveryMode: "pickup", remainingMeals: 7, premiumRemaining: [2] });

  let res = await auth(request(app).get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(customer.phone)}`));
  assert.strictEqual(res.status, 200, "search status");
  assert.strictEqual(res.body.data.customer.phone, customer.phone);
  assert.strictEqual(res.body.data.subscription.id, String(sub._id));
  assert.strictEqual(res.body.data.subscription.fulfillmentMethod, "pickup");
  assert.strictEqual(res.body.data.subscription.remainingMeals, 7);
  assert.strictEqual(res.body.data.subscription.remainingPremiumMeals, 2);
  assert.strictEqual(res.body.data.subscription.remainingRegularMeals, 5);

  res = await auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 2, reason: "Manual branch pickup deduction", notes: "No phone" });
  assert.strictEqual(res.status, 200, "pickup deduction status");
  assert.deepStrictEqual(res.body.data.deducted, { regularMeals: 1, premiumMeals: 2, total: 3, addons: [] });
  assert.deepStrictEqual(res.body.data.remaining, { regularMeals: 4, premiumMeals: 0, totalMeals: 4, addons: [] });

  const refreshedAfterPremium = await Subscription.findById(sub._id).lean();
  assert.strictEqual(refreshedAfterPremium.consumedMeals, 6, "canonical consumed counter updated with the debit");
  assert.strictEqual(refreshedAfterPremium.premiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0), 0, "premium remaining deducted");
  assert.strictEqual(refreshedAfterPremium.premiumBalance.reduce((sum, row) => sum + Number(row.consumedQty || 0), 0), 2, "premium consumed incremented");

  res = await auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 0, reason: "Second pickup", notes: "" });
  assert.strictEqual(res.status, 200, "second same-day pickup deduction status");
  assert.deepStrictEqual(res.body.data.remaining, { regularMeals: 3, premiumMeals: 0, totalMeals: 3, addons: [] });

  const log = await ActivityLog.findOne({
    entityType: "subscription",
    entityId: sub._id,
    action: "manual_subscription_meal_deduction",
    "meta.deductedPremiumMeals": 2,
  }).lean();
  assert(log, "manual deduction audit log exists");
  assert.strictEqual(log.byRole, "admin");
  assert.strictEqual(String(log.byUserId), String(dashboardUser._id));
  assert.strictEqual(log.meta.fulfillmentMethod, "pickup");
  assert.strictEqual(log.meta.before.remainingMeals, 7);
  assert.strictEqual(log.meta.after.remainingMeals, 4);

  res = await auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`), kitchenToken)
    .send({ regularMeals: 1, premiumMeals: 0 });
  assert.strictEqual(res.status, 403, "kitchen route forbidden");
}

async function testDeliveryOncePerBusinessDay() {
  const deliveryUser = await User.create({ phone: TEST_PHONES[1], name: "Delivery Customer", role: "client", isActive: true });
  const sub = await createSubscription({ user: deliveryUser, deliveryMode: "delivery", remainingMeals: 4, premiumRemaining: [1] });

  let res = await auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 0, reason: "Delivery deduction" });
  assert.strictEqual(res.status, 200, "first delivery deduction");

  res = await auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 0, reason: "Delivery duplicate" });
  assert.strictEqual(res.status, 409, "second delivery deduction blocked");
  await assertError(res, "DELIVERY_ALREADY_DEDUCTED_TODAY");

  res = await authAr(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 0, reason: "Delivery duplicate" });
  assert.strictEqual(res.status, 409, "second delivery deduction blocked (Arabic)");
  await assertError(res, "DELIVERY_ALREADY_DEDUCTED_TODAY");
  assert.strictEqual(res.body.error.message, "تم خصم اشتراك التوصيل لهذا اليوم بالفعل");

  res = await auth(request(app).get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(deliveryUser.phone)}`));
  assert.strictEqual(res.status, 200, "delivery search status");
  assert.strictEqual(res.body.data.today.hasDeliveryDeductionToday, true);
}

async function testValidationFailures() {
  const validationUser = await User.create({ phone: TEST_PHONES[2], name: "Validation Customer", role: "client", isActive: true });
  const sub = await createSubscription({ user: validationUser, deliveryMode: "pickup", remainingMeals: 3, premiumRemaining: [1] });

  const cases = [
    [{ regularMeals: 0, premiumMeals: 0 }, "INVALID_MEAL_COUNT"],
    [{ regularMeals: -1, premiumMeals: 0 }, "INVALID_MEAL_COUNT"],
    [{ regularMeals: 3, premiumMeals: 1 }, "INSUFFICIENT_REMAINING_MEALS"],
    [{ regularMeals: 3, premiumMeals: 0 }, "INSUFFICIENT_REGULAR_MEALS"],
    [{ regularMeals: 0, premiumMeals: 2 }, "INSUFFICIENT_PREMIUM_MEALS"],
  ];

  for (const [body, code] of cases) {
    const res = await auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`)).send(body);
    assert.strictEqual(res.status, code === "INVALID_MEAL_COUNT" ? 400 : 409, `status for ${code}`);
    await assertError(res, code);
  }

  const arabicCases = [
    [{ regularMeals: 0, premiumMeals: 0 }, "INVALID_MEAL_COUNT", "كمية الوجبات أو الإضافات غير صالحة"],
    [{ regularMeals: 3, premiumMeals: 1 }, "INSUFFICIENT_REMAINING_MEALS", "رصيد الوجبات المتبقية غير كاف"],
    [{ regularMeals: 3, premiumMeals: 0 }, "INSUFFICIENT_REGULAR_MEALS", "رصيد الوجبات العادية غير كاف"],
    [{ regularMeals: 0, premiumMeals: 2 }, "INSUFFICIENT_PREMIUM_MEALS", "رصيد الوجبات المميزة غير كاف"],
  ];

  for (const [body, code, expectedMsg] of arabicCases) {
    const res = await authAr(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`)).send(body);
    assert.strictEqual(res.status, code === "INVALID_MEAL_COUNT" ? 400 : 409);
    await assertError(res, code);
    assert.strictEqual(res.body.error.message, expectedMsg);
  }

  const inactiveUser = await User.create({ phone: TEST_PHONES[3], name: "Inactive Customer", role: "client", isActive: true });
  const inactiveSub = await createSubscription({ user: inactiveUser, status: "canceled", remainingMeals: 5, premiumRemaining: [1] });
  const inactiveRes = await authAr(request(app).post(`/api/dashboard/subscriptions/${inactiveSub._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 0 });
  assert.strictEqual(inactiveRes.status, 409, "inactive subscription status");
  await assertError(inactiveRes, "SUBSCRIPTION_NOT_ACTIVE");
  assert.strictEqual(inactiveRes.body.error.message, "الاشتراك غير نشط");

  const missingSearch = await authAr(request(app).get("/api/dashboard/subscriptions/search?phone=%2B966599999999"));
  assert.strictEqual(missingSearch.status, 404, "missing customer status");
  await assertError(missingSearch, "CUSTOMER_NOT_FOUND");
  assert.strictEqual(missingSearch.body.error.message, "لم يتم العثور على العميل");

  const oneTimeOrder = await Order.create(orderPayload());
  const orderEndpointRes = await authAr(request(app).post(`/api/dashboard/subscriptions/${oneTimeOrder._id}/manual-deduction`))
    .send({ regularMeals: 1, premiumMeals: 0 });
  assert.strictEqual(orderEndpointRes.status, 404, "one-time order is not a subscription");
  await assertError(orderEndpointRes, "SUBSCRIPTION_NOT_FOUND");
  assert.strictEqual(orderEndpointRes.body.error.message, "لم يتم العثور على الاشتراك");
}

async function testConcurrentDeductionCannotOverspend() {
  const concurrentUser = await User.create({ phone: TEST_PHONES[4], name: "Concurrent Customer", role: "client", isActive: true });
  const sub = await createSubscription({ user: concurrentUser, deliveryMode: "pickup", remainingMeals: 2, premiumRemaining: [1] });

  const [a, b] = await Promise.all([
    auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`)).send({ regularMeals: 1, premiumMeals: 1 }),
    auth(request(app).post(`/api/dashboard/subscriptions/${sub._id}/manual-deduction`)).send({ regularMeals: 1, premiumMeals: 1 }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepStrictEqual(statuses, [200, 409], "one concurrent deduction wins and one fails");
  const refreshed = await Subscription.findById(sub._id).lean();
  assert.strictEqual(refreshed.remainingMeals, 0, "remaining total not overspent");
  assert.strictEqual(refreshed.consumedMeals, 10, "concurrent winner keeps canonical meal ledger balanced");
  assert.strictEqual(refreshed.premiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0), 0, "premium not overspent");
  assert.strictEqual(refreshed.premiumBalance.reduce((sum, row) => sum + Number(row.consumedQty || 0), 0), 1, "premium consumed once");
}

async function testLegacyCashierRouteUsesCanonicalPolicy() {
  const legacyUser = await User.create({ phone: "+966500001006", name: "Legacy Cashier Customer", role: "client", isActive: true });
  const sub = await createSubscription({ user: legacyUser, deliveryMode: "pickup", remainingMeals: 2, premiumRemaining: [1] });

  let res = await auth(request(app).post("/api/dashboard/ops/cashier/customer-consumption"))
    .send({ phone: legacyUser.phone, subscriptionId: String(sub._id), mealCount: 2 });
  assert.strictEqual(res.status, 409, "legacy route cannot silently spend Premium balance as regular meals");
  await assertError(res, "INSUFFICIENT_REGULAR_MEALS");

  res = await auth(request(app).post("/api/dashboard/ops/cashier/customer-consumption"))
    .send({ phone: legacyUser.phone, subscriptionId: String(sub._id), mealCount: 1 });
  assert.strictEqual(res.status, 200, "legacy route delegates a valid regular deduction");

  const refreshed = await Subscription.findById(sub._id).lean();
  assert.strictEqual(refreshed.remainingMeals, 1);
  assert.strictEqual(refreshed.consumedMeals, 9);
  assert.strictEqual(refreshed.premiumBalance[0].remainingQty, 1, "legacy regular deduction preserves Premium balance");

  res = await auth(
    request(app).post("/api/dashboard/ops/cashier/customer-consumption"),
    kitchenToken
  ).send({ phone: legacyUser.phone, subscriptionId: String(sub._id), mealCount: 1 });
  assert.strictEqual(res.status, 403, "kitchen cannot use the legacy manual-deduction alias");
}

async function run() {
  await setup();
  try {
    await testOrderPickupFlow();
    await testManualSubscriptionSearchAndPickupDeductions();
    await testDeliveryOncePerBusinessDay();
    await testValidationFailures();
    await testConcurrentDeductionCannotOverspend();
    await testLegacyCashierRouteUsesCanonicalPolicy();
    console.log("✅ dashboard manual deduction and one-time pickup tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(`❌ dashboard manual deduction and one-time pickup tests failed: ${err.stack || err.message}`);
  process.exit(1);
});
