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
const MealBuilderConfig = require("../src/models/MealBuilderConfig");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`dashboard_meal_builder_hydrated_${Date.now()}`);
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
    MenuCategory.create({ key: "custom_order", name: { en: "Custom Order", ar: "Custom Order" }, publishedAt: now }),
    MenuCategory.create({ key: "cold_sandwiches", name: { en: "Sandwiches", ar: "Sandwiches" }, publishedAt: now }),
  ]);
  const [proteinsGroup, carbsGroup] = await Promise.all([
    MenuOptionGroup.create({ key: "proteins", name: { en: "Proteins", ar: "Proteins" }, publishedAt: now }),
    MenuOptionGroup.create({ key: "carbs", name: { en: "Carbs", ar: "Carbs" }, publishedAt: now }),
  ]);
  const [basicMeal, premiumLargeSalad, sandwich] = await Promise.all([
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
      categoryId: customCategory._id,
      key: "premium_large_salad",
      itemType: "premium_large_salad",
      isCustomizable: true,
      name: { en: "Premium Large Salad", ar: "Premium Large Salad" },
      pricingModel: "fixed",
      priceHalala: 2900,
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

  const proteinRows = [
    { key: "chicken", family: "chicken" },
    { key: "asian_chicken", family: "chicken", disabledRelation: true },
    { key: "chicken_fajita", family: "chicken", disabledRelation: true },
    { key: "chicken_strips", family: "chicken", disabledRelation: true },
    { key: "chicken_tikka", family: "chicken", disabledRelation: true },
    { key: "grilled_chicken", family: "chicken", disabledRelation: true },
    { key: "italian_spiced_chicken", family: "chicken", disabledRelation: true },
    { key: "mexican_chicken", family: "chicken", disabledRelation: true },
    { key: "spicy_chicken", family: "chicken", disabledRelation: true },
    { key: "beef", family: "beef" },
    { key: "beef_stroganoff", family: "beef", disabledRelation: true },
    { key: "meatballs", family: "beef", disabledRelation: true },
    { key: "fish", family: "fish" },
    { key: "fish_fillet", family: "fish", disabledRelation: true },
    { key: "tuna", family: "fish", disabledRelation: true },
    { key: "eggs", family: "eggs" },
    { key: "boiled_eggs", family: "eggs", disabledRelation: true },
    { key: "beef_steak", family: "beef", premium: true, price: 3000 },
    { key: "shrimp", family: "fish", premium: true, price: 3000 },
    { key: "salmon", family: "fish", premium: true, price: 3000 },
  ];
  const proteins = await Promise.all(proteinRows.map((row, index) => MenuOption.create({
    groupId: proteinsGroup._id,
    key: row.key,
    premiumKey: row.premium ? row.key : "",
    name: { en: row.key, ar: row.key },
    proteinFamilyKey: row.family,
    displayCategoryKey: row.premium ? "premium" : row.family,
    extraPriceHalala: row.price || 0,
    availableFor: ["subscription"],
    availableForSubscription: true,
    sortOrder: index + 1,
    publishedAt: now,
  })));
  const carbs = await Promise.all(["white_rice", "sweet_potato"].map((key, index) => MenuOption.create({
    groupId: carbsGroup._id,
    key,
    name: { en: key, ar: key },
    availableFor: ["subscription"],
    availableForSubscription: true,
    sortOrder: index + 1,
    publishedAt: now,
  })));

  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: carbsGroup._id, minSelections: 1, maxSelections: 2, isRequired: true, sortOrder: 2 });
  for (const option of proteins) {
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: option._id,
      extraPriceHalala: option.extraPriceHalala || 0,
      isActive: proteinRows.find((row) => row.key === option.key)?.disabledRelation ? false : true,
      isVisible: proteinRows.find((row) => row.key === option.key)?.disabledRelation ? false : true,
      isAvailable: proteinRows.find((row) => row.key === option.key)?.disabledRelation ? false : true,
      sortOrder: option.sortOrder,
    });
  }
  for (const option of carbs) {
    await ProductGroupOption.create({ productId: basicMeal._id, groupId: carbsGroup._id, optionId: option._id, sortOrder: option.sortOrder });
  }
  await ProductOptionGroup.create({ productId: premiumLargeSalad._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductGroupOption.create({
    productId: premiumLargeSalad._id,
    groupId: proteinsGroup._id,
    optionId: proteins.find((option) => option.key === "grilled_chicken")._id,
    sortOrder: 1,
  });

  return {
    basicMeal,
    premiumLargeSalad,
    proteinsGroup,
    carbsGroup,
    sandwichCategory,
    chicken: proteins.find((option) => option.key === "chicken"),
    sandwich,
  };
}

async function main() {
  await connect();
  try {
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "meal-builder-hydrated");

    let res = await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers);
    expectStatus(res, 200, "hydrated draft without draft");
    assert.strictEqual(res.body.data.draft, null);
    assert.strictEqual(res.body.data.ready, false);
    assert.strictEqual(res.body.data.errors[0].code, "MEAL_BUILDER_DRAFT_MISSING");

    const fixture = await seedCatalog();

    const legacySections = [
      {
        sectionType: "option_group",
        productContextId: String(fixture.basicMeal._id),
        sourceGroupId: String(fixture.proteinsGroup._id),
        selectedOptionIds: [String(fixture.chicken._id)],
        selectionType: "standard_meal",
        titleOverride: { en: "Standard Proteins", ar: "Standard Proteins" },
        sortOrder: 1,
      },
      {
        sectionType: "option_group",
        productContextId: String(fixture.basicMeal._id),
        sourceGroupId: String(fixture.carbsGroup._id),
        selectionType: "standard_meal",
        titleOverride: { en: "Carbs", ar: "Carbs" },
        sortOrder: 2,
      },
      {
        sectionType: "option_group",
        productContextId: String(fixture.basicMeal._id),
        sourceGroupId: String(fixture.proteinsGroup._id),
        selectionType: "premium_meal",
        titleOverride: { en: "Premium Proteins", ar: "Premium Proteins" },
        sortOrder: 3,
      },
      {
        sectionType: "product_category",
        sourceCategoryId: String(fixture.sandwichCategory._id),
        selectedProductIds: [String(fixture.sandwich._id)],
        selectionType: "sandwich",
        titleOverride: { en: "Sandwiches", ar: "Sandwiches" },
        sortOrder: 4,
      },
      {
        sectionType: "product_list",
        selectedProductIds: [String(fixture.premiumLargeSalad._id)],
        selectionType: "premium_large_salad",
        titleOverride: { en: "Premium Large Salad", ar: "Premium Large Salad" },
        sortOrder: 5,
      },
    ];

    res = await api.post("/api/dashboard/meal-builder/validate").set(headers).send({ sections: legacySections });
    expectStatus(res, 200, "validate legacy five-section draft");
    assert.strictEqual(res.body.data.ready, false);
    assert(res.body.data.errors.some((error) => error.code === "MEAL_BUILDER_LEGACY_VISUAL_TEMPLATE"), JSON.stringify(res.body.data.errors));

    await MealBuilderConfig.create({
      status: "draft",
      isCurrent: true,
      contractVersion: "subscription_meal_builder.v1",
      source: "dashboard",
      sections: legacySections,
    });

    res = await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers);
    expectStatus(res, 200, "hydrate legacy five-section draft");
    assert.deepStrictEqual(res.body.data.sections.map((section) => section.key), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
    assert(res.body.data.warnings.some((warning) => warning.code === "MEAL_BUILDER_LEGACY_DRAFT_MIGRATED"), JSON.stringify(res.body.data.warnings));
    assert.strictEqual(res.body.data.validation.summary.migratedFromLegacyTemplate, true);

    res = await api.post("/api/dashboard/meal-builder/draft").set(headers).send({});
    expectStatus(res, 201, "create default draft");
    const sections = res.body.data.sections;

    res = await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers);
    expectStatus(res, 200, "hydrate default draft");
    assert.strictEqual(res.body.data.sections.length, 7);
    const chicken = res.body.data.sections.find((section) => section.key === "chicken");
    assert.strictEqual(chicken.type, "option_family");
    assert.strictEqual(chicken.source.kind, "option_family");
    assert.strictEqual(chicken.source.displayCategoryKey, "chicken");
    const chickenItem = chicken.selectedOptions.find((item) => item.key === "chicken");
    assert(chickenItem.selected, "chicken option selected");
    assert(chickenItem.eligible, JSON.stringify(chickenItem));
    assert(chickenItem.linked, "chicken option linked");
    assert(chickenItem.available, "chicken option available");
    const expectedFamilies = {
      chicken: ["chicken", "asian_chicken", "chicken_fajita", "chicken_strips", "chicken_tikka", "grilled_chicken", "italian_spiced_chicken", "mexican_chicken", "spicy_chicken"],
      beef: ["beef", "beef_stroganoff", "meatballs"],
      fish: ["fish", "fish_fillet", "tuna"],
      eggs: ["eggs", "boiled_eggs"],
    };
    for (const [sectionKey, expectedKeys] of Object.entries(expectedFamilies)) {
      const section = res.body.data.sections.find((item) => item.key === sectionKey);
      const actualKeys = section.items.map((item) => item.key);
      assert.deepStrictEqual(actualKeys, expectedKeys, `${sectionKey} hydrated variants`);
      for (const item of section.items) {
        assert.strictEqual(item.selected, true, `${item.key} selected`);
        assert.strictEqual(item.eligible, true, JSON.stringify(item));
        assert.strictEqual(item.state, "selected", `${item.key} state`);
      }
    }
    const fajitaItem = chicken.items.find((item) => item.key === "chicken_fajita");
    assert.strictEqual(fajitaItem.relationExists, true, JSON.stringify(fajitaItem));
    assert.strictEqual(fajitaItem.includedVia, "section_selection", JSON.stringify(fajitaItem));

    const sandwich = res.body.data.sections.find((section) => section.key === "sandwich");
    assert.strictEqual(sandwich.type, "product_list");
    assert.strictEqual(sandwich.source.kind, "product_category");
    assert.strictEqual(sandwich.selectedProducts[0].productId, String(fixture.sandwich._id));
    assert.strictEqual(sandwich.selectedProducts[0].type, "product");

    const premium = res.body.data.sections.find((section) => section.key === "premium");
    assert(premium.items.some((item) => item.key === "beef_steak"), "premium hydrates beef_steak");
    assert(premium.items.some((item) => item.key === "shrimp"), "premium hydrates shrimp");
    assert(premium.items.some((item) => item.key === "salmon"), "premium hydrates salmon");
    assert(premium.items.some((item) => item.key === "premium_large_salad"), "premium hydrates salad");
    assert.strictEqual(premium.items.find((item) => item.key === "premium_large_salad").selectionType, "premium_large_salad");

    const carbs = res.body.data.sections.find((section) => section.key === "carbs");
    assert.strictEqual(carbs.type, "option_group");
    assert.strictEqual(carbs.source.groupKey, "carbs");
    assert.strictEqual(carbs.rules.maxTypes, 2);
    assert.strictEqual(carbs.rules.maxTotalGrams, 300);

    const missingId = new mongoose.Types.ObjectId().toString();
    const updatedSections = sections.map((section) => section.key === "chicken"
      ? { ...section, selectedOptionIds: [...section.selectedOptionIds, missingId] }
      : section);
    res = await api.put("/api/dashboard/meal-builder/draft").set(headers).send({ sections: updatedSections });
    expectStatus(res, 200, "save draft with missing selected option");

    await MenuOption.updateOne({ _id: fixture.chicken._id }, { $set: { isActive: false } });
    res = await api.get("/api/dashboard/meal-builder/draft/hydrated").set(headers);
    expectStatus(res, 200, "hydrate invalid selected items");
    const invalidChicken = res.body.data.sections.find((section) => section.key === "chicken");
    const missing = invalidChicken.selectedOptions.find((item) => item.type === "missing_option");
    assert(missing, "missing option placeholder returned");
    assert(missing.reasonCodes.includes("MISSING_OPTION"), JSON.stringify(missing));
    const inactive = invalidChicken.selectedOptions.find((item) => item.optionId === String(fixture.chicken._id));
    assert(inactive.reasonCodes.includes("OPTION_INACTIVE"), JSON.stringify(inactive));

    console.log("dashboard meal builder hydrated draft checks passed");
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
