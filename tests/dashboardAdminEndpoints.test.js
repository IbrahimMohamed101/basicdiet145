process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const Addon = require("../src/models/Addon");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const Plan = require("../src/models/Plan");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");
const User = require("../src/models/User");
const Zone = require("../src/models/Zone");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const PromoCode = require("../src/models/PromoCode");
const Delivery = require("../src/models/Delivery");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const Setting = require("../src/models/Setting");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const TEST_TAG = `dashboard-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED = process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
const TEST_DELIVERY_SLOT_ID = "delivery_slot_1";
let originalPremiumPriceSetting;
const dashboardAuthUserIds = {};

let adminHeaders;
let kitchenHeaders;
let courierHeaders;
let cashierHeaders;
let superadminHeaders;

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function authForUser(userId, role = "admin") {
  const token = jwt.sign(
    { userId: String(userId), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

async function cleanup() {
  const addonIds = (await Addon.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const builderCategoryIds = (await BuilderCategory.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const builderProteinIds = (await BuilderProtein.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const builderCarbIds = (await BuilderCarb.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const sandwichIds = (await Sandwich.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const saladIngredientIds = (await SaladIngredient.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const planIds = (await Plan.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const zoneIds = (await Zone.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const userIds = (await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean()).map((row) => row._id);
  const subIds = (await Subscription.find({ userId: { $in: userIds } }).select("_id").lean()).map((row) => row._id);
  const promoIds = (await PromoCode.find({ codeNormalized: { $regex: TEST_TAG.replace(/[^A-Z0-9]/gi, "").slice(0, 16).toUpperCase() } }).select("_id").lean()).map((row) => row._id);

  await Promise.all([
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    CheckoutDraft.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subIds } }] }),
    Delivery.deleteMany({ subscriptionId: { $in: subIds } }),
    SubscriptionAuditLog.deleteMany({ $or: [{ entityId: { $in: subIds } }, { "meta.subscriptionId": { $in: subIds.map(String) } }] }),
    ActivityLog.deleteMany({
      $or: [
        { entityId: { $in: [...subIds, ...addonIds, ...zoneIds, ...planIds, ...builderCategoryIds, ...builderProteinIds, ...builderCarbIds, ...sandwichIds, ...saladIngredientIds] } },
        { "meta.userId": { $in: userIds.map(String) } },
      ],
    }),
    PromoCode.deleteMany({ _id: { $in: promoIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    Addon.deleteMany({ _id: { $in: addonIds } }),
    BuilderCategory.deleteMany({ _id: { $in: builderCategoryIds } }),
    BuilderProtein.deleteMany({ _id: { $in: builderProteinIds } }),
    BuilderCarb.deleteMany({ _id: { $in: builderCarbIds } }),
    Sandwich.deleteMany({ _id: { $in: sandwichIds } }),
    SaladIngredient.deleteMany({ _id: { $in: saladIngredientIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    Zone.deleteMany({ _id: { $in: zoneIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedBaseData() {
  await Setting.findOneAndUpdate(
    { key: "delivery_windows" },
    { $set: { key: "delivery_windows", value: ["16:00-18:00", "18:00-20:00"] } },
    { upsert: true, new: true }
  );

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

async function seedDashboardAuthUsers() {
  const admin = await dashboardAuth("admin", TEST_TAG);
  adminHeaders = admin.headers;
  dashboardAuthUserIds.admin = admin.user._id;
  const kitchen = await dashboardAuth("kitchen", TEST_TAG);
  kitchenHeaders = kitchen.headers;
  dashboardAuthUserIds.kitchen = kitchen.user._id;
  const courier = await dashboardAuth("courier", TEST_TAG);
  courierHeaders = courier.headers;
  dashboardAuthUserIds.courier = courier.user._id;
  const cashier = await dashboardAuth("cashier", TEST_TAG);
  cashierHeaders = cashier.headers;
  dashboardAuthUserIds.cashier = cashier.user._id;
  const superadmin = await dashboardAuth("superadmin", TEST_TAG);
  superadminHeaders = superadmin.headers;
  dashboardAuthUserIds.superadmin = superadmin.user._id;
}

async function main() {
  await connect();
  await cleanup();
  delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
  const app = createApp();
  const api = request(app);
  const ctx = await seedBaseData();
  await seedDashboardAuthUsers();

  try {
    let res = await api.post("/api/dashboard/addons").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Plan Create` },
      category: "juice",
      kind: "plan",
      billingMode: "per_day",
      priceHalala: 1100,
    });
    expectStatus(res, 201, "create addon plan");
    const createdPlanAddonId = res.body.data.id;

    res = await api.post("/api/dashboard/addons").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Item Create` },
      category: "snack",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 600,
    });
    expectStatus(res, 201, "create addon item");
    const createdItemAddonId = res.body.data.id;

    res = await api.post("/api/dashboard/addons").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Invalid Kind` },
      category: "juice",
      kind: "bad",
      priceHalala: 100,
    });
    expectStatus(res, 400, "reject invalid kind");

    res = await api.post("/api/dashboard/addons").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Invalid Category` },
      category: "bad",
      kind: "item",
      priceHalala: 100,
    });
    expectStatus(res, 400, "reject invalid category");

    res = await api.post("/api/dashboard/addons").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Invalid Billing` },
      category: "juice",
      kind: "item",
      billingMode: "per_day",
      priceHalala: 100,
    });
    expectStatus(res, 400, "reject invalid billing combination");

    res = await api.get("/api/dashboard/addons?kind=plan").set(adminHeaders);
    expectStatus(res, 200, "list addons by kind");
    assert(res.body.data.every((addon) => addon.kind === "plan"));

    res = await api.get("/api/dashboard/addons?category=snack").set(adminHeaders);
    expectStatus(res, 200, "list addons by category");
    assert(res.body.data.every((addon) => addon.category === "snack"));

    res = await api.patch(`/api/dashboard/addons/${createdItemAddonId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle addon");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.delete(`/api/dashboard/addons/${createdPlanAddonId}`).set(adminHeaders).send({});
    expectStatus(res, 200, "soft delete addon");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.get("/api/dashboard/addon-plans").set(adminHeaders);
    expectStatus(res, 200, "list addon plans alias");
    assert(res.body.data.every((addon) => addon.kind === "plan"));

    res = await api.post("/api/dashboard/addon-plans").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Alias Reject Item` },
      category: "juice",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 700,
    });
    expectStatus(res, 400, "addon plans reject kind item");

    res = await api.post("/api/dashboard/addon-plans").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Alias Plan Create` },
      category: "juice",
      kind: "plan",
      billingMode: "per_day",
      priceHalala: 700,
    });
    expectStatus(res, 201, "create addon plan alias");
    const aliasAddonPlanId = res.body.data.id;

    res = await api.delete(`/api/dashboard/addon-plans/${aliasAddonPlanId}`).set(adminHeaders).send({});
    expectStatus(res, 200, "soft delete addon plan alias");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/addon-items").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Alias Item Create` },
      category: "snack",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 800,
    });
    expectStatus(res, 201, "create addon item alias");
    const aliasAddonItemId = res.body.data.id;

    res = await api.get(`/api/dashboard/addon-items/${aliasAddonItemId}`).set(adminHeaders);
    expectStatus(res, 200, "get addon item alias");
    assert.strictEqual(res.body.data.kind, "item");

    res = await api.put(`/api/dashboard/addon-items/${aliasAddonItemId}`).set(adminHeaders).send({
      name: { en: `${TEST_TAG} Alias Item Updated` },
      category: "snack",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 900,
    });
    expectStatus(res, 200, "update addon item alias");

    res = await api.patch(`/api/dashboard/addon-items/${aliasAddonItemId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle addon item alias");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.delete(`/api/dashboard/addon-items/${aliasAddonItemId}`).set(adminHeaders).send({});
    expectStatus(res, 200, "soft delete addon item alias");
    assert.strictEqual(res.body.data.isActive, false);

    const categoryKey = `test_category_${Date.now()}`;
    res = await api.post("/api/dashboard/meal-planner/categories").set(adminHeaders).send({
      key: categoryKey,
      dimension: "protein",
      name: { en: `${TEST_TAG} Category` },
      description: { en: "Dashboard managed category" },
      rules: { ruleKey: "dashboard_test" },
      isActive: true,
      sortOrder: 99,
    });
    expectStatus(res, 201, "create meal planner category");
    const categoryId = res.body.data.id;

    res = await api.get(`/api/dashboard/meal-planner/categories/${categoryId}`).set(adminHeaders);
    expectStatus(res, 200, "get meal planner category");
    assert.strictEqual(res.body.data.key, categoryKey);

    res = await api.post("/api/dashboard/meal-planner/categories").set(adminHeaders).send({
      dimension: "protein",
      name: { en: `${TEST_TAG} Generated Category` },
      ui: { cardVariant: "premium" },
      isActive: true,
      sortOrder: 98,
    });
    expectStatus(res, 201, "create generated-key meal planner category");
    const generatedCategoryId = res.body.data.id;
    assert.strictEqual(res.body.data.key, `${TEST_TAG.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_generated_category`);
    assert.strictEqual(res.body.data.ui.cardVariant, "premium");

    res = await api.put(`/api/dashboard/meal-planner/categories/${generatedCategoryId}`).set(adminHeaders).send({
      dimension: "protein",
      name: { en: `${TEST_TAG} Generated Category Renamed` },
      ui: { cardVariant: "large_salad" },
      isActive: true,
      sortOrder: 98,
    });
    expectStatus(res, 200, "rename generated-key meal planner category");
    assert.strictEqual(res.body.data.key, `${TEST_TAG.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}_generated_category`);
    assert.strictEqual(res.body.data.ui.cardVariant, "large_salad");

    res = await api.put(`/api/dashboard/meal-planner/categories/${generatedCategoryId}`).set(adminHeaders).send({
      key: "changed_builder_category",
      dimension: "protein",
      name: { en: `${TEST_TAG} Generated Category Renamed` },
      isActive: true,
      sortOrder: 98,
    });
    expectStatus(res, 400, "changed builder category key rejected");

    res = await api.post("/api/dashboard/meal-planner/categories").set(adminHeaders).send({
      dimension: "carb",
      name: { ar: "تصنيف عربي فقط" },
      isActive: true,
      sortOrder: 97,
    });
    expectStatus(res, 201, "create arabic fallback builder category");
    assert(/^category_[a-f0-9]{6}$/.test(res.body.data.key), `unexpected fallback key ${res.body.data.key}`);

    res = await api.patch(`/api/dashboard/meal-planner/categories/${categoryId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle meal planner category");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.delete(`/api/dashboard/meal-planner/categories/${categoryId}`).set(adminHeaders).send({});
    expectStatus(res, 200, "soft delete meal planner category");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/meal-planner/proteins").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Protein` },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      extraFeeHalala: 0,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create dashboard meal planner protein");
    const proteinId = res.body.data.id;

    res = await api.get(`/api/dashboard/meal-planner/proteins/${proteinId}`).set(adminHeaders);
    expectStatus(res, 200, "get dashboard meal planner protein");
    assert.strictEqual(res.body.data.isPremium, false);
    assert(res.body.data.key && res.body.data.key.includes("protein"), "standard protein generated a key");

    res = await api.put(`/api/dashboard/meal-planner/proteins/${proteinId}`).set(adminHeaders).send({
      key: "changed_builder_protein",
      name: { en: `${TEST_TAG} Protein` },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      extraFeeHalala: 0,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 400, "changed builder protein key rejected");

    res = await api.patch(`/api/dashboard/meal-planner/proteins/${proteinId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle dashboard meal planner protein");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/meal-planner/premium-proteins").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Premium Protein` },
      proteinFamilyKey: "fish",
      extraFeeHalala: 2500,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create dashboard premium protein");
    const premiumProteinId = res.body.data.id;

    res = await api.get(`/api/dashboard/meal-planner/premium-proteins/${premiumProteinId}`).set(adminHeaders);
    expectStatus(res, 200, "get dashboard premium protein");
    assert.strictEqual(res.body.data.isPremium, true);
    assert(res.body.data.key && res.body.data.key.includes("premium_protein"), "premium protein generated a key");
    assert(res.body.data.premiumKey && res.body.data.premiumKey.includes("premium_protein"), "premium protein generated premiumKey");

    res = await api.put(`/api/dashboard/meal-planner/premium-proteins/${premiumProteinId}`).set(adminHeaders).send({
      premiumKey: "changed_premium_key",
      name: { en: `${TEST_TAG} Premium Protein` },
      proteinFamilyKey: "fish",
      extraFeeHalala: 2500,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 400, "changed premiumKey rejected");

    res = await api.patch(`/api/dashboard/meal-planner/premium-proteins/${premiumProteinId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle dashboard premium protein");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/meal-planner/carbs").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Carb` },
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create dashboard carb");
    const carbId = res.body.data.id;

    res = await api.get(`/api/dashboard/meal-planner/carbs/${carbId}`).set(adminHeaders);
    expectStatus(res, 200, "get dashboard carb");
    assert.strictEqual(res.body.data.displayCategoryKey, "standard_carbs");
    assert(res.body.data.key && res.body.data.key.includes("carb"), "carb generated a key");

    res = await api.patch(`/api/dashboard/meal-planner/carbs/${carbId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle dashboard carb");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/meal-planner/sandwiches").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Sandwich` },
      proteinFamilyKey: "chicken",
      calories: 420,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create dashboard sandwich");
    const sandwichId = res.body.data.id;

    res = await api.get(`/api/dashboard/meal-planner/sandwiches/${sandwichId}`).set(adminHeaders);
    expectStatus(res, 200, "get dashboard sandwich");
    assert.strictEqual(res.body.data.selectionType, "sandwich");

    res = await api.patch(`/api/dashboard/meal-planner/sandwiches/${sandwichId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle dashboard sandwich");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/meal-planner/salad-ingredients").set(adminHeaders).send({
      name: { en: `${TEST_TAG} Salad Ingredient` },
      groupKey: "vegetables",
      calories: 25,
      price: 0,
      maxQuantity: 3,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create dashboard salad ingredient");
    const saladIngredientId = res.body.data.id;

    res = await api.get(`/api/dashboard/meal-planner/salad-ingredients/${saladIngredientId}`).set(adminHeaders);
    expectStatus(res, 200, "get dashboard salad ingredient");
    assert.strictEqual(res.body.data.groupKey, "vegetables");

    res = await api.patch(`/api/dashboard/meal-planner/salad-ingredients/${saladIngredientId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle dashboard salad ingredient");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.get("/api/admin/meal-planner-menu/proteins?includeInactive=true&q=Protein").set(adminHeaders);
    expectStatus(res, 200, "old meal planner route remains available");
    assert.strictEqual(typeof res.body.totalCount, "number");

    const catalogLogs = await ActivityLog.countDocuments({
      action: { $in: [
        "meal_planner_category_created_by_admin",
        "meal_planner_protein_created_by_admin",
        "meal_planner_carb_created_by_admin",
      ] },
    });
    assert(catalogLogs >= 3, "meal planner catalog writes should create activity logs");

    res = await api.get("/api/dashboard/subscriptions/summary").set(adminHeaders);
    expectStatus(res, 200, "static subscriptions summary route is not captured by :id");

    res = await api.post("/api/dashboard/subscriptions/quote").set(adminHeaders).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 200,
      mealsPerDay: 2,
      deliveryMethod: "delivery",
      zoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "Quote address" },
      delivery: { slot: { slotId: TEST_DELIVERY_SLOT_ID } },
      addonPlans: [String(ctx.addonPlan._id)],
    });
    expectStatus(res, 200, "valid dashboard quote");
    assert.strictEqual(res.body.data.breakdown.addonsTotalHalala, 7000);

    res = await api.post("/api/dashboard/subscriptions").set(adminHeaders).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 200,
      mealsPerDay: 2,
      deliveryMethod: "delivery",
      zoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "Create with entitlement address" },
      delivery: { slot: { slotId: TEST_DELIVERY_SLOT_ID } },
      addons: [String(ctx.addonPlan._id)],
    });
    expectStatus(res, 201, "dashboard create persists addon entitlement from addons field");
    assert(Array.isArray(res.body.data.addonSubscriptions), "created subscription should expose addonSubscriptions");
    assert.strictEqual(res.body.data.addonSubscriptions.length, 1);
    assert.strictEqual(res.body.data.addonSubscriptions[0].category, "juice");
    assert.strictEqual(String(res.body.data.addonSubscriptions[0].addonId), String(ctx.addonPlan._id));
    const createdSubscription = await Subscription.findById(res.body.data.id).lean();
    assert(createdSubscription, "created subscription should exist");
    assert.strictEqual(createdSubscription.addonSubscriptions.length, 1);
    assert.strictEqual(createdSubscription.addonSubscriptions[0].category, "juice");
    assert.strictEqual(String(createdSubscription.addonSubscriptions[0].addonId), String(ctx.addonPlan._id));

    const promoCode = `DASH${TEST_TAG.replace(/[^A-Z0-9]/gi, "").slice(0, 14).toUpperCase()}`;
    res = await api.post("/api/dashboard/promo-codes").set(adminHeaders).send({
      code: promoCode,
      name: { en: `${TEST_TAG} Promo` },
      description: { en: "Dashboard promo test" },
      discountType: "percentage",
      discountValue: 10,
      maxDiscountHalala: 10000,
      minOrderHalala: 1000,
      appliesTo: "subscriptions",
      usageLimit: 5,
      usageLimitPerUser: 2,
      isActive: true,
      sortOrder: 10,
    });
    expectStatus(res, 201, "create promo code");
    const promoId = res.body.data.id;

    res = await api.put(`/api/dashboard/promo-codes/${promoId}`).set(adminHeaders).send({
      code: promoCode,
      name: { en: `${TEST_TAG} Promo Updated` },
      discountType: "fixed_amount",
      discountValue: 500,
      appliesTo: "subscriptions",
      isActive: true,
    });
    expectStatus(res, 200, "update promo code");
    assert.strictEqual(res.body.data.discountType, "fixed");

    res = await api.post("/api/dashboard/promo-codes/validate").set(adminHeaders).send({
      code: promoCode,
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      subtotalHalala: 70000,
    });
    expectStatus(res, 200, "validate promo code");
    assert.strictEqual(res.body.data.valid, true);

    res = await api.post("/api/dashboard/subscriptions/quote").set(adminHeaders).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 200,
      mealsPerDay: 2,
      deliveryMethod: "delivery",
      zoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "Quote promo address" },
      delivery: { slot: { slotId: TEST_DELIVERY_SLOT_ID } },
      promoCode,
    });
    expectStatus(res, 200, "dashboard quote with promo");
    assert(res.body.data.breakdown.discountHalala > 0, "promo quote should include discountHalala");
    assert(res.body.data.breakdown.vatHalala >= 0, "promo quote should expose VAT");

    res = await api.patch(`/api/dashboard/promo-codes/${promoId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle promo inactive");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/subscriptions/quote").set(adminHeaders).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 200,
      mealsPerDay: 2,
      deliveryMethod: "delivery",
      zoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "Quote inactive promo address" },
      delivery: { slot: { slotId: TEST_DELIVERY_SLOT_ID } },
      promoCode,
    });
    expectStatus(res, 400, "inactive promo rejected in quote");

    res = await api.delete(`/api/dashboard/promo-codes/${promoId}`).set(adminHeaders).send({});
    expectStatus(res, 200, "soft delete promo");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.post("/api/dashboard/subscriptions/quote").set(adminHeaders).send({
      userId: String(ctx.user._id),
      planId: String(new mongoose.Types.ObjectId()),
      grams: 200,
      mealsPerDay: 2,
    });
    expectStatus(res, 404, "quote invalid plan");

    res = await api.post("/api/dashboard/subscriptions/quote").set(adminHeaders).send({
      userId: String(ctx.user._id),
      planId: String(ctx.plan._id),
      grams: 999,
      mealsPerDay: 2,
    });
    expectStatus(res, 400, "quote invalid grams");

    res = await api.put(`/api/dashboard/subscriptions/${ctx.subscription._id}/delivery`).set(adminHeaders).send({
      deliveryMode: "delivery",
      deliveryZoneId: String(ctx.zone._id),
      deliveryAddress: { line1: "New address", notes: "admin note" },
      delivery: {
        slot: { slotId: "morning_slot" }
      },
      reason: "customer requested address change",
    });
    expectStatus(res, 200, "update subscription delivery");
    assert.strictEqual(res.body.data.deliveryAddress.line1, "New address");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/addon-entitlements`).set(adminHeaders).send({
      addonSubscriptions: [{ addonId: String(ctx.addonPlan._id), maxPerDay: 1 }],
    });
    expectStatus(res, 400, "addon entitlements require reason");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/addon-entitlements`).set(adminHeaders).send({
      reason: "manual entitlement correction",
      addonSubscriptions: [{ addonId: String(ctx.addonPlan._id), maxPerDay: 1 }],
    });
    expectStatus(res, 200, "update addon entitlements");
    assert.strictEqual(res.body.data.addonSubscriptions[0].category, "juice");

    res = await api.get(`/api/dashboard/subscriptions/${ctx.subscription._id}/addon-entitlements`).set(adminHeaders);
    expectStatus(res, 200, "get addon entitlements");
    assert.strictEqual(res.body.data.subscriptionId, String(ctx.subscription._id));
    assert.strictEqual(res.body.data.addonEntitlements[0].category, "juice");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/balances`).set(superadminHeaders).send({
      premiumBalance: [],
    });
    expectStatus(res, 400, "balances require reason");

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/balances`).set(superadminHeaders).send({
      reason: "manual balance correction",
      premiumBalance: [{ premiumKey: "shrimp", purchasedQty: 2, remainingQty: 1, unitExtraFeeHalala: 2200 }],
      addonBalance: [{ addonId: String(ctx.addonItem._id), purchasedQty: 3, remainingQty: 2, unitPriceHalala: 500 }],
    });
    expectStatus(res, 200, "update balances");
    assert.strictEqual(res.body.data.premiumBalance[0].premiumKey, "shrimp");

    res = await api.get(`/api/dashboard/subscriptions/${ctx.subscription._id}/balances`).set(cashierHeaders);
    expectStatus(res, 200, "cashier reads balances");
    assert.strictEqual(res.body.data.subscriptionId, String(ctx.subscription._id));
    assert.strictEqual(res.body.data.premiumBalance[0].premiumKey, "shrimp");
    assert.strictEqual(res.body.data.addonBalance[0].remainingQty, 2);

    res = await api.patch(`/api/dashboard/subscriptions/${ctx.subscription._id}/balances`).set(cashierHeaders).send({
      reason: "cashier should not edit balances",
      premiumBalance: [],
    });
    expectStatus(res, 403, "cashier cannot update balances");

    res = await api.get(`/api/dashboard/subscriptions/${ctx.subscription._id}/audit-log`).set(adminHeaders);
    expectStatus(res, 200, "get audit log");
    assert(res.body.data.auditLogs.length >= 2);

    const deliveryDay = await SubscriptionDay.create({
      subscriptionId: ctx.subscription._id,
      date: "2026-05-10",
      status: "open",
      materializedMeals: [{
        slotKey: "slot_1",
        selectionType: "standard_meal",
        operationalSku: "dashboard-test-meal",
      }],
      mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    });

    res = await api.get("/api/dashboard/kitchen/queue?date=2026-05-10&method=delivery").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen queue");
    const openDeliveryQueueItem = res.body.data.items.find((item) => item.subscriptionDayId === String(deliveryDay._id));
    assert(openDeliveryQueueItem);
    assert.deepStrictEqual(
      openDeliveryQueueItem.allowedActions.map((action) => action.id),
      ["prepare", "lock", "cancel"]
    );
    assert(openDeliveryQueueItem.allowedActions.every((action) => action.endpoint && action.method === "POST"));

    res = await api.post("/api/dashboard/kitchen/actions/lock").set(kitchenHeaders).send({
      entityId: String(deliveryDay._id),
      entityType: "subscription_day",
      payload: { reason: "lock before kitchen prep" },
    });
    expectStatus(res, 200, "kitchen lock delivery day");
    assert.strictEqual(res.body.data.status, "locked");

    res = await api.post("/api/dashboard/kitchen/actions/prepare").set(kitchenHeaders).send({
      entityId: String(deliveryDay._id),
      entityType: "subscription_day",
      payload: { reason: "start kitchen prep" },
    });
    expectStatus(res, 200, "kitchen prepare delivery day");
    assert.strictEqual(res.body.data.status, "in_preparation");
    assert.deepStrictEqual(
      res.body.data.allowedActions.map((action) => action.id),
      ["dispatch", "cancel"]
    );
    assert(!res.body.data.allowedActions.some((action) => action.id === "set_ready"));

    res = await api.post("/api/dashboard/courier/actions/dispatch").set(courierHeaders).send({
      entityId: String(deliveryDay._id),
      entityType: "subscription_day",
      payload: { reason: "dispatch to courier", notes: "Left branch" },
    });
    expectStatus(res, 200, "courier dispatch delivery day");
    assert.strictEqual(res.body.data.status, "out_for_delivery");

    res = await api.get("/api/dashboard/courier/queue?date=2026-05-10&method=delivery").set(courierHeaders);
    expectStatus(res, 200, "courier queue includes subscription delivery day");
    assert(res.body.data.items.some((item) => item.subscriptionDayId === String(deliveryDay._id)));

    res = await api.post("/api/dashboard/courier/actions/notify_arrival").set(courierHeaders).send({
      entityId: String(deliveryDay._id),
      entityType: "subscription_day",
      payload: { reason: "arrived nearby" },
    });
    expectStatus(res, 200, "courier notify arrival");

    res = await api.post("/api/dashboard/courier/actions/fulfill").set(courierHeaders).send({
      entityId: String(deliveryDay._id),
      entityType: "subscription_day",
      payload: { reason: "delivered to customer" },
    });
    expectStatus(res, 200, "courier fulfill delivery day");
    assert.strictEqual(res.body.data.status, "fulfilled");

    const deliveryCancelDay = await SubscriptionDay.create({
      subscriptionId: ctx.subscription._id,
      date: "2026-05-11",
      status: "in_preparation",
      materializedMeals: [{
        slotKey: "slot_1",
        selectionType: "standard_meal",
        operationalSku: "dashboard-test-cancel-meal",
      }],
      mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    });
    res = await api.post("/api/dashboard/courier/actions/dispatch").set(courierHeaders).send({
      entityId: String(deliveryCancelDay._id),
      entityType: "subscription_day",
      payload: { reason: "dispatch cancellation regression" },
    });
    expectStatus(res, 200, "courier dispatch cancel regression day");

    res = await api.post("/api/dashboard/courier/actions/cancel").set(courierHeaders).send({
      entityId: String(deliveryCancelDay._id),
      entityType: "subscription_day",
      payload: { reason: "customer unavailable" },
    });
    expectStatus(res, 200, "courier cancel subscription delivery day");
    assert.strictEqual(res.body.data.status, "delivery_canceled");

    const pickupSubscription = await Subscription.create({
      userId: ctx.user._id,
      planId: ctx.plan._id,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      validityEndDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      totalMeals: 14,
      remainingMeals: 14,
      selectedGrams: 200,
      selectedMealsPerDay: 2,
      deliveryMode: "pickup",
      pickupLocationId: new mongoose.Types.ObjectId(),
    });
    const pickupDay = await SubscriptionDay.create({
      subscriptionId: pickupSubscription._id,
      date: "2026-05-10",
      status: "open",
      pickupRequested: true,
      pickupRequestedAt: new Date(),
      materializedMeals: [{
        slotKey: "slot_1",
        selectionType: "standard_meal",
        operationalSku: "dashboard-test-pickup-meal",
      }],
      mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    });

    res = await api.post("/api/dashboard/kitchen/actions/prepare").set(kitchenHeaders).send({
      entityId: String(pickupDay._id),
      entityType: "subscription_day",
      payload: { reason: "prepare pickup" },
    });
    expectStatus(res, 200, "kitchen prepare pickup day");
    assert.strictEqual(res.body.data.status, "in_preparation");

    res = await api.post("/api/dashboard/kitchen/actions/ready_for_pickup").set(kitchenHeaders).send({
      entityId: String(pickupDay._id),
      entityType: "subscription_day",
      payload: { reason: "ready at branch" },
    });
    expectStatus(res, 200, "ready for pickup");
    assert.strictEqual(res.body.data.status, "ready_for_pickup");
    const pickupCode = res.body.data.pickup && res.body.data.pickup.pickupCode;
    assert.match(pickupCode, /^\d{6}$/);

    res = await api.post("/api/dashboard/pickup/actions/fulfill").set(kitchenHeaders).send({
      entityId: String(pickupDay._id),
      entityType: "subscription_day",
      payload: { reason: "Customer picked up from branch", notes: "Verified at branch", pickupCode },
    });
    expectStatus(res, 200, "pickup fulfill collected");
    assert.strictEqual(res.body.data.status, "fulfilled");

    const canceledPickupDay = await SubscriptionDay.create({
      subscriptionId: pickupSubscription._id,
      date: "2026-05-11",
      status: "ready_for_pickup",
      pickupRequested: true,
      pickupPreparedAt: new Date(),
    });
    res = await api.post("/api/dashboard/pickup/actions/cancel").set(kitchenHeaders).send({
      entityId: String(canceledPickupDay._id),
      entityType: "subscription_day",
      payload: { reason: "customer did not collect" },
    });
    expectStatus(res, 200, "pickup cancel");
    assert.strictEqual(res.body.data.status, "canceled_at_branch");

    res = await api.post("/api/dashboard/pickup/actions/reopen").set(adminHeaders).send({
      entityId: String(canceledPickupDay._id),
      entityType: "subscription_day",
      payload: { reason: "branch reopened by admin" },
    });
    expectStatus(res, 200, "pickup reopen");
    assert.strictEqual(res.body.data.status, "open");

    res = await api.get("/api/dashboard/delivery-schedule?date=2026-05-10").set(courierHeaders);
    expectStatus(res, 200, "delivery schedule");
    assert.strictEqual(res.body.data.date, "2026-05-10");
    assert(res.body.data.summary.total >= 1);

    const payment = await Payment.create({
      provider: "moyasar",
      type: "subscription_activation",
      status: "paid",
      amount: 70000,
      currency: "SAR",
      userId: ctx.user._id,
      subscriptionId: ctx.subscription._id,
      providerInvoiceId: `inv_${Date.now()}`,
      metadata: {
        breakdown: {
          subtotalBeforeVatHalala: 60870,
          vatPercentage: 15,
          vatHalala: 9130,
          totalHalala: 70000,
          discountHalala: 0,
        },
        lineItems: [{ type: "plan", amountHalala: 70000 }],
      },
      paidAt: new Date(),
    });
    res = await api.get(`/api/dashboard/payments/${payment._id}/breakdown`).set(adminHeaders);
    expectStatus(res, 200, "payment breakdown");
    assert.strictEqual(res.body.data.breakdown.vatInclusive, true);
    assert.strictEqual(res.body.data.totalHalala, 70000);

    res = await api.put("/api/dashboard/restaurant-hours").set(adminHeaders).send({
      restaurant_open_time: "10:00",
      restaurant_close_time: "23:00",
      isOpen: true,
      deliveryWindows: ["16:00-18:00", "18:00-20:00"],
      cutoffTime: "12:00",
    });
    expectStatus(res, 200, "update restaurant hours");
    res = await api.patch("/api/dashboard/restaurant-hours/toggle-open").set(adminHeaders).send({ isOpen: false });
    expectStatus(res, 200, "toggle restaurant open");
    assert.strictEqual(res.body.data.isOpen, false);
    res = await api.get("/api/dashboard/restaurant-hours").set(adminHeaders);
    expectStatus(res, 200, "get restaurant hours");
    assert.strictEqual(res.body.data.restaurant_is_open, false);

    originalPremiumPriceSetting = await Setting.findOne({ key: "premium_price" }).lean();
    await Setting.findOneAndUpdate(
      { key: "premium_price" },
      { $set: { key: "premium_price", value: 33 } },
      { upsert: true, new: true }
    );
    res = await api.get("/api/dashboard/settings").set(adminHeaders);
    expectStatus(res, 200, "get dashboard settings");
    assert.strictEqual(res.body.status, true);
    assert.strictEqual(res.body.data.premium_price, 33);
    res = await api.get("/api/dashboard/settings").set(cashierHeaders);
    expectStatus(res, 403, "cashier cannot read settings");

    const cashierUser = await DashboardUser.create({
      email: `${TEST_TAG}-cashier@example.com`,
      passwordHash: "not-used-in-this-test",
      role: "cashier",
      isActive: true,
    });
    res = await api.get("/api/dashboard/auth/me").set(authForUser(cashierUser._id, "cashier"));
    expectStatus(res, 200, "dashboard auth me cashier");
    assert.strictEqual(res.body.status, true);
    assert.strictEqual(res.body.user.role, "cashier");
    assert.strictEqual(res.body.data.user.role, "cashier");
    res = await api.get("/api/dashboard/auth/me");
    expectStatus(res, 200, "dashboard auth me anonymous");
    assert.strictEqual(res.body.status, false);
    assert.strictEqual(res.body.user, null);
    assert.strictEqual(res.body.data.user, null);

    res = await api.post("/api/dashboard/zones").set(adminHeaders).send({
      name: { en: `${TEST_TAG} API Zone` },
      deliveryFeeHalala: 1500,
      isActive: true,
      sortOrder: 2,
    });
    expectStatus(res, 201, "create zone");
    const createdZoneId = res.body.data._id;

    res = await api.put(`/api/dashboard/zones/${createdZoneId}`).set(adminHeaders).send({
      name: { en: `${TEST_TAG} API Zone Updated` },
      deliveryFeeHalala: 1700,
      isActive: true,
      sortOrder: 3,
    });
    expectStatus(res, 200, "update zone");
    assert.strictEqual(res.body.data.deliveryFeeHalala, 1700);

    res = await api.patch(`/api/dashboard/zones/${createdZoneId}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "toggle zone");
    assert.strictEqual(res.body.data.isActive, false);

    res = await api.get("/api/dashboard/zones?isActive=false").set(adminHeaders);
    expectStatus(res, 200, "list zones");
    assert(res.body.data.some((zone) => String(zone._id) === String(createdZoneId)));

    res = await api.delete(`/api/dashboard/zones/${createdZoneId}`).set(adminHeaders).send({});
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
      res = await api.get(path).set(adminHeaders);
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
    if (ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED === undefined) {
      delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    } else {
      process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED;
    }
    if (originalPremiumPriceSetting) {
      await Setting.findOneAndUpdate(
        { key: "premium_price" },
        { $set: { value: originalPremiumPriceSetting.value, description: originalPremiumPriceSetting.description } },
        { upsert: true }
      );
    } else if (originalPremiumPriceSetting === null) {
      await Setting.deleteOne({ key: "premium_price" });
    }
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
