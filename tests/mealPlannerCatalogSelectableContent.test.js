process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const sinon = require("sinon");

const { createApp } = require("../src/app");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const { sanitizePublicData } = require("../src/controllers/subscriptionMealPlannerV4Controller");
const CatalogService = require("../src/services/catalog/CatalogService");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");
const {
  hasFlutterPrimaryMealPickerContent,
  hasSelectablePlannerContent,
  summarizeFlutterPrimaryMealPickerContent,
} = require("../src/services/catalog/plannerCatalogContentValidator");
const { logger } = require("../src/utils/logger");

const CONTRACT_VERSION = "meal_planner_menu.v3";

function catalogWithProduct(product, overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    currency: "SAR",
    sections: [{ key: "test", products: [product] }],
    catalogHash: overrides.catalogHash || "test-hash",
    rules: overrides.rules || {},
    source: overrides.source,
  };
}

function directProduct(key = "direct", selectionType = "full_meal_product") {
  return {
    id: key,
    key,
    selectionType,
    action: { type: "direct_add", requiresBuilder: false },
    optionGroups: [],
  };
}

function standardProduct(optionCount = 1) {
  return {
    id: "standard",
    key: "standard",
    selectionType: "standard_meal",
    action: { type: "open_builder", requiresBuilder: true },
    optionGroups: [{
      key: "proteins",
      options: Array.from({ length: optionCount }, (_, index) => ({ id: `protein-${index + 1}` })),
    }],
  };
}

function premiumLargeSaladProduct() {
  return {
    id: "premium-large-salad",
    key: "premium_large_salad",
    selectionType: "premium_large_salad",
    action: { type: "open_builder", requiresBuilder: true },
    optionGroups: [{ key: "protein", options: [{ id: "salad-protein" }] }],
  };
}

async function connect() {
  const mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "planner_selectable_content" },
  });
  const uri = mongoServer.getUri("planner_selectable_content");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  return mongoServer;
}

async function seedCanonicalDirectProduct() {
  const category = await MenuCategory.create({
    key: "meal_planner_selectable_content",
    name: { en: "Meals", ar: "وجبات" },
    publishedAt: new Date(),
  });
  return MenuProduct.create({
    categoryId: category._id,
    key: "canonical_direct_meal",
    name: { en: "Canonical Direct Meal", ar: "وجبة مباشرة" },
    itemType: "full_meal_product",
    pricingModel: "fixed",
    priceHalala: 1200,
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: new Date(),
  });
}

async function plannerCatalog() {
  const bundle = await CatalogService.getSubscriptionBuilderCatalogWithV2({
    lang: "en",
    includeV3: true,
    includeV2: false,
  });
  return bundle.plannerCatalog;
}

async function withPublishedCatalog(publishedCatalog, check) {
  const originalBuilder = mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder;
  mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = async () => publishedCatalog;
  try {
    return await check();
  } finally {
    mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = originalBuilder;
  }
}

function assertCanonicalFallback(catalog, canonicalProduct) {
  assert(hasSelectablePlannerContent(catalog), "canonical fallback remains selectable");
  assert(hasFlutterPrimaryMealPickerContent(catalog), "canonical fallback supports Flutter primary picker");
  assert(
    catalog.sections.some((section) => (
      (section.products || []).some((product) => String(product.id) === String(canonicalProduct._id))
    )),
    "canonical fallback product remains present"
  );
}

function testValidatorBoundaries() {
  assert.strictEqual(hasSelectablePlannerContent(null), false);
  assert.strictEqual(hasSelectablePlannerContent([]), false);
  assert.strictEqual(hasSelectablePlannerContent({ contractVersion: "meal_planner_menu.v2", sections: [{}] }), false);
  assert.strictEqual(hasSelectablePlannerContent({ contractVersion: CONTRACT_VERSION, sections: [] }), false);
  assert.strictEqual(hasSelectablePlannerContent({
    contractVersion: CONTRACT_VERSION,
    sections: [{ key: "standard_meal", products: [] }],
  }), false);
  assert.strictEqual(hasSelectablePlannerContent(catalogWithProduct({
    action: { type: "open_builder", requiresBuilder: true },
    optionGroups: [{ key: "protein", options: [] }, { key: "carbs" }],
  })), false);
  assert.strictEqual(hasSelectablePlannerContent(catalogWithProduct(directProduct())), true);
  assert.strictEqual(hasSelectablePlannerContent(catalogWithProduct({
    action: { type: "open_builder", treatAsFullMeal: true },
    optionGroups: [],
  })), true);
  assert.strictEqual(hasSelectablePlannerContent(catalogWithProduct({
    action: { type: "open_builder", requiresBuilder: true },
    optionGroups: [{ key: "protein", options: [{ id: "chicken" }] }],
  })), true);

  const premiumSaladOnly = catalogWithProduct(premiumLargeSaladProduct());
  assert.strictEqual(hasSelectablePlannerContent(premiumSaladOnly), true);
  assert.strictEqual(hasFlutterPrimaryMealPickerContent(premiumSaladOnly), false);
  assert.deepStrictEqual(summarizeFlutterPrimaryMealPickerContent(premiumSaladOnly), {
    standardProductCount: 0,
    standardProteinOptionCount: 0,
    directMealCount: 0,
    premiumLargeSaladCount: 1,
  });
  assert.strictEqual(hasFlutterPrimaryMealPickerContent(catalogWithProduct(standardProduct(2))), true);
  assert.strictEqual(hasFlutterPrimaryMealPickerContent(catalogWithProduct(directProduct("full-meal"))), true);
  assert.strictEqual(hasFlutterPrimaryMealPickerContent(catalogWithProduct(directProduct("sandwich", "sandwich"))), true);
}

async function run() {
  testValidatorBoundaries();
  const mongoServer = await connect();
  const warnStub = sinon.stub(logger, "warn");
  try {
    const canonicalProduct = await seedCanonicalDirectProduct();

    assertCanonicalFallback(await plannerCatalog(), canonicalProduct);

    await MealBuilderConfig.create({
      status: "draft",
      isCurrent: true,
      contractVersion: "subscription_meal_builder.v1",
      source: "dashboard",
      sections: [],
    });
    assertCanonicalFallback(await plannerCatalog(), canonicalProduct);

    const emptySectionsCatalog = { contractVersion: CONTRACT_VERSION, sections: [] };
    await withPublishedCatalog(emptySectionsCatalog, async () => {
      assertCanonicalFallback(await plannerCatalog(), canonicalProduct);
    });

    const emptyProductsCatalog = {
      contractVersion: CONTRACT_VERSION,
      sections: [{ key: "standard_meal", products: [] }],
    };
    await withPublishedCatalog(emptyProductsCatalog, async () => {
      assertCanonicalFallback(await plannerCatalog(), canonicalProduct);
    });

    const emptyOptionGroupsCatalog = catalogWithProduct({
      id: "empty-builder-product",
      action: { type: "open_builder", requiresBuilder: true },
      optionGroups: [{ key: "protein", options: [] }],
    });
    await withPublishedCatalog(emptyOptionGroupsCatalog, async () => {
      assertCanonicalFallback(await plannerCatalog(), canonicalProduct);
    });

    const premiumSaladOnlyCatalog = catalogWithProduct(premiumLargeSaladProduct());
    await withPublishedCatalog(premiumSaladOnlyCatalog, async () => {
      assertCanonicalFallback(await plannerCatalog(), canonicalProduct);
    });

    const publishedOptionsCatalog = catalogWithProduct(
      standardProduct(),
      { rules: { source: "meal_builder_config" }, source: "dashboard" }
    );
    await withPublishedCatalog(publishedOptionsCatalog, async () => {
      assert.strictEqual(await plannerCatalog(), publishedOptionsCatalog, "usable published options override canonical");
    });

    const publishedDirectCatalog = catalogWithProduct(directProduct("published-direct"), {
      rules: { source: "meal_builder_config" },
      source: "dashboard",
    });
    await withPublishedCatalog(publishedDirectCatalog, async () => {
      assert.strictEqual(await plannerCatalog(), publishedDirectCatalog, "usable published direct product overrides canonical");
    });

    assert.strictEqual(warnStub.callCount, 4, "each unusable published catalog emits one warning");
    for (const warningCall of warnStub.getCalls().slice(0, 3)) {
      assert.strictEqual(warningCall.args[1].event, "published_meal_builder_catalog_rejected");
      assert.strictEqual(warningCall.args[1].reason, "no_selectable_content");
    }
    assert.strictEqual(warnStub.getCall(3).args[1].reason, "no_flutter_primary_content");
    assert.strictEqual(warnStub.getCall(3).args[1].premiumLargeSaladCount, 1);

    const api = request(createApp());
    const success = await api.get("/api/subscriptions/meal-planner-menu?lang=ar");
    assert.strictEqual(success.status, 200, JSON.stringify(success.body));
    assert.strictEqual(success.body.status, true);
    assert(hasSelectablePlannerContent(success.body.data.builderCatalog));
    assert(hasFlutterPrimaryMealPickerContent(success.body.data.builderCatalog));
    assert.strictEqual(success.body.data.plannerCatalog, undefined);
    assert.strictEqual(success.body.data.builderCatalogV2, undefined);
    assert.strictEqual(success.body.data.sections, undefined);

    const sanitized = sanitizePublicData({ builderCatalog: publishedDirectCatalog });
    assert.strictEqual(sanitized.builderCatalog, publishedDirectCatalog);

    assert.throws(
      () => sanitizePublicData({ builderCatalog: premiumSaladOnlyCatalog }),
      (error) => {
        assert.strictEqual(error.status, 503);
        assert.strictEqual(error.code, "MEAL_PLANNER_PRIMARY_CONTENT_EMPTY");
        assert.deepStrictEqual(error.details, {
          standardProductCount: 0,
          standardProteinOptionCount: 0,
          directMealCount: 0,
          premiumLargeSaladCount: 1,
        });
        return true;
      }
    );

    await MenuProduct.deleteMany({});
    const emptyResponse = await api.get("/api/subscriptions/meal-planner-menu?lang=ar");
    assert.strictEqual(emptyResponse.status, 503, JSON.stringify(emptyResponse.body));
    assert.strictEqual(emptyResponse.body.error.code, "MEAL_PLANNER_CATALOG_EMPTY");
    assert.strictEqual(
      emptyResponse.body.error.message,
      "Meal Planner catalog contains no selectable content"
    );
    assert.deepStrictEqual(emptyResponse.body.error.details, {
      expectedContractVersion: CONTRACT_VERSION,
      receivedContractVersion: CONTRACT_VERSION,
      sectionCount: 4,
    });

    console.log("mealPlannerCatalogSelectableContent.test.js passed");
  } finally {
    warnStub.restore();
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
