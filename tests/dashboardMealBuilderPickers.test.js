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
  const uri = mongoServer.getUri(`dashboard_meal_builder_pickers_${Date.now()}`);
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
  const options = await Promise.all([
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "grilled_chicken",
      name: { en: "Grilled Chicken", ar: "Grilled Chicken" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 1,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "chicken_curry",
      name: { en: "Chicken Curry", ar: "Chicken Curry" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 2,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "hidden_chicken",
      name: { en: "Hidden Chicken", ar: "Hidden Chicken" },
      proteinFamilyKey: "chicken",
      displayCategoryKey: "chicken",
      availableFor: ["subscription"],
      availableForSubscription: true,
      isActive: false,
      publishedAt: now,
      sortOrder: 3,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "beef",
      name: { en: "Beef", ar: "Beef" },
      proteinFamilyKey: "beef",
      displayCategoryKey: "beef",
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 4,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "beef_steak",
      premiumKey: "beef_steak",
      name: { en: "Beef Steak", ar: "Beef Steak" },
      proteinFamilyKey: "beef",
      displayCategoryKey: "premium",
      extraPriceHalala: 3000,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 5,
    }),
    MenuOption.create({
      groupId: proteinsGroup._id,
      key: "shrimp",
      premiumKey: "shrimp",
      name: { en: "Shrimp", ar: "Shrimp" },
      proteinFamilyKey: "fish",
      displayCategoryKey: "premium",
      extraPriceHalala: 3000,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 6,
    }),
    MenuOption.create({
      groupId: carbsGroup._id,
      key: "white_rice",
      name: { en: "White Rice", ar: "White Rice" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 1,
    }),
    MenuOption.create({
      groupId: carbsGroup._id,
      key: "internal_carb",
      name: { en: "Internal Carb", ar: "Internal Carb" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: now,
      sortOrder: 2,
    }),
  ]);
  const byKey = new Map(options.map((option) => [option.key, option]));

  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductOptionGroup.create({ productId: basicMeal._id, groupId: carbsGroup._id, minSelections: 1, maxSelections: 2, isRequired: true, sortOrder: 2 });
  for (const key of ["grilled_chicken", "hidden_chicken", "beef", "beef_steak", "shrimp"]) {
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: byKey.get(key)._id,
      extraPriceHalala: byKey.get(key).extraPriceHalala || 0,
      sortOrder: byKey.get(key).sortOrder,
    });
  }
  await ProductGroupOption.create({ productId: basicMeal._id, groupId: carbsGroup._id, optionId: byKey.get("white_rice")._id, sortOrder: 1 });
  await ProductOptionGroup.create({ productId: premiumLargeSalad._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductGroupOption.create({ productId: premiumLargeSalad._id, groupId: proteinsGroup._id, optionId: byKey.get("grilled_chicken")._id, sortOrder: 1 });

  return { sandwich };
}

async function main() {
  await connect();
  try {
    await seedCatalog();
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "meal-builder-pickers");

    let res = await api.get("/api/dashboard/meal-builder/pickers/chicken");
    assert.notStrictEqual(res.status, 200, "picker requires auth");

    res = await api.get("/api/dashboard/meal-builder/pickers/not-a-section").set(headers);
    expectStatus(res, 400, "invalid picker section");
    assert.strictEqual(res.body.error.code, "MEAL_BUILDER_PICKER_SECTION_INVALID");

    res = await api.get("/api/dashboard/meal-builder/pickers/chicken").set(headers);
    expectStatus(res, 200, "chicken picker");
    let keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("grilled_chicken"), "linked chicken returned");
    assert(keys.includes("chicken_curry"), "not-linked chicken returned by default");
    assert(!keys.includes("hidden_chicken"), "inactive chicken hidden by default");
    assert(!keys.includes("beef"), "beef excluded from chicken picker");
    const linked = res.body.data.candidates.find((item) => item.key === "grilled_chicken");
    assert.strictEqual(linked.state, "eligible");
    assert.strictEqual(linked.linked, true);
    const notLinked = res.body.data.candidates.find((item) => item.key === "chicken_curry");
    assert.strictEqual(notLinked.state, "not_linked");
    assert(notLinked.reasonCodes.includes("NOT_LINKED_TO_PRODUCT_GROUP"), JSON.stringify(notLinked));

    res = await api.get("/api/dashboard/meal-builder/pickers/chicken?includeUnavailable=true").set(headers);
    expectStatus(res, 200, "chicken picker with unavailable");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("hidden_chicken"), "inactive option included when requested");
    assert(res.body.data.candidates.find((item) => item.key === "hidden_chicken").reasonCodes.includes("OPTION_INACTIVE"));

    res = await api.get("/api/dashboard/meal-builder/pickers/beef").set(headers);
    expectStatus(res, 200, "beef picker");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("beef"), "beef returned");
    assert(!keys.includes("grilled_chicken"), "chicken excluded from beef picker");
    assert(!keys.includes("beef_steak"), "premium beef excluded from standard beef picker");

    res = await api.get("/api/dashboard/meal-builder/pickers/carbs").set(headers);
    expectStatus(res, 200, "carbs picker");
    assert.strictEqual(res.body.data.rules.maxTypes, 2);
    assert.strictEqual(res.body.data.rules.maxTotalGrams, 300);
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("white_rice"), "visible carb returned");
    assert(!keys.includes("internal_carb"), "non-customer carb excluded");

    res = await api.get("/api/dashboard/meal-builder/pickers/sandwich").set(headers);
    expectStatus(res, 200, "sandwich picker");
    assert.strictEqual(res.body.data.candidateType, "product");
    assert(res.body.data.candidates.some((item) => item.key === "grilled_chicken_cold_sandwich"));

    res = await api.get("/api/dashboard/meal-builder/pickers/premium").set(headers);
    expectStatus(res, 200, "premium picker");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("beef_steak"), "premium includes steak");
    assert(keys.includes("shrimp"), "premium includes shrimp");
    assert(keys.includes("salmon"), "premium includes missing salmon placeholder");
    assert(keys.includes("premium_large_salad"), "premium includes salad product");
    const missingSalmon = res.body.data.candidates.find((item) => item.key === "salmon");
    assert.strictEqual(missingSalmon.type, "missing_option");
    assert(missingSalmon.reasonCodes.includes("PREMIUM_REQUIRED_KEY"), JSON.stringify(missingSalmon));

    console.log("dashboard meal builder picker checks passed");
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
