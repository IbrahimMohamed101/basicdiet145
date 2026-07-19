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
  const uri = mongoServer.getUri(
    `dashboard_meal_planner_production_products_${Date.now()}`
  );
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

async function seedProductionStyleProducts() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "production_products",
    name: { ar: "منتجات الإنتاج", en: "Production Products" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
  });

  return MenuProduct.insertMany([
    {
      categoryId: category._id,
      key: "production_ready_meal",
      name: { ar: "وجبة إنتاج", en: "Production Ready Meal" },
      itemType: "product",
      pricingModel: "per_100g",
      priceHalala: 1900,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      ui: { cardVariant: "ready_meal" },
      publishedAt: now,
      sortOrder: 1,
    },
    {
      categoryId: category._id,
      key: "production_sandwich",
      name: { ar: "ساندويتش إنتاج", en: "Production Sandwich" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 1500,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      ui: { cardVariant: "sandwich_card" },
      publishedAt: now,
      sortOrder: 2,
    },
    {
      categoryId: category._id,
      key: "canonical_full_meal",
      name: { ar: "وجبة كاملة", en: "Canonical Full Meal" },
      itemType: "full_meal_product",
      pricingModel: "fixed",
      priceHalala: 1800,
      availableFor: ["subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      ui: { cardVariant: "ready_meal" },
      publishedAt: now,
      sortOrder: 3,
    },
    {
      categoryId: category._id,
      key: "production_addon",
      name: { ar: "إضافة إنتاج", en: "Production Addon" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 500,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      ui: { cardVariant: "addon_card" },
      publishedAt: now,
      sortOrder: 4,
    },
    {
      categoryId: category._id,
      key: "production_builder_shell",
      name: { ar: "منشئ تقني", en: "Production Builder Shell" },
      itemType: "product",
      pricingModel: "per_100g",
      priceHalala: 1900,
      availableFor: ["one_time", "subscription"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      ui: { cardVariant: "hero_builder" },
      publishedAt: now,
      sortOrder: 5,
    },
  ]);
}

async function run() {
  await connect();
  try {
    await seedProductionStyleProducts();
    const app = createApp();
    const auth = await dashboardAuth(
      "admin",
      "dashboard-meal-planner-production-products"
    );

    const productsResponse = await request(app)
      .get("/api/dashboard/menu/products?limit=500&includeInactive=true")
      .set(auth.headers);
    expectStatus(productsResponse, 200, "dashboard products list");
    assert.strictEqual(productsResponse.body.data.items.length, 5);
    assert.strictEqual(productsResponse.body.data.pagination.limit, 500);
    assert.strictEqual(productsResponse.body.data.pagination.total, 5);
    assert.strictEqual(productsResponse.body.data.pagination.pages, 1);

    const pickerResponse = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=500&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(pickerResponse, 200, "production product picker");

    const candidates = pickerResponse.body.data.candidates;
    const keys = new Set(candidates.map((candidate) => candidate.key));
    assert.deepStrictEqual(
      keys,
      new Set([
        "production_ready_meal",
        "production_sandwich",
        "canonical_full_meal",
      ])
    );
    assert.strictEqual(pickerResponse.body.data.meta.limit, 500);
    assert.strictEqual(pickerResponse.body.data.meta.total, 3);
    assert.strictEqual(pickerResponse.body.data.meta.catalogTotal, 3);
    assert.strictEqual(
      candidates.find((candidate) => candidate.key === "production_sandwich")
        .selectionType,
      "sandwich"
    );
    assert.ok(!keys.has("production_addon"));
    assert.ok(!keys.has("production_builder_shell"));
  } finally {
    await disconnect();
  }
}

run()
  .then(() => {
    console.log("dashboard Meal Planner production product compatibility passed");
  })
  .catch(async (error) => {
    console.error(error);
    await disconnect().catch(() => {});
    process.exit(1);
  });
