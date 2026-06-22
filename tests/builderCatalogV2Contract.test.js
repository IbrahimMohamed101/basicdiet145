process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.ALLOW_CATALOG_RESET = "true";
process.env.BOOTSTRAP_SYNC = "true";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const { seedCatalog } = require("../scripts/bootstrap/seed-catalog");

const TEST_DB_NAME = `builder_catalog_v2_contract_${Date.now()}`;

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: TEST_DB_NAME },
  });
  const uri = mongoServer.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

function assertObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function assertString(value, label) {
  assert.strictEqual(typeof value, "string", `${label} must be a string`);
  assert(value.trim(), `${label} must not be empty`);
}

function assertHalala(value, label) {
  assert.strictEqual(typeof value, "number", `${label} must be a number`);
  assert(Number.isInteger(value), `${label} must be integer halala`);
  assert(value >= 0, `${label} must be non-negative`);
}

function assertSelectionLimit(value, label) {
  assert(
    value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0),
    `${label} must be null or a non-negative integer`
  );
}

function sectionByKey(catalog, key) {
  return (catalog.sections || []).find((section) => section.key === key || section.selectionType === key);
}

function firstProduct(section, label) {
  assertArray(section.products, `${label}.products`);
  assert(section.products.length > 0, `${label}.products must not be empty`);
  return section.products[0];
}

function groupByKey(product, key) {
  return (product.optionGroups || []).find((group) => group.key === key || group.sourceKey === key);
}

function allV2Groups(catalog) {
  return (catalog.sections || []).flatMap((section) => (
    section.products || []
  ).flatMap((product) => product.optionGroups || []));
}

function resolvePremiumSaladPriceSource(catalog) {
  if (catalog?.premiumLargeSalad) {
    return catalog.premiumLargeSalad;
  }
  const saladSection = sectionByKey(catalog || {}, "premium_large_salad");
  const saladProduct = saladSection && firstProduct(saladSection, "premium_large_salad pricing source");
  if (saladProduct?.pricing) {
    return {
      priceHalala: saladProduct.pricing.priceHalala ?? saladProduct.pricing.basePriceHalala,
      priceSource: saladProduct.pricing.priceSource ?? saladProduct.priceSource,
    };
  }
  return saladProduct || null;
}

function assertDefaultTopLevelCompatibility(data) {
  assert.deepStrictEqual(
    Object.keys(data).sort(),
    ["addonCatalog", "builderCatalog", "builderCatalogV2", "plannerCatalog"].sort(),
    "default meal-planner-menu response exposes canonical planner catalog plus compatibility fields"
  );
  assertObject(data.builderCatalog, "data.builderCatalog");
  assertObject(data.addonCatalog, "data.addonCatalog");
  assertObject(data.builderCatalogV2, "data.builderCatalogV2");
  assertObject(data.plannerCatalog, "data.plannerCatalog");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "regularMeals"), false, "regularMeals is includeLegacy-only");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "premiumMeals"), false, "premiumMeals is includeLegacy-only");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(data, "addons"), false, "addons is includeLegacy-only");
}

function assertIncludeLegacyCompatibility(data) {
  for (const key of ["builderCatalog", "addonCatalog", "builderCatalogV2", "currency", "regularMeals", "premiumMeals", "addons"]) {
    assert(Object.prototype.hasOwnProperty.call(data, key), `includeLegacy response keeps ${key}`);
  }
  assert.strictEqual(data.currency, "SAR", "legacy currency remains SAR");
  assertObject(data.regularMeals, "legacy regularMeals");
  assertObject(data.premiumMeals, "legacy premiumMeals");
  assertObject(data.addons, "legacy addons");
  assertArray(data.regularMeals.items, "legacy regularMeals.items");
  assertArray(data.premiumMeals.items, "legacy premiumMeals.items");
  assertArray(data.addons.items, "legacy addons.items");
}

function assertBuilderCatalogV2(catalog, compatibilityCatalog) {
  assert.strictEqual(catalog.catalogVersion, "meal_planner_menu.v2", "catalogVersion is stable");
  assert.strictEqual(catalog.currency, "SAR", "catalog currency is stable");
  assertArray(catalog.sections, "builderCatalogV2.sections");
  assertObject(catalog.rules, "builderCatalogV2.rules");
  assertObject(catalog.rules.beef, "builderCatalogV2.rules.beef");
  assertObject(catalog.rules.standardCarbs, "builderCatalogV2.rules.standardCarbs");
  assertObject(catalog.rules.premiumCarbs, "builderCatalogV2.rules.premiumCarbs");
  assertObject(catalog.rules.premiumLargeSalad, "builderCatalogV2.rules.premiumLargeSalad");

  const expectedSections = ["standard_meal", "premium_meal", "sandwich", "premium_large_salad"];
  for (const key of expectedSections) {
    assert(sectionByKey(catalog, key), `builderCatalogV2 includes ${key} section`);
  }

  for (const group of allV2Groups(catalog)) {
    assertSelectionLimit(group.maxSelections, `${group.key}.maxSelections`);
    assertObject(group.ui, `${group.key}.ui`);
    assertString(group.ui.displayStyle, `${group.key}.ui.displayStyle`);
  }

  const standardSection = sectionByKey(catalog, "standard_meal");
  const standardProduct = firstProduct(standardSection, "standard_meal");
  assert.strictEqual(standardProduct.id, "virtual:standard_meal", "standard meal product remains virtual");
  assert.strictEqual(standardProduct.type, "virtual_builder_product", "standard meal product type remains stable");
  assert.strictEqual(standardProduct.isVirtual, true, "standard meal product is virtual");
  assert.strictEqual(standardProduct.selectionType, "standard_meal", "standard meal selectionType");
  assertArray(standardProduct.optionGroups, "standard_meal.optionGroups");

  const standardProteinGroup = groupByKey(standardProduct, "protein");
  const standardCarbGroup = groupByKey(standardProduct, "carb");
  assertObject(standardProteinGroup, "standard protein group");
  assertObject(standardCarbGroup, "standard carb group");
  assert.strictEqual(standardProteinGroup.sourceKey, "proteins", "standard protein sourceKey");
  assert.strictEqual(standardProteinGroup.minSelections, 1, "standard protein min");
  assert.strictEqual(standardProteinGroup.maxSelections, 1, "standard protein max");
  assert.strictEqual(standardProteinGroup.isRequired, true, "standard protein required");
  assertArray(standardProteinGroup.options, "standard protein options");
  assertArray(standardProteinGroup.optionSections, "standard protein optionSections");
  assert(standardProteinGroup.optionSections.length > 0, "standard protein optionSections is populated");
  assert(
    standardProteinGroup.optionSections.some((section) => section.key === "chicken"),
    "standard protein optionSections includes a chicken section"
  );
  assert.strictEqual(standardCarbGroup.sourceKey, "carbs", "standard carb sourceKey");
  assert.strictEqual(standardCarbGroup.rules.maxTypes, catalog.rules.standardCarbs.maxTypes, "standard carb maxTypes follows rules");
  assert.strictEqual(standardCarbGroup.rules.maxTotalGrams, catalog.rules.standardCarbs.maxTotalGrams, "standard carb grams follows rules");
  assertArray(standardCarbGroup.options, "standard carb options");

  const premiumSection = sectionByKey(catalog, "premium_meal");
  const premiumProduct = firstProduct(premiumSection, "premium_meal");
  assert.strictEqual(premiumProduct.id, "virtual:premium_meal", "premium meal product remains virtual");
  assert.strictEqual(premiumProduct.type, "virtual_builder_product", "premium meal product type remains stable");
  assert.strictEqual(premiumProduct.selectionType, "premium_meal", "premium meal selectionType");
  const premiumProteinGroup = groupByKey(premiumProduct, "protein");
  assertObject(premiumProteinGroup, "premium protein group");
  const steak = (premiumProteinGroup.options || []).find((option) => option.premiumKey === "beef_steak");
  assertObject(steak, "premium beef steak option");
  assert.strictEqual(steak.selectionType, "premium_meal", "premium steak selectionType");
  assert.strictEqual(steak.isPremium, true, "premium steak isPremium");
  assertHalala(steak.extraFeeHalala, "premium steak extraFeeHalala");

  const sandwichSection = sectionByKey(catalog, "sandwich");
  const grilledChickenSandwich = (sandwichSection.products || []).find((product) => product.key === "grilled_chicken_cold_sandwich");
  assertObject(grilledChickenSandwich, "grilled chicken sandwich product");
  assert.strictEqual(grilledChickenSandwich.selectionType, "sandwich", "sandwich selectionType");
  assert.strictEqual(grilledChickenSandwich.pricingModel, "fixed", "sandwich pricingModel");
  assertHalala(grilledChickenSandwich.priceHalala, "sandwich priceHalala");
  assert.strictEqual(grilledChickenSandwich.currency, "SAR", "sandwich currency");
  assertObject(grilledChickenSandwich.ui, "sandwich ui");
  assertString(grilledChickenSandwich.ui.cardVariant, "sandwich ui.cardVariant");

  const saladSection = sectionByKey(catalog, "premium_large_salad");
  const saladProduct = firstProduct(saladSection, "premium_large_salad");
  assert.strictEqual(saladProduct.selectionType, "premium_large_salad", "premium salad selectionType");
  assert.strictEqual(saladProduct.premiumKey, "premium_large_salad", "premium salad premiumKey");
  assert.strictEqual(saladProduct.presetKey, "large_salad", "premium salad presetKey");
  assertHalala(saladProduct.priceHalala, "premium salad priceHalala");
  assertHalala(saladProduct.extraFeeHalala, "premium salad extraFeeHalala");
  const saladPriceSource = resolvePremiumSaladPriceSource(compatibilityCatalog);
  assertObject(saladPriceSource, "premium salad compatibility price source");
  assert.strictEqual(saladProduct.priceHalala, saladPriceSource.priceHalala, "premium salad V2 price matches compatibility catalog");
  assert.strictEqual(saladProduct.priceSource, saladPriceSource.priceSource, "premium salad V2 priceSource matches compatibility catalog");
  assertArray(saladProduct.optionGroups, "premium salad optionGroups");
  assert.deepStrictEqual(
    saladProduct.optionGroups.map((group) => group.key).sort(),
    ["cheese_nuts", "fruits", "leafy_greens", "protein", "sauce", "vegetables"].sort(),
    "premium salad exposes canonical group keys"
  );
}

function assertPlannerCatalogV3(catalog) {
  assertObject(catalog, "plannerCatalog");
  assert.strictEqual(catalog.contractVersion, "meal_planner_menu.v3", "plannerCatalog contractVersion");
  assert.strictEqual(catalog.currency, "SAR", "plannerCatalog currency");
  assertString(catalog.catalogHash, "plannerCatalog catalogHash");
  assert(catalog.catalogHash.startsWith("sha256:"), "plannerCatalog catalogHash is sha256 tagged");
  assertArray(catalog.sections, "plannerCatalog.sections");
  assertObject(catalog.rules, "plannerCatalog.rules");
  assert.strictEqual(catalog.rules.version, "meal_planner_rules.v4", "plannerCatalog rules version");

  const standardSection = sectionByKey(catalog, "standard_meal");
  assertObject(standardSection, "plannerCatalog standard section");
  assert.strictEqual(standardSection.type, "configurable_product", "plannerCatalog standard type");
  const standardProduct = firstProduct(standardSection, "plannerCatalog standard");
  assert.strictEqual(standardProduct.key, "basic_meal", "plannerCatalog standard uses MenuProduct basic_meal");
  assert.strictEqual(standardProduct.selectionType, "standard_meal", "plannerCatalog standard selectionType");
  assertObject(standardProduct.pricing, "plannerCatalog standard pricing");
  assert.strictEqual(standardProduct.pricing.model, "per_100g", "plannerCatalog standard pricing model");
  assertHalala(standardProduct.pricing.basePriceHalala, "plannerCatalog standard basePriceHalala");
  assertArray(standardProduct.optionGroups, "plannerCatalog standard optionGroups");

  const standardProteinGroup = groupByKey(standardProduct, "proteins");
  const standardCarbGroup = groupByKey(standardProduct, "carbs");
  assertObject(standardProteinGroup, "plannerCatalog standard proteins group");
  assertObject(standardCarbGroup, "plannerCatalog standard carbs group");
  assert.strictEqual(standardProteinGroup.minSelections, 1, "plannerCatalog protein min follows relation");
  assert.strictEqual(standardProteinGroup.maxSelections, 1, "plannerCatalog protein max follows relation");
  assertArray(standardProteinGroup.options, "plannerCatalog protein options");
  assert(standardProteinGroup.options.length > 0, "plannerCatalog protein options populated");
  assertObject(standardProteinGroup.options[0].nutrition, "plannerCatalog option nutrition");
  assertHalala(standardProteinGroup.options[0].extraPriceHalala, "plannerCatalog option relation extra price");
  assertArray(standardProteinGroup.optionSections, "plannerCatalog protein optionSections");

  const premiumSection = sectionByKey(catalog, "premium_meal");
  assertObject(premiumSection, "plannerCatalog premium section");
  const premiumProduct = firstProduct(premiumSection, "plannerCatalog premium");
  assert.strictEqual(premiumProduct.key, "basic_meal", "plannerCatalog premium uses same product shell");
  assert.strictEqual(premiumProduct.selectionType, "premium_meal", "plannerCatalog premium selectionType");
  const premiumProteinGroup = groupByKey(premiumProduct, "proteins");
  assertObject(premiumProteinGroup, "plannerCatalog premium proteins group");
  assertArray(premiumProteinGroup.options, "plannerCatalog premium relation proteins");
  assert(premiumProteinGroup.options.some((option) => option.isPremium === true), "plannerCatalog premium proteins are relation-driven");

  const sandwichSection = sectionByKey(catalog, "sandwich");
  assertObject(sandwichSection, "plannerCatalog sandwich section");
  assert.strictEqual(sandwichSection.type, "product_list", "plannerCatalog sandwich type");
  const sandwich = (sandwichSection.products || []).find((product) => product.key === "grilled_chicken_cold_sandwich");
  assertObject(sandwich, "plannerCatalog grilled chicken sandwich");
  assert.strictEqual(sandwich.action.type, "direct_add", "plannerCatalog sandwich action");

  const saladSection = sectionByKey(catalog, "premium_large_salad");
  assertObject(saladSection, "plannerCatalog premium salad section");
  const saladProduct = firstProduct(saladSection, "plannerCatalog premium salad");
  assert.strictEqual(saladProduct.selectionType, "premium_large_salad", "plannerCatalog premium salad selectionType");
  assertObject(saladProduct.pricing, "plannerCatalog premium salad pricing");
  assertArray(saladProduct.optionGroups, "plannerCatalog premium salad optionGroups");
  assert(
    saladProduct.optionGroups.some((group) => (
      (group.key === "vegetables_legumes" && group.canonicalGroupKey === "vegetables")
      || group.key === "vegetables"
    )),
    "plannerCatalog exposes the canonical vegetables salad group"
  );
  assert(
    !saladProduct.optionGroups.some((group) => group.key === "extra_protein_50g"),
    "plannerCatalog omits premium salad extra protein group"
  );
}

async function enrichContractFixtureMetadata() {
  const proteinsGroup = await MenuOptionGroup.findOne({ key: "proteins" }).lean();
  assertObject(proteinsGroup, "proteins fixture group");

  await MenuOption.updateOne(
    { groupId: proteinsGroup._id, "name.en": "Grilled Chicken" },
    {
      $set: {
        key: "grilled_chicken",
        displayCategoryKey: "chicken",
        proteinFamilyKey: "chicken",
        premiumKey: "grilled_chicken",
        selectionType: "standard_meal",
        extraPriceHalala: 0,
        extraFeeHalala: 0,
      },
    }
  );
  await MenuOption.updateOne(
    { groupId: proteinsGroup._id, "name.en": "Steak" },
    {
      $set: {
        key: "beef_steak",
        displayCategoryKey: "premium",
        proteinFamilyKey: "beef",
        premiumKey: "beef_steak",
        selectionType: "premium_meal",
        extraPriceHalala: 2000,
        extraFeeHalala: 2000,
      },
    }
  );
  await MenuOption.updateOne(
    { groupId: proteinsGroup._id, "name.en": "Shrimp" },
    {
      $set: {
        key: "shrimp",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        premiumKey: "shrimp",
        selectionType: "premium_meal",
        extraPriceHalala: 2000,
        extraFeeHalala: 2000,
      },
    }
  );
  await MenuOption.updateOne(
    { groupId: proteinsGroup._id, "name.en": "Salmon" },
    {
      $set: {
        key: "salmon",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        premiumKey: "salmon",
        selectionType: "premium_meal",
        extraPriceHalala: 2000,
        extraFeeHalala: 2000,
      },
    }
  );
}

async function run() {
  await connect();
  try {
    await seedCatalog({ reset: true, sync: true });
    await enrichContractFixtureMetadata();

    const app = createApp();
    const api = request(app);

    let res = await api.get("/api/subscriptions/meal-planner-menu?lang=en");
    assert.strictEqual(res.status, 200, `default catalog status: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.status, true, "default response status");
    assertObject(res.body.data, "default response data");
    assertDefaultTopLevelCompatibility(res.body.data);
    assertBuilderCatalogV2(res.body.data.builderCatalogV2, res.body.data.plannerCatalog || res.body.data.builderCatalog);

    res = await api.get("/api/subscriptions/meal-planner-menu?contractVersion=v3&lang=en");
    assert.strictEqual(res.status, 200, `v3 catalog status: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.status, true, "v3 response status");
    assertObject(res.body.data, "v3 response data");
    assertObject(res.body.data.builderCatalog, "v3 response keeps builderCatalog compatibility");
    assertObject(res.body.data.builderCatalogV2, "v3 response keeps builderCatalogV2 compatibility");
    assertPlannerCatalogV3(res.body.data.plannerCatalog);

    res = await api.get("/api/subscriptions/meal-planner-menu?includeLegacy=true&lang=en");
    assert.strictEqual(res.status, 200, `includeLegacy catalog status: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.status, true, "includeLegacy response status");
    assertObject(res.body.data, "includeLegacy response data");
    assertIncludeLegacyCompatibility(res.body.data);
    assertBuilderCatalogV2(res.body.data.builderCatalogV2, res.body.data.legacyBuilderCatalog || res.body.data.plannerCatalog || res.body.data.builderCatalog);

    console.log("builderCatalogV2 contract checks passed");
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
