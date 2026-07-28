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
const {
  pruneMembershipToPublishedSelections,
  resolveAutomaticPremiumMembershipOptions,
} = require("../src/services/installFlutterPublishedSelectionAuthority");

const TEST_DB_NAME = `meal_builder_published_premium_${Date.now()}`;
let mongoServer;

function itemId(value = {}) {
  return String(
    value.id || value.productId || value.optionId || value._id || ""
  ).trim();
}

function premiumDescriptor(config = {}) {
  return (config.sections || []).find((section) => (
    section.key === "premium"
    || section.sourceKind === "premium_visual"
    || section.metadata?.visualRole === "premium"
  ));
}

function premiumOptionsFromPlanner(catalog, descriptor) {
  const section = (catalog?.sections || []).find((row) => (
    row.key === "premium"
    || row.selectionType === "premium_meal"
    || row.source?.kind === "premium_mixed"
    || row.source?.kind === "premium_visual"
  ));
  const product = (section?.products || []).find((row) => (
    itemId(row) === String(descriptor.productContextId)
  ));
  const group = (product?.optionGroups || []).find((row) => (
    String(row.id || row.groupId || "") === String(descriptor.sourceGroupId)
  ));
  return group?.options || [];
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

  const premiumConfig = await PremiumUpgradeConfig.create({
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

  return {
    basicMealId: String(basicMeal._id),
    proteinsGroupId: String(proteinsGroup._id),
    chickenFajitaId: String(chickenFajita._id),
    premiumConfigId: String(premiumConfig._id),
  };
}

function membershipFixture({ basicMealId, proteinsGroupId, chickenFajitaId }) {
  const chickenKey = `${basicMealId}:${proteinsGroupId}:${chickenFajitaId}`;
  const unrelatedKey = `${basicMealId}:${proteinsGroupId}:507f191e810c19729de86099`;
  return {
    chickenKey,
    unrelatedKey,
    result: {
      membership: {
        products: new Set([basicMealId]),
        groups: new Set([`${basicMealId}:${proteinsGroupId}`]),
        options: new Set([chickenKey, unrelatedKey]),
        bySelectionType: new Map([
          [
            "premium_meal",
            {
              products: new Set([basicMealId]),
              groups: new Set([`${basicMealId}:${proteinsGroupId}`]),
              options: new Set([chickenKey, unrelatedKey]),
            },
          ],
        ]),
      },
    },
  };
}

async function run() {
  // Ensure route installers are evaluated exactly as they are in the application.
  assert.strictEqual(typeof createApp, "function");
  await connect();
  try {
    await seedCatalog({ reset: true, sync: true });
    const identity = await configureChickenFajitaPremium();

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
    const descriptor = premiumDescriptor(config);
    assert(descriptor, "published config must contain the Premium descriptor");
    assert(
      !(descriptor.selectedOptionIds || []).map(String).includes(
        identity.chickenFajitaId
      ),
      "Chicken Fajita must exercise automatic Premium authority, not selected IDs"
    );

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
    assert.strictEqual(String(contractChicken.configId), identity.premiumConfigId);

    const planner = await mealBuilderConfigService
      .buildPlannerCatalogFromPublishedBuilder({ config, lang: "ar" });
    const premiumOptions = premiumOptionsFromPlanner(planner, descriptor);
    const premiumChickenRows = premiumOptions.filter(
      (option) => option.premiumKey === "chicken_fajita"
    );
    assert.strictEqual(
      premiumChickenRows.length,
      1,
      "the Premium group must contain exactly one authoritative Chicken Fajita"
    );
    const plannerChicken = premiumChickenRows[0];
    assert.strictEqual(plannerChicken.nameI18n.ar, "فاهيتا");
    assert.strictEqual(plannerChicken.nameI18n.en, "Chicken Fajita");
    assert.strictEqual(plannerChicken.selectionType, "premium_meal");
    assert.strictEqual(plannerChicken.isPremium, true);
    assert.strictEqual(plannerChicken.extraFeeHalala, 2500);
    assert.strictEqual(String(plannerChicken.configId), identity.premiumConfigId);
    assert.strictEqual(String(plannerChicken.sourceId), identity.chickenFajitaId);
    assert.strictEqual(String(plannerChicken.sourceProductId), identity.basicMealId);
    assert.strictEqual(String(plannerChicken.sourceGroupId), identity.proteinsGroupId);

    const automaticPremiumOptionsByType =
      await resolveAutomaticPremiumMembershipOptions(config);
    const fixture = membershipFixture(identity);
    const prunedMembership = pruneMembershipToPublishedSelections(
      fixture.result,
      config,
      { automaticPremiumOptionsByType }
    );
    const premiumMembership = prunedMembership.membership
      .bySelectionType.get("premium_meal");
    assert(
      premiumMembership.options.has(fixture.chickenKey),
      "automatic Premium Chicken Fajita must remain in published membership"
    );
    assert(
      !premiumMembership.options.has(fixture.unrelatedKey),
      "an unrelated unselected option must remain pruned"
    );

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
