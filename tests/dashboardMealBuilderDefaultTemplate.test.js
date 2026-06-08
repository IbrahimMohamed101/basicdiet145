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
  const uri = mongoServer.getUri(`dashboard_meal_builder_default_${Date.now()}`);
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
    { key: "grilled_chicken", family: "chicken" },
    { key: "beef", family: "beef" },
    { key: "meatballs", family: "beef" },
    { key: "fish", family: "fish" },
    { key: "tuna", family: "fish" },
    { key: "eggs", family: "eggs" },
    { key: "boiled_eggs", family: "eggs" },
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
  const carbs = await Promise.all([
    "white_rice",
    "turmeric_rice",
    "alfredo_pasta",
    "red_sauce_pasta",
    "roasted_potato",
    "sweet_potato",
    "grilled_mixed_vegetables",
  ].map((key, index) => MenuOption.create({
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

  return { premiumLargeSalad, sandwich };
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function main() {
  await connect();
  try {
    const fixture = await seedCatalog();
    const app = createApp();
    const api = request(app);
    const { headers } = await dashboardAuth("admin", "meal-builder-default-template");

    let res = await api.post("/api/dashboard/meal-builder/draft").set(headers).send({});
    expectStatus(res, 201, "create default visual draft");
    assert.deepStrictEqual(res.body.data.sections.map((section) => section.key), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
    assert.deepStrictEqual(res.body.data.sections.map((section) => section.sortOrder), [10, 20, 30, 40, 50, 60, 70]);
    assert.deepStrictEqual(res.body.data.sections.map((section) => section.type), ["mixed", "product_list", "option_family", "option_family", "option_family", "option_family", "option_group"]);
    assert.deepStrictEqual(res.body.data.sections.map((section) => section.source.kind), ["premium_mixed", "product_category", "option_family", "option_family", "option_family", "option_family", "option_group"]);
    assert.strictEqual(res.body.data.sections[2].source.groupKey, "proteins");
    assert.strictEqual(res.body.data.sections[2].source.displayCategoryKey, "chicken");
    assert.strictEqual(res.body.data.sections[1].source.categoryKey, "sandwich");
    assert.strictEqual(res.body.data.sections[0].titleOverride.en, "Premium");
    assert.strictEqual(res.body.data.sections[1].metadata.requiresBuilder, false);
    assert.strictEqual(res.body.data.sections[1].metadata.treatAsFullMeal, true);
    assert.strictEqual(res.body.data.sections[6].rules.maxTypes, 2);
    assert.strictEqual(res.body.data.sections[6].rules.maxTotalGrams, 300);
    assert.deepStrictEqual(res.body.data.sections[6].rules.onlyForSelectionTypes, ["standard_meal", "premium_meal"]);

    res = await api.post("/api/dashboard/meal-builder/publish").set(headers).send({});
    expectStatus(res, 200, "publish default visual draft");
    assert.strictEqual(res.body.data.validation.ready, true, JSON.stringify(res.body.data.validation));

    res = await api.get("/api/subscriptions/meal-builder?lang=en");
    expectStatus(res, 200, "published meal-builder read model");
    const premium = res.body.data.sections.find((section) => section.key === "premium");
    assert(premium, "premium visual section returned");
    const premiumKeys = premium.items.map((item) => item.key);
    for (const key of ["beef_steak", "shrimp", "salmon", "premium_large_salad"]) {
      assert(premiumKeys.includes(key), `premium contains ${key}`);
    }
    const sandwich = res.body.data.sections.find((section) => section.key === "sandwich");
    assert.strictEqual(sandwich.items[0].selectionType, "sandwich");
    assert.strictEqual(sandwich.items[0].action.requiresBuilder, false);
    assert.strictEqual(sandwich.items[0].action.treatAsFullMeal, true);

    res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    expectStatus(res, 200, "planner menu after builder publish");
    const planner = res.body.data.plannerCatalog;
    assert.strictEqual(planner.contractVersion, "meal_planner_menu.v3");
    assert.strictEqual(planner.rules.source, "meal_builder_config");
    assert.deepStrictEqual(planner.sections.map((section) => section.key), ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]);
    assert.deepStrictEqual(planner.sections.map((section) => section.sortOrder), [10, 20, 30, 40, 50, 60, 70]);
    const plannerPremium = planner.sections.find((section) => section.key === "premium");
    assert.strictEqual(plannerPremium.source.kind, "premium_mixed");
    assert(plannerPremium.products.some((product) => product.key === "basic_meal"), "premium planner section includes basic meal shell");
    assert(plannerPremium.products.some((product) => product.key === "premium_large_salad" && product.selectionType === "premium_large_salad"), "premium planner section includes salad product");
    const plannerSandwich = planner.sections.find((section) => section.key === "sandwich").products[0];
    assert.strictEqual(plannerSandwich.productId, String(fixture.sandwich._id));
    assert.strictEqual(plannerSandwich.action.requiresBuilder, false);
    assert.strictEqual(plannerSandwich.optionGroups.length, 0);
    const plannerCarbs = planner.sections.find((section) => section.key === "carbs");
    assert.strictEqual(plannerCarbs.products[0].optionGroups[0].maxSelections, 2);

    res = await api.get("/api/dashboard/meal-builder/readiness").set(headers);
    expectStatus(res, 200, "meal builder readiness");
    assert.strictEqual(res.body.data.ready, true, JSON.stringify(res.body.data));

    assert(fixture.premiumLargeSalad, "fixture keeps salad product referenced");
    console.log("dashboard meal builder default template checks passed");
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
