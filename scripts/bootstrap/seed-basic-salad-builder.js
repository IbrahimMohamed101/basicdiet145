#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

const CatalogItem = require("../../src/models/CatalogItem");
const MenuOption = require("../../src/models/MenuOption");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuProduct = require("../../src/models/MenuProduct");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const { getPublishedMenu } = require("../../src/services/orders/menuCatalogService");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const {
  ensureCustomOrderCompatibility,
} = require("./ensure-custom-order-compatibility");

const BASIC_SALAD_KEY = "basic_salad";
const SOURCE_SALAD_KEY = "salads_build_your_own_salad_100g_protein";
const CUSTOM_ORDER_KEY = "custom_order";

const SALAD_NAME = {
  ar: "سلطة على مزاجك – 100جرام بروتين",
  en: "Build Your Own Salad – 100g Protein",
};

const SALAD_DESCRIPTION = {
  ar: "كوّن سلطتك من الورقيات والخضراوات والفواكه والبروتين والصوص والإضافات المتاحة.",
  en: "Build your salad from the available greens, vegetables, fruits, protein, sauces, and extras.",
};

const SALAD_GROUPS = [
  {
    key: "salad_greens",
    name: { ar: "ورقيات", en: "Greens" },
    maxSelections: 2,
    displayStyle: "checkbox_grid",
    options: [
      { key: "lettuce", name: { ar: "خس", en: "Lettuce" }, calories: 15 },
      { key: "arugula", name: { ar: "جرجير", en: "Arugula" }, calories: 25 },
      { key: "cabbage", name: { ar: "ملفوف", en: "Cabbage" }, calories: 25 },
    ],
  },
  {
    key: "salad_vegetables_legumes",
    name: { ar: "خضراوات وبقوليات", en: "Vegetables & Legumes" },
    maxSelections: 19,
    displayStyle: "checkbox_grid",
    options: [
      { key: "tomato", name: { ar: "طماطم", en: "Tomato" }, calories: 18 },
      { key: "carrot", name: { ar: "جزر", en: "Carrot" }, calories: 41 },
      { key: "cucumber", name: { ar: "خيار", en: "Cucumber" }, calories: 41 },
      { key: "corn", name: { ar: "ذرة", en: "Corn" }, calories: 86 },
      { key: "chickpeas", name: { ar: "حمص", en: "Chickpeas" }, calories: 164 },
      { key: "jalapeno", name: { ar: "هالبينو", en: "Jalapeño" }, calories: 29 },
      { key: "red_kidney_beans", name: { ar: "فاصوليا حمراء", en: "Red Kidney Beans" }, calories: 127 },
      { key: "beetroot", name: { ar: "بنجر", en: "Beetroot" }, calories: 43 },
      { key: "hot_pepper", name: { ar: "فلفل حار", en: "Hot Pepper" }, calories: 40 },
      { key: "coriander", name: { ar: "كزبرة", en: "Coriander" }, calories: 15 },
      { key: "mushroom", name: { ar: "فطر", en: "Mushroom" }, calories: 22 },
      { key: "broccoli", name: { ar: "بروكلي", en: "Broccoli" }, calories: 34 },
      { key: "grilled_mixed_vegetables", name: { ar: "خضار مشكل مشوي", en: "Grilled Mixed Vegetables" }, calories: 45 },
      { key: "red_onion", name: { ar: "بصل احمر", en: "Red Onion" }, calories: 40 },
      { key: "green_onion", name: { ar: "بصل اخضر", en: "Green Onion" }, calories: 32 },
      { key: "green_olives", name: { ar: "زيتون اخضر", en: "Green Olives" }, calories: 145 },
      { key: "black_olives", name: { ar: "زيتون اسود", en: "Black Olives" }, calories: 120 },
      { key: "mint", name: { ar: "نعناع", en: "Mint" }, calories: 44 },
      { key: "pickled_onion", name: { ar: "بصل مخلل", en: "Pickled Onion" }, calories: 25 },
    ],
  },
  {
    key: "salad_fruits",
    name: { ar: "فواكه", en: "Fruits" },
    maxSelections: 4,
    displayStyle: "checkbox_grid",
    options: [
      { key: "mango", name: { ar: "مانجا", en: "Mango" }, calories: 60 },
      { key: "green_apple", name: { ar: "تفاح اخضر", en: "Green Apple" }, calories: 52 },
      { key: "pomegranate", name: { ar: "رمان", en: "Pomegranate" }, calories: 83 },
      { key: "strawberry", name: { ar: "فراولة", en: "Strawberry" }, calories: 32 },
      { key: "blueberry", name: { ar: "توت ازرق", en: "Blueberry" }, calories: 57 },
      { key: "red_berries", name: { ar: "توت احمر", en: "Red Berries" }, calories: 52 },
      { key: "watermelon", name: { ar: "بطيخ", en: "Watermelon" }, calories: 30 },
      { key: "melon", name: { ar: "شمام", en: "Melon" }, calories: 34 },
      { key: "dates", name: { ar: "تمر", en: "Dates" }, calories: 277 },
    ],
  },
  {
    key: "salad_proteins",
    name: { ar: "بروتينات", en: "Proteins" },
    maxSelections: 1,
    displayStyle: "radio_cards",
    options: [
      { key: "boiled_egg", name: { ar: "بيض مسلوق", en: "Boiled Egg" }, calories: 155 },
      { key: "tuna", name: { ar: "تونا", en: "Tuna" }, calories: 116 },
      { key: "fajita", name: { ar: "فاهيتا", en: "Fajita" }, calories: 200 },
      { key: "spicy_chicken", name: { ar: "دجاج سبايسي", en: "Spicy Chicken" }, calories: 220 },
      { key: "italian_chicken", name: { ar: "دجاج توابل إيطالية", en: "Italian Seasoned Chicken" }, calories: 200 },
      { key: "tikka_chicken", name: { ar: "دجاج تكا", en: "Tikka Chicken" }, calories: 200 },
      { key: "asian_chicken", name: { ar: "دجاج آسيوي", en: "Asian Chicken" }, calories: 220 },
      { key: "chicken_strips", name: { ar: "استربس", en: "Chicken Strips" }, calories: 250 },
      { key: "grilled_chicken", name: { ar: "دجاج مشوي", en: "Grilled Chicken" }, calories: 175 },
      { key: "mexican_chicken", name: { ar: "دجاج مكسيكي", en: "Mexican Chicken" }, calories: 210 },
      { key: "meatballs", name: { ar: "كرات لحم ( زيادة على سعر الوجبة )", en: "Meatballs (extra charge)" }, calories: 280, extraPriceHalala: 300 },
      { key: "beef_stroganoff", name: { ar: "لحم استرغانوف ( زيادة على سعر الوجبة )", en: "Beef Stroganoff (extra charge)" }, calories: 250, extraPriceHalala: 300 },
      { key: "beef_steak", name: { ar: "ستيك لحم ( زيادة على سعر الوجبة )", en: "Beef Steak (extra charge)" }, calories: 270, extraPriceHalala: 1600 },
      { key: "shrimp", name: { ar: "جمبري ( زيادة على سعر الوجبة )", en: "Shrimp (extra charge)" }, calories: 380, extraPriceHalala: 1600 },
      { key: "fish_fillet", name: { ar: "سمك فيليه", en: "Fish Fillet" }, calories: 130 },
      { key: "salmon", name: { ar: "سالمون", en: "Salmon" }, calories: 210, extraPriceHalala: 1600 },
    ],
  },
  {
    key: "salad_cheese_nuts",
    name: { ar: "الاجبان و المكسرات", en: "Cheese & Nuts" },
    maxSelections: 2,
    displayStyle: "checkbox_grid",
    options: [
      { key: "cashew", name: { ar: "كاجو", en: "Cashew" }, calories: 160 },
      { key: "walnut", name: { ar: "عين الجمل", en: "Walnut" }, calories: 185 },
      { key: "sesame", name: { ar: "سمسم", en: "Sesame" }, calories: 123 },
      { key: "feta", name: { ar: "فيتا", en: "Feta" }, calories: 70 },
      { key: "parmesan", name: { ar: "بارميزان", en: "Parmesan" }, calories: 104 },
    ],
  },
  {
    key: "salad_sauces",
    name: { ar: "الصوصات", en: "Sauces" },
    maxSelections: 1,
    displayStyle: "radio_cards",
    options: [
      { key: "ranch", name: { ar: "رانش", en: "Ranch" }, calories: 50 },
      { key: "spicy_ranch", name: { ar: "سبايسي رانش", en: "Spicy Ranch" }, calories: 55 },
      { key: "pesto", name: { ar: "صوص بيستو", en: "Pesto Sauce" }, calories: 60 },
      { key: "balsamic", name: { ar: "بالسميك", en: "Balsamic" }, calories: 40 },
      { key: "caesar", name: { ar: "سيزر", en: "Caesar" }, calories: 55 },
      { key: "honey_mustard", name: { ar: "هاني ماستر", en: "Honey Mustard" }, calories: 45 },
      { key: "mint_yogurt", name: { ar: "زبادي بالنعناع", en: "Mint Yogurt" }, calories: 20 },
      { key: "honey_garlic", name: { ar: "عسل بالثوم", en: "Honey Garlic" }, calories: 45 },
    ],
  },
  {
    key: "salad_extra_protein",
    name: { ar: "اضافات البروتين", en: "Extra Protein" },
    maxSelections: 4,
    displayStyle: "checkbox_grid",
    options: [
      { key: "extra_chicken_50g", name: { ar: "زيادة 50 جرام من الدجاج", en: "Extra 50g Chicken" }, extraPriceHalala: 500, extraWeightUnitGrams: 50 },
      { key: "extra_beef_steak_50g", name: { ar: "زيادة 50 جرام من ستيك اللحم", en: "Extra 50g Beef Steak" }, extraPriceHalala: 1000, extraWeightUnitGrams: 50 },
      { key: "extra_shrimp_50g", name: { ar: "زيادة 50 جرام من الجمبري", en: "Extra 50g Shrimp" }, extraPriceHalala: 1000, extraWeightUnitGrams: 50 },
      { key: "extra_salmon_50g", name: { ar: "زيادة 50 جرام من السالمون", en: "Extra 50g Salmon" }, extraPriceHalala: 1000, extraWeightUnitGrams: 50 },
    ],
  },
];

function optionNutrition(option) {
  return {
    calories: Number(option.calories || 0),
    proteinGrams: 0,
    carbGrams: 0,
    fatGrams: 0,
  };
}

async function ensureBasicSaladProduct(now) {
  let product = await MenuProduct.findOne({ key: BASIC_SALAD_KEY });
  if (!product) {
    await ensureCustomOrderCompatibility();
    product = await MenuProduct.findOne({ key: BASIC_SALAD_KEY });
  }
  if (!product) throw new Error("basic_salad could not be created.");

  const sourceProduct = await MenuProduct.findOne({ key: SOURCE_SALAD_KEY }).lean();
  const imageUrl = sourceProduct?.imageUrl || product.imageUrl || "";

  const catalogItem = await CatalogItem.findOneAndUpdate(
    { key: BASIC_SALAD_KEY },
    {
      $set: {
        nameI18n: SALAD_NAME,
        descriptionI18n: SALAD_DESCRIPTION,
        imageUrl,
        itemKind: "product",
        nutrition: { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
        isActive: true,
        isAvailable: true,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  product = await MenuProduct.findOneAndUpdate(
    { _id: product._id },
    {
      $set: {
        catalogItemId: catalogItem._id,
        name: SALAD_NAME,
        description: SALAD_DESCRIPTION,
        imageUrl,
        itemType: "basic_salad",
        pricingModel: "fixed",
        priceHalala: 2900,
        baseUnitGrams: 100,
        defaultWeightGrams: 100,
        minWeightGrams: 100,
        maxWeightGrams: 100,
        weightStepGrams: 1,
        weightStepPriceHalala: 0,
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
          priceLabelMode: "fixed",
          behaviorHint: "open_builder",
        },
        publishedAt: now,
      },
    },
    { new: true, runValidators: true }
  );

  return { product, catalogItem };
}

async function seedGroupsAndOptions(product, now) {
  const activeGroupRelationIds = [];
  const activeOptionRelationIds = [];
  const summary = [];

  for (const [groupIndex, definition] of SALAD_GROUPS.entries()) {
    const group = await MenuOptionGroup.findOneAndUpdate(
      { key: definition.key },
      {
        $set: {
          key: definition.key,
          name: definition.name,
          description: { ar: "", en: "" },
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: groupIndex + 1,
          ui: { displayStyle: definition.displayStyle },
          publishedAt: now,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const groupRelation = await ProductOptionGroup.findOneAndUpdate(
      { productId: product._id, groupId: group._id },
      {
        $set: {
          productId: product._id,
          groupId: group._id,
          minSelections: 0,
          maxSelections: definition.maxSelections,
          isRequired: false,
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: groupIndex + 1,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    activeGroupRelationIds.push(groupRelation._id);

    const activeOptionIds = [];
    for (const [optionIndex, optionDefinition] of definition.options.entries()) {
      const extraPriceHalala = Number(optionDefinition.extraPriceHalala || 0);
      const extraWeightUnitGrams = Number(optionDefinition.extraWeightUnitGrams || 0);
      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: optionDefinition.key },
        {
          $set: {
            groupId: group._id,
            catalogItemId: null,
            key: optionDefinition.key,
            name: optionDefinition.name,
            description: { ar: "", en: "" },
            imageUrl: "",
            extraPriceHalala,
            extraFeeHalala: extraPriceHalala,
            extraWeightUnitGrams,
            extraWeightPriceHalala: 0,
            currency: "SAR",
            availableFor: ["one_time", "subscription"],
            availableForSubscription: true,
            nutrition: optionNutrition(optionDefinition),
            proteinFamilyKey: "",
            displayCategoryKey: definition.key,
            premiumKey: "",
            ruleTags: [],
            selectionType: "",
            isActive: true,
            isVisible: true,
            isAvailable: true,
            sortOrder: optionIndex + 1,
            publishedAt: now,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      activeOptionIds.push(option._id);

      const optionRelation = await ProductGroupOption.findOneAndUpdate(
        { productId: product._id, groupId: group._id, optionId: option._id },
        {
          $set: {
            productId: product._id,
            groupId: group._id,
            optionId: option._id,
            extraPriceHalala,
            extraWeightUnitGrams,
            extraWeightPriceHalala: 0,
            isActive: true,
            isVisible: true,
            isAvailable: true,
            sortOrder: optionIndex + 1,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      activeOptionRelationIds.push(optionRelation._id);
    }

    await MenuOption.updateMany(
      { groupId: group._id, _id: { $nin: activeOptionIds } },
      { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
    );

    summary.push({
      key: definition.key,
      name: definition.name,
      minSelections: 0,
      maxSelections: definition.maxSelections,
      options: definition.options.length,
    });
  }

  await ProductOptionGroup.updateMany(
    { productId: product._id, _id: { $nin: activeGroupRelationIds } },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );
  await ProductGroupOption.updateMany(
    { productId: product._id, _id: { $nin: activeOptionRelationIds } },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );

  return summary;
}

async function verifyPublicMenu() {
  const menu = await getPublishedMenu({ lang: "ar" });
  const category = (menu.categories || []).find((row) => row.key === CUSTOM_ORDER_KEY);
  const product = (category?.products || []).find((row) => row.key === BASIC_SALAD_KEY);
  if (!product) {
    throw new Error("basic_salad is not returned by the published custom_order menu.");
  }

  const expectedByKey = new Map(SALAD_GROUPS.map((group) => [group.key, group]));
  const returnedGroups = Array.isArray(product.optionGroups) ? product.optionGroups : [];
  const missingGroups = SALAD_GROUPS
    .map((group) => group.key)
    .filter((key) => !returnedGroups.some((group) => group.key === key));
  if (missingGroups.length) {
    throw new Error(`Published basic_salad is missing groups: ${missingGroups.join(", ")}`);
  }

  for (const returnedGroup of returnedGroups) {
    const expected = expectedByKey.get(returnedGroup.key);
    if (!expected) continue;
    if ((returnedGroup.options || []).length !== expected.options.length) {
      throw new Error(
        `${returnedGroup.key} returned ${(returnedGroup.options || []).length} options; expected ${expected.options.length}.`
      );
    }
  }

  return {
    categoryKey: category.key,
    productKey: product.key,
    productName: product.name,
    priceHalala: product.priceHalala,
    requiresBuilder: product.requiresBuilder,
    groups: returnedGroups.map((group) => ({
      key: group.key,
      name: group.name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      options: (group.options || []).length,
      optionsWithCalories: (group.options || []).filter((option) => Number(option.calories || 0) > 0).length,
    })),
  };
}

async function seedBasicSaladBuilder() {
  const now = new Date();
  const { product, catalogItem } = await ensureBasicSaladProduct(now);
  const seededGroups = await seedGroupsAndOptions(product, now);
  const publicMenu = await verifyPublicMenu();

  return {
    basicSalad: {
      id: product._id.toString(),
      key: product.key,
      name: product.name,
      priceHalala: product.priceHalala,
      catalogItemId: catalogItem._id.toString(),
    },
    seededGroups,
    publicMenu,
  };
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await seedBasicSaladBuilder();
    console.log("[seed-basic-salad-builder] completed", JSON.stringify(result, null, 2));
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[seed-basic-salad-builder:error] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  SALAD_GROUPS,
  seedBasicSaladBuilder,
};
