process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_planner_production_products_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, expectedStatus, label) {
  assert.strictEqual(
    response.status,
    expectedStatus,
    `${label}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(
      response.body
    )}`
  );
}

async function seedProductionShape() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "production_products",
    name: { ar: "منتجات الإنتاج", en: "Production Products" },
    publishedAt: now,
    sortOrder: 1,
  });
  const products = await MenuProduct.insertMany([
    {
      categoryId: category._id,
      key: "production_ready_meal",
      name: { ar: "وجبة جاهزة", en: "Ready Meal" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 1800,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      ui: { cardVariant: "ready_meal" },
      publishedAt: now,
      sortOrder: 10,
    },
    {
      categoryId: category._id,
      key: "production_customizable_ready_meal",
      name: { ar: "وجبة جاهزة قابلة للتخصيص", en: "Customizable Ready Meal" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 2000,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      isCustomizable: true,
      ui: { cardVariant: "ready_meal_customizable" },
      publishedAt: now,
      sortOrder: 20,
    },
    {
      categoryId: category._id,
      key: "production_sandwich",
      name: { ar: "ساندويتش إنتاج", en: "Production Sandwich" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 1600,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      ui: { cardVariant: "sandwich_card" },
      publishedAt: now,
      sortOrder: 30,
    },
    {
      categoryId: category._id,
      key: "production_full_meal",
      name: { ar: "وجبة كاملة مستقلة", en: "Independent Full Meal" },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 2200,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 40,
    },
    {
      categoryId: category._id,
      key: "production_builder",
      name: { ar: "منتج بناء", en: "Builder Product" },
      itemType: "product",
      pricingModel: "per_100g",
      priceHalala: 1900,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      isCustomizable: true,
      ui: { cardVariant: "hero_builder" },
      publishedAt: now,
      sortOrder: 50,
    },
    {
      categoryId: category._id,
      key: "production_addon",
      name: { ar: "إضافة", en: "Addon" },
      itemType: "addon",
      pricingModel: "fixed",
      priceHalala: 500,
      currency: "SAR",
      availableFor: ["subscription"],
      availableForSubscription: true,
      ui: { cardVariant: "addon_card" },
      publishedAt: now,
      sortOrder: 60,
    },
  ]);
  return products;
}

async function run() {
  await connect();
  try {
    const app = createApp();
    const auth = await dashboardAuth("admin", "production-products");
    const products = await seedProductionShape();
    const byKey = new Map(products.map((product) => [product.key, product]));

    const response = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/products?includeUnavailable=true&unassignedOnly=false&limit=1000"
      )
      .set(auth.headers);
    expectStatus(response, 200, "production-shaped direct picker");

    const candidates = response.body.data.candidates;
    const candidateByKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
    for (const key of [
      "production_ready_meal",
      "production_customizable_ready_meal",
      "production_sandwich",
      "production_full_meal",
    ]) {
      assert(candidateByKey.has(key), `${key} must be visible in the direct picker`);
    }
    assert(!candidateByKey.has("production_builder"));
    assert(!candidateByKey.has("production_addon"));

    assert.strictEqual(
      candidateByKey.get("production_ready_meal").selectionType,
      "full_meal_product"
    );
    assert.strictEqual(
      candidateByKey.get("production_sandwich").selectionType,
      "full_meal_product"
    );
    assert.strictEqual(
      candidateByKey.get("production_full_meal").selectionType,
      "full_meal_product"
    );
    assert.strictEqual(
      candidateByKey.get("production_customizable_ready_meal").configurable,
      true
    );
    assert.strictEqual(response.body.data.rules.classificationAuthority, "meal_product_classification.v1");
    assert.strictEqual(
      candidateByKey.get("production_ready_meal").productId,
      String(byKey.get("production_ready_meal")._id)
    );

    console.log("dashboard Meal Planner production product compatibility passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
