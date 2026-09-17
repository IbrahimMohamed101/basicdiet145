process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const baseService = require("../src/services/subscription/mealBuilderConfigService");
const {
  buildCompatibleDefaultSeedSections,
} = require("../src/services/installDashboardMealBuilderFinalization");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`compatible_default_seed_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function section(key, sortOrder) {
  return {
    key,
    sectionType: "product_list",
    sourceKind: "product_list",
    selectedProductIds: [new mongoose.Types.ObjectId()],
    includeMode: "selected",
    selectionType: "full_meal_product",
    sortOrder,
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    availableFor: ["subscription"],
  };
}

async function run() {
  await connect();
  const originalBuild = baseService.buildDefaultVisualTemplateSections;
  const originalNormalize = baseService.normalizeSections;
  const originalValidate = baseService.validateConfigObject;
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "default_seed_ready",
      name: { en: "Ready" },
      publishedAt: now,
    });
    const readyMeal = await MenuProduct.create({
      categoryId: category._id,
      key: "production_ready_default_seed",
      name: { en: "Production Ready" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 1900,
      availableFor: ["subscription"],
      ui: { cardVariant: "ready_meal" },
      publishedAt: now,
    });
    await MenuProduct.create({
      categoryId: category._id,
      key: "default_seed_addon",
      name: { en: "Addon" },
      itemType: "product",
      pricingModel: "fixed",
      priceHalala: 300,
      availableFor: ["subscription"],
      ui: { cardVariant: "addon_card" },
      publishedAt: now,
    });

    baseService.buildDefaultVisualTemplateSections = async () => ({
      sections: [
        section("premium", 10),
        section("chicken", 30),
        section("beef", 40),
        section("fish", 50),
        section("eggs", 60),
        section("carbs", 70),
      ],
      errors: [
        {
          code: "MEAL_BUILDER_DEFAULT_SANDWICH_SOURCE_MISSING",
          message: "legacy explicit itemType query found no products",
        },
      ],
      warnings: [],
    });
    baseService.normalizeSections = (sections) =>
      [...sections].sort((left, right) => left.sortOrder - right.sortOrder);
    baseService.validateConfigObject = async () => ({
      ready: true,
      errors: [],
      warnings: [],
    });

    const sections = await buildCompatibleDefaultSeedSections();
    assert.deepStrictEqual(
      sections.map((item) => item.key),
      ["premium", "sandwich", "chicken", "beef", "fish", "eggs", "carbs"]
    );
    const directSection = sections.find((item) => item.key === "sandwich");
    assert.deepStrictEqual(directSection.selectedProductIds.map(String), [
      String(readyMeal._id),
    ]);
    assert.strictEqual(directSection.metadata.treatAsFullMeal, true);
    assert.strictEqual(
      directSection.metadata.classificationAuthority,
      "meal_product_classification.v1"
    );

    console.log("dashboard Meal Builder compatible default seed passed");
  } finally {
    baseService.buildDefaultVisualTemplateSections = originalBuild;
    baseService.normalizeSections = originalNormalize;
    baseService.validateConfigObject = originalValidate;
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
