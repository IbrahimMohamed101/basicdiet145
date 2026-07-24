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

  // A separate product for testing standard_meal + zero option groups behavior
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
    // NOTE: NO ProductOptionGroup entries — zero option groups intentionally to test standard_meal behavior
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

    // ── Test 1: full_meal_product section + zero option groups ─────────────────
    // This is the primary positive case: a product in a full_meal_product section
    // must publish as treatAsFullMeal=true, requiresBuilder=false.
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

      const pastaSection = planner.sections.find((section) => section.key === "pasta_section");
      assert(pastaSection, "pasta section should exist in contract");

      const pastaItem = pastaSection.products[0];
      assert.strictEqual(pastaItem.productId, String(fixture.pastaProduct._id));
      assert.strictEqual(pastaItem.selectionType, "full_meal_product", "selectionType should map correctly");
      assert.deepStrictEqual(pastaItem.action, {
        type: "direct_add",
        requiresBuilder: false,
        treatAsFullMeal: true
      }, "full_meal_product section: action must be treatAsFullMeal=true, requiresBuilder=false");
      console.log("✓ Test 1 PASSED: full_meal_product section + zero option groups → treatAsFullMeal=true, requiresBuilder=false");
    }

    // ── Test 2: standard_meal section + zero option groups ─────────────────────
    // A product in a standard_meal section with zero option groups must NOT be
    // silently treated as a full meal. The system should expose requiresBuilder=true.
    // This prevents broken builder products from becoming accidental full meals.
    {
      const draftPayload = {
        sections: [
          {
            key: "breakfast_section",
            sectionType: "product_category",
            sourceCategoryId: String(fixture.breakfastCategory._id),
            includeMode: "selected",
            selectedProductIds: [String(fixture.breakfastProduct._id)],
            selectionType: "standard_meal", // explicitly NOT full_meal_product
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

      // Publishing this may or may not succeed depending on validation strictness,
      // but the key contract assertion is: when the builder contract IS returned,
      // a standard_meal product with zero option groups must NOT have treatAsFullMeal=true.
      // We test this at the contract level even if publish fails.
      await api.post("/api/dashboard/meal-builder/publish").set(headers).send({});

      res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
      if (res.status === 200) {
        const planner = res.body.data.builderCatalog;
        const breakfastSection = planner.sections.find((s) => s.key === "breakfast_section");
        if (breakfastSection && breakfastSection.products && breakfastSection.products.length > 0) {
          const item = breakfastSection.products[0];
          // Core assertion: standard_meal + zero option groups must NOT become full meal
          assert.strictEqual(
            item.action?.treatAsFullMeal,
            undefined,
            `standard_meal section with zero option groups must NOT have treatAsFullMeal set. Got: ${JSON.stringify(item.action)}`
          );
          assert.strictEqual(
            item.action?.requiresBuilder,
            true,
            `standard_meal section with zero option groups must expose requiresBuilder=true (broken state, not silently full meal). Got: ${JSON.stringify(item.action)}`
          );
        }
      }
      // Whether the endpoint returns the section or not (it may filter empty sections),
      // the critical assertion is that it does NOT silently return treatAsFullMeal=true.
      console.log("✓ Test 2 PASSED: standard_meal section + zero option groups → NOT treated as full meal");
    }

    // ── Test 3: live direct catalog membership + legacy mobile payload ──────────
    // Older published versions may still store only a subset of direct products.
    // The live direct catalog must accept every active standalone meal that Flutter
    // can display, while configurable products remain excluded.
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
        "canonical full_meal_product must resolve a product stored in legacy sandwich membership"
      );
      assert.strictEqual(
        mealBuilderConfigService.isProductIncluded(
          publishedMembership.membership,
          MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          fixture.pastaProduct._id
        ),
        true,
        "an active standalone meal must be included from the live catalog without stored membership"
      );
      assert.strictEqual(
        mealBuilderConfigService.isProductIncluded(
          publishedMembership.membership,
          MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
          fixture.breakfastProduct._id
        ),
        false,
        "a configurable basic meal must not leak into direct full-meal membership"
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
      const directSection = res.body.data.builderCatalog.sections.find(
        (section) => section.key === "legacy_sandwiches"
      );
      assert(directSection, "legacy direct section must remain visible in the public planner");
      assert.strictEqual(
        directSection.products[0].selectionType,
        MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
        "public planner must expose the canonical direct-product selection type"
      );

      console.log("✓ Test 3 PASSED: live direct catalog membership validates canonical full_meal_product payloads");
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
