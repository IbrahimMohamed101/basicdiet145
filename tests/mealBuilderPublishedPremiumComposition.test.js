"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "published-premium-composition-test-secret";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET
  || "published-premium-composition-dashboard-test-secret";
process.env.ALLOW_CATALOG_RESET = "true";
process.env.BOOTSTRAP_SYNC = "true";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../src/app");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const { seedCatalog } = require("../scripts/bootstrap/seed-catalog");
const mealBuilderConfigService = require(
  "../src/services/subscription/mealBuilderConfigService"
);
const premiumUpgradeConfigService = require(
  "../src/services/subscription/premiumUpgradeConfigService"
);

const TEST_DB_NAME = `meal_builder_published_premium_${Date.now()}`;
let mongoServer;

function sectionByKey(catalog, key) {
  return (catalog?.sections || []).find(
    (section) => section.key === key || section.selectionType === key
  );
}

function premiumOptionsFromPlanner(catalog) {
  const section = sectionByKey(catalog, "premium_meal")
    || sectionByKey(catalog, "premium");
  return (section?.products || []).flatMap((product) => (
    product.optionGroups || []
  )).flatMap((group) => group.options || []);
}

function premiumItemsFromContract(contract) {
  const section = (contract?.sections || []).find((row) => (
    row?.sourceKind === "premium_visual"
    || row?.selectionType === "premium_meal"
    || row?.metadata?.visualRole === "premium"
  ));
  return section?.items || [];
}

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
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  mongoServer = null;
}

async function configureChickenFajitaPremium() {
  const [proteinsGroup, basicMeal, chickenFajita] = await Promise.all([
    MenuOptionGroup.findOne({ key: "proteins" }).lean(),
    MenuProduct.findOne({ key: "basic_meal" }).lean(),
    MenuOption.findOne({ key: "chicken_fajita" }),
  ]);
  assert(proteinsGroup, "proteins group must exist");
  assert(basicMeal, "basic meal must exist");
  assert(chickenFajita, "Chicken Fajita source must exist");

  chickenFajita.name = { ar: "فاهيتا", en: "Chicken Fajita" };
  chickenFajita.displayCategoryKey = "chicken";
  chickenFajita.proteinFamilyKey = "chicken";
  chickenFajita.selectionType = "standard_meal";
  chickenFajita.isPremium = false;
  chickenFajita.extraFeeHalala = 0;
  chickenFajita.extraPriceHalala = 0;
  await chickenFajita.save();

  await PremiumUpgradeConfig.create({
    sourceType: "menu_option",
    sourceId: chickenFajita._id,
    sourceProductId: basicMeal._id,
    sourceGroupId: proteinsGroup._id,
    selectionType: "premium_meal",
    premiumKey: "chicken_fajita",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 2500,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 110,
    sourceSnapshot: {
      key: "chicken_fajita",
      name: { ar: "فاهيتا", en: "Chicken Fajita" },
      context: { productKey: "basic_meal", groupKey: "proteins" },
    },
  });
}

async function run() {
  // Ensure route installers are evaluated exactly as they are in the application.
  assert.strictEqual(typeof createApp, "function");
  await connect();
  try {
    await seedCatalog({ reset: true, sync: true });
    await configureChickenFajitaPremium();

    const state = await premiumUpgradeConfigService
      .loadClientPremiumUpgradeConfigState();
    assert(
      state.isAllowed("chicken_fajita"),
      "Premium authority must allow the dashboard-created Chicken Fajita config"
    );

    const readyRows = await premiumUpgradeConfigService
      .listActiveReadyPremiumUpgradeConfigs();
    const readyChicken = readyRows.find(
      ({ config }) => config.premiumKey === "chicken_fajita"
    );
    assert(
      readyChicken,
      "active-ready Premium rows must contain Chicken Fajita"
    );

    const sections = await mealBuilderConfigService
      .buildDefaultVisualTemplateSections();
    const config = {
      status: "published",
      isCurrent: true,
      source: "dashboard",
      revisionHash: "published-premium-composition",
      publishedAt: new Date(),
      sections,
    };

    const contract = await mealBuilderConfigService.buildPublishedContract({
      config,
      lang: "ar",
    });
    const contractChicken = premiumItemsFromContract(contract).find(
      (item) => item.premiumKey === "chicken_fajita" || item.key === "chicken_fajita"
    );
    assert(
      contractChicken,
      "published contract must merge active-ready Chicken Fajita"
    );
    assert.strictEqual(contractChicken.extraFeeHalala, 2500);

    const planner = await mealBuilderConfigService
      .buildPlannerCatalogFromPublishedBuilder({ config, lang: "ar" });
    const plannerChicken = premiumOptionsFromPlanner(planner).find(
      (option) => option.premiumKey === "chicken_fajita" || option.key === "chicken_fajita"
    );
    assert(
      plannerChicken,
      "published planner catalog must contain Chicken Fajita"
    );
    assert.strictEqual(plannerChicken.nameI18n.ar, "فاهيتا");
    assert.strictEqual(plannerChicken.nameI18n.en, "Chicken Fajita");
    assert.strictEqual(plannerChicken.selectionType, "premium_meal");
    assert.strictEqual(plannerChicken.isPremium, true);
    assert.strictEqual(plannerChicken.extraFeeHalala, 2500);

    console.log("mealBuilderPublishedPremiumComposition.test.js passed");
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
