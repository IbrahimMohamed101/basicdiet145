#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

const CATEGORY_KEY = "custom_order";
const LEGACY_DUPLICATE_CATEGORY_KEY = "build_your_own";
const BASIC_MEAL_KEY = "basic_meal";
const BASIC_SALAD_KEY = "basic_salad";

async function upsertCategory(now) {
  const category = await MenuCategory.findOneAndUpdate(
    { key: CATEGORY_KEY },
    {
      $set: {
        key: CATEGORY_KEY,
        name: { ar: "اطلب على مزاجك", en: "Build Your Own" },
        description: {
          ar: "اختر بين الوجبة والسلطة ثم خصص طلبك على مزاجك.",
          en: "Choose a meal or salad, then customize it your way.",
        },
        imageUrl: "",
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 0,
        ui: {
          cardVariant: "hero_builder_collection",
          layout: "grid",
          behaviorHint: "open_builder",
          priceLabelMode: "from_price",
        },
        availability: { branchIds: [] },
        publishedAt: now,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await MenuCategory.updateMany(
    { key: LEGACY_DUPLICATE_CATEGORY_KEY },
    {
      $set: {
        isActive: false,
        isVisible: false,
        isAvailable: false,
        publishedAt: null,
      },
    }
  );

  return category;
}

async function ensureProducts(category, now) {
  const basicMeal = await MenuProduct.findOne({ key: BASIC_MEAL_KEY });
  if (!basicMeal) {
    throw new Error("basic_meal is missing. Run the workbook production import first.");
  }

  await MenuProduct.updateOne(
    { _id: basicMeal._id },
    {
      $set: {
        categoryId: category._id,
        name: { ar: "وجبة بيسك", en: "Basic Meal" },
        description: {
          ar: "اختر البروتين والنشويات وحدد الكمية المناسبة.",
          en: "Choose your protein and carbs, then select the quantity.",
        },
        itemType: "basic_meal",
        pricingModel: "per_100g",
        priceHalala: 1900,
        baseUnitGrams: 100,
        defaultWeightGrams: 100,
        minWeightGrams: 100,
        maxWeightGrams: 1000,
        weightStepGrams: 50,
        weightStepPriceHalala: 950,
        currency: "SAR",
        availableFor: ["one_time", "subscription"],
        isCustomizable: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 1,
        ui: {
          cardVariant: "hero_builder",
          cardSize: "large",
          showDescription: true,
          showPrice: true,
          priceLabelMode: "per_unit_or_from",
          behaviorHint: "open_builder",
        },
        publishedAt: now,
      },
    },
    { runValidators: true }
  );

  const workbookSalad = await MenuProduct.findOne({
    key: "salads_build_your_own_salad_100g_protein",
  }).lean();

  const basicSalad = await MenuProduct.findOneAndUpdate(
    { key: BASIC_SALAD_KEY },
    {
      $set: {
        categoryId: category._id,
        catalogItemId: workbookSalad?.catalogItemId || null,
        key: BASIC_SALAD_KEY,
        name: { ar: "سلطة بيسك", en: "Basic Salad" },
        description: {
          ar: "اختر البروتين والمكونات المتاحة وحدد الكمية المناسبة.",
          en: "Choose your protein and available ingredients, then select the quantity.",
        },
        imageUrl: workbookSalad?.imageUrl || "",
        itemType: "basic_salad",
        pricingModel: "per_100g",
        priceHalala: 2900,
        baseUnitGrams: 100,
        defaultWeightGrams: 100,
        minWeightGrams: 100,
        maxWeightGrams: 1000,
        weightStepGrams: 50,
        weightStepPriceHalala: 1450,
        currency: "SAR",
        availableFor: ["one_time", "subscription"],
        isCustomizable: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 2,
        ui: {
          cardVariant: "compact_builder",
          cardSize: "medium",
          showDescription: true,
          showPrice: true,
          priceLabelMode: "per_unit_or_from",
          behaviorHint: "open_builder",
        },
        branchAvailability: [],
        publishedAt: now,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return {
    basicMeal: await MenuProduct.findById(basicMeal._id),
    basicSalad,
  };
}

async function ensureBuilderRelations(products) {
  const groups = await MenuOptionGroup.find({
    key: { $in: ["proteins", "carbs"] },
    isActive: true,
  }).sort({ sortOrder: 1 });

  if (groups.length !== 2) {
    throw new Error("Active proteins and carbs option groups are required.");
  }

  const groupIds = groups.map((group) => group._id);
  const options = await MenuOption.find({
    groupId: { $in: groupIds },
    isActive: true,
    isVisible: true,
    isAvailable: true,
  }).sort({ sortOrder: 1 });

  if (!options.length) {
    throw new Error("No active builder options were found.");
  }

  await MenuOption.updateMany(
    { _id: { $in: options.map((option) => option._id) } },
    {
      $set: {
        availableFor: ["one_time", "subscription"],
        availableForSubscription: true,
      },
    }
  );

  for (const product of [products.basicMeal, products.basicSalad]) {
    const activeRelationIds = [];
    const activeOptionRelationIds = [];

    for (const group of groups) {
      const isProtein = group.key === "proteins";
      const relation = await ProductOptionGroup.findOneAndUpdate(
        { productId: product._id, groupId: group._id },
        {
          $set: {
            productId: product._id,
            groupId: group._id,
            minSelections: 1,
            maxSelections: isProtein ? 1 : 2,
            isRequired: true,
            isActive: true,
            isVisible: true,
            isAvailable: true,
            sortOrder: isProtein ? 1 : 2,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      activeRelationIds.push(relation._id);

      const groupOptions = options.filter(
        (option) => String(option.groupId) === String(group._id)
      );
      for (const option of groupOptions) {
        const optionRelation = await ProductGroupOption.findOneAndUpdate(
          { productId: product._id, groupId: group._id, optionId: option._id },
          {
            $set: {
              productId: product._id,
              groupId: group._id,
              optionId: option._id,
              extraPriceHalala: Number(option.extraPriceHalala || option.extraFeeHalala || 0),
              extraWeightUnitGrams: Number(option.extraWeightUnitGrams || 0),
              extraWeightPriceHalala: Number(option.extraWeightPriceHalala || 0),
              isActive: true,
              isVisible: true,
              isAvailable: true,
              sortOrder: Number(option.sortOrder || 0),
            },
          },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );
        activeOptionRelationIds.push(optionRelation._id);
      }
    }

    await ProductOptionGroup.updateMany(
      { productId: product._id, _id: { $nin: activeRelationIds } },
      { $set: { isActive: false, isVisible: false, isAvailable: false } }
    );
    await ProductGroupOption.updateMany(
      { productId: product._id, _id: { $nin: activeOptionRelationIds } },
      { $set: { isActive: false, isVisible: false, isAvailable: false } }
    );
  }

  return { groups, options };
}

async function verify(category, products) {
  const visibleProducts = await MenuProduct.find({
    categoryId: category._id,
    key: { $in: [BASIC_MEAL_KEY, BASIC_SALAD_KEY] },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    availableFor: "one_time",
  }).select("key name priceHalala availableFor").lean();

  const keys = new Set(visibleProducts.map((row) => row.key));
  if (!keys.has(BASIC_MEAL_KEY) || !keys.has(BASIC_SALAD_KEY)) {
    throw new Error("custom_order verification failed: both products are not visible for one-time ordering.");
  }

  const relationCounts = {};
  for (const product of [products.basicMeal, products.basicSalad]) {
    relationCounts[product.key] = await ProductOptionGroup.countDocuments({
      productId: product._id,
      isActive: true,
      isVisible: true,
      isAvailable: true,
    });
    if (relationCounts[product.key] < 2) {
      throw new Error(`${product.key} does not have the required builder groups.`);
    }
  }

  return { visibleProducts, relationCounts };
}

async function ensureCustomOrderCompatibility() {
  const now = new Date();
  const category = await upsertCategory(now);
  const products = await ensureProducts(category, now);
  const builder = await ensureBuilderRelations(products);
  const verification = await verify(category, products);

  return {
    category: {
      id: category._id.toString(),
      key: category.key,
      name: category.name,
    },
    products: verification.visibleProducts.map((row) => ({
      id: row._id.toString(),
      key: row.key,
      name: row.name,
      priceHalala: row.priceHalala,
      availableFor: row.availableFor,
    })),
    builderGroups: builder.groups.map((group) => group.key),
    builderOptions: builder.options.length,
    relationCounts: verification.relationCounts,
  };
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await ensureCustomOrderCompatibility();
    console.log("[custom-order-compatibility] completed", result);
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[custom-order-compatibility:error] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  ensureCustomOrderCompatibility,
};
