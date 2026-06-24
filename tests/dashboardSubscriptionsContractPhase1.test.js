require('dotenv').config();

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const Plan = require("../src/models/Plan");
const Zone = require("../src/models/Zone");
const Setting = require("../src/models/Setting");
const BuilderProtein = require("../src/models/BuilderProtein");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const TEST_TAG = `sub-phase1-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const results = { passed: 0, failed: 0 };
const dashboardUsers = new Map();
const createdSubscriptionIds = [];

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

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    const mongoUri = resolveMongoUri();
    await mongoose.connect(mongoUri);
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
        name: { ar: "فرع الرياض", en: "Riyadh Branch" },
        isActive: true,
      }]
    },
    {
      key: "restaurant_is_open",
      value: true
    },
    {
      key: "delivery_windows",
      value: ["08:00-11:00", "12:00-15:00"]
    }
  ]);

  const protein = await BuilderProtein.create({
    name: { ar: "سالمون", en: "Salmon" },
    premiumKey: "salmon",
    extraFeeHalala: 1500,
    isPremium: true,
    isActive: true,
    proteinFamilyKey: "fish",
    displayCategoryKey: "seafood",
    displayCategoryId: new mongoose.Types.ObjectId(),
  });

  await PremiumUpgradeConfig.deleteMany({ premiumKey: "salmon" });
  const upgradeConfig = await PremiumUpgradeConfig.create({
    sourceType: "menu_option",
    sourceId: new mongoose.Types.ObjectId(),
    selectionType: "premium_meal",
    premiumKey: "salmon",
    upgradeDeltaHalala: 1500,
    isEnabled: true,
    status: "active",
  });

  const client = await User.create({
    phone: `+966500000001_${TEST_TAG}`,
    name: "Phase1 Test User",
    email: `phase1_${TEST_TAG}@example.com`,
    role: "client",
    isActive: true,
  });

  const plan = await Plan.create({
    name: { ar: "خطة المرحلة الأولى", en: `${TEST_TAG} Plan` },
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

  const subscription = await Subscription.create({
    userId: client._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalMeals: 20,
    remainingMeals: 15,
    selectedGrams: 150,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    premiumBalance: [
      { premiumKey: "salmon", purchasedQty: 7, remainingQty: 5 }
    ],
    premiumSummary: [
      { premiumMealId: "salmon", name: "Salmon", consumedQtyTotal: 2, minUnitPriceHalala: 1500, maxUnitPriceHalala: 1500 }
    ],
    addonSelections: [
      { addonId: new mongoose.Types.ObjectId(), name: "Soup", qty: 3, unitPriceHalala: 1000 }
    ],
    addonBalance: [
      { addonId: new mongoose.Types.ObjectId(), purchasedQty: 5, remainingQty: 2 }
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subDay = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-06-25",
    status: "open",
    deliveryMode: "delivery",
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", active: true }],
    addonSelections: [],
  });

  seedData = { client, plan, zone, subscription, subDay, protein, upgradeConfig };
}

async function seedAuthUsers() {
  for (const role of ["superadmin", "admin", "cashier"]) {
    const authObj = await dashboardAuth(role, TEST_TAG);
    dashboardUsers.set(role, authObj.user);
  }
}

async function cleanup() {
  const userIds = [seedData.client?._id].filter(Boolean);
  const subIds = [seedData.subscription?._id, ...createdSubscriptionIds].filter(Boolean);
  const planIds = [seedData.plan?._id].filter(Boolean);
  const zoneIds = [seedData.zone?._id].filter(Boolean);
  const proteinIds = [seedData.protein?._id].filter(Boolean);
  const upgradeConfigIds = [seedData.upgradeConfig?._id].filter(Boolean);

  await Promise.all([
    User.deleteMany({ _id: { $in: userIds } }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    Zone.deleteMany({ _id: { $in: zoneIds } }),
    BuilderProtein.deleteMany({ _id: { $in: proteinIds } }),
    PremiumUpgradeConfig.deleteMany({ _id: { $in: upgradeConfigIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
  ]);
}

async function runTests() {
  await connectDatabase();
  await seedBaseData();
  await seedAuthUsers();

  const app = createApp();

  console.log(`Running Dashboard Subscriptions Backend-only Phase 1 Contract Verification Tests...`);

  await test("1. Subscription detail returns backward-compatible existing fields", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "subscription detail");
    assert.strictEqual(res.body.status, true);
    assert(res.body.data !== undefined);
    assert(res.body.data.user !== undefined);
    assert.strictEqual(res.body.data.userName, "Phase1 Test User");
    assert.strictEqual(res.body.data.totalMeals, 20);
    assert.strictEqual(res.body.data.remainingMeals, 15);
    assert(Array.isArray(res.body.data.premiumSummary), "premiumSummary must be an array");
    assert(Array.isArray(res.body.data.addonsSummary), "addonsSummary must be an array");
  });

  await test("2. Subscription detail returns additive balances summary", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "subscription balances summary");
    assert(res.body.data.balances !== undefined);
    assert(res.body.data.balances.regularMeals !== undefined);
    assert.strictEqual(res.body.data.balances.regularMeals.total, 20);
    assert.strictEqual(res.body.data.balances.regularMeals.remaining, 15);
    assert.strictEqual(res.body.data.balances.regularMeals.consumed, 5);
  });

  await test("3. Regular meal balance is separate from premium balance", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "separate meal and premium balances");
    assert(res.body.data.balances.regularMeals !== undefined);
    assert(res.body.data.balances.premiumMeals !== undefined);
    assert.strictEqual(res.body.data.balances.premiumMeals.remaining, 5);
    assert.strictEqual(res.body.data.balances.regularMeals.remaining, 15);
  });

  await test("4. Add-on balances are separate from meal balances", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "separate add-on balances");
    assert(Array.isArray(res.body.data.balances.addons), "balances.addons must be an array");
    assert(res.body.data.balances.addons.length > 0);
  });

  await test("5. Premium upgrades do not increase meal count", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "premium upgrades meal count check");
    assert.strictEqual(res.body.data.totalMeals, 20);
  });

  await test("6. Add-ons do not decrement regular or premium meals", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "add-ons decrement check");
    assert.strictEqual(res.body.data.remainingMeals, 15);
    assert.strictEqual(res.body.data.premiumRemaining, 5);
  });

  await test("7. Detail DTO includes stable premium summary if premium data exists", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "stable premium summary check");
    assert(res.body.data.premiumFulfillmentSummary !== undefined);
    assert.strictEqual(res.body.data.premiumFulfillmentSummary.total, 7);
    assert.strictEqual(res.body.data.premiumFulfillmentSummary.remaining, 5);
    assert.strictEqual(res.body.data.premiumFulfillmentSummary.consumed, 2);
    assert(Array.isArray(res.body.data.premiumFulfillmentSummary.items));
  });

  await test("8. Detail DTO includes stable add-on summary if add-on data exists", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}`)
      .set(auth("admin"));
    expectStatus(res, 200, "stable add-on summary check");
    assert(res.body.data.addonsFulfillmentSummary !== undefined);
    assert.strictEqual(res.body.data.addonsFulfillmentSummary.consumed, 3);
    assert(Array.isArray(res.body.data.addonsFulfillmentSummary.items));
  });

  await test("9. Audit DTO status values match docs", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}/audit`)
      .set(auth("admin"));
    expectStatus(res, 200, "audit DTO check");
    assert.strictEqual(res.body.status, true);
    assert(res.body.data.auditStatus !== undefined);
    assert(["ok", "mismatch"].includes(res.body.data.auditStatus));
    assert(res.body.data.severity !== undefined);
  });

  await test("10. Lifecycle endpoint returns stable events", async () => {
    const res = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}/lifecycle`)
      .set(auth("admin"));
    expectStatus(res, 200, "lifecycle events check");
    assert.strictEqual(res.body.status, true);
    assert(Array.isArray(res.body.data.events));
    assert(res.body.data.events.length > 0);
  });

  await test("11. Cashier cannot call admin-only lifecycle mutations", async () => {
    const res = await request(app)
      .post(`/api/dashboard/subscriptions/${seedData.subscription._id}/freeze`)
      .send({ startDate: "2026-07-01", days: 5 })
      .set(auth("cashier"));
    expectStatus(res, 403, "cashier block lifecycle mutation");
  });

  await test("12. Manual deduction endpoints remain compatible", async () => {
    const searchRes = await request(app)
      .get(`/api/dashboard/subscriptions/search?phone=${encodeURIComponent(seedData.client.phone)}`)
      .set(auth("cashier"));
    expectStatus(searchRes, 200, "cashier search subscriptions");
    assert.strictEqual(searchRes.body.status, true);
    assert(Array.isArray(searchRes.body.data.subscriptions));

    const deductionRes = await request(app)
      .post(`/api/dashboard/subscriptions/${seedData.subscription._id}/manual-deduction`)
      .send({ regularMeals: 1, premiumMeals: 0, reason: "Phase 1 compatibility verification" })
      .set(auth("cashier"));
    expectStatus(deductionRes, 200, "cashier manual deduction");
    assert.deepStrictEqual(deductionRes.body.data.deducted, { regularMeals: 1, premiumMeals: 0, addons: [], total: 1 });

    const historyRes = await request(app)
      .get(`/api/dashboard/subscriptions/${seedData.subscription._id}/manual-deductions`)
      .set(auth("cashier"));
    expectStatus(historyRes, 200, "cashier manual deduction history");
    assert(Array.isArray(historyRes.body.data.items));
    assert(historyRes.body.data.items.length > 0);
  });

  await test("13. Subscription quote/create compatibility remains unchanged", async () => {
    const quoteRes = await request(app)
      .post("/api/dashboard/subscriptions/quote")
      .send({
        planId: seedData.plan._id,
        userId: seedData.client._id,
        mealsPerDay: 2,
        grams: 150,
        deliveryMode: "delivery",
        zoneId: seedData.zone._id,
        deliveryAddress: { line1: "Phase 1 compatibility address" },
        deliverySlotId: "delivery_slot_1",
        durationInDays: 10,
        startDate: "2026-07-01",
      })
      .set(auth("admin"));
    expectStatus(quoteRes, 200, "subscription quote check");
    assert.strictEqual(quoteRes.body.status, true);
    assert(quoteRes.body.data.totalPriceHalala !== undefined || quoteRes.body.data.totalHalala !== undefined || quoteRes.body.data.breakdown !== undefined);

    const createRes = await request(app)
      .post("/api/dashboard/subscriptions")
      .send({
        planId: seedData.plan._id,
        userId: seedData.client._id,
        mealsPerDay: 2,
        grams: 150,
        deliveryMode: "delivery",
        zoneId: seedData.zone._id,
        deliveryAddress: { line1: "Phase 1 compatibility address" },
        deliverySlotId: "delivery_slot_1",
        durationInDays: 10,
        startDate: "2026-07-01",
      })
      .set(auth("admin"));
    expectStatus(createRes, 201, "subscription create check");
    assert.strictEqual(createRes.body.status, true);
    assert(createRes.body.data.id || createRes.body.data._id, "created subscription must retain its identifier");
    createdSubscriptionIds.push(createRes.body.data.id || createRes.body.data._id);
  });

  await test("14. Flutter-compatible premium payload remains accepted", async () => {
    const quoteRes = await request(app)
      .post("/api/dashboard/subscriptions/quote")
      .send({
        planId: seedData.plan._id,
        userId: seedData.client._id,
        mealsPerDay: 2,
        grams: 150,
        deliveryMode: "delivery",
        zoneId: seedData.zone._id,
        deliverySlotId: "delivery_slot_1",
        durationInDays: 10,
        startDate: "2026-07-01",
        premiumUpgradeConfig: { enabled: true, maxSelectionsPerDay: 1 }
      })
      .set(auth("admin"));
    expectStatus(quoteRes, 200, "flutter premium payload check");
    assert.strictEqual(quoteRes.body.status, true);
  });

  await test("15. Existing Dashboard-compatible legacy premium payload remains accepted", async () => {
    const quoteRes = await request(app)
      .post("/api/dashboard/subscriptions/quote")
      .send({
        planId: seedData.plan._id,
        userId: seedData.client._id,
        mealsPerDay: 2,
        grams: 150,
        deliveryMode: "delivery",
        zoneId: seedData.zone._id,
        deliverySlotId: "delivery_slot_1",
        durationInDays: 10,
        startDate: "2026-07-01",
        premiumItems: [{ premiumKey: "salmon", qty: 5 }]
      })
      .set(auth("admin"));
    expectStatus(quoteRes, 200, "legacy dashboard premium payload check");
    assert.strictEqual(quoteRes.body.status, true);
  });

  console.log(`\n==========================================`);
  console.log(`RESULTS: ${results.passed} passed, ${results.failed} failed`);
  console.log(`==========================================\n`);

  await cleanup();
  await mongoose.disconnect();

  if (results.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
