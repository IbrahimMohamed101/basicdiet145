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

const carbContract = require("../src/services/installOneTimeCarbGramContract");
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
  const catalogItems = await CatalogItem.create([
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
    {
      key: "sweet_potato",
      nameI18n: { ar: "بطاطا حلوة", en: "Sweet Potato" },
      itemKind: "carb",
      isActive: true,
      isAvailable: true,
    },
    {
      key: "alfredo_pasta",
      nameI18n: { ar: "مكرونة بالكريمة", en: "Alfredo Pasta" },
      itemKind: "carb",
      isActive: true,
      isAvailable: true,
    },
  ]);
  const [productCatalogItem, whiteCatalogItem, redCatalogItem, sweetCatalogItem, hiddenCatalogItem] = catalogItems;

  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "اطلب على مزاجك", en: "Build Your Own" },
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
    currency: "SAR",
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
    ui: { cardSize: "large" },
  });

  const group = await MenuOptionGroup.create({
    key: "carbs",
    name: { ar: "النشويات", en: "Carbs" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    sortOrder: 2,
    ui: { displayStyle: "checkbox_grid" },
  });

  const [whiteRice, redPasta, sweetPotato, hiddenAlfredo] = await MenuOption.create([
    {
      groupId: group._id,
      catalogItemId: whiteCatalogItem._id,
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
      catalogItemId: redCatalogItem._id,
      key: "red_sauce_pasta",
      name: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
      extraPriceHalala: 0,
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: 0,
      availableFor: ["one_time"],
      availableForSubscription: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 2,
    },
    {
      groupId: group._id,
      catalogItemId: sweetCatalogItem._id,
      key: "sweet_potato",
      name: { ar: "بطاطا حلوة", en: "Sweet Potato" },
      extraPriceHalala: 0,
      extraWeightUnitGrams: 50,
      extraWeightPriceHalala: 200,
      availableFor: ["one_time"],
      availableForSubscription: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 3,
    },
    {
      groupId: group._id,
      catalogItemId: hiddenCatalogItem._id,
      key: "alfredo_pasta",
      name: { ar: "مكرونة بالكريمة", en: "Alfredo Pasta" },
      extraPriceHalala: 0,
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: 0,
      availableFor: ["one_time"],
      availableForSubscription: false,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: 4,
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
    sortOrder: 2,
  });

  await ProductGroupOption.create([
    {
      productId: product._id,
      groupId: group._id,
      optionId: whiteRice._id,
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
      optionId: hiddenAlfredo._id,
      extraPriceHalala: null,
      extraWeightUnitGrams: null,
      extraWeightPriceHalala: null,
      isActive: false,
      isVisible: false,
      isAvailable: false,
      sortOrder: 4,
    },
  ]);

  return { product, group, whiteRice, redPasta, sweetPotato, hiddenAlfredo };
}

async function quote({ product, group, option, extraWeightGrams }) {
  const selection = {
    groupId: String(group._id),
    optionId: String(option._id),
  };
  if (extraWeightGrams !== undefined) selection.extraWeightGrams = extraWeightGrams;

  return menuPricingService.priceMenuCart({
    userId: new mongoose.Types.ObjectId(),
    items: [
      {
        productId: String(product._id),
        qty: 1,
        weightGrams: 100,
        selectedOptions: [selection],
      },
    ],
    fulfillmentMethod: "pickup",
    pickup: { branchId: "main" },
    requestBody: {},
    lang: "ar",
  });
}

async function main() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: `one_time_basic_meal_carbs_${Date.now()}` },
  });
  await mongoose.connect(mongoServer.getUri(), {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    const { product, group, whiteRice, redPasta, sweetPotato, hiddenAlfredo } = await seedBuilder();

    const firstRepair = await carbContract.ensureOneTimeBasicMealCarbRelations({ force: true });
    assert.strictEqual(firstRepair.eligibleOptions, 4);
    assert.strictEqual(firstRepair.insertedRelations, 2);

    const secondRepair = await carbContract.ensureOneTimeBasicMealCarbRelations({ force: true });
    assert.strictEqual(secondRepair.insertedRelations, 0, "repair must be idempotent");

    const relationCount = await ProductGroupOption.countDocuments({
      productId: product._id,
      groupId: group._id,
    });
    assert.strictEqual(relationCount, 4, "existing hidden relation must not be duplicated or reactivated");

    const hiddenRelation = await ProductGroupOption.findOne({
      productId: product._id,
      groupId: group._id,
      optionId: hiddenAlfredo._id,
    }).lean();
    assert.strictEqual(hiddenRelation.isActive, false);
    assert.strictEqual(hiddenRelation.isVisible, false);
    assert.strictEqual(hiddenRelation.isAvailable, false);

    const menu = await orderMenuService.getOneTimeOrderMenu({
      lang: "ar",
      includePublicV2: true,
    });
    const publicProduct = findProduct(menu, product._id);
    assert(publicProduct, "one-time Basic Meal must be returned");
    const publicCarbGroup = publicProduct.optionGroups.find((row) => row.key === "carbs");
    assert(publicCarbGroup, "carb group must be returned");

    assert.deepStrictEqual(
      publicCarbGroup.options.map((row) => row.key),
      ["white_rice", "red_sauce_pasta", "sweet_potato"],
      "all eligible carbs must be returned while an explicitly hidden relation stays hidden"
    );

    const publicWhiteRice = publicCarbGroup.options.find((row) => row.optionId === String(whiteRice._id));
    const publicRedPasta = publicCarbGroup.options.find((row) => row.optionId === String(redPasta._id));
    const publicSweetPotato = publicCarbGroup.options.find((row) => row.optionId === String(sweetPotato._id));
    assert.strictEqual(publicWhiteRice.extraWeightUnitGrams, 50);
    assert.strictEqual(publicWhiteRice.extraWeightPriceHalala, 0);
    assert.strictEqual(publicRedPasta.extraWeightUnitGrams, 50);
    assert.strictEqual(publicRedPasta.extraWeightPriceHalala, 0);
    assert.strictEqual(publicSweetPotato.extraWeightUnitGrams, 50);
    assert.strictEqual(publicSweetPotato.extraWeightPriceHalala, 200);

    const v2Product = menu.publicMenuV2.sections
      .flatMap((section) => section.products || [])
      .find((row) => row.id === String(product._id));
    assert(v2Product, "Public Menu V2 must contain Basic Meal");
    assert.strictEqual(
      v2Product.optionGroups.find((row) => row.key === "carbs").options.length,
      3
    );

    const defaultQuote = await quote({ product, group, option: redPasta });
    assert.strictEqual(defaultQuote.items[0].unitPriceHalala, 1900);
    assert.strictEqual(defaultQuote.items[0].selectedOptions[0].extraWeightGrams, 50);
    assert.strictEqual(defaultQuote.items[0].selectedOptions[0].extraWeightUnitGrams, 50);
    assert.strictEqual(defaultQuote.items[0].selectedOptions[0].extraWeightPriceHalala, 0);

    const includedQuote = await quote({
      product,
      group,
      option: redPasta,
      extraWeightGrams: 150,
    });
    assert.strictEqual(includedQuote.items[0].unitPriceHalala, 1900);
    assert.strictEqual(includedQuote.items[0].pricingSnapshot.optionsTotalHalala, 0);
    assert.strictEqual(includedQuote.items[0].selectedOptions[0].extraWeightGrams, 150);

    const paidQuote = await quote({
      product,
      group,
      option: sweetPotato,
      extraWeightGrams: 100,
    });
    assert.strictEqual(paidQuote.items[0].unitPriceHalala, 2300);
    assert.strictEqual(paidQuote.items[0].pricingSnapshot.optionsTotalHalala, 400);

    await assert.rejects(
      () => quote({
        product,
        group,
        option: redPasta,
        extraWeightGrams: 125,
      }),
      (error) => error && error.code === "INVALID_WEIGHT"
    );

    console.log("oneTimeCarbGramContract.test.js complete one-time carb contract passed");
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
