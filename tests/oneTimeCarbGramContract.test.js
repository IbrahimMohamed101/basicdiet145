"use strict";

process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "one-time-carb-dashboard-secret";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "one-time-carb-app-secret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

require("../src/services/installOneTimeCarbGramContract");
const menuPricingService = require("../src/services/orders/menuPricingService");
const orderMenuService = require("../src/services/orders/orderMenuService");

let mongoServer;

function findProduct(menu, productId) {
  return (menu.categories || [])
    .flatMap((category) => category.products || [])
    .find((product) => product.id === String(productId));
}

async function seedBuilder() {
  const now = new Date();
  const [productCatalogItem, includedCarbCatalogItem, paidCarbCatalogItem] =
    await CatalogItem.create([
      {
        key: "one_time_steak_builder",
        nameI18n: { ar: "وجبة ستيك", en: "Steak Builder" },
        itemKind: "product",
        isActive: true,
        isAvailable: true,
      },
      {
        key: "white_rice",
        nameI18n: { ar: "رز أبيض", en: "White Rice" },
        itemKind: "carb",
        isActive: true,
        isAvailable: true,
      },
      {
        key: "red_sauce_pasta",
        nameI18n: { ar: "مكرونة حمراء", en: "Red Pasta" },
        itemKind: "carb",
        isActive: true,
        isAvailable: true,
      },
    ]);

  const category = await MenuCategory.create({
    key: "one_time_builder_meals",
    name: { ar: "الوجبات", en: "Meals" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    sortOrder: 1,
    ui: { cardVariant: "meal_builder" },
  });

  const product = await MenuProduct.create({
    categoryId: category._id,
    catalogItemId: productCatalogItem._id,
    key: "one_time_steak_builder",
    name: { ar: "وجبة ستيك", en: "Steak Builder" },
    itemType: "product",
    pricingModel: "fixed",
    priceHalala: 1900,
    currency: "SAR",
    availableFor: ["one_time"],
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    ui: { cardVariant: "hero_builder" },
  });

  const group = await MenuOptionGroup.create({
    key: "carbs",
    name: { ar: "النشويات", en: "Carbs" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    sortOrder: 1,
    ui: { displayStyle: "checkbox_grid" },
  });

  const [includedCarb, paidCarb] = await MenuOption.create([
    {
      groupId: group._id,
      catalogItemId: includedCarbCatalogItem._id,
      key: "white_rice",
      name: { ar: "رز أبيض", en: "White Rice" },
      extraPriceHalala: 0,
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: 0,
      availableFor: ["one_time"],
      availableForSubscription: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 1,
    },
    {
      groupId: group._id,
      catalogItemId: paidCarbCatalogItem._id,
      key: "red_sauce_pasta",
      name: { ar: "مكرونة حمراء", en: "Red Pasta" },
      extraPriceHalala: 0,
      extraWeightUnitGrams: 50,
      extraWeightPriceHalala: 200,
      availableFor: ["one_time"],
      availableForSubscription: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 2,
    },
  ]);

  await ProductOptionGroup.create({
    productId: product._id,
    groupId: group._id,
    minSelections: 1,
    maxSelections: 2,
    isRequired: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 1,
  });

  await ProductGroupOption.create([
    {
      productId: product._id,
      groupId: group._id,
      optionId: includedCarb._id,
      extraPriceHalala: null,
      extraWeightUnitGrams: null,
      extraWeightPriceHalala: null,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 1,
    },
    {
      productId: product._id,
      groupId: group._id,
      optionId: paidCarb._id,
      extraPriceHalala: null,
      extraWeightUnitGrams: null,
      extraWeightPriceHalala: null,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 2,
    },
  ]);

  return { product, group, includedCarb, paidCarb };
}

async function main() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: `one_time_carb_grams_${Date.now()}` },
  });
  await mongoose.connect(mongoServer.getUri(), {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    const { product, group, includedCarb, paidCarb } = await seedBuilder();

    const menu = await orderMenuService.getOneTimeOrderMenu({
      lang: "ar",
      includePublicV2: true,
    });
    const publicProduct = findProduct(menu, product._id);
    assert(publicProduct, "one-time Builder product must be returned");
    const publicCarbGroup = publicProduct.optionGroups.find(
      (row) => row.key === "carbs"
    );
    assert(publicCarbGroup, "carb group must be returned");

    const publicIncludedCarb = publicCarbGroup.options.find(
      (row) => row.optionId === String(includedCarb._id)
    );
    assert.strictEqual(publicIncludedCarb.extraWeightUnitGrams, 50);
    assert.strictEqual(publicIncludedCarb.extraWeightPriceHalala, 0);

    const publicPaidCarb = publicCarbGroup.options.find(
      (row) => row.optionId === String(paidCarb._id)
    );
    assert.strictEqual(publicPaidCarb.extraWeightUnitGrams, 50);
    assert.strictEqual(publicPaidCarb.extraWeightPriceHalala, 200);

    const v2Product = menu.publicMenuV2.sections
      .flatMap((section) => section.products || [])
      .find((row) => row.id === String(product._id));
    const v2IncludedCarb = v2Product.optionGroups
      .find((row) => row.key === "carbs")
      .options.find((row) => row.optionId === String(includedCarb._id));
    assert.strictEqual(v2IncludedCarb.extraWeightUnitGrams, 50);

    const defaultQuote = await menuPricingService.priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: String(product._id),
          qty: 1,
          selectedOptions: [
            {
              groupId: String(group._id),
              optionId: String(includedCarb._id),
            },
          ],
        },
      ],
      fulfillmentMethod: "pickup",
      pickup: { branchId: "main" },
      requestBody: {},
      lang: "ar",
    });
    assert.strictEqual(defaultQuote.items[0].unitPriceHalala, 1900);
    assert.strictEqual(
      defaultQuote.items[0].selectedOptions[0].extraWeightGrams,
      50
    );

    const includedQuote = await menuPricingService.priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: String(product._id),
          qty: 1,
          selectedOptions: [
            {
              groupId: String(group._id),
              optionId: String(includedCarb._id),
              extraWeightGrams: 150,
            },
          ],
        },
      ],
      fulfillmentMethod: "pickup",
      pickup: { branchId: "main" },
      requestBody: {},
      lang: "ar",
    });

    assert.strictEqual(includedQuote.items[0].unitPriceHalala, 1900);
    assert.strictEqual(includedQuote.items[0].pricingSnapshot.optionsTotalHalala, 0);
    assert.strictEqual(includedQuote.items[0].selectedOptions[0].extraWeightGrams, 150);
    assert.strictEqual(
      includedQuote.items[0].selectedOptions[0].extraWeightUnitGrams,
      50
    );
    assert.strictEqual(
      includedQuote.items[0].selectedOptions[0].extraWeightPriceHalala,
      0
    );

    const paidQuote = await menuPricingService.priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: String(product._id),
          qty: 1,
          selectedOptions: [
            {
              groupId: String(group._id),
              optionId: String(paidCarb._id),
              extraWeightGrams: 100,
            },
          ],
        },
      ],
      fulfillmentMethod: "pickup",
      pickup: { branchId: "main" },
      requestBody: {},
      lang: "ar",
    });
    assert.strictEqual(paidQuote.items[0].unitPriceHalala, 2300);
    assert.strictEqual(paidQuote.items[0].pricingSnapshot.optionsTotalHalala, 400);

    await assert.rejects(
      () =>
        menuPricingService.priceMenuCart({
          userId: new mongoose.Types.ObjectId(),
          items: [
            {
              productId: String(product._id),
              qty: 1,
              selectedOptions: [
                {
                  groupId: String(group._id),
                  optionId: String(includedCarb._id),
                  extraWeightGrams: 125,
                },
              ],
            },
          ],
          fulfillmentMethod: "pickup",
          pickup: { branchId: "main" },
          requestBody: {},
          lang: "ar",
        }),
      (error) => error && error.code === "INVALID_WEIGHT"
    );

    console.log(
      "oneTimeCarbGramContract.test.js one-time carb gram contract passed"
    );
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
}

main().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  process.exitCode = 1;
});
