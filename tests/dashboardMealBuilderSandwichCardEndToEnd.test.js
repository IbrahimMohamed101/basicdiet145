process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-only-jwt-key-sandwich-card-111111";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-key-sandwich-card";

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
  const uri = mongoServer.getUri(`meal_builder_sandwich_card_${Date.now()}`);
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
      key: "sandwich_card_e2e",
      name: { ar: "ساندويتشات", en: "Sandwiches" },
      publishedAt: now,
    });

    const [sandwichOne, sandwichTwo, fullMeal] = await MenuProduct.insertMany([
      {
        categoryId: category._id,
        key: "sandwich_card_chicken",
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
        key: "sandwich_card_beef",
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
        key: "separate_ready_full_meal",
        name: { ar: "وجبة جاهزة", en: "Ready Full Meal" },
        itemType: "full_meal_product",
        pricingModel: "fixed",
        priceHalala: 2200,
        availableFor: ["subscription"],
        ui: { cardVariant: "ready_meal" },
        publishedAt: now,
        sortOrder: 30,
      },
    ]);

    const app = createApp();
    const auth = await dashboardAuth("admin", "sandwich-card-e2e");

    let response = await request(app)
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({ sections: [], notes: "sandwich card isolated draft" });
    expectStatus(response, 201, "create empty draft");

    response = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=500&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(response, 200, "direct product picker");
    const candidatesByKey = new Map(
      response.body.data.candidates.map((candidate) => [candidate.key, candidate])
    );
    assert.strictEqual(
      candidatesByKey.get("sandwich_card_chicken").selectionType,
      "sandwich"
    );
    assert.strictEqual(
      candidatesByKey.get("sandwich_card_chicken").classification.kind,
      "sandwich"
    );
    assert.strictEqual(
      candidatesByKey.get("separate_ready_full_meal").selectionType,
      "full_meal_product"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "sandwiches",
        titleOverride: { ar: "ساندويتشات", en: "Sandwiches" },
        selectedProductIds: [String(sandwichOne._id)],
        sortOrder: 10,
        visible: true,
      });
    expectStatus(response, 201, "create sandwich card without selectionType");
    assert.strictEqual(response.body.data.section.selectionType, "sandwich");
    assert.strictEqual(
      response.body.data.section.metadata.requiresBuilder,
      false
    );
    assert.strictEqual(
      response.body.data.section.metadata.treatAsFullMeal,
      true
    );
    assert.strictEqual(response.body.data.section.rules.carbsRequired, false);
    assert.strictEqual(
      (await MenuProduct.findById(sandwichOne._id).lean()).itemType,
      "cold_sandwich",
      "modern sandwich_card product is normalized to canonical cold_sandwich"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections/sandwiches/products")
      .set(auth.headers)
      .send({ productIds: [String(sandwichTwo._id)] });
    expectStatus(response, 200, "add second sandwich");
    assert.deepStrictEqual(
      response.body.data.section.selectedProductIds.map(String),
      [String(sandwichOne._id), String(sandwichTwo._id)]
    );
    assert.strictEqual(
      (await MenuProduct.findById(sandwichTwo._id).lean()).itemType,
      "cold_sandwich",
      "added sandwich_card product is normalized before legacy validation"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections/sandwiches/products")
      .set(auth.headers)
      .send({ productIds: [String(fullMeal._id)] });
    expectStatus(response, 422, "reject mixed sandwich and full-meal card");
    assert.strictEqual(
      response.body.error.code,
      "MEAL_BUILDER_DIRECT_CARD_MIXED_TYPES"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "ready_meals",
        titleOverride: { ar: "وجبات جاهزة", en: "Ready Meals" },
        selectedProductIds: [String(fullMeal._id)],
        sortOrder: 20,
        visible: true,
      });
    expectStatus(response, 201, "create full-meal card without selectionType");
    assert.strictEqual(
      response.body.data.section.selectionType,
      "full_meal_product"
    );
    assert.strictEqual(
      response.body.data.section.metadata.treatAsFullMeal,
      true
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "publish sandwich card e2e" });
    expectStatus(response, 200, "publish Meal Builder");

    response = await request(app).get(
      "/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en"
    );
    expectStatus(response, 200, "public Meal Planner contract");

    const contract = response.body.data.builderCatalog;
    const sandwichSection = findSection(contract, "sandwiches");
    const readySection = findSection(contract, "ready_meals");
    assert(sandwichSection, "sandwich section reaches public contract");
    assert(readySection, "ready-meal section reaches public contract");

    const publicSandwich = findProduct(sandwichSection, sandwichOne._id);
    const publicFullMeal = findProduct(readySection, fullMeal._id);
    assert(publicSandwich, "sandwich reaches public contract");
    assert(publicFullMeal, "full meal reaches public contract");

    assert.strictEqual(publicSandwich.selectionType, "sandwich");
    assert.strictEqual(publicSandwich.action.type, "direct_add");
    assert.strictEqual(publicSandwich.action.requiresBuilder, false);
    assert.strictEqual(publicSandwich.action.treatAsFullMeal, true);

    assert.strictEqual(publicFullMeal.selectionType, "full_meal_product");
    assert.strictEqual(publicFullMeal.action.type, "direct_add");
    assert.strictEqual(publicFullMeal.action.requiresBuilder, false);
    assert.strictEqual(publicFullMeal.action.treatAsFullMeal, true);

    console.log("dashboard Meal Builder sandwich card end-to-end passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
