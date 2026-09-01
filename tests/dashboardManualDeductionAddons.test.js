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
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const Addon = require("../src/models/Addon");

const DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
const TEST_PREFIX = "manual-deduction-addons";

let app;
let adminUser;
let cashierUser;
let kitchenUser;
let adminToken;
let cashierToken;
let kitchenToken;
let plan;
let customer;
let addon;
let addon2;
let testSubscription;

function issueDashboardToken(userId, role = "admin") {
  return jwt.sign(
    { userId: String(userId), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, token) {
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

async function cleanup() {
  const users = await User.find({ phone: "+966511119999" }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  await ActivityLog.deleteMany({
    $or: [
      { entityId: testSubscription ? testSubscription._id : null },
      { "meta.customerId": { $in: userIds.map(String) } },
    ],
  });
  await Subscription.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ phone: "+966511119999" });
  await Plan.deleteMany({ "name.en": TEST_PREFIX });
  await Addon.deleteMany({ "name.en": { $regex: TEST_PREFIX } });
  await DashboardUser.deleteMany({ email: { $regex: TEST_PREFIX } });
}

async function setup() {
  await connect();
  await cleanup();
  app = createApp();

  await ActivityLog.init();

  adminUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-admin@example.com`,
    passwordHash: "test",
    role: "admin",
    isActive: true,
  });
  cashierUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-cashier@example.com`,
    passwordHash: "test",
    role: "cashier",
    isActive: true,
  });
  kitchenUser = await DashboardUser.create({
    email: `${TEST_PREFIX}-kitchen@example.com`,
    passwordHash: "test",
    role: "kitchen",
    isActive: true,
  });

  adminToken = issueDashboardToken(adminUser._id, "admin");
  cashierToken = issueDashboardToken(cashierUser._id, "cashier");
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

  addon = await Addon.create({
    name: { ar: "Test Addon", en: `${TEST_PREFIX}-addon` },
    category: "snack",
    currency: "SAR",
    priceHalala: 1000,
    isActive: true,
  });
  addon2 = await Addon.create({
    name: { ar: "Second Test Addon", en: `${TEST_PREFIX}-addon-2` },
    category: "juice",
    currency: "SAR",
    priceHalala: 800,
    isActive: true,
  });

  customer = await User.create({
    phone: "+966511119999",
    name: "Manual Deduction Addon Customer",
    role: "client",
    isActive: true,
  });

  testSubscription = await Subscription.create({
    userId: customer._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 86400000),
    validityEndDate: new Date(Date.now() + 30 * 86400000),
    totalMeals: 10,
    remainingMeals: 7,
    selectedMealsPerDay: 2,
    deliveryMode: "pickup",
    premiumBalance: [{
      premiumKey: "premium_1",
      purchasedQty: 2,
      remainingQty: 2,
    }],
    addonSubscriptions: [{
      addonId: addon._id,
      name: "Test Addon",
      category: "Snack",
      maxPerDay: 1,
    }, {
      addonId: addon2._id,
      name: "Second Test Addon",
      category: "Juice",
      maxPerDay: 1,
    }],
    addonBalance: [{
      addonId: addon._id,
      purchasedQty: 5,
      remainingQty: 5,
    }, {
      addonId: addon2._id,
      purchasedQty: 4,
      remainingQty: 4,
    }],
  });
}

function addonBalanceById(rows) {
  return new Map((rows || []).map((row) => [String(row.addonId), row]));
}

async function testRoles() {
  // Admin allowed
  let res = await auth(request(app).get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(customer.phone)}`), adminToken);
  assert.strictEqual(res.status, 200, "admin can search");

  // Cashier allowed
  res = await auth(request(app).get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(customer.phone)}`), cashierToken);
  assert.strictEqual(res.status, 200, "cashier can search");

  // Kitchen denied
  res = await auth(request(app).get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(customer.phone)}`), kitchenToken);
  assert.strictEqual(res.status, 403, "kitchen denied");
}

async function testSearchResponse() {
  const res = await auth(request(app).get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(customer.phone)}`), cashierToken);
  assert.strictEqual(res.status, 200);
  const sub = res.body.data.subscription;
  assert.strictEqual(sub.remainingRegularMeals, 5);
  assert.strictEqual(sub.remainingPremiumMeals, 2);
  assert.strictEqual(sub.remainingMeals, 7);
  assert(Array.isArray(sub.addonBalances), "addonBalances is an array");
  assert.strictEqual(sub.addonBalances.length, 2);
  const balances = addonBalanceById(sub.addonBalances);
  assert.strictEqual(balances.get(String(addon._id)).name, "Test Addon");
  assert.strictEqual(balances.get(String(addon._id)).remainingQty, 5);
  assert.strictEqual(balances.get(String(addon._id)).totalQty, 5);
  assert.strictEqual(balances.get(String(addon._id)).consumedQty, 0);
  assert.strictEqual(balances.get(String(addon2._id)).name, "Second Test Addon");
  assert.strictEqual(balances.get(String(addon2._id)).remainingQty, 4);
  assert.strictEqual(balances.get(String(addon2._id)).totalQty, 4);
  assert.strictEqual(balances.get(String(addon2._id)).consumedQty, 0);
}

async function testOldPayloadStillWorks() {
  const payload = {
    regularMeals: 1,
    premiumMeals: 0,
    reason: "test_regular",
    notes: "notes"
  };
  const res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send(payload), cashierToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.deducted.regularMeals, 1);
  assert.strictEqual(res.body.data.remaining.regularMeals, 4); // 5 - 1
  assert.strictEqual(res.body.data.remaining.totalMeals, 6); // 7 - 1
}

async function testAddonDeduction() {
  const payload = {
    regularMeals: 0,
    premiumMeals: 0,
    addons: [{ addonId: String(addon._id), qty: 2 }],
    reason: "test_addon"
  };
  const res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send(payload), adminToken);
  assert.strictEqual(res.status, 200, res.text);
  assert.strictEqual(res.body.data.deducted.addons[0].qty, 2);
  const responseBalances = addonBalanceById(res.body.data.remaining.addons);
  assert.strictEqual(responseBalances.get(String(addon._id)).remainingQty, 3); // 5 - 2
  assert.strictEqual(responseBalances.get(String(addon2._id)).remainingQty, 4);
  
  // Verify regular meals unaffected
  assert.strictEqual(res.body.data.remaining.regularMeals, 4);
  assert.strictEqual(res.body.data.remaining.totalMeals, 6);
  assert.strictEqual(res.body.data.remaining.premiumMeals, 2);

  const afterDeduction = await Subscription.findById(testSubscription._id).lean();
  assert.strictEqual(afterDeduction.addonBalance[0].remainingQty, 3);
  assert.strictEqual(afterDeduction.addonBalance[0].consumedQty, 2);
  assert.strictEqual(afterDeduction.addonBalance[1].remainingQty, 4);
  assert.strictEqual(afterDeduction.addonBalance[1].consumedQty, 0);
}

async function testCombinedDeduction() {
  const payload = {
    regularMeals: 1,
    premiumMeals: 1,
    addons: [{ addonId: String(addon._id), qty: 1 }],
    reason: "test_combined"
  };
  const res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send(payload), cashierToken);
  assert.strictEqual(res.status, 200, res.text);
  assert.strictEqual(res.body.data.remaining.regularMeals, 3); // 4 - 1
  assert.strictEqual(res.body.data.remaining.premiumMeals, 1); // 2 - 1
  assert.strictEqual(res.body.data.remaining.totalMeals, 4); // 6 - 2
  const responseBalances = addonBalanceById(res.body.data.remaining.addons);
  assert.strictEqual(responseBalances.get(String(addon._id)).remainingQty, 2); // 3 - 1
  assert.strictEqual(responseBalances.get(String(addon2._id)).remainingQty, 4);

  const afterCombined = await Subscription.findById(testSubscription._id).lean();
  assert.strictEqual(afterCombined.addonBalance[0].remainingQty, 2);
  assert.strictEqual(afterCombined.addonBalance[0].consumedQty, 3);
  assert.strictEqual(afterCombined.addonBalance[1].remainingQty, 4);
  assert.strictEqual(afterCombined.addonBalance[1].consumedQty, 0);
}

async function testMultipleAddonFullDeduction() {
  const payload = {
    regularMeals: 0,
    premiumMeals: 0,
    addons: [
      { addonId: String(addon._id), qty: 1 },
      { addonId: String(addon._id), qty: 1 },
      { addonId: String(addon2._id), qty: 4 },
    ],
    reason: "test_multiple_addons_full_deduction"
  };
  const res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send(payload), cashierToken);
  assert.strictEqual(res.status, 200, res.text);

  const deducted = addonBalanceById(res.body.data.deducted.addons);
  assert.strictEqual(deducted.get(String(addon._id)).qty, 2, "duplicate addon request rows are combined");
  assert.strictEqual(deducted.get(String(addon2._id)).qty, 4, "second addon fully deducted");

  const responseBalances = addonBalanceById(res.body.data.remaining.addons);
  assert.strictEqual(responseBalances.get(String(addon._id)).remainingQty, 0);
  assert.strictEqual(responseBalances.get(String(addon2._id)).remainingQty, 0);
  assert.strictEqual(res.body.data.remaining.totalMeals, 4, "addon-only deduction does not affect meal balance");

  const afterFullDeduction = await Subscription.findById(testSubscription._id).lean();
  const storedBalances = addonBalanceById(afterFullDeduction.addonBalance);
  assert.strictEqual(storedBalances.get(String(addon._id)).remainingQty, 0);
  assert.strictEqual(storedBalances.get(String(addon._id)).consumedQty, 5);
  assert.strictEqual(storedBalances.get(String(addon2._id)).remainingQty, 0);
  assert.strictEqual(storedBalances.get(String(addon2._id)).consumedQty, 4);
}

async function testErrors() {
  // All zero
  let res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send({ regularMeals: 0, premiumMeals: 0, addons: [], reason: "fail" }), cashierToken);
  assert.strictEqual(res.status, 400);

  // Negative qty
  res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send({ regularMeals: 0, premiumMeals: 0, addons: [{ addonId: String(addon._id), qty: -1 }], reason: "fail" }), cashierToken);
  assert.strictEqual(res.status, 400);

  // Unknown addon
  res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send({ regularMeals: 0, premiumMeals: 0, addons: [{ addonId: String(new mongoose.Types.ObjectId()), qty: 1 }], reason: "fail" }), cashierToken);
  assert.strictEqual(res.status, 404, "unknown addon rejected");

  // Exceed balance
  res = await auth(request(app).post(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deduction`).send({ regularMeals: 0, premiumMeals: 0, addons: [{ addonId: String(addon._id), qty: 10 }], reason: "fail" }), cashierToken);
  assert.strictEqual(res.status, 409, "exceed addon balance rejected");
}

async function testActivityLog() {
  const res = await auth(request(app).get(`/api/dashboard/subscriptions/${testSubscription._id}/manual-deductions`), cashierToken);
  assert.strictEqual(res.status, 200);
  const items = res.body.data.items;
  assert.strictEqual(items.length, 4, "should have 4 logs");
  
  // The first log is the full addon deduction (most recent)
  const fullAddonLog = items[0];
  assert.strictEqual(fullAddonLog.deducted.regularMeals, 0);
  assert.strictEqual(fullAddonLog.deducted.premiumMeals, 0);
  assert.strictEqual(fullAddonLog.deducted.total, 0);
  assert.strictEqual(fullAddonLog.deducted.addons.length, 2);
  const deducted = addonBalanceById(fullAddonLog.deducted.addons);
  assert.strictEqual(deducted.get(String(addon._id)).qty, 2);
  assert.strictEqual(deducted.get(String(addon2._id)).qty, 4);
}

async function run() {
  await setup();
  try {
    await testRoles();
    await testSearchResponse();
    await testOldPayloadStillWorks();
    await testAddonDeduction();
    await testCombinedDeduction();
    await testMultipleAddonFullDeduction();
    await testErrors();
    await testActivityLog();
    console.log("dashboard manual deduction phase 2 addons tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

run().catch(async (err) => {
  console.error(`dashboard manual deduction addons tests failed: ${err.stack || err.message}`);
  try {
    await cleanup();
  } catch (e) {}
  process.exit(1);
});
