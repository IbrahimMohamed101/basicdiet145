process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_builder_composer_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function seedCatalog() {
  const now = new Date();
  const [customCategory, sandwichCategory] = await Promise.all([
    MenuCategory.create({
      key: "custom_order",
      name: { en: "Custom Order", ar: "Custom Order" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    }),
    MenuCategory.create({
      key: "cold_sandwiches",
      name: { en: "Sandwiches", ar: "Sandwiches" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    }),
  ]);
  const [proteinsGroup, carbsGroup] = await Promise.all([
    MenuOptionGroup.create({ key: "proteins", name: { en: "Proteins", ar: "Proteins" }, publishedAt: now }),
    MenuOptionGroup.create({ key: "carbs", name: { en: "Carbs", ar: "Carbs" }, publishedAt: now }),
  ]);
  const [basicMeal, sandwich] = await Promise.all([
    MenuProduct.create({
      categoryId: customCategory._id,
      key: "basic_meal",
      itemType: "basic_meal",
      name: { en: "Basic Meal", ar: "Basic Meal" },
      pricingModel: "per_100g",
      priceHalala: 1900,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
    MenuProduct.create({
      categoryId: sandwichCategory._id,
      key: "grilled_chicken_cold_sandwich",
      itemType: "cold_sandwich",
      name: { en: "Chicken Sandwich", ar: "Chicken Sandwich" },
      pricingModel: "fixed",
      priceHalala: 1200,
      availableFor: ["subscription"],
      publishedAt: now,
    }),
  ]);
  const [chicken, rice] = await Promise.all([
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "grilled_chicken",
      name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
    }),
    MenuOption.create({
      groupId: carbsGroup._id,
      key: "white_rice",
      name: { en: "White Rice", ar: "White Rice" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
    }),
  ]);
  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 10 });
  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: carbsGroup._id, minSelections: 1, maxSelections: 2, isRequired: true, sortOrder: 20 });
  await ProductGroupOption.create({ productId: basicMeal._id, groupId: proteinsGroup._id, optionId: chicken._id, sortOrder: 10 });
  await ProductGroupOption.create({ productId: basicMeal._id, groupId: carbsGroup._id, optionId: rice._id, sortOrder: 10 });

  return { basicMeal, sandwichCategory, sandwich, proteinsGroup, carbsGroup, chicken, rice };
}

function builderSections(fixture) {
  return [
    {
      key: "chicken",
      sectionType: "option_group",
      sourceKind: "visual_family",
      productContextId: String(fixture.basicMeal._id),
      sourceGroupId: String(fixture.proteinsGroup._id),
      selectedOptionIds: [String(fixture.chicken._id)],
      selectionType: "standard_meal",
      titleOverride: { en: "Proteins", ar: "Proteins" },
      required: true,
      minSelections: 1,
      maxSelections: 1,
      sortOrder: 1,
      metadata: {
        cardType: "option_family",
        optionRole: "protein",
        proteinFamilyKey: "chicken",
      },
    },
    {
      key: "carbs",
      sectionType: "option_group",
      sourceKind: "configurable_product",
      productContextId: String(fixture.basicMeal._id),
      sourceGroupId: String(fixture.carbsGroup._id),
      selectedOptionIds: [String(fixture.rice._id)],
      selectionType: "standard_meal",
      titleOverride: { en: "Carbs", ar: "Carbs" },
      required: true,
      minSelections: 1,
      maxSelections: 2,
      multiSelect: true,
      sortOrder: 2,
      metadata: { cardType: "option_family", optionRole: "carbs" },
      rules: { maxTypes: 2, maxTotalGrams: 300, unit: "grams" },
    },
    {
      key: "sandwich",
      sectionType: "product_list",
      sourceKind: "product_list",
      selectedProductIds: [String(fixture.sandwich._id)],
      includeMode: "selected",
      selectionType: "full_meal_product",
      titleOverride: { en: "Sandwiches", ar: "Sandwiches" },
      sortOrder: 3,
      metadata: {
        cardType: "direct_product",
        requiresBuilder: false,
        treatAsFullMeal: true,
      },
    },
  ];
}

async function main() {
  await connect();
  try {
    const fixture = await seedCatalog();
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "meal-builder-composer");

    let res = await api.get("/api/subscriptions/meal-builder?lang=en");
    expectStatus(res, 404, "published Meal Builder before first publish");
    assert.strictEqual(res.body.error.code, "MEAL_BUILDER_NOT_PUBLISHED");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner compatibility catalog before first publish");
    assert.strictEqual(res.body.data.builderCatalog.contractVersion, "meal_planner_menu.v3");
    assert.strictEqual(res.body.data.builderCatalog.publishedVersionId, null);
    const fallbackCatalogHash = res.body.data.builderCatalog.catalogHash;

    res = await api.post("/api/dashboard/meal-builder/draft").set(headers).send({ sections: builderSections(fixture) });
    expectStatus(res, 201, "create builder draft");
    assert.strictEqual(res.body.data.status, "draft");
    assert.strictEqual(res.body.data.sections.length, 3);

    res = await api.get("/api/subscriptions/meal-builder?lang=en");
    expectStatus(res, 404, "unpublished draft does not create published Meal Builder");
    assert.strictEqual(res.body.error.code, "MEAL_BUILDER_NOT_PUBLISHED");

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner compatibility catalog ignores unpublished draft");
    assert.strictEqual(res.body.data.builderCatalog.publishedVersionId, null);
    assert.strictEqual(res.body.data.builderCatalog.catalogHash, fallbackCatalogHash);

    res = await api.post("/api/dashboard/meal-builder/validate").set(headers).send({ sections: builderSections(fixture) });
    expectStatus(res, 200, "validate builder draft payload");
    assert.strictEqual(res.body.data.ready, true, JSON.stringify(res.body.data));

    res = await api.post("/api/dashboard/meal-builder/publish").set(headers).send({ notes: "initial publish" });
    expectStatus(res, 200, "publish builder draft");
    assert.strictEqual(res.body.data.config.status, "published");
    assert(res.body.data.config.revisionHash.startsWith("sha256:"), "published config has revision hash");

    res = await api.get("/api/subscriptions/meal-builder?lang=en");
    expectStatus(res, 200, "published Meal Builder contract after publish");
    assert.strictEqual(res.body.data.contractVersion, "subscription_meal_builder.v1");
    assert(res.body.data.revisionHash.startsWith("sha256:"), "published read model has revision hash");
    assert.strictEqual(res.body.data.sections.length, 3);
    assert.strictEqual(res.body.data.sections[0].items[0].id, String(fixture.chicken._id));
    assert.strictEqual(res.body.data.sections[2].items[0].id, String(fixture.sandwich._id));
    const publishedRevisionHash = res.body.data.revisionHash;

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner v3 contract after builder publish");
    const publishedPlannerCatalog = res.body.data.builderCatalog;
    assert.strictEqual(publishedPlannerCatalog.contractVersion, "meal_planner_menu.v3");
    assert.strictEqual(publishedPlannerCatalog.publishedVersionId, null);
    assert.strictEqual(publishedPlannerCatalog.rules.source, "meal_builder_config");
    assert.strictEqual(publishedPlannerCatalog.rules.builderRevisionHash, publishedRevisionHash);
    assert.strictEqual(publishedPlannerCatalog.sections.length, 3);
    assert.strictEqual(publishedPlannerCatalog.sections[0].products[0].optionGroups[0].options[0].id, String(fixture.chicken._id));
    assert.strictEqual(publishedPlannerCatalog.sections[2].products[0].id, String(fixture.sandwich._id));
    const publishedCatalogHash = publishedPlannerCatalog.catalogHash;

    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({
      sections: builderSections(fixture).slice(0, 2),
      notes: "unpublished draft change",
    });
    expectStatus(res, 200, "update draft after publish");

    res = await api.get("/api/subscriptions/meal-builder?lang=en");
    expectStatus(res, 200, "published Meal Builder ignores later draft edits");
    assert.strictEqual(res.body.data.contractVersion, "subscription_meal_builder.v1");
    assert.strictEqual(res.body.data.revisionHash, publishedRevisionHash);
    assert.strictEqual(res.body.data.sections.length, 3);

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner v3 ignores later unpublished draft edits");
    assert.strictEqual(res.body.data.builderCatalog.catalogHash, publishedCatalogHash);
    assert.strictEqual(
      res.body.data.builderCatalog.rules.builderRevisionHash,
      publishedRevisionHash
    );
    assert.strictEqual(res.body.data.builderCatalog.sections.length, 3);

    console.log("dashboard meal builder composer checks passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
