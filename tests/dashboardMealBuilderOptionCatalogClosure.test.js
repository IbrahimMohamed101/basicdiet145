process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-jwt-key-0000000000000000";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-key-000000000";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const {
  classifyMealProduct,
} = require("../src/services/catalog/mealProductClassificationService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`meal_builder_option_catalog_${Date.now()}`);
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
      key: "closure_catalog",
      name: { ar: "اختبار", en: "Closure" },
      publishedAt: now,
    });
    const [proteins, carbs] = await MenuOptionGroup.insertMany([
      { key: "proteins", name: { en: "Proteins" }, publishedAt: now, sortOrder: 1 },
      { key: "carbs", name: { en: "Carbs" }, publishedAt: now, sortOrder: 2 },
    ]);
    const products = await MenuProduct.insertMany([
      {
        categoryId: category._id,
        key: "closure_basic",
        name: { en: "Basic" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1800,
        availableFor: ["subscription"],
        isCustomizable: true,
        ui: { cardVariant: "hero_builder" },
        publishedAt: now,
      },
      {
        categoryId: category._id,
        key: "closure_ready",
        name: { en: "Ready" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1900,
        availableFor: ["subscription"],
        ui: { cardVariant: "ready_meal" },
        publishedAt: now,
      },
      {
        categoryId: category._id,
        key: "closure_sandwich",
        name: { en: "Sandwich" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1500,
        availableFor: ["subscription"],
        ui: { cardVariant: "sandwich_card" },
        publishedAt: now,
      },
      {
        categoryId: category._id,
        key: "closure_full",
        name: { en: "Full" },
        itemType: "full_meal_product",
        pricingModel: "fixed",
        priceHalala: 2000,
        availableFor: ["subscription"],
        publishedAt: now,
      },
      {
        categoryId: category._id,
        key: "closure_addon",
        name: { en: "Addon" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 400,
        availableFor: ["subscription"],
        ui: { cardVariant: "addon_card" },
        publishedAt: now,
      },
      {
        categoryId: category._id,
        key: "closure_inactive_ready",
        name: { en: "Inactive" },
        itemType: "product",
        pricingModel: "fixed",
        priceHalala: 1700,
        availableFor: ["subscription"],
        ui: { cardVariant: "ready_meal" },
        isActive: false,
        isVisible: false,
        isAvailable: false,
        publishedAt: null,
      },
    ]);
    const [basic, ready, sandwich, full, addon] = products;

    const app = createApp();
    const auth = await dashboardAuth("admin", "option-catalog-closure");
    const createOption = await request(app)
      .post("/api/dashboard/menu/options")
      .set(auth.headers)
      .send({
        groupId: String(proteins._id),
        key: "closure_chicken",
        name: { en: "Chicken" },
        availableFor: ["subscription"],
        selectionType: "standard_meal",
        proteinFamilyKey: "chicken",
        displayCategoryKey: "chicken",
        ruleTags: ["primary_protein", "primary_protein"],
        nutrition: { calories: 165, proteinGrams: 31, carbGrams: 0, fatGrams: 3.6 },
        availableForSubscription: true,
      });
    expectStatus(createOption, 201, "create option metadata");
    const proteinOptionId = String(createOption.body.data.id || createOption.body.data._id);
    assert.strictEqual(createOption.body.data.selectionType, "standard_meal");
    assert.deepStrictEqual(createOption.body.data.ruleTags, ["primary_protein"]);

    const updateOption = await request(app)
      .patch(`/api/dashboard/menu/options/${proteinOptionId}`)
      .set(auth.headers)
      .send({
        selectionType: "premium_meal",
        premiumKey: "closure_premium_chicken",
        ruleTags: ["premium", "meal_planner"],
        nutrition: { calories: 170 },
      });
    expectStatus(updateOption, 200, "update option metadata");
    assert.strictEqual(updateOption.body.data.selectionType, "premium_meal");
    assert.strictEqual(updateOption.body.data.nutrition.proteinGrams, 31);
    assert.strictEqual(updateOption.body.data.nutrition.calories, 170);

    const proteinOption = await MenuOption.findById(proteinOptionId).lean();
    const carbOption = await MenuOption.create({
      groupId: carbs._id,
      key: "closure_rice",
      name: { en: "Rice" },
      availableFor: ["subscription"],
      selectionType: "standard_meal",
      publishedAt: now,
    });
    await ProductOptionGroup.insertMany([
      { productId: basic._id, groupId: proteins._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 },
      { productId: basic._id, groupId: carbs._id, minSelections: 1, maxSelections: 2, isRequired: true, sortOrder: 2 },
    ]);
    await ProductGroupOption.insertMany([
      { productId: basic._id, groupId: proteins._id, optionId: proteinOption._id, sortOrder: 1 },
      { productId: basic._id, groupId: carbs._id, optionId: carbOption._id, sortOrder: 1 },
    ]);

    const response = await request(app)
      .get("/api/dashboard/meal-builder/catalog?lang=en")
      .set(auth.headers);
    expectStatus(response, 200, "complete catalog");
    const catalog = response.body.data;
    assert.strictEqual(catalog.products.length, 6);
    assert.strictEqual(catalog.optionGroups.length, 2);
    assert.strictEqual(catalog.options.length, 2);
    assert.strictEqual(catalog.relations.productOptionGroups.length, 2);
    assert.strictEqual(catalog.relations.productGroupOptions.length, 2);

    const topOption = catalog.options.find((option) => option.key === "closure_chicken");
    assert.strictEqual(topOption.selectionType, "premium_meal");
    assert.strictEqual(topOption.premiumKey, "closure_premium_chicken");

    const basicPayload = catalog.products.find((product) => product.key === "closure_basic");
    assert.strictEqual(basicPayload.mealPlanner.composedMeal.eligible, true);
    assert.strictEqual(basicPayload.optionGroups.length, 2);
    const nested = basicPayload.optionGroups
      .flatMap((group) => group.options || [])
      .map((entry) => entry.option || entry)
      .find((option) => option.key === "closure_chicken");
    assert.strictEqual(nested.selectionType, "premium_meal");

    const readyPayload = catalog.products.find((product) => product.key === "closure_ready");
    assert.strictEqual(readyPayload.mealPlanner.directAdd.selectionType, "full_meal_product");
    assert.strictEqual(readyPayload.mealPlanner.directAdd.eligible, true);
    const sandwichPayload = catalog.products.find((product) => product.key === "closure_sandwich");
    assert.strictEqual(
      sandwichPayload.mealPlanner.directAdd.selectionType,
      "full_meal_product"
    );
    const fullPayload = catalog.products.find((product) => product.key === "closure_full");
    assert.strictEqual(fullPayload.mealPlanner.directAdd.selectionType, "full_meal_product");
    const addonPayload = catalog.products.find((product) => product.key === "closure_addon");
    assert.strictEqual(addonPayload.mealPlanner.directAdd.eligible, false);
    assert.ok(addonPayload.mealPlanner.reasonCodes.includes("NON_MEAL_CARD_VARIANT"));
    const inactivePayload = catalog.products.find((product) => product.key === "closure_inactive_ready");
    assert.ok(inactivePayload);
    assert.strictEqual(inactivePayload.mealPlanner.directAdd.compatible, true);
    assert.strictEqual(inactivePayload.mealPlanner.directAdd.eligible, false);

    assert.strictEqual(classifyMealProduct(ready).directSelectionType, "full_meal_product");
    assert.strictEqual(classifyMealProduct(sandwich).directSelectionType, "sandwich");
    assert.strictEqual(classifyMealProduct(full).directSelectionType, "full_meal_product");
    assert.strictEqual(classifyMealProduct(addon).kind, "non_meal");

    console.log("dashboard Meal Builder option/catalog closure passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
