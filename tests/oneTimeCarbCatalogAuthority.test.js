"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "one-time-carb-catalog-test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "one-time-carb-catalog-dashboard-test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const menuPricingService = require("../src/services/orders/menuPricingService");
const {
  applyPublishedOneTimeCarbAuthority,
  loadPublishedOneTimeCarbAuthority,
} = require("../src/services/installOneTimeCarbCatalogAuthority");
const {
  applyOneTimeCarbGramContract,
} = require("../src/services/installOneTimeCarbGramContract");

const EXPECTED_CARB_KEYS = [
  "vermicelli_rice",
  "yellow_rice",
  "vegetable_rice",
  "white_rice",
  "mashed_potatoes",
  "creamy_pasta",
  "red_sauce_pasta",
  "mixed_vegetables",
  "roasted_potatoes",
  "sweet_potatoes",
];

async function main() {
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: `one_time_carb_catalog_${Date.now()}` },
  });
  await mongoose.connect(mongo.getUri(), { serverSelectionTimeoutMS: 10000 });

  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "custom_order",
      name: { ar: "اطلب على مزاجك", en: "Build Your Own" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    const product = await MenuProduct.create({
      categoryId: category._id,
      key: "basic_meal",
      name: { ar: "وجبة بيسك", en: "Basic Meal" },
      pricingModel: "per_100g",
      priceHalala: 1900,
      baseUnitGrams: 100,
      defaultWeightGrams: 100,
      minWeightGrams: 100,
      maxWeightGrams: 300,
      weightStepGrams: 50,
      availableFor: ["one_time"],
      isCustomizable: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    const group = await MenuOptionGroup.create({
      key: "carbs",
      name: { ar: "النشويات", en: "Carbs" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    await ProductOptionGroup.create({
      productId: product._id,
      groupId: group._id,
      minSelections: 1,
      maxSelections: 2,
      isRequired: true,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 2,
    });

    const options = [];
    for (let index = 0; index < EXPECTED_CARB_KEYS.length; index += 1) {
      const key = EXPECTED_CARB_KEYS[index];
      const option = await MenuOption.create({
        groupId: group._id,
        key,
        name: { ar: key, en: key },
        displayCategoryKey: "standard_carbs",
        selectionType: "standard_meal",
        availableFor: ["one_time", "subscription"],
        extraPriceHalala: 0,
        extraWeightUnitGrams: 0,
        extraWeightPriceHalala: 0,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: index + 1,
        publishedAt: now,
      });
      options.push(option);
      await ProductGroupOption.create({
        productId: product._id,
        groupId: group._id,
        optionId: option._id,
        extraPriceHalala: 0,
        extraWeightUnitGrams: 0,
        extraWeightPriceHalala: 0,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: index + 1,
      });
    }

    const hidden = await MenuOption.create({
      groupId: group._id,
      key: "hidden_carb",
      name: { ar: "مخفي", en: "Hidden" },
      availableFor: ["one_time"],
      isActive: true,
      isVisible: false,
      isAvailable: true,
      publishedAt: now,
    });
    await ProductGroupOption.create({
      productId: product._id,
      groupId: group._id,
      optionId: hidden._id,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 50,
    });

    const authority = await loadPublishedOneTimeCarbAuthority({ lang: "en" });
    assert(authority, "published carb authority must resolve");
    assert.deepStrictEqual(
      authority.options.map((option) => option.key),
      EXPECTED_CARB_KEYS,
      "all active, published, linked one-time carb options must be returned without a static key allowlist"
    );

    const partialMenu = {
      categories: [{
        key: "custom_order",
        products: [{
          id: String(product._id),
          key: "basic_meal",
          optionGroups: [{
            id: String(group._id),
            key: "carbs",
            options: authority.options.filter((option) => ["white_rice", "red_sauce_pasta"].includes(option.key)),
          }],
        }],
      }],
      publicMenuV2: {
        sections: [{
          key: "custom_order",
          products: [{
            id: String(product._id),
            key: "basic_meal",
            optionGroups: [{
              id: String(group._id),
              key: "carbs",
              options: authority.options.filter((option) => option.key === "white_rice"),
            }],
          }],
        }],
      },
    };

    const hydrated = applyOneTimeCarbGramContract(
      applyPublishedOneTimeCarbAuthority(partialMenu, authority)
    );
    const categoryCarbs = hydrated.categories[0].products[0].optionGroups[0].options;
    const publicV2Carbs = hydrated.publicMenuV2.sections[0].products[0].optionGroups[0].options;
    assert.deepStrictEqual(categoryCarbs.map((option) => option.key), EXPECTED_CARB_KEYS);
    assert.deepStrictEqual(publicV2Carbs.map((option) => option.key), EXPECTED_CARB_KEYS);
    assert(categoryCarbs.every((option) => option.extraWeightUnitGrams === 50));
    assert(categoryCarbs.every((option) => option.extraWeightPriceHalala === 0));

    const restoredOption = options.find((option) => option.key === "creamy_pasta");
    const priced = await menuPricingService.priceMenuCart({
      items: [{
        productId: String(product._id),
        qty: 1,
        weightGrams: 100,
        selectedOptions: [{
          groupId: String(group._id),
          optionId: String(restoredOption._id),
          qty: 1,
          extraWeightGrams: 100,
        }],
      }],
      lang: "en",
    });
    assert.strictEqual(priced.items[0].selectedOptions[0].extraWeightGrams, 100);
    assert.strictEqual(priced.items[0].selectedOptions[0].extraWeightPriceHalala, 0);
    assert.strictEqual(priced.pricing.subtotalHalala, 1900);

    console.log("oneTimeCarbCatalogAuthority.test.js passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
