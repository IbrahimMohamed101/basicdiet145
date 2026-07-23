process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const Addon = require("../src/models/Addon");
const AddonPlanPrice = require("../src/models/AddonPlanPrice");
const DashboardUser = require("../src/models/DashboardUser");
const Plan = require("../src/models/Plan");

const TEST_TAG = `kitchen-read-only-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  } else if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
  }
}

async function cleanup() {
  const plans = await Plan.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean();
  const addons = await Addon.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean();
  const planIds = plans.map((row) => row._id);
  const addonIds = addons.map((row) => row._id);
  await Promise.all([
    AddonPlanPrice.deleteMany({ $or: [{ addonPlanId: { $in: addonIds } }, { basePlanId: { $in: planIds } }] }),
    Addon.deleteMany({ _id: { $in: addonIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
  ]);
}

async function seedCatalogRows() {
  const plan = await Plan.create({
    name: { en: `${TEST_TAG} Plan`, ar: "" },
    daysCount: 7,
    durationDays: 7,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
    }],
  });
  const addonPlan = await Addon.create({
    name: { en: `${TEST_TAG} Juice Plan`, ar: "" },
    category: "juice",
    kind: "plan",
    billingMode: "per_day",
    priceHalala: 1000,
    currency: "SAR",
    isActive: true,
  });
  const addonItem = await Addon.create({
    name: { en: `${TEST_TAG} Juice Item`, ar: "" },
    category: "juice",
    kind: "item",
    billingMode: "flat_once",
    priceHalala: 500,
    currency: "SAR",
    isActive: true,
  });
  const addonPrice = await AddonPlanPrice.create({
    addonPlanId: addonPlan._id,
    basePlanId: plan._id,
    priceHalala: 7000,
    currency: "SAR",
    isActive: true,
  });
  return { plan, addonPlan, addonItem, addonPrice };
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function run() {
  await connect();
  await cleanup();
  const app = createApp();
  const api = request(app);
  const { headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG);
  const { headers: restaurantHeaders } = await dashboardAuth("restaurant", TEST_TAG);
  const { headers: kitchenHeaders } = await dashboardAuth("kitchen", TEST_TAG);
  const { headers: cashierHeaders } = await dashboardAuth("cashier", TEST_TAG);
  const rows = await seedCatalogRows();

  try {
    let res = await api.get("/api/dashboard/plans?view=picker").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen plan picker");
    assert(res.body.data.some((plan) => plan.id === String(rows.plan._id)), "kitchen picker includes seeded plan");

    res = await api.get(`/api/dashboard/plans/${rows.plan._id}`).set(kitchenHeaders);
    expectStatus(res, 200, "kitchen plan detail");

    res = await api.get("/api/dashboard/addons").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen dashboard add-on plans");

    res = await api.get("/api/dashboard/addon-plans").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen add-on plan list");

    res = await api.get(`/api/dashboard/addon-plans/${rows.addonPlan._id}`).set(kitchenHeaders);
    expectStatus(res, 200, "kitchen add-on plan detail");

    res = await api.get("/api/dashboard/addon-items").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen add-on item list");

    res = await api.get(`/api/dashboard/addon-items/${rows.addonItem._id}`).set(kitchenHeaders);
    expectStatus(res, 200, "kitchen add-on item detail");

    res = await api.get("/api/dashboard/addon-prices").set(kitchenHeaders);
    expectStatus(res, 200, "kitchen add-on price list");

    res = await api.get(`/api/dashboard/addon-prices/${rows.addonPrice._id}`).set(kitchenHeaders);
    expectStatus(res, 200, "kitchen add-on price detail");

    res = await api.post("/api/dashboard/addons").set(kitchenHeaders).send({
      name: { en: `${TEST_TAG} Kitchen Mutate` },
      category: "juice",
      kind: "plan",
      priceHalala: 100,
    });
    expectStatus(res, 403, "kitchen cannot create add-on plan");

    res = await api.patch(`/api/dashboard/addon-plans/${rows.addonPlan._id}/toggle`).set(kitchenHeaders).send({});
    expectStatus(res, 403, "kitchen cannot toggle add-on plan");

    res = await api.put(`/api/dashboard/addon-items/${rows.addonItem._id}`).set(kitchenHeaders).send({
      name: { en: `${TEST_TAG} Kitchen Mutate Item` },
      category: "juice",
      kind: "item",
      billingMode: "flat_once",
      priceHalala: 600,
    });
    expectStatus(res, 403, "kitchen cannot update add-on item");

    res = await api.delete(`/api/dashboard/addon-prices/${rows.addonPrice._id}`).set(kitchenHeaders);
    expectStatus(res, 403, "kitchen cannot delete add-on price");

    res = await api.get("/api/dashboard/plans?view=picker").set(restaurantHeaders);
    expectStatus(res, 200, "restaurant inherits kitchen catalog read");

    res = await api.get("/api/dashboard/users?limit=1").set(restaurantHeaders);
    expectStatus(res, 200, "restaurant inherits cashier app-user read");

    res = await api.post("/api/dashboard/addons").set(restaurantHeaders).send({
      name: { en: `${TEST_TAG} Restaurant Mutate` },
      category: "juice",
      kind: "plan",
      priceHalala: 100,
    });
    expectStatus(res, 403, "restaurant does not inherit admin catalog mutation");

    res = await api.get("/api/dashboard/plans?view=picker").set(cashierHeaders);
    expectStatus(res, 403, "cashier cannot use kitchen plan picker");

    res = await api.patch(`/api/dashboard/addon-plans/${rows.addonPlan._id}/toggle`).set(adminHeaders).send({});
    expectStatus(res, 200, "admin can still mutate add-on plan");

    console.log("kitchen and restaurant read-only permission tests passed");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(`kitchen read-only permission tests failed: ${err.stack || err.message}`);
  process.exit(1);
});
