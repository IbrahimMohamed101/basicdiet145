process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-jwt-key-0000000000000000";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "test-only-dashboard-key-000000000";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const mealBuilderConfigService = require("../src/services/subscription/mealBuilderConfigService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`flutter_planner_expansion_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function ids(rows) {
  return rows.map((row) => String(row.id || row.optionId || row.productId));
}

async function run() {
  await connect();
  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "build_your_meal",
      name: { ar: "اطلب على مزاجك", en: "Build Your Meal" },
      publishedAt: now,
    });
    const basicMeal = await MenuProduct.create({
      categoryId: category._id,
      key: "basic_meal",
      name: { ar: "وجبة بيسك", en: "Basic Meal" },
      itemType: "basic_meal",
      pricingModel: "fixed",
      priceHalala: 2000,
      availableFor: ["subscription"],
      publishedAt: now,
    });
    const [proteins, carbs] = await MenuOptionGroup.insertMany([
      {
        key: "proteins",
        name: { ar: "البروتين", en: "Proteins" },
        publishedAt: now,
        sortOrder: 1,
      },
      {
        key: "carbs",
        name: { ar: "الكارب", en: "Carbs" },
        publishedAt: now,
        sortOrder: 2,
      },
    ]);
    const proteinOptions = await MenuOption.insertMany([
      {
        groupId: proteins._id,
        key: "beef_steak_classic",
        name: { ar: "ستيك كلاسيك", en: "Classic Steak" },
        selectionType: "standard_meal",
        proteinFamilyKey: "beef",
        displayCategoryKey: "beef",
        availableFor: ["subscription"],
        publishedAt: now,
        sortOrder: 10,
      },
      {
        groupId: proteins._id,
        key: "beef_steak_pepper",
        name: { ar: "ستيك بالفلفل", en: "Pepper Steak" },
        selectionType: "standard_meal",
        proteinFamilyKey: "beef",
        displayCategoryKey: "beef",
        availableFor: ["subscription"],
        publishedAt: now,
        sortOrder: 20,
      },
      {
        groupId: proteins._id,
        key: "beef_steak_mushroom",
        name: { ar: "ستيك بالمشروم", en: "Mushroom Steak" },
        selectionType: "standard_meal",
        proteinFamilyKey: "beef",
        displayCategoryKey: "beef",
        availableFor: ["subscription"],
        publishedAt: now,
        sortOrder: 30,
      },
    ]);
    const carbOptions = await MenuOption.insertMany([
      {
        groupId: carbs._id,
        key: "white_rice",
        name: { ar: "أرز أبيض", en: "White Rice" },
        selectionType: "standard_meal",
        displayCategoryKey: "standard_carbs",
        availableFor: ["subscription"],
        publishedAt: now,
        sortOrder: 10,
      },
      {
        groupId: carbs._id,
        key: "roasted_potato",
        name: { ar: "بطاطس مشوية", en: "Roasted Potato" },
        selectionType: "standard_meal",
        displayCategoryKey: "standard_carbs",
        availableFor: ["subscription"],
        publishedAt: now,
        sortOrder: 20,
      },
    ]);

    await ProductOptionGroup.insertMany([
      {
        productId: basicMeal._id,
        groupId: proteins._id,
        minSelections: 1,
        maxSelections: 1,
        isRequired: true,
        sortOrder: 1,
      },
      {
        productId: basicMeal._id,
        groupId: carbs._id,
        minSelections: 1,
        maxSelections: 2,
        isRequired: true,
        sortOrder: 2,
      },
    ]);
    await ProductGroupOption.insertMany([
      ...proteinOptions.map((option, index) => ({
        productId: basicMeal._id,
        groupId: proteins._id,
        optionId: option._id,
        sortOrder: (index + 1) * 10,
      })),
      ...carbOptions.map((option, index) => ({
        productId: basicMeal._id,
        groupId: carbs._id,
        optionId: option._id,
        sortOrder: (index + 1) * 10,
      })),
    ]);

    const directProducts = await MenuProduct.insertMany(
      ["one", "two", "three"].map((suffix, index) => ({
        categoryId: category._id,
        key: `ready_steak_${suffix}`,
        name: { ar: `وجبة ستيك ${index + 1}`, en: `Ready Steak ${index + 1}` },
        itemType: "full_meal_product",
        pricingModel: "fixed",
        priceHalala: 2500 + index * 100,
        availableFor: ["subscription"],
        publishedAt: now,
        sortOrder: 100 + index * 10,
      }))
    );

    await MealBuilderConfig.create({
      status: "published",
      isCurrent: true,
      contractVersion: "subscription_meal_builder.v1",
      versionNumber: 1,
      source: "dashboard",
      createdBySystem: false,
      publishedAt: now,
      sections: [
        {
          key: "beef",
          sectionType: "option_group",
          sourceKind: "visual_family",
          productContextId: basicMeal._id,
          sourceGroupId: proteins._id,
          selectedOptionIds: proteinOptions.slice(0, 2).map((option) => option._id),
          selectionType: "standard_meal",
          titleOverride: { ar: "ستيك", en: "Steak" },
          visible: true,
          availableFor: ["subscription"],
          metadata: { proteinFamilyKey: "beef", optionRole: "protein" },
          sortOrder: 10,
        },
        {
          key: "carbs",
          sectionType: "option_group",
          sourceKind: "configurable_product",
          productContextId: basicMeal._id,
          sourceGroupId: carbs._id,
          selectedOptionIds: [carbOptions[0]._id],
          selectionType: "standard_meal",
          titleOverride: { ar: "الكارب", en: "Carbs" },
          visible: true,
          availableFor: ["subscription"],
          metadata: { optionRole: "carbs" },
          sortOrder: 20,
        },
        {
          key: "ready_steaks",
          sectionType: "product_list",
          sourceKind: "product_list",
          selectedProductIds: directProducts.slice(0, 2).map((product) => product._id),
          includeMode: "selected",
          selectionType: "full_meal_product",
          titleOverride: { ar: "وجبات ستيك", en: "Ready Steaks" },
          visible: true,
          availableFor: ["subscription"],
          metadata: { cardType: "direct_product", treatAsFullMeal: true },
          sortOrder: 30,
        },
      ],
    });

    const app = createApp();
    const response = await request(app).get(
      "/api/subscriptions/meal-planner-menu?lang=en"
    );
    assert.strictEqual(response.status, 200, JSON.stringify(response.body));
    const catalog = response.body.data.builderCatalog;
    assert.strictEqual(catalog.contractVersion, "meal_planner_menu.v3");

    const beefSection = catalog.sections.find((section) => section.key === "beef");
    const beefGroup = beefSection.products[0].optionGroups.find(
      (group) => group.key === "proteins" || group.sourceKey === "proteins"
    );
    assert.deepStrictEqual(
      ids(beefGroup.options),
      proteinOptions.map((option) => String(option._id)),
      "Flutter beef picker must receive every eligible related option"
    );

    const carbsSection = catalog.sections.find((section) => section.key === "carbs");
    const carbsGroup = carbsSection.products[0].optionGroups.find(
      (group) => group.key === "carbs" || group.sourceKey === "carbs"
    );
    assert.deepStrictEqual(
      ids(carbsGroup.options),
      carbOptions.map((option) => String(option._id)),
      "Flutter carb picker must receive every eligible related option"
    );
    assert.strictEqual(catalog.rules.maxCarbItemsPerMeal, 2);
    assert.strictEqual(catalog.rules.maxCarbTotalGrams, 300);
    assert.strictEqual(catalog.rules.carbGramStep, 50);
    assert.strictEqual(catalog.rules.carbUnit, "grams");

    const directSection = catalog.sections.find(
      (section) => section.key === "ready_steaks"
    );
    assert.deepStrictEqual(
      ids(directSection.products),
      directProducts.map((product) => String(product._id)),
      "Flutter direct-product tab must receive every eligible product in the configured category"
    );

    const membershipResult = await mealBuilderConfigService.buildPublishedMembership();
    assert.strictEqual(
      mealBuilderConfigService.isOptionIncluded(
        membershipResult.membership,
        "standard_meal",
        basicMeal._id,
        proteins._id,
        proteinOptions[2]._id
      ),
      true,
      "an option exposed to Flutter must also be accepted by backend membership validation"
    );
    assert.strictEqual(
      mealBuilderConfigService.isOptionIncluded(
        membershipResult.membership,
        "standard_meal",
        basicMeal._id,
        carbs._id,
        carbOptions[1]._id
      ),
      true,
      "a gram-based carb exposed to Flutter must also be accepted by backend membership validation"
    );
    assert.strictEqual(
      mealBuilderConfigService.isProductIncluded(
        membershipResult.membership,
        "full_meal_product",
        directProducts[2]._id
      ),
      true,
      "a direct product exposed to Flutter must also be accepted by backend membership validation"
    );

    console.log("Flutter Meal Planner catalog expansion contract passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error);
  await disconnect().catch(() => {});
  process.exit(1);
});
