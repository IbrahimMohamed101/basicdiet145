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

async function createCatalogItem(key, name, itemKind) {
  return CatalogItem.create({
    key,
    nameI18n: { ar: name, en: name },
    itemKind,
    isActive: true,
    isAvailable: true,
  });
}

async function seedBuilder() {
  const now = new Date();
  const productCatalog = await createCatalogItem("basic_meal", "Basic Meal", "product");
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { ar: "اطلب على مزاجك", en: "Build Your Own" },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: now,
    sortOrder: 1,
  });
  const product = await MenuProduct.create({
    categoryId: category._id,
    catalogItemId: productCatalog._id,
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
    sortOrder: 1,
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

  const optionDefinitions = [
    {
      key: "white_rice",
      name: "White Rice",
      sortOrder: 1,
      extraWeightPriceHalala: 0,
    },
    {
      key: "red_sauce_pasta",
      name: "Red Sauce Pasta",
      sortOrder: 2,
      extraWeightPriceHalala: 0,
    },
    {
      key: "sweet_potatoes",
      name: "Sweet Potatoes",
      sortOrder: 3,
      extraWeightPriceHalala: 200,
    },
    {
      key: "creamy_pasta",
      name: "Creamy Pasta",
      sortOrder: 4,
      extraWeightPriceHalala: 0,
    },
  ];
  const options = [];
  for (const definition of optionDefinitions) {
    const catalogItem = await createCatalogItem(
      definition.key,
      definition.name,
      "carb"
    );
    options.push(await MenuOption.create({
      groupId: group._id,
      catalogItemId: catalogItem._id,
      key: definition.key,
      name: { ar: definition.name, en: definition.name },
      description: { ar: definition.name, en: definition.name },
      extraPriceHalala: 0,
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: definition.extraWeightPriceHalala,
      currency: "SAR",
      // This mirrors the current workbook production import. These options are
      // authored as subscription carbs even though the one-time Basic Meal uses
      // the same canonical group.
      availableFor: ["subscription"],
      availableForSubscription: true,
      selectionType: "standard_meal",
      displayCategoryKey: "standard_carbs",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
      sortOrder: definition.sortOrder,
    }));
  }
  const [whiteRice, redPasta, sweetPotatoes, hiddenCreamyPasta] = options;

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
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: null,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 1,
    },
    {
      productId: product._id,
      groupId: group._id,
      optionId: hiddenCreamyPasta._id,
      extraPriceHalala: null,
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: null,
      isActive: false,
      isVisible: false,
      isAvailable: false,
      sortOrder: 4,
    },
  ]);

  return {
    product,
    group,
    whiteRice,
    redPasta,
    sweetPotatoes,
    hiddenCreamyPasta,
  };
}

async function quote({ product, selections }) {
  return menuPricingService.priceMenuCart({
    userId: new mongoose.Types.ObjectId(),
    items: [{
      productId: String(product._id),
      qty: 1,
      weightGrams: 100,
      selectedOptions: selections,
    }],
    fulfillmentMethod: "pickup",
    pickup: { branchId: "main" },
    requestBody: {},
    lang: "ar",
  });
}

function selection(group, option, extraWeightGrams) {
  return {
    groupId: String(group._id),
    optionId: String(option._id),
    ...(extraWeightGrams === undefined ? {} : { extraWeightGrams }),
  };
}

async function main() {
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: `one_time_basic_meal_carbs_${Date.now()}` },
  });
  await mongoose.connect(mongoServer.getUri(), {
    serverSelectionTimeoutMS: 10000,
  });

  try {
    const seeded = await seedBuilder();
    const {
      product,
      group,
      whiteRice,
      redPasta,
      sweetPotatoes,
      hiddenCreamyPasta,
    } = seeded;

    const firstRepair = await carbContract.ensureOneTimeBasicMealCarbRelations({
      force: true,
    });
    assert.deepStrictEqual(firstRepair, {
      productId: String(product._id),
      eligibleOptions: 3,
      insertedRelations: 2,
      updatedRelations: 1,
      updatedChannels: 3,
      preservedHiddenRelations: 1,
    });

    const secondRepair = await carbContract.ensureOneTimeBasicMealCarbRelations({
      force: true,
    });
    assert.strictEqual(secondRepair.insertedRelations, 0, "repair is idempotent");
    assert.strictEqual(secondRepair.updatedRelations, 0, "step repair is idempotent");
    assert.strictEqual(secondRepair.updatedChannels, 0, "channel repair is idempotent");

    const activeOptions = await MenuOption.find({
      _id: { $in: [whiteRice._id, redPasta._id, sweetPotatoes._id] },
    }).lean();
    assert(activeOptions.every((option) => option.availableFor.includes("one_time")));
    const hiddenOption = await MenuOption.findById(hiddenCreamyPasta._id).lean();
    assert(!hiddenOption.availableFor.includes("one_time"));

    const hiddenRelation = await ProductGroupOption.findOne({
      productId: product._id,
      optionId: hiddenCreamyPasta._id,
    }).lean();
    assert.strictEqual(hiddenRelation.isActive, false);
    assert.strictEqual(hiddenRelation.isVisible, false);
    assert.strictEqual(hiddenRelation.isAvailable, false);
    assert.strictEqual(hiddenRelation.extraWeightUnitGrams, 0);

    const activeRelations = await ProductGroupOption.find({
      productId: product._id,
      optionId: { $in: [whiteRice._id, redPasta._id, sweetPotatoes._id] },
    }).lean();
    assert.strictEqual(activeRelations.length, 3);
    assert(activeRelations.every((relation) => relation.extraWeightUnitGrams === 50));

    const menu = await orderMenuService.getOneTimeOrderMenu({
      lang: "ar",
      includePublicV2: true,
    });
    const publicProduct = findProduct(menu, product._id);
    assert(publicProduct, "one-time Basic Meal is returned");
    const publicCarbs = publicProduct.optionGroups.find((row) => row.key === "carbs");
    assert(publicCarbs, "carb group is returned");
    assert.deepStrictEqual(
      publicCarbs.options.map((option) => option.key),
      ["white_rice", "red_sauce_pasta", "sweet_potatoes"]
    );
    assert(publicCarbs.options.every((option) => option.extraWeightUnitGrams === 50));
    assert.strictEqual(
      publicCarbs.options.find((option) => option.key === "sweet_potatoes")
        .extraWeightPriceHalala,
      200
    );

    const publicV2Product = menu.publicMenuV2.sections
      .flatMap((section) => section.products || [])
      .find((row) => row.id === String(product._id));
    assert(publicV2Product, "Public Menu V2 contains Basic Meal");
    assert.strictEqual(
      publicV2Product.optionGroups.find((row) => row.key === "carbs").options.length,
      3
    );

    const defaultQuote = await quote({
      product,
      selections: [selection(group, redPasta)],
    });
    assert.strictEqual(defaultQuote.items[0].unitPriceHalala, 1900);
    assert.strictEqual(defaultQuote.items[0].selectedOptions[0].extraWeightGrams, 50);
    assert.strictEqual(defaultQuote.items[0].selectedOptions[0].extraWeightUnitGrams, 50);
    assert.strictEqual(defaultQuote.items[0].selectedOptions[0].extraWeightPriceHalala, 0);

    const includedQuote = await quote({
      product,
      selections: [selection(group, redPasta, 150)],
    });
    assert.strictEqual(includedQuote.items[0].unitPriceHalala, 1900);
    assert.strictEqual(includedQuote.items[0].pricingSnapshot.optionsTotalHalala, 0);
    assert.strictEqual(includedQuote.items[0].selectedOptions[0].extraWeightGrams, 150);

    const paidQuote = await quote({
      product,
      selections: [selection(group, sweetPotatoes, 100)],
    });
    assert.strictEqual(paidQuote.items[0].unitPriceHalala, 2300);
    assert.strictEqual(paidQuote.items[0].pricingSnapshot.optionsTotalHalala, 400);
    assert.strictEqual(paidQuote.items[0].selectedOptions[0].extraWeightGrams, 100);

    await assert.rejects(
      () => quote({
        product,
        selections: [selection(group, redPasta, 125)],
      }),
      (error) => error && error.code === "INVALID_WEIGHT"
    );

    await assert.rejects(
      () => quote({
        product,
        selections: [
          selection(group, whiteRice, 200),
          selection(group, redPasta, 150),
        ],
      }),
      (error) => error
        && error.code === "INVALID_WEIGHT"
        && error.details
        && error.details.maxTotalGrams === 300
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
