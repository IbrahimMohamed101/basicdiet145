process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");
const User = require("../src/models/User");
const Zone = require("../src/models/Zone");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const TEST_TAG = `dashboard-admin-${Date.now()}`;

function dashboardToken(role = "admin") {
  return jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(role = "admin") {
  return { Authorization: `Bearer ${dashboardToken(role)}`, "Accept-Language": "en" };
}

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function cleanup() {
  const addonIds = (await Addon.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const planIds = (await Plan.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const zoneIds = (await Zone.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const userIds = (await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const subIds = (await Subscription.find({ userId: { $in: userIds } }).select("_id").lean()).map((row) => row._id);

  await Promise.all([
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    CheckoutDraft.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    SubscriptionAuditLog.deleteMany({ $or: [{ entityId: { $in: subIds } }, { "meta.subscriptionId": { $in: subIds.map(String) } }] }),
    ActivityLog.deleteMany({ $or: [{ entityId: { $in: [...subIds, ...addonIds, ...zoneIds, ...planIds] } }, { "meta.userId": { $in: userIds.map(String) } }] }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    Addon.deleteMany({ _id: { $in: addonIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    Zone.deleteMany({ _id: { $in: zoneIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedBaseData() {
  const user = await User.create({
    phone: `+${Date.now()}${TEST_TAG.replace(/\D/g, "").slice(0, 4)}`,
    name: `${TEST_TAG} User`,
    role: "client",
    isActive: true,
  });
  const plan = await Plan.create({
    name: { ar: "", en: `${TEST_TAG} Plan` },
    daysCount: 7,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
    }],
  });
  const zone = await Zone.create({
    name: { ar: "", en: `${TEST_TAG} Zone` },
    deliveryFeeHalala: 1200,
    isActive: true,
    sortOrder: 1,
  });
  const addonPlan = await Addon.create({
    name: { ar: "", en: `${TEST_TAG} Juice Plan` },
    category: "juice",
    kind: "plan",
    billingMode: "per_day",
    priceHalala: 1000,
    currency: "SAR",
    isActive: true,
  });
  const addonItem = await Addon.create({
    name: { ar: "", en: `${TEST_TAG} Snack Item` },
    category: "snack",
    kind: "item",
    billingMode: "flat_once",
    priceHalala: 500,
    currency: "SAR",
    isActive: true,
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    validityEndDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    totalMeals: 14,
    remainingMeals: 14,
    selectedGrams: 200,
    selectedMealsPerDay: 2,
    deliveryMode: "delivery",
    deliveryAddress: { line1: "Old address" },
    deliveryZoneId: zone._id,
    deliveryZoneName: "Old zone",
    deliveryFeeHalala: 1200,
    deliveryWindow: "",
  });
  return { user, plan, zone, addonPlan, addonItem, subscription };
}

async function main() {
  await connect();
  await cleanup();
  const app = createApp();
  const api = request(app);
  const ctx = await seedBaseData();

  try {
    let res = await api.post("/api/dashboard/addons").set(auth()).send({
      name: { en: `${TEST_TAG} Plan Create` },
      category: "juice",
      kind: "plan",
      billingMode: "per_day",
      priceHalala: 1100,
    });
    expectStatus(res, 201, "create addon plan");
    const createdPlanAddonId = res.body.data.id;

    res = await api.post("/api/dashboard/addons").set(auth()).send({
      name: { en: `${TEST_TAG} Item Create` },
      category: "snack",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 600,
    });
    expectStatus(res, 201, "create addon item");
    const createdItemAddonId = res.body.data.id;

    res = await api.post("/api/dashboard/addons").set(auth()).send({
      name: { en: `${TEST_TAG} Invalid Kind` },
      category: "juice",
      kind: "bad",
      priceHalala: 100,
    });
    expectStatus(res, 400, "reject invalid kind");

    res = await api.post("/api/dashboard/addons").set(auth()).send({
      name: { en: `${TEST_TAG} Invalid Category` },
      category: "bad",
      kind: "item",
      priceHalala: 100,
    });
    expectStatus(res, 400, "reject invalid category");

    res = await api.post("/api/dashboard/addons").set(auth()).send({
      name: { en: `${TEST_TAG} Invalid Billing` },
      category: "juice",
      kind: "item",
      billingMode: "per_day",
      priceHalala: 100,
    });
    expectStatus(res, 400, "reject invalid billing combination");

    res = await api.get("/api/dashboard/addons?kind=plan").set(auth());
    expectStatus(res, 200, "list addons by kind");
    assert(res.body.data.every((addon) => addon.kind === "plan"));

    res = await api.get("/api/dashboard/addons?category=snack").set(auth());
    expectStatus(res, 200, "list addons by category");
    assert(res.body.data.every((addon) => addon.category === "snack"));

    res = await api.patch(`/api/dashboard/addons/${createdItemAddonId}/toggle`).set(auth()).send({});
    expectStatus(res, 200, "toggle addon");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.delete(`/api/dashboard/addons/${createdPlanAddonId}`).set(auth()).send({});
    expectStatus(res, 200, "soft delete addon");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.get("/api/dashboard/addon-plans").set(auth());
    expectStatus(res, 200, "list addon plans alias");
    assert(res.body.data.every((addon) => addon.kind === "plan"));

    res = await api.post("/api/dashboard/addon-plans").set(auth()).send({
      name: { en: `${TEST_TAG} Alias Reject Item` },
      category: "juice",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 700,
    });
    expectStatus(res, 400, "addon plans reject kind item");

    res = await api.post("/api/dashboard/subscriptions/quote").set(auth()).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 200,
      mealsPerDay: 2,
      deliveryMethod: "delivery",
      zoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "Quote address" },
      addonPlans: [String(ctx.addonPlan._id)],
    });
    expectStatus(res, 200, "valid dashboard quote");
    assert.strictEqual(res.body.data.breakdown.addonsTotalHalala, 7000);

    res = await api.post("/api/dashboard/subscriptions/quote").set(auth()).send({
      userId: String(ctx.user._id),
      planId: String(new mongoose.Types.ObjectId()),
      grams: 200,
      mealsPerDay: 2,
    });
    expectStatus(res, 404, "quote invalid plan");

    res = await api.post("/api/dashboard/subscriptions/quote").set(auth()).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 999,
      mealsPerDay: 2,
    });
    expectStatus(res, 400, "quote invalid grams");

    res = await api.put(`/api/dashboard/subscriptions/${ctx.subscription._id}/delivery`).set(auth()).send({
      deliveryMode: "delivery",
      deliveryZoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "New address", notes: "admin note" },
      reason: "customer requested address change",
    });
    expectStatus(res, 200, "update subscription delivery");
    assert.strictEqual(res.body.data.deliveryAddress.line1, "New address");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/addon-entitlements`).set(auth()).send({
      addonSubscriptions: [{ addonId: String(ctx.addonPlan._id), maxPerDay: 1 }],
    });
    expectStatus(res, 400, "addon entitlements require reason");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/addon-entitlements`).set(auth()).send({
      reason: "manual entitlement correction",
      addonSubscriptions: [{ addonId: String(ctx.addonPlan._id), maxPerDay: 1 }],
    });
    expectStatus(res, 200, "update addon entitlements");
    assert.strictEqual(res.body.data.addonSubscriptions[0].category, "juice");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/balances`).set(auth("superadmin")).send({
      premiumBalance: [],
    });
    expectStatus(res, 400, "balances require reason");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/balances`).set(auth("superadmin")).send({
      reason: "manual balance correction",
      premiumBalance: [{ premiumKey: "shrimp", purchasedQty: 2, remainingQty: 1, unitExtraFeeHalala: 2200 }],
      addonBalance: [{ addonId: String(ctx.addonItem._id), purchasedQty: 3, remainingQty: 2, unitPriceHalala: 500 }],
    });
    expectStatus(res, 200, "update balances");
    assert.strictEqual(res.body.data.premiumBalance[0].premiumKey, "shrimp");

    res = await api.get(`/api/dashboard/subscriptions/${ctx.subscription._id}/audit-log`).set(auth());
    expectStatus(res, 200, "get audit log");
    assert(res.body.data.auditLogs.length >= 2);

    res = await api.post("/api/dashboard/zones").set(auth()).send({
      name: { en: `${TEST_TAG} API Zone` },
      deliveryFeeHalala: 1500,
      isActive: true,
      sortOrder: 2,
    });
    expectStatus(res, 201, "create zone");
    const createdZoneId = res.body.data._id;

    res = await api.put(`/api/dashboard/zones/${createdZoneId}`).set(auth()).send({
      name: { en: `${TEST_TAG} API Zone Updated` },
      deliveryFeeHalala: 1700,
      isActive: true,
      sortOrder: 3,
    });
    expectStatus(res, 200, "update zone");
    assert.strictEqual(res.body.data.deliveryFeeHalala, 1700);

    res = await api.patch(`/api/dashboard/zones/${createdZoneId}/toggle`).set(auth()).send({});
    expectStatus(res, 200, "toggle zone");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.get("/api/dashboard/zones?isActive=false").set(auth());
    expectStatus(res, 200, "list zones");
    assert(res.body.data.some((zone) => String(zone._id) === String(createdZoneId)));

    res = await api.delete(`/api/dashboard/zones/${createdZoneId}`).set(auth()).send({});
    expectStatus(res, 200, "soft delete zone");
    assert.strictEqual(res.body.data.isActive, false);

    const beforeCounts = {
      plans: await Plan.countDocuments(),
      addons: await Addon.countDocuments(),
      subscriptions: await Subscription.countDocuments(),
    };
    for (const path of [
      "/api/dashboard/health/catalog",
      "/api/dashboard/health/subscription-menu",
      "/api/dashboard/health/meal-planner",
      "/api/dashboard/health/indexes",
    ]) {
      res = await api.get(path).set(auth());
      expectStatus(res, 200, `health ${path}`);
      assert.strictEqual(res.body.status, true);
      assert(res.body.data && typeof res.body.data === "object");
    }
    const afterCounts = {
      plans: await Plan.countDocuments(),
      addons: await Addon.countDocuments(),
      subscriptions: await Subscription.countDocuments(),
    };
    assert.deepStrictEqual(afterCounts, beforeCounts, "health endpoints must be read-only");

    console.log("✅ Dashboard admin endpoints tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch (_cleanupErr) {
    // ignore cleanup failures after assertion failure
  }
  process.exit(1);
});
