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
const Order = require("../src/models/Order");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

require("../src/services/orders/installWeightPricingAuthority");
require("../src/services/installOneTimeCarbGramContract");
const menuPricingService = require("../src/services/orders/menuPricingService");
const orderMenuService = require("../src/services/orders/orderMenuService");
const {
  serializeOrderForDashboard,
} = require("../src/services/orders/orderSerializationService");

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
        key: "basic_meal",
        nameI18n: { ar: "وجبة بيسك", en: "Basic Meal" },
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
        nameI18n: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
        itemKind: "carb",
        isActive: true,
        isAvailable: true,
      },
    ]);

  const category = await MenuCategory.create({
    key: "meals",
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
    key: "basic_meal",
    name: { ar: "وجبة بيسك", en: "Basic Meal" },
    itemType: "basic_meal",
    pricingModel: "per_100g",
    priceHalala: 1900,
    baseUnitGrams: 100,
    defaultWeightGrams: 100,
    minWeightGrams: 100,
    maxWeightGrams: 300,
    weightStepGrams: 50,
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
      displayCategoryKey: "standard_carbs",
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
      name: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
      displayCategoryKey: "standard_carbs",
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
    assert(publicProduct, "basic_meal must be returned");
    const publicCarbGroups = publicProduct.optionGroups.filter(
      (row) => row.key === "carbs"
    );
    assert.strictEqual(publicCarbGroups.length, 1, "carb group must appear once");
    const publicCarbGroup = publicCarbGroups[0];
    assert.strictEqual(publicCarbGroup.options.length, 2, "each carb must appear once");

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

    const includedQuote = await menuPricingService.priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: String(product._id),
          qty: 1,
          weightGrams: 100,
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

    assert.strictEqual(includedQuote.items[0].pricingSnapshot.optionsTotalHalala, 0);
    assert.strictEqual(includedQuote.items[0].selectedOptions[0].extraWeightGrams, 150);
    assert.strictEqual(includedQuote.items[0].selectedOptions[0].extraWeightUnitGrams, 50);
    assert.strictEqual(includedQuote.items[0].selectedOptions[0].extraWeightPriceHalala, 0);

    const persistedOrder = await Order.create({
      userId: new mongoose.Types.ObjectId(),
      fulfillmentMethod: "pickup",
      fulfillmentDate: "2026-07-24",
      items: includedQuote.items,
      pricing: includedQuote.pricing,
      pickup: { branchId: "main" },
    });
    const storedOrder = await Order.findById(persistedOrder._id).lean();
    const storedSelection = storedOrder.items[0].selections.selectedOptions[0];
    assert.strictEqual(storedSelection.name.ar, "رز أبيض");
    assert.strictEqual(storedSelection.extraWeightGrams, 150);
    assert.strictEqual(storedSelection.extraWeightUnitGrams, 50);

    const operationsDetail = serializeOrderForDashboard(storedOrder, {
      detail: true,
    });
    const operationsSelection =
      operationsDetail.items[0].selections.selectedOptions[0];
    assert.strictEqual(operationsSelection.name.ar, "رز أبيض");
    assert.strictEqual(operationsSelection.extraWeightGrams, 150);

    const paidQuote = await menuPricingService.priceMenuCart({
      userId: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: String(product._id),
          qty: 1,
          weightGrams: 100,
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
    assert.strictEqual(paidQuote.items[0].pricingSnapshot.optionsTotalHalala, 400);

    await assert.rejects(
      () => menuPricingService.priceMenuCart({
        userId: new mongoose.Types.ObjectId(),
        items: [
          {
            productId: String(product._id),
            qty: 1,
            weightGrams: 100,
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

    console.log("oneTimeCarbGramContract.test.js passed");
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
