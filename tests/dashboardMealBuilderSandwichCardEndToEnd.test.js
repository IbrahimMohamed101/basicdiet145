process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-jwt-key-explicit-card-111111";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-key-explicit-card";

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
  const uri = mongoServer.getUri(`meal_builder_explicit_card_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(response, expected, label) {
  assert.strictEqual(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(
      response.body
    )}`
  );
}

function findSection(contract, key) {
  return (contract?.sections || []).find((section) => section.key === key);
}

function findProduct(section, productId) {
  return (section?.products || []).find(
    (product) =>
      String(product.productId || product.id) === String(productId)
  );
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "explicit_full_meal_card",
      name: { ar: "ساندويتشات ووجبات", en: "Sandwiches and Meals" },
      publishedAt: now,
    });

    const [sandwichOne, sandwichTwo, normalMeal] = await MenuProduct.insertMany([
      {
        categoryId: category._id,
        key: "manual_chicken_sandwich",
        name: { ar: "ساندويتش دجاج", en: "Chicken Sandwich" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1700,
        availableFor: ["subscription"],
        ui: { cardVariant: "sandwich_card" },
        publishedAt: now,
        sortOrder: 10,
      },
      {
        categoryId: category._id,
        key: "manual_beef_sandwich",
        name: { ar: "ساندويتش لحم", en: "Beef Sandwich" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1900,
        availableFor: ["subscription"],
        ui: { cardVariant: "sandwich_card" },
        publishedAt: now,
        sortOrder: 20,
      },
      {
        categoryId: category._id,
        key: "manual_normal_product",
        name: { ar: "منتج عادي", en: "Normal Product" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 2200,
        availableFor: ["subscription"],
        ui: { cardVariant: "standard" },
        publishedAt: now,
        sortOrder: 30,
      },
    ]);

    const app = createApp();
    const auth = await dashboardAuth("admin", "explicit-full-meal-card");

    let response = await request(app)
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [], notes: "system managed direct meals" });
    expectStatus(response, 201, "create system-managed draft");

    response = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=500&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(response, 200, "live direct product picker");
    const candidateKeys = new Set(
      response.body.data.candidates.map((candidate) => candidate.key)
    );
    assert(candidateKeys.has("manual_chicken_sandwich"));
    assert(candidateKeys.has("manual_beef_sandwich"));
    assert(!candidateKeys.has("manual_normal_product"));
    assert.strictEqual(
      response.body.data.rules.classificationAuthority,
      "meal_product_classification.v1"
    );
    assert.strictEqual(
      response.body.data.rules.membershipSource,
      "live_catalog"
    );

    response = await request(app)
      .get("/api/dashboard/meal-builder")
      .set(auth.headers);
    expectStatus(response, 200, "dashboard Meal Builder state");
    const draftSection = findSection(response.body.data.draft, "sandwich");
    assert(draftSection, "system-managed direct-meal section must exist in draft state");
    assert.strictEqual(draftSection.metadata.membershipSource, "live_catalog");
    assert.strictEqual(draftSection.metadata.systemManaged, true);
    const draftProductIds = new Set(
      (draftSection.selectedProductIds || []).map(String)
    );
    assert(draftProductIds.has(String(sandwichOne._id)));
    assert(draftProductIds.has(String(sandwichTwo._id)));
    assert(!draftProductIds.has(String(normalMeal._id)));

    const productsAfterDraft = await MenuProduct.find({
      _id: { $in: [sandwichOne._id, sandwichTwo._id, normalMeal._id] },
    }).lean();
    assert(
      productsAfterDraft.every((product) => product.itemType === "product"),
      "system-managed membership must not mutate product itemType"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "publish live direct meals" });
    expectStatus(response, 200, "publish system-managed Meal Builder");

    response = await request(app).get(
      "/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en"
    );
    expectStatus(response, 200, "public Meal Planner contract");

    const contract = response.body.data.builderCatalog;
    const directSection = findSection(contract, "sandwich");
    assert(directSection, "canonical live direct-meal section reaches public contract");
    assert.strictEqual(
      contract.sections.filter((section) => section.key === "sandwich").length,
      1,
      "public contract must contain one canonical direct-meal section"
    );

    for (const productId of [sandwichOne._id, sandwichTwo._id]) {
      const product = findProduct(directSection, productId);
      assert(product, "live direct product reaches public contract");
      assert.strictEqual(product.selectionType, "full_meal_product");
      assert.strictEqual(product.action.type, "direct_add");
      assert.strictEqual(product.action.requiresBuilder, false);
      assert.strictEqual(product.action.treatAsFullMeal, true);
    }
    assert(
      !findProduct(directSection, normalMeal._id),
      "unclassified normal product must not leak into direct meals"
    );

    console.log("dashboard system-managed direct meal end-to-end passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
