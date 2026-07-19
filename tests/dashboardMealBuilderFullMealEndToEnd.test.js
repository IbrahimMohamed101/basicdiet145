process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-jwt-key-1111111111111111";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-key-111111111";

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
  const uri = mongoServer.getUri(`meal_builder_full_meal_e2e_${Date.now()}`);
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
    `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`
  );
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "full_meal_e2e",
      name: { ar: "وجبات كاملة", en: "Full Meals" },
      publishedAt: now,
    });
    const [readyMeal, sandwich, explicitFullMeal, addon] =
      await MenuProduct.insertMany([
        {
          categoryId: category._id,
          key: "e2e_ready_meal",
          name: { ar: "وجبة جاهزة", en: "Ready Meal" },
          itemType: "product",
          pricingModel: "fixed",
          priceHalala: 1900,
          availableFor: ["subscription"],
          ui: { cardVariant: "ready_meal" },
          publishedAt: now,
          sortOrder: 1,
        },
        {
          categoryId: category._id,
          key: "e2e_sandwich",
          name: { ar: "ساندويتش", en: "Sandwich" },
          itemType: "product",
          pricingModel: "fixed",
          priceHalala: 1500,
          availableFor: ["subscription"],
          ui: { cardVariant: "sandwich_card" },
          publishedAt: now,
          sortOrder: 2,
        },
        {
          categoryId: category._id,
          key: "e2e_explicit_full",
          name: { ar: "وجبة كاملة", en: "Explicit Full" },
          itemType: "full_meal_product",
          pricingModel: "fixed",
          priceHalala: 2000,
          availableFor: ["subscription"],
          publishedAt: now,
          sortOrder: 3,
        },
        {
          categoryId: category._id,
          key: "e2e_addon",
          name: { ar: "إضافة", en: "Addon" },
          itemType: "product",
          pricingModel: "fixed",
          priceHalala: 300,
          availableFor: ["subscription"],
          ui: { cardVariant: "addon_card" },
          publishedAt: now,
          sortOrder: 4,
        },
      ]);

    const app = createApp();
    const auth = await dashboardAuth("admin", "full-meal-e2e");

    const picker = await request(app)
      .get(
        "/api/dashboard/meal-builder/pickers/products?limit=500&includeUnavailable=true&unassignedOnly=false"
      )
      .set(auth.headers);
    expectStatus(picker, 200, "direct product picker");
    const byKey = new Map(
      picker.body.data.candidates.map((candidate) => [candidate.key, candidate])
    );
    assert.strictEqual(byKey.get("e2e_ready_meal").selectionType, "full_meal_product");
    assert.strictEqual(byKey.get("e2e_sandwich").selectionType, "sandwich");
    assert.strictEqual(byKey.get("e2e_explicit_full").selectionType, "full_meal_product");
    assert.ok(!byKey.has("e2e_addon"));
    assert.strictEqual(
      picker.body.data.rules.classificationAuthority,
      "meal_product_classification.v1"
    );

    const draft = await request(app)
      .post("/api/dashboard/meal-builder/draft")
      .set(auth.headers)
      .send({
        sections: [
          {
            key: "ready_meals",
            sectionType: "product_list",
            sourceKind: "product_list",
            titleOverride: { ar: "وجبات جاهزة", en: "Ready Meals" },
            selectedProductIds: [String(readyMeal._id)],
            includeMode: "selected",
            selectionType: "full_meal_product",
            sortOrder: 1,
            required: false,
            minSelections: 0,
            maxSelections: 1,
            multiSelect: false,
            visible: true,
            availableFor: ["subscription"],
            metadata: { requiresBuilder: false, treatAsFullMeal: true },
            rules: { carbsRequired: false },
          },
        ],
      });
    expectStatus(draft, 201, "create full meal draft");

    const publish = await request(app)
      .post("/api/dashboard/meal-builder/publish")
      .set(auth.headers)
      .send({});
    expectStatus(publish, 200, "publish full meal draft");

    const publicMenu = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    expectStatus(publicMenu, 200, "public Meal Planner menu");
    const section = publicMenu.body.data.builderCatalog.sections.find(
      (item) => item.key === "ready_meals"
    );
    assert.ok(section, "ready meals section must reach the public contract");
    const product = section.products.find(
      (item) => item.productId === String(readyMeal._id)
    );
    assert.ok(product, "production ready meal must reach the public contract");
    assert.strictEqual(product.selectionType, "full_meal_product");
    assert.deepStrictEqual(product.action, {
      type: "direct_add",
      requiresBuilder: false,
      treatAsFullMeal: true,
    });

    assert.ok(String(sandwich._id));
    assert.ok(String(explicitFullMeal._id));
    assert.ok(String(addon._id));
    console.log("dashboard Meal Builder full meal end-to-end passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
