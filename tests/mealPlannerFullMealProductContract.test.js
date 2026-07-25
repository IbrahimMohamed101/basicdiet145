process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

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
  const uri = mongoServer.getUri(`meal_planner_full_meal_product_${Date.now()}`);
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
  const pastaCategory = await MenuCategory.create({ key: "pasta", name: { en: "Pasta", ar: "مكرونة" }, publishedAt: now });
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

  const breakfastCategory = await MenuCategory.create({ key: "breakfast", name: { en: "Breakfast", ar: "إفطار" }, publishedAt: now });
  const breakfastProduct = await MenuProduct.create({
    categoryId: breakfastCategory._id,
    key: "breakfast_plate",
    itemType: "basic_meal",
    name: { en: "Breakfast Plate", ar: "طبق إفطار" },
    pricingModel: "fixed",
    priceHalala: 1500,
    availableFor: ["subscription"],
    publishedAt: now,
  });

  const sandwichCategory = await MenuCategory.create({
    key: "sandwiches",
    name: { en: "Sandwiches", ar: "ساندوتشات" },
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
    breakfastCategory,
    breakfastProduct,
    sandwichCategory,
    sandwichProduct,
  };
}

async function main() {
  await connect();
  try {
    const fixture = await seedCatalog();
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "full-meal-product-test");

    // A dashboard-authored direct product card must reach Flutter under the same
    // card key. The backend must not create an extra app-only `sandwich` card.
    {
      const draftPayload = {
        sections: [
          {
            key: "pasta_section",
            sectionType: "product_category",
            sourceCategoryId: String(fixture.pastaCategory._id),
            includeMode: "selected",
            selectedProductIds: [String(fixture.pastaProduct._id)],
            selectionType: "full_meal_product",
            titleOverride: { en: "Pasta Meals", ar: "وجبات مكرونة" },
            required: false,
            minSelections: 0,
            maxSelections: 1,
            multiSelect: false,
            visible: true,
            availableFor: ["subscription"],
          }
        ]
      };

      let res = await api.post("/api/dashboard/meal-builder/draft").set(headers).send(draftPayload);
      assert.strictEqual(res.status, 201, `Failed to create draft: ${JSON.stringify(res.body)}`);

      res = await api.post("/api/dashboard/meal-builder/publish").set(headers).send({});
      assert.strictEqual(res.status, 200, `Failed to publish draft: ${JSON.stringify(res.body)}`);

      res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
      assert.strictEqual(res.status, 200);

      const planner = res.body.data.builderCatalog;
      assert.strictEqual(planner.contractVersion, "meal_planner_menu.v3");
      assert.strictEqual(
        planner.sections.some((section) => section.key === "sandwich"),
        false,
        "backend must not inject an app-only sandwich card"
      );

      const directSection = planner.sections.find((section) => section.key === "pasta_section");
      assert(directSection, "dashboard-authored direct meal card should exist");

      const pastaItem = directSection.products.find(
        (product) => String(product.productId || product.id) === String(fixture.pastaProduct._id)
      );
      assert(pastaItem, "selected standalone pasta meal should remain in its authored card");
      assert.strictEqual(pastaItem.selectionType, "full_meal_product", "selectionType should map correctly");
      assert.deepStrictEqual(pastaItem.action, {
        type: "direct_add",
        requiresBuilder: false,
        treatAsFullMeal: true
      }, "dashboard-authored direct product action must remain Flutter-compatible");
      console.log("✓ Test 1 PASSED: direct product remains in its dashboard-authored card");
    }

    // A standard_meal product with zero option groups must never become a direct
    // full meal accidentally.
    {
      const draftPayload = {
        sections: [
          {
            key: "breakfast_section",
            sectionType: "product_category",
            sourceCategoryId: String(fixture.breakfastCategory._id),
            includeMode: "selected",
            selectedProductIds: [String(fixture.breakfastProduct._id)],
            selectionType: "standard_meal",
            titleOverride: { en: "Breakfast", ar: "إفطار" },
            required: false,
            minSelections: 0,
            maxSelections: 1,
            multiSelect: false,
            visible: true,
            availableFor: ["subscription"],
          }
        ]
      };

      let res = await api.post("/api/dashboard/meal-builder/draft").set(headers).send(draftPayload);
      assert.strictEqual(res.status, 201, `Failed to create standard_meal draft: ${JSON.stringify(res.body)}`);

      await api.post("/api/dashboard/meal-builder/publish").set(headers).send({});

      res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
      if (res.status === 200) {
        const planner = res.body.data.builderCatalog;
        const breakfastSection = planner.sections.find((s) => s.key === "breakfast_section");
        if (breakfastSection && breakfastSection.products && breakfastSection.products.length > 0) {
          const item = breakfastSection.products[0];
          assert.strictEqual(
            item.action?.treatAsFullMeal,
            undefined,
            `standard_meal section with zero option groups must NOT have treatAsFullMeal set. Got: ${JSON.stringify(item.action)}`
          );
          assert.strictEqual(
            item.action?.requiresBuilder,
            true,
            `standard_meal section with zero option groups must expose requiresBuilder=true. Got: ${JSON.stringify(item.action)}`
          );
        }
      }
      console.log("✓ Test 2 PASSED: standard_meal + zero option groups is not treated as full meal");
    }

    // Historical sandwich selectionType remains readable for existing published
    // configs, but it must stay in the authored card and must not grant every live
    // standalone product implicit membership.
    {
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

      const publishedMembership = await mealBuilderConfigService.buildPublishedMembership();
      assert.strictEqual(publishedMembership.hasPublishedConfig, true);
      assert.strictEqual(
        mealBuilderConfigService.isProductIncluded(
          publishedMembership.membership,
          MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          fixture.sandwichProduct._id
        ),
        true,
        "legacy sandwich must resolve in canonical full-meal membership"
      );
      assert.strictEqual(
        mealBuilderConfigService.isProductIncluded(
          publishedMembership.membership,
          MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          fixture.pastaProduct._id
        ),
        false,
        "un-authored standalone meals must not receive implicit membership"
      );
      assert.strictEqual(
        mealBuilderConfigService.isProductIncluded(
          publishedMembership.membership,
          MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          fixture.breakfastProduct._id
        ),
        false,
        "configurable basic meal must not leak into direct membership"
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
        `canonical direct product validation failed: ${JSON.stringify(validation)}`
      );

      const res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(
        res.body.data.builderCatalog.sections.some((section) => section.key === "sandwich"),
        false,
        "legacy config must not create an additional app-only sandwich card"
      );
      const directSection = res.body.data.builderCatalog.sections.find(
        (section) => section.key === "legacy_sandwiches"
      );
      assert(directSection, "legacy authored direct-meal section must be present");
      const directProductIds = directSection.products.map(
        (product) => String(product.productId || product.id)
      );
      assert(
        directProductIds.includes(String(fixture.sandwichProduct._id)),
        "legacy authored sandwich product must remain visible"
      );
      assert(
        !directProductIds.includes(String(fixture.pastaProduct._id)),
        "un-authored standalone product must not leak into the legacy card"
      );
      assert(
        directSection.products.every(
          (product) =>
            product.selectionType === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT &&
            product.action?.type === "direct_add" &&
            product.action?.requiresBuilder === false &&
            product.action?.treatAsFullMeal === true
        ),
        "authored direct-meal items must preserve the canonical Flutter action contract"
      );

      console.log("✓ Test 3 PASSED: legacy direct card stays authored and membership-scoped");
    }

    console.log("\nAll Full Meal Product Contract tests passed!");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err && err.stack ? err.stack : err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
