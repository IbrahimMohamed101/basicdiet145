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
  const proteinRows = [
    { key: "chicken", family: "chicken" },
    { key: "chicken_fajita", family: "chicken" },
    { key: "spicy_chicken", family: "chicken" },
    { key: "italian_spiced_chicken", family: "chicken" },
    { key: "chicken_tikka", family: "chicken" },
    { key: "asian_chicken", family: "chicken" },
    { key: "chicken_strips", family: "chicken", unpublished: true },
    { key: "grilled_chicken", family: "chicken" },
    { key: "mexican_chicken", family: "chicken" },
    { key: "hidden_chicken", family: "chicken", isActive: false },
    { key: "ranch", family: "chicken" },
    { key: "mango", family: "chicken" },
    { key: "cashew", family: "chicken" },
    { key: "tomato", family: "chicken" },
    { key: "extra_chicken_50g", family: "chicken" },
    { key: "extra_protein_50g", family: "chicken" },
    { key: "beef", family: "beef" },
    { key: "meatballs", family: "beef" },
    { key: "beef_stroganoff", family: "beef" },
    { key: "fish", family: "fish" },
    { key: "tuna", family: "fish" },
    { key: "fish_fillet", family: "fish" },
    { key: "eggs", family: "eggs" },
    { key: "boiled_eggs", family: "eggs" },
    { key: "beef_steak", family: "beef", premium: true, price: 3000 },
    { key: "shrimp", family: "fish", premium: true, price: 3000 },
  ];
  const proteinOptions = await Promise.all(proteinRows.map((row, index) => MenuOption.create({
    groupId: proteinsGroup._id,
    key: row.key,
    premiumKey: row.premium ? row.key : "",
    name: { en: row.key, ar: row.key },
    proteinFamilyKey: row.family,
    displayCategoryKey: row.premium ? "premium" : row.family,
    extraPriceHalala: row.price || 0,
    availableFor: ["subscription"],
    availableForSubscription: true,
    isActive: row.isActive === false ? false : true,
    publishedAt: row.unpublished ? null : now,
    sortOrder: index + 1,
  })));
  const options = await Promise.all([
    ...proteinOptions,
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
  for (const key of ["chicken", "grilled_chicken", "hidden_chicken", "extra_chicken_50g", "beef", "fish", "eggs", "beef_steak", "shrimp"]) {
    await ProductGroupOption.create({
      productId: basicMeal._id,
      groupId: proteinsGroup._id,
      optionId: byKey.get(key)._id,
      extraPriceHalala: byKey.get(key).extraPriceHalala || 0,
      sortOrder: byKey.get(key).sortOrder,
    });
  }
  await ProductGroupOption.create({
    productId: basicMeal._id,
    groupId: proteinsGroup._id,
    optionId: byKey.get("chicken_fajita")._id,
    isActive: false,
    isVisible: false,
    isAvailable: false,
    sortOrder: 100,
  });
  await ProductGroupOption.create({ productId: basicMeal._id, groupId: carbsGroup._id, optionId: byKey.get("white_rice")._id, sortOrder: 1 });
  await ProductOptionGroup.create({ productId: premiumLargeSalad._id, groupId: proteinsGroup._id, minSelections: 1, maxSelections: 1, isRequired: true, sortOrder: 1 });
  await ProductGroupOption.create({ productId: premiumLargeSalad._id, groupId: proteinsGroup._id, optionId: byKey.get("grilled_chicken")._id, sortOrder: 1 });

  await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    contractVersion: "subscription_meal_builder.v1",
    source: "dashboard",
    sections: [
      {
        key: "chicken",
        sectionType: "option_group",
        sourceKind: "visual_family",
        productContextId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectedOptionIds: [byKey.get("chicken")._id],
        selectionType: "standard_meal",
        titleOverride: { en: "Chicken", ar: "Chicken" },
        sortOrder: 30,
      },
      {
        key: "beef",
        sectionType: "option_group",
        sourceKind: "visual_family",
        productContextId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectedOptionIds: [byKey.get("beef")._id],
        selectionType: "standard_meal",
        titleOverride: { en: "Beef", ar: "Beef" },
        sortOrder: 40,
      },
      {
        key: "fish",
        sectionType: "option_group",
        sourceKind: "visual_family",
        productContextId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectedOptionIds: [byKey.get("fish")._id],
        selectionType: "standard_meal",
        titleOverride: { en: "Fish", ar: "Fish" },
        sortOrder: 50,
      },
      {
        key: "eggs",
        sectionType: "option_group",
        sourceKind: "visual_family",
        productContextId: basicMeal._id,
        sourceGroupId: proteinsGroup._id,
        selectedOptionIds: [byKey.get("eggs")._id],
        selectionType: "standard_meal",
        titleOverride: { en: "Eggs", ar: "Eggs" },
        sortOrder: 60,
      },
    ],
  });

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
    const expectedChickenKeys = [
      "chicken",
      "chicken_fajita",
      "spicy_chicken",
      "italian_spiced_chicken",
      "chicken_tikka",
      "asian_chicken",
      "chicken_strips",
      "grilled_chicken",
      "mexican_chicken",
    ];
    assert(res.body.data.meta.total >= 9, JSON.stringify(res.body.data.meta));
    for (const key of expectedChickenKeys) {
      assert(keys.includes(key), `chicken picker returns ${key}`);
    }
    assert.strictEqual(res.body.data.candidates.find((item) => item.key === "chicken").selected, true);
    for (const key of expectedChickenKeys.filter((item) => item !== "chicken")) {
      const candidate = res.body.data.candidates.find((item) => item.key === key);
      assert.strictEqual(candidate.selected, false, `${key} selected=false`);
      assert.strictEqual(candidate.eligible, true, `${key} eligible=true: ${JSON.stringify(candidate)}`);
      assert.strictEqual(candidate.state, "addable", `${key} state=addable: ${JSON.stringify(candidate)}`);
    }
    assert(!keys.includes("hidden_chicken"), "inactive chicken hidden by default");
    assert(!keys.includes("ranch"), "ranch excluded from chicken picker");
    assert(!keys.includes("mango"), "mango excluded from chicken picker");
    assert(!keys.includes("cashew"), "cashew excluded from chicken picker");
    assert(!keys.includes("tomato"), "tomato excluded from chicken picker");
    assert(!keys.includes("extra_chicken_50g"), "extra chicken add-on excluded from chicken picker");
    assert(!keys.includes("extra_protein_50g"), "extra protein add-on excluded from chicken picker");
    assert(!keys.includes("beef"), "beef excluded from chicken picker");
    const linked = res.body.data.candidates.find((item) => item.key === "grilled_chicken");
    assert.strictEqual(linked.state, "addable");
    assert.strictEqual(linked.linked, true);
    const addable = res.body.data.candidates.find((item) => item.key === "chicken_fajita");
    assert.strictEqual(addable.state, "addable");
    assert.strictEqual(addable.linked, false);
    assert.strictEqual(addable.relationExists, false);
    assert(addable.reasonCodes.includes("NOT_LINKED_TO_PRODUCT_GROUP"), JSON.stringify(addable));

    res = await api.get("/api/dashboard/meal-builder/pickers/chicken?includeUnavailable=true").set(headers);
    expectStatus(res, 200, "chicken picker with unavailable");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("hidden_chicken"), "inactive option included when requested");
    assert(res.body.data.candidates.find((item) => item.key === "hidden_chicken").reasonCodes.includes("OPTION_INACTIVE"));

    res = await api.get("/api/dashboard/meal-builder/pickers/chicken?include=all").set(headers);
    expectStatus(res, 200, "chicken picker include all alias");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("hidden_chicken"), "include=all includes unavailable options");

    res = await api.get("/api/dashboard/meal-builder/pickers/chicken?include=all&diagnostics=true").set(headers);
    expectStatus(res, 200, "chicken picker diagnostics");
    assert.strictEqual(res.body.data.diagnostics.runtime.marker, "meal_builder_picker_v3_option_family_catalog_discovery");
    assert.strictEqual(res.body.data.diagnostics.codePath, "option_family_catalog_discovery");
    assert(res.body.data.diagnostics.extendedFamilyKeys.includes("chicken_fajita"), JSON.stringify(res.body.data.diagnostics));

    res = await api.get("/api/dashboard/meal-builder/pickers/beef").set(headers);
    expectStatus(res, 200, "beef picker");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("beef"), "beef returned");
    assert(keys.includes("meatballs"), "meatballs returned");
    assert(keys.includes("beef_stroganoff"), "beef stroganoff returned");
    assert.strictEqual(res.body.data.candidates.find((item) => item.key === "beef").selected, true);
    for (const key of ["meatballs", "beef_stroganoff"]) {
      const candidate = res.body.data.candidates.find((item) => item.key === key);
      assert.strictEqual(candidate.selected, false, `${key} selected=false`);
      assert.strictEqual(candidate.eligible, true, `${key} eligible=true: ${JSON.stringify(candidate)}`);
      assert.strictEqual(candidate.state, "addable", `${key} state=addable: ${JSON.stringify(candidate)}`);
    }
    assert(!keys.includes("grilled_chicken"), "chicken excluded from beef picker");
    assert(!keys.includes("beef_steak"), "premium beef excluded from standard beef picker");

    res = await api.get("/api/dashboard/meal-builder/pickers/fish").set(headers);
    expectStatus(res, 200, "fish picker");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("fish"), "fish returned");
    assert(keys.includes("tuna"), "tuna returned");
    assert(keys.includes("fish_fillet"), "fish fillet returned");
    assert.strictEqual(res.body.data.candidates.find((item) => item.key === "fish").selected, true);
    for (const key of ["tuna", "fish_fillet"]) {
      const candidate = res.body.data.candidates.find((item) => item.key === key);
      assert.strictEqual(candidate.selected, false, `${key} selected=false`);
      assert.strictEqual(candidate.eligible, true, `${key} eligible=true: ${JSON.stringify(candidate)}`);
      assert.strictEqual(candidate.state, "addable", `${key} state=addable: ${JSON.stringify(candidate)}`);
    }
    assert(!keys.includes("shrimp"), "premium shrimp excluded from standard fish picker");

    res = await api.get("/api/dashboard/meal-builder/pickers/eggs").set(headers);
    expectStatus(res, 200, "eggs picker");
    keys = res.body.data.candidates.map((item) => item.key);
    assert(keys.includes("eggs"), "eggs returned");
    assert(keys.includes("boiled_eggs"), "boiled eggs returned");
    assert.strictEqual(res.body.data.candidates.find((item) => item.key === "eggs").selected, true);
    const boiledEggs = res.body.data.candidates.find((item) => item.key === "boiled_eggs");
    assert.strictEqual(boiledEggs.selected, false, `boiled_eggs selected=false`);
    assert.strictEqual(boiledEggs.eligible, true, `boiled_eggs eligible=true: ${JSON.stringify(boiledEggs)}`);
    assert.strictEqual(boiledEggs.state, "addable", `boiled_eggs state=addable: ${JSON.stringify(boiledEggs)}`);

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
    assert.strictEqual(res.body.data.candidates.find((item) => item.key === "premium_large_salad").selectionType, "premium_large_salad");
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
