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
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const { MEAL_SELECTION_TYPES } = require("../src/config/mealPlannerContract");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");
const canonicalPlannerService = require("../src/services/subscription/canonicalMealSlotPlannerService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(
    `meal_planner_full_meal_product_${Date.now()}`
  );
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function seedCatalog() {
  const now = new Date();
  const pastaCategory = await MenuCategory.create({
    key: "pasta",
    name: { en: "Pasta", ar: "مكرونة" },
    publishedAt: now,
  });
  const sandwichCategory = await MenuCategory.create({
    key: "sandwiches",
    name: { en: "Sandwiches", ar: "ساندوتشات" },
    publishedAt: now,
  });

  const pastaProduct = await MenuProduct.create({
    categoryId: pastaCategory._id,
    key: "macarna_bashamel",
    itemType: "standalone_meal",
    name: { en: "Macaroni Béchamel", ar: "مكرونة بشاميل" },
    pricingModel: "fixed",
    priceHalala: 2000,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  const sandwichProduct = await MenuProduct.create({
    categoryId: sandwichCategory._id,
    key: "turkey_sandwich_contract_test",
    itemType: "cold_sandwich",
    name: { en: "Turkey Sandwich", ar: "ساندوتش تركي" },
    pricingModel: "fixed",
    priceHalala: 1900,
    availableFor: ["subscription"],
    publishedAt: now,
  });

  return {
    pastaCategory,
    pastaProduct,
    sandwichProduct,
  };
}

function plannerProduct(planner, productId) {
  for (const section of planner.sections || []) {
    const product = (section.products || []).find(
      (row) => String(row.productId || row.id) === String(productId)
    );
    if (product) return { section, product };
  }
  return null;
}

function assertNoAutomaticSandwichCard(planner) {
  assert.strictEqual(
    (planner.sections || []).some((section) => section.key === "sandwich"),
    false,
    "backend must not inject an app-only sandwich card"
  );
}

async function run() {
  await connect();
  try {
    const fixture = await seedCatalog();
    const api = request(createApp());
    const { headers } = await dashboardAuth("admin", "full-meal-product-test");

    const draftPayload = {
      sections: [
        {
          key: "pasta_section",
          sectionType: "product_category",
          sourceCategoryId: String(fixture.pastaCategory._id),
          includeMode: "selected",
          selectedProductIds: [String(fixture.pastaProduct._id)],
          selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          titleOverride: { en: "Pasta Meals", ar: "وجبات مكرونة" },
          required: false,
          minSelections: 0,
          maxSelections: 1,
          multiSelect: false,
          visible: true,
          availableFor: ["subscription"],
        },
      ],
    };

    let response = await api
      .post("/api/dashboard/meal-builder/draft")
      .set(headers)
      .send(draftPayload);
    assert.strictEqual(
      response.status,
      201,
      `Failed to create draft: ${JSON.stringify(response.body)}`
    );

    response = await api
      .post("/api/dashboard/meal-builder/publish")
      .set(headers)
      .send({});
    assert.strictEqual(
      response.status,
      200,
      `Failed to publish draft: ${JSON.stringify(response.body)}`
    );

    response = await api.get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const planner = response.body.data.builderCatalog;
    assertNoAutomaticSandwichCard(planner);

    const authored = plannerProduct(planner, fixture.pastaProduct._id);
    assert(authored, "dashboard-authored full meal must reach Flutter");
    assert.strictEqual(authored.section.key, "pasta_section");
    assert.strictEqual(
      authored.product.selectionType,
      MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
    );
    assert.deepStrictEqual(authored.product.action, {
      type: "direct_add",
      requiresBuilder: false,
      treatAsFullMeal: true,
    });

    // Preserve validation compatibility for already-saved historical selections,
    // but do not expose their retired sandwich presentation card to new clients.
    const now = new Date();
    await MealBuilderConfig.updateMany(
      { status: "published", isCurrent: true },
      { $set: { status: "archived", isCurrent: false } }
    );
    await MealBuilderConfig.create({
      status: "published",
      isCurrent: true,
      contractVersion: "subscription_meal_builder.v1",
      versionNumber: 999,
      source: "dashboard",
      createdBySystem: false,
      publishedAt: now,
      sections: [
        {
          key: "legacy_sandwiches",
          sectionType: "product_list",
          sourceKind: "product_list",
          includeMode: "selected",
          selectedProductIds: [String(fixture.sandwichProduct._id)],
          selectionType: MEAL_SELECTION_TYPES.SANDWICH,
          titleOverride: { en: "Sandwiches", ar: "ساندوتشات" },
          required: false,
          minSelections: 0,
          maxSelections: 1,
          multiSelect: false,
          visible: true,
          availableFor: ["subscription"],
          metadata: {
            cardType: "direct_product",
            requiresBuilder: false,
            treatAsFullMeal: true,
          },
        },
      ],
    });

    const membership = await mealBuilderConfigService.buildPublishedMembership();
    assert.strictEqual(membership.hasPublishedConfig, true);
    assert.strictEqual(
      mealBuilderConfigService.isProductIncluded(
        membership.membership,
        MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
        fixture.sandwichProduct._id
      ),
      true,
      "historical saved selection must remain valid"
    );

    const validation = await canonicalPlannerService.validateCanonicalMealSlots({
      mealSlots: [
        {
          slotIndex: 1,
          slotKey: "slot_1",
          selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          productId: String(fixture.sandwichProduct._id),
          selectedOptions: [],
        },
      ],
      mealsPerDayLimit: 2,
      maxSlotCount: 2,
      subscription: null,
    });
    assert.strictEqual(
      validation.valid,
      true,
      `historical direct product validation failed: ${JSON.stringify(validation)}`
    );

    response = await api.get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const legacyPlanner = response.body.data.builderCatalog;
    assertNoAutomaticSandwichCard(legacyPlanner);
    assert.strictEqual(
      (legacyPlanner.sections || []).some(
        (section) => section.key === "legacy_sandwiches"
      ),
      false,
      "retired legacy sandwich presentation must not be exposed"
    );

    console.log("full meal product dashboard authority contract passed");
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  await disconnect().catch(() => {});
  process.exit(1);
});
