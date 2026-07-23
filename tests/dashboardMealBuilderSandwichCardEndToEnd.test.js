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
      .send({ sections: [], notes: "explicit card isolated draft" });
    expectStatus(response, 201, "create empty draft");

    response = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=500&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(response, 200, "manual product picker");
    const candidateKeys = new Set(
      response.body.data.candidates.map((candidate) => candidate.key)
    );
    assert(candidateKeys.has("manual_chicken_sandwich"));
    assert(candidateKeys.has("manual_beef_sandwich"));
    assert(candidateKeys.has("manual_normal_product"));
    assert.strictEqual(
      response.body.data.rules.selectionTypeRequired,
      false,
      "the only direct selection type is applied automatically"
    );
    assert.strictEqual(
      response.body.data.rules.canonicalSelectionType,
      "full_meal_product"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "missing_type",
        titleOverride: { ar: "بدون نوع", en: "Missing type" },
        selectedProductIds: [String(sandwichOne._id)],
        sortOrder: 5,
        visible: true,
      });
    expectStatus(response, 201, "default card to canonical direct selection type");
    assert.strictEqual(
      response.body.data.section.selectionType,
      "full_meal_product"
    );

    response = await request(app)
      .delete("/api/dashboard/meal-builder/sections/missing_type")
      .set(auth.headers);
    expectStatus(response, 200, "remove canonical-default test card");

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "sandwiches",
        titleOverride: { ar: "ساندويتشات", en: "Sandwiches" },
        selectedProductIds: [
          String(sandwichOne._id),
          String(sandwichTwo._id),
        ],
        selectionType: "full_meal_product",
        sortOrder: 10,
        visible: true,
      });
    expectStatus(response, 201, "create explicitly selected full-meal card");
    assert.strictEqual(
      response.body.data.section.selectionType,
      "full_meal_product"
    );
    assert.strictEqual(
      response.body.data.section.metadata.configuredExplicitly,
      true
    );
    assert.strictEqual(
      response.body.data.section.metadata.treatAsFullMeal,
      true
    );
    assert.strictEqual(
      response.body.data.section.metadata.requiresBuilder,
      false
    );
    assert.strictEqual(response.body.data.section.rules.carbsRequired, false);

    const productsAfterCreate = await MenuProduct.find({
      _id: { $in: [sandwichOne._id, sandwichTwo._id] },
    }).lean();
    assert(
      productsAfterCreate.every((product) => product.itemType === "product"),
      "explicit card behavior must not mutate product itemType"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/sections")
      .set(auth.headers)
      .send({
        key: "chef_choice",
        titleOverride: { ar: "اختيار الشيف", en: "Chef Choice" },
        selectedProductIds: [String(normalMeal._id)],
        selectionType: "full_meal_product",
        sortOrder: 20,
        visible: true,
      });
    expectStatus(response, 201, "mark an arbitrary product as a full meal explicitly");
    assert.strictEqual(
      response.body.data.section.selectionType,
      "full_meal_product"
    );
    assert.strictEqual(
      (await MenuProduct.findById(normalMeal._id).lean()).itemType,
      "product",
      "normal product remains unchanged"
    );

    response = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({ notes: "publish explicit full meal cards" });
    expectStatus(response, 200, "publish explicit Meal Builder cards");

    response = await request(app).get(
      "/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en"
    );
    expectStatus(response, 200, "public Meal Planner contract");

    const contract = response.body.data.builderCatalog;
    const sandwichSection = findSection(contract, "sandwiches");
    const chefSection = findSection(contract, "chef_choice");
    assert(sandwichSection, "sandwich card reaches public contract");
    assert(chefSection, "arbitrary full-meal card reaches public contract");

    for (const [section, productId] of [
      [sandwichSection, sandwichOne._id],
      [chefSection, normalMeal._id],
    ]) {
      const product = findProduct(section, productId);
      assert(product, "selected product reaches public contract");
      assert.strictEqual(product.selectionType, "full_meal_product");
      assert.strictEqual(product.action.type, "direct_add");
      assert.strictEqual(product.action.requiresBuilder, false);
      assert.strictEqual(product.action.treatAsFullMeal, true);
    }

    console.log("dashboard Meal Builder explicit full-meal card end-to-end passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
