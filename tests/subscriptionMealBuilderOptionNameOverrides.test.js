process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const mealBuilderService = require("../src/services/subscription/mealBuilderConfigService");
require("../src/services/installFlutterMealPlannerCatalogExpansion");
const { serializePublicOption } = require("../src/services/orders/menuCatalogPresenter");

let mongoServer;

async function run() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: `subscription_option_names_${Date.now()}_test` },
  });
  await mongoose.connect(mongoServer.getUri(), { autoIndex: false });

  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "meal_builder",
      name: { ar: "بناء الوجبة", en: "Meal Builder" },
      publishedAt: now,
    });
    const product = await MenuProduct.create({
      categoryId: category._id,
      key: "basic_meal",
      name: { ar: "وجبة", en: "Meal" },
      itemType: "basic_meal",
      pricingModel: "per_100g",
      priceHalala: 0,
      availableFor: ["one_time", "subscription"],
      publishedAt: now,
    });
    const group = await MenuOptionGroup.create({
      key: "proteins",
      name: { ar: "البروتين", en: "Protein" },
      publishedAt: now,
    });
    const option = await MenuOption.create({
      groupId: group._id,
      key: "kofta",
      name: { ar: "كفتة", en: "Kofta" },
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      proteinFamilyKey: "beef",
      displayCategoryKey: "beef",
      selectionType: "standard_meal",
      publishedAt: now,
    });
    const secondOption = await MenuOption.create({
      groupId: group._id,
      key: "mushroom_beef",
      name: { ar: "لحم بالمشروم", en: "Beef with Mushroom" },
      availableFor: ["one_time", "subscription"],
      availableForSubscription: true,
      proteinFamilyKey: "beef",
      displayCategoryKey: "beef",
      selectionType: "standard_meal",
      publishedAt: now,
    });
    await ProductOptionGroup.create({
      productId: product._id,
      groupId: group._id,
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      sortOrder: 1,
    });
    const relation = await ProductGroupOption.create({
      productId: product._id,
      groupId: group._id,
      optionId: option._id,
      extraPriceHalala: null,
      extraWeightUnitGrams: null,
      extraWeightPriceHalala: null,
      sortOrder: 1,
    });
    await ProductGroupOption.create({
      productId: product._id,
      groupId: group._id,
      optionId: secondOption._id,
      extraPriceHalala: null,
      extraWeightUnitGrams: null,
      extraWeightPriceHalala: null,
      sortOrder: 0,
    });

    const config = {
      _id: new mongoose.Types.ObjectId(),
      status: "published",
      isCurrent: true,
      contractVersion: mealBuilderService.CONTRACT_VERSION,
      versionNumber: 1,
      revisionHash: "",
      source: "dashboard",
      sections: [{
        key: "beef",
        sectionType: "option_group",
        sourceKind: "visual_family",
        titleOverride: { ar: "اللحوم", en: "Beef" },
        productContextId: product._id,
        sourceGroupId: group._id,
        selectedOptionIds: [option._id, secondOption._id],
        includeMode: "selected",
        selectionType: "standard_meal",
        sortOrder: 40,
        maxSelections: 1,
        availableFor: ["subscription"],
        metadata: {
          visualRole: "protein_family",
          proteinFamilyKey: "beef",
          optionNameOverrides: {
            [String(option._id)]: {
              ar: "لحم كفتة كباب",
              en: "Beef Kofta Kebab",
            },
            [String(secondOption._id)]: {
              ar: "لحم مشروم",
              en: "Mushroom Beef",
            },
          },
        },
      }],
    };
    config.revisionHash = mealBuilderService.computeRevisionHash(config);

    for (const [lang, expected] of [
      ["ar", "لحم كفتة كباب"],
      ["en", "Beef Kofta Kebab"],
    ]) {
      const planner = await mealBuilderService.buildPlannerCatalogFromPublishedBuilder({
        config,
        lang,
      });
      const plannerOptions = planner.sections[0].products[0].optionGroups[0].options;
      assert.deepStrictEqual(plannerOptions.map((item) => item.id), [
        String(option._id),
        String(secondOption._id),
      ]);
      const projected = plannerOptions[0];
      assert.strictEqual(projected.name, expected);
      assert.deepStrictEqual(projected.nameI18n, {
        ar: "لحم كفتة كباب",
        en: "Beef Kofta Kebab",
      });

      const dashboard = await mealBuilderService.buildPublishedContract({ config, lang });
      assert.strictEqual(dashboard.sections[0].items[0].name, expected);
      assert.deepStrictEqual(dashboard.sections[0].items[0].nameI18n, {
        ar: "لحم كفتة كباب",
        en: "Beef Kofta Kebab",
      });
    }

    const oneTimeProjection = serializePublicOption(
      relation.toObject(),
      option.toObject(),
      "en"
    );
    assert.strictEqual(oneTimeProjection.name, "Kofta");
    assert.deepStrictEqual(oneTimeProjection.nameI18n, {
      ar: "كفتة",
      en: "Kofta",
    });

    const unknownNutrition = await MenuOption.create({
      groupId: group._id,
      key: "new_subscription_only_option",
      name: { ar: "جديد", en: "New" },
      availableFor: ["subscription"],
      availableForSubscription: true,
      nutrition: {
        calories: null,
        proteinGrams: null,
        carbGrams: null,
        fatGrams: null,
      },
      nutritionDataStatus: "unknown",
      publishedAt: now,
    });
    assert.strictEqual(unknownNutrition.nutritionDataStatus, "unknown");
    assert.strictEqual(unknownNutrition.nutrition.calories, null);

    console.log("subscription Meal Builder option-name override checks passed");
  } finally {
    await mongoose.disconnect();
    await mongoServer.stop();
  }
}

run().catch(async (error) => {
  console.error(error);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
  if (mongoServer) await mongoServer.stop().catch(() => {});
  process.exit(1);
});
