#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const MenuVersion = require("../src/models/MenuVersion");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const Addon = require("../src/models/Addon");
const Setting = require("../src/models/Setting");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");
const { publishMenu } = require("../src/services/orders/menuCatalogService");
const { pickupLocations, settings } = require("./fixtures/subscription-demo-data");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
const now = new Date();
const SYSTEM_CURRENCY = "SAR";

function name(ar, en = ar) {
  return { ar, en };
}

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    reset: argv.includes("--reset") || isTruthy(process.env.ALLOW_CATALOG_RESET),
  };
}

function activePublishedFields(sortOrder = 0) {
  return {
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder,
    publishedAt: now,
  };
}

const categoryRows = [
  { key: "custom_order", name: name("اطلب على مزاجك", "Custom Order"), ui: { cardVariant: "standard" } },
  { key: "light_options", name: name("اختيارات خفيفة", "Light Options"), ui: { cardVariant: "standard" } },
  { key: "cold_sandwiches", name: name("الساندويتش البارد", "Cold Sandwiches"), ui: { cardVariant: "standard" } },
  { key: "sourdough", name: name("الساندويشات", "Sourdough Sandwiches"), ui: { cardVariant: "standard" } },
  { key: "desserts", name: name("الحلويات", "Desserts"), ui: { cardVariant: "addon" } },
  { key: "juices", name: name("العصائر", "Juices"), ui: { cardVariant: "addon" } },
  { key: "drinks", name: name("المشروبات", "Drinks"), ui: { cardVariant: "addon" } },
  { key: "ice_cream", name: name("الايس كريم", "Ice Cream"), ui: { cardVariant: "addon" } },
];

const groupDefinitions = [
  {
    key: "proteins",
    name: name("بروتينات", "Proteins"),
    ui: { displayStyle: "radio_cards" },
    options: [
      {
        key: "chicken",
        name: name("دجاج", "Chicken"),
        displayCategoryKey: "chicken",
        proteinFamilyKey: "chicken",
        selectionType: "standard_meal",
        extraFeeHalala: 0,
      },
      {
        key: "beef",
        name: name("لحم", "Beef"),
        displayCategoryKey: "beef",
        proteinFamilyKey: "beef",
        selectionType: "standard_meal",
        extraFeeHalala: 0,
      },
      {
        key: "fish",
        name: name("سمك", "Fish"),
        displayCategoryKey: "fish",
        proteinFamilyKey: "fish",
        selectionType: "standard_meal",
        extraFeeHalala: 0,
      },
      {
        key: "eggs",
        name: name("بيض", "Eggs"),
        displayCategoryKey: "eggs",
        proteinFamilyKey: "eggs",
        selectionType: "standard_meal",
        extraFeeHalala: 0,
      },
      {
        key: "beef_steak",
        name: name("ستيك لحم", "Beef Steak"),
        premiumKey: "beef_steak",
        displayCategoryKey: "premium",
        proteinFamilyKey: "beef",
        selectionType: "premium_meal",
        extraFeeHalala: 2000,
      },
      {
        key: "shrimp",
        name: name("جمبري", "Shrimp"),
        premiumKey: "shrimp",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        selectionType: "premium_meal",
        extraFeeHalala: 2000,
      },
      {
        key: "salmon",
        name: name("سالمون", "Salmon"),
        premiumKey: "salmon",
        displayCategoryKey: "premium",
        proteinFamilyKey: "fish",
        selectionType: "premium_meal",
        extraFeeHalala: 2000,
      },
    ],
  },
  {
    key: "carbs",
    name: name("كارب", "Carbs"),
    ui: { displayStyle: "chips" },
    options: [
      { key: "white_rice", name: name("ارز ابيض", "White Rice"), displayCategoryKey: "standard_carbs" },
      { key: "brown_rice", name: name("ارز اسمر", "Brown Rice"), displayCategoryKey: "standard_carbs" },
      { key: "potato", name: name("بطاطس", "Potato"), displayCategoryKey: "standard_carbs" },
      { key: "sweet_potato", name: name("بطاطا حلوة", "Sweet Potato"), displayCategoryKey: "standard_carbs" },
      { key: "pasta", name: name("مكرونة", "Pasta"), displayCategoryKey: "standard_carbs" },
    ],
  },
  {
    key: "leafy_greens",
    name: name("ورقيات", "Leafy Greens"),
    ui: { displayStyle: "checkbox_grid" },
    options: [
      { key: "lettuce", name: name("خس", "Lettuce") },
      { key: "arugula", name: name("جرجير", "Arugula") },
      { key: "spinach", name: name("سبانخ", "Spinach") },
    ],
  },
  {
    key: "vegetables_legumes",
    name: name("خضراوات وبقوليات", "Vegetables & Legumes"),
    ui: { displayStyle: "checkbox_grid" },
    options: [
      { key: "cucumber", name: name("خيار", "Cucumber") },
      { key: "tomato", name: name("طماطم", "Tomato") },
      { key: "corn", name: name("ذرة", "Corn") },
      { key: "carrot", name: name("جزر", "Carrot") },
      { key: "red_beans", name: name("فاصوليا حمراء", "Red Beans") },
    ],
  },
  {
    key: "cheese_nuts",
    name: name("الأجبان والمكسرات", "Cheese & Nuts"),
    ui: { displayStyle: "checkbox_grid" },
    options: [
      { key: "feta_cheese", name: name("جبنة فيتا", "Feta Cheese") },
      { key: "almond", name: name("لوز", "Almond") },
      { key: "walnut", name: name("جوز", "Walnut") },
    ],
  },
  {
    key: "fruits",
    name: name("فواكه", "Fruits"),
    ui: { displayStyle: "checkbox_grid" },
    options: [
      { key: "apple", name: name("تفاح", "Apple") },
      { key: "pomegranate", name: name("رمان", "Pomegranate") },
      { key: "mango", name: name("مانجا", "Mango") },
    ],
  },
  {
    key: "sauces",
    name: name("الصوصات", "Sauces"),
    ui: { displayStyle: "radio_cards" },
    options: [
      { key: "ranch", name: name("رانش", "Ranch") },
      { key: "lemon_mustard", name: name("ليمون وخردل", "Lemon Mustard") },
      { key: "balsamic", name: name("بلسميك", "Balsamic") },
    ],
  },
];

const saladIngredientGroupAliases = {
  vegetables_legumes: "vegetables",
  sauces: "sauce",
};

const standardProteinOptionKeys = ["chicken", "beef", "fish", "eggs"];

const productGroupAllowedOptionKeys = {
  basic_salad: {
    proteins: standardProteinOptionKeys,
  },
  basic_meal: {
    proteins: standardProteinOptionKeys,
  },
};

const productRows = [
  {
    key: "basic_salad",
    category: "custom_order",
    itemType: "basic_salad",
    name: name("سلطة بيسك", "Basic Salad"),
    pricingModel: "per_100g",
    priceHalala: 2900,
    availableFor: ["one_time", "subscription"],
    ui: { cardVariant: "standard" },
    groups: [
      ["leafy_greens", 2, 2],
      ["vegetables_legumes", 0, 99],
      ["fruits", 0, 99],
      ["proteins", 1, 1],
      ["cheese_nuts", 0, 99],
      ["sauces", 1, 1],
    ],
  },
  {
    key: "basic_meal",
    category: "custom_order",
    itemType: "basic_meal",
    name: name("وجبة بيسك", "Basic Meal"),
    pricingModel: "per_100g",
    priceHalala: 1900,
    availableFor: ["one_time", "subscription"],
    ui: { cardVariant: "standard" },
    groups: [
      ["carbs", 1, 2],
      ["proteins", 1, 1],
    ],
  },
  {
    key: "premium_large_salad",
    category: "custom_order",
    itemType: "basic_salad",
    name: name("سلطة كبيرة مميزة", "Premium Large Salad"),
    pricingModel: "fixed",
    priceHalala: 2900,
    defaultWeightGrams: 0,
    availableFor: ["subscription"],
    ui: { cardVariant: "large_salad" },
    groups: [
      ["leafy_greens", 0, 99, false],
      ["vegetables_legumes", 0, 99, false],
      ["proteins", 1, 1, true],
      ["cheese_nuts", 0, 99, false],
      ["fruits", 0, 99, false],
      ["sauces", 1, 1, true],
    ],
  },
  {
    key: "small_salad",
    category: "custom_order",
    itemType: "green_salad",
    name: name("سلطة خضراء صغيرة", "Small Green Salad"),
    pricingModel: "fixed",
    priceHalala: 900,
    availableFor: ["one_time", "subscription"],
    ui: { cardVariant: "addon" },
  },
  {
    key: "green_salad",
    category: "custom_order",
    itemType: "green_salad",
    name: name("سلطة خضرا", "Green Salad"),
    pricingModel: "per_100g",
    priceHalala: 1500,
    availableFor: ["one_time", "subscription"],
    ui: { cardVariant: "standard" },
    groups: [
      ["leafy_greens", 2, 2],
      ["vegetables_legumes", 0, 99],
      ["sauces", 1, 1],
    ],
  },
  {
    key: "fruit_salad",
    category: "custom_order",
    itemType: "fruit_salad",
    name: name("سلطة فواكه", "Fruit Salad"),
    pricingModel: "fixed",
    priceHalala: 1700,
    defaultWeightGrams: 150,
    availableFor: ["one_time"],
    ui: { cardVariant: "standard" },
    groups: [["fruits", 0, 99]],
  },
  {
    key: "greek_yogurt",
    category: "custom_order",
    itemType: "greek_yogurt",
    name: name("زبادي يوناني", "Greek Yogurt"),
    pricingModel: "fixed",
    priceHalala: 1700,
    defaultWeightGrams: 200,
    availableFor: ["one_time"],
    ui: { cardVariant: "standard" },
    groups: [
      ["fruits", 0, 99],
      ["cheese_nuts", 0, 99],
    ],
  },
  { key: "chicken_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("ساندويتش دجاج", "Chicken Sandwich"), pricingModel: "fixed", priceHalala: 1300, availableFor: ["subscription"], ui: { cardVariant: "standard" }, proteinFamilyKey: "chicken" },
  { key: "tuna_sandwich", category: "cold_sandwiches", itemType: "cold_sandwich", name: name("ساندويتش تونا", "Tuna Sandwich"), pricingModel: "fixed", priceHalala: 1300, availableFor: ["subscription"], ui: { cardVariant: "standard" }, proteinFamilyKey: "fish" },
  { key: "sourdough_turkey", category: "sourdough", itemType: "sourdough", name: name("ساوردو تركي", "Sourdough Turkey"), pricingModel: "fixed", priceHalala: 2300, availableFor: ["subscription"], ui: { cardVariant: "standard" }, proteinFamilyKey: "other" },
  { key: "berry_cheesecake", category: "desserts", itemType: "dessert", name: name("تشيز كيك بالتوت", "Berry Cheesecake"), pricingModel: "fixed", priceHalala: 1900, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
  { key: "dark_brownies", category: "desserts", itemType: "dessert", name: name("براونيز داكن", "Dark Brownies"), pricingModel: "fixed", priceHalala: 1300, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
  { key: "berry_blast", category: "juices", itemType: "juice", name: name("بيري بلاست", "Berry Blast"), pricingModel: "fixed", priceHalala: 1100, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
  { key: "classic_green", category: "juices", itemType: "juice", name: name("كلاسيك جرين", "Classic Green"), pricingModel: "fixed", priceHalala: 1100, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
  { key: "protein_drink", category: "drinks", itemType: "drink", name: name("مشروب بروتين", "Protein Drink"), pricingModel: "fixed", priceHalala: 1900, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
  { key: "water", category: "drinks", itemType: "drink", name: name("مياه عادية", "Water"), pricingModel: "fixed", priceHalala: 200, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
  { key: "vanilla_ice_cream", category: "ice_cream", itemType: "ice_cream", name: name("ايس كريم فانيليا", "Vanilla Ice Cream"), pricingModel: "fixed", priceHalala: 1300, availableFor: ["one_time", "subscription"], ui: { cardVariant: "addon" } },
];

const builderCategoryRows = [
  { key: "chicken", dimension: "protein", name: name("دجاج", "Chicken"), sortOrder: 10 },
  { key: "beef", dimension: "protein", name: name("لحم", "Beef"), sortOrder: 20, rules: { dailyLimit: 1, ruleKey: "beef_daily_limit", unit: "slots" } },
  { key: "fish", dimension: "protein", name: name("أسماك", "Fish"), sortOrder: 30 },
  { key: "eggs", dimension: "protein", name: name("بيض", "Eggs"), sortOrder: 40 },
  { key: "premium", dimension: "protein", name: name("بريميوم", "Premium"), sortOrder: 50, ui: { cardVariant: "premium" } },
  { key: "standard_carbs", dimension: "carb", name: name("كربوهيدرات", "Standard Carbs"), sortOrder: 10, rules: { maxTypes: 2, maxTotalGrams: 300, unit: "grams", ruleKey: "carb_split" } },
  { key: "large_salad", dimension: "carb", name: name("سلطة كبيرة مميزة", "Premium Large Salad"), sortOrder: 20, ui: { cardVariant: "large_salad" }, rules: { ruleKey: "premium_large_salad" } },
];

// Menu* collections are the canonical catalog source of truth in this seed.
// The Builder*, Sandwich, and SaladIngredient rows below are temporary mirrors
// for legacy planner validation/read paths that still resolve those model IDs.
async function resetCatalogData() {
  await Promise.all([
    ProductGroupOption.deleteMany({}),
    ProductOptionGroup.deleteMany({}),
    MenuOption.deleteMany({}),
    MenuOptionGroup.deleteMany({}),
    MenuProduct.deleteMany({}),
    MenuCategory.deleteMany({}),
    MenuVersion.deleteMany({}),
    BuilderProtein.deleteMany({}),
    BuilderCarb.deleteMany({}),
    BuilderCategory.deleteMany({}),
    Sandwich.deleteMany({}),
    SaladIngredient.deleteMany({}),
  ]);
}

async function seedCategories() {
  const categoryMap = new Map();
  for (let index = 0; index < categoryRows.length; index += 1) {
    const row = categoryRows[index];
    const doc = await MenuCategory.findOneAndUpdate(
      { key: row.key },
      {
        $set: {
          key: row.key,
          name: row.name,
          ui: row.ui,
          ...activePublishedFields((index + 1) * 10),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    categoryMap.set(doc.key, doc);
  }
  return categoryMap;
}

async function seedOptionGroupsAndOptions() {
  const groupMap = new Map();
  const optionMap = new Map();

  for (let groupIndex = 0; groupIndex < groupDefinitions.length; groupIndex += 1) {
    const groupDef = groupDefinitions[groupIndex];
    const group = await MenuOptionGroup.findOneAndUpdate(
      { key: groupDef.key },
      {
        $set: {
          key: groupDef.key,
          name: groupDef.name,
          ui: groupDef.ui,
          ...activePublishedFields((groupIndex + 1) * 10),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    groupMap.set(group.key, group);

    for (let optionIndex = 0; optionIndex < groupDef.options.length; optionIndex += 1) {
      const optionDef = groupDef.options[optionIndex];
      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: optionDef.key },
        {
          $set: {
            groupId: group._id,
            key: optionDef.key,
            name: optionDef.name,
            availableFor: ["one_time", "subscription"],
            availableForSubscription: true,
            extraPriceHalala: 0,
            extraWeightPriceHalala: 0,
            extraWeightUnitGrams: 0,
            extraFeeHalala: Number(optionDef.extraFeeHalala || 0),
            premiumKey: optionDef.premiumKey || "",
            proteinFamilyKey: optionDef.proteinFamilyKey || "",
            displayCategoryKey: optionDef.displayCategoryKey || "",
            selectionType: optionDef.selectionType || "",
            ruleTags: optionDef.ruleTags || [],
            ...activePublishedFields((optionIndex + 1) * 10),
          },
        },
        { upsert: true, new: true, runValidators: true }
      );
      optionMap.set(`${group.key}:${option.key}`, option);
    }
  }

  return { groupMap, optionMap };
}

async function seedBuilderCompatibilityCategories() {
  const categoryMap = new Map();
  for (const row of builderCategoryRows) {
    const doc = await BuilderCategory.findOneAndUpdate(
      { dimension: row.dimension, key: row.key },
      {
        $set: {
          key: row.key,
          dimension: row.dimension,
          name: row.name,
          ui: row.ui || { cardVariant: row.key === "premium" ? "premium" : "standard" },
          rules: row.rules || {},
          isActive: true,
          sortOrder: row.sortOrder,
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    categoryMap.set(`${row.dimension}:${row.key}`, doc);
  }
  return categoryMap;
}

async function seedBuilderCompatibilityMirrors({ optionMap, builderCategoryMap }) {
  for (const groupDef of groupDefinitions) {
    for (let optionIndex = 0; optionIndex < groupDef.options.length; optionIndex += 1) {
      const optionDef = groupDef.options[optionIndex];
      const option = optionMap.get(`${groupDef.key}:${optionDef.key}`);
      if (!option) continue;

      if (groupDef.key === "proteins") {
        const displayCategoryKey = optionDef.displayCategoryKey || "other";
        const displayCategory = builderCategoryMap.get(`protein:${displayCategoryKey}`);
        if (!displayCategory) continue;

        const query = optionDef.premiumKey ? { premiumKey: optionDef.premiumKey } : { key: optionDef.key };
        const update = {
          $setOnInsert: {
            _id: option._id,
          },
          $set: {
            key: optionDef.key,
            name: optionDef.name,
            displayCategoryId: displayCategory._id,
            displayCategoryKey,
            proteinFamilyKey: optionDef.proteinFamilyKey || "other",
            selectionType: optionDef.selectionType || "standard_meal",
            isPremium: Number(optionDef.extraFeeHalala || 0) > 0,
            extraFeeHalala: Number(optionDef.extraFeeHalala || 0),
            currency: SYSTEM_CURRENCY,
            availableForSubscription: true,
            isActive: true,
            sortOrder: (optionIndex + 1) * 10,
          },
        };
        if (optionDef.premiumKey) update.$set.premiumKey = optionDef.premiumKey;
        else update.$unset = { premiumKey: "" };

        await BuilderProtein.updateOne(query, update, { upsert: true, runValidators: true });
      }

      if (groupDef.key === "carbs") {
        const displayCategory = builderCategoryMap.get("carb:standard_carbs");
        await BuilderCarb.updateOne(
          { key: optionDef.key },
          {
            $setOnInsert: {
              _id: option._id,
            },
            $set: {
              key: optionDef.key,
              name: optionDef.name,
              displayCategoryId: displayCategory._id,
              displayCategoryKey: "standard_carbs",
              availableForSubscription: true,
              isActive: true,
              sortOrder: (optionIndex + 1) * 10,
            },
          },
          { upsert: true, runValidators: true }
        );
      }

      if (["leafy_greens", "vegetables_legumes", "cheese_nuts", "fruits", "sauces"].includes(groupDef.key)) {
        const groupKey = saladIngredientGroupAliases[groupDef.key] || groupDef.key;
        await SaladIngredient.updateOne(
          { _id: option._id },
          {
            $set: {
              name: optionDef.name,
              groupKey,
              price: 0,
              calories: 0,
              maxQuantity: 99,
              isActive: true,
              sortOrder: (optionIndex + 1) * 10,
            },
          },
          { upsert: true, runValidators: true }
        );
      }
    }
  }
}

async function seedProducts({ categoryMap, groupMap, optionMap }) {
  const productMap = new Map();

  for (let productIndex = 0; productIndex < productRows.length; productIndex += 1) {
    const row = productRows[productIndex];
    const category = categoryMap.get(row.category);
    if (!category) throw new Error(`Missing category ${row.category} for ${row.key}`);

    const product = await MenuProduct.findOneAndUpdate(
      { key: row.key },
      {
        $set: {
          categoryId: category._id,
          key: row.key,
          name: row.name,
          itemType: row.itemType,
          pricingModel: row.pricingModel,
          priceHalala: row.priceHalala,
          baseUnitGrams: 100,
          defaultWeightGrams: row.defaultWeightGrams ?? (row.pricingModel === "per_100g" ? 100 : 0),
          minWeightGrams: row.pricingModel === "per_100g" ? 100 : 0,
          maxWeightGrams: row.maxWeightGrams || 0,
          weightStepGrams: 50,
          currency: SYSTEM_CURRENCY,
          availableFor: row.availableFor,
          ui: row.ui || { cardVariant: "standard" },
          ...activePublishedFields((productIndex + 1) * 10),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    productMap.set(product.key, product);

    if (Array.isArray(row.groups)) {
      for (let relationIndex = 0; relationIndex < row.groups.length; relationIndex += 1) {
        const [groupKey, minSelections, maxSelections, explicitRequired] = row.groups[relationIndex];
        const group = groupMap.get(groupKey);
        if (!group) throw new Error(`Missing option group ${groupKey} for ${row.key}`);

        await ProductOptionGroup.findOneAndUpdate(
          { productId: product._id, groupId: group._id },
          {
            $set: {
              productId: product._id,
              groupId: group._id,
              minSelections,
              maxSelections,
              isRequired: explicitRequired ?? minSelections > 0,
              isActive: true,
              isVisible: true,
              isAvailable: true,
              sortOrder: (relationIndex + 1) * 10,
            },
          },
          { upsert: true, runValidators: true }
        );

        const groupDef = groupDefinitions.find((definition) => definition.key === groupKey);
        const explicitAllowedKeys = productGroupAllowedOptionKeys[row.key]?.[groupKey];
        const allowedOptions = groupDef
          ? groupDef.options.filter((optionDef) => (
            !Array.isArray(explicitAllowedKeys) || explicitAllowedKeys.includes(optionDef.key)
          ))
          : [];
        const allowedOptionIds = [];
        for (let optionIndex = 0; optionIndex < allowedOptions.length; optionIndex += 1) {
          const optionDef = allowedOptions[optionIndex];
          const option = optionMap.get(`${groupKey}:${optionDef.key}`);
          if (!option) continue;
          allowedOptionIds.push(option._id);
          await ProductGroupOption.findOneAndUpdate(
            { productId: product._id, groupId: group._id, optionId: option._id },
            {
              $set: {
                productId: product._id,
                groupId: group._id,
                optionId: option._id,
                extraPriceHalala: 0,
                extraWeightUnitGrams: 0,
                extraWeightPriceHalala: 0,
                isActive: true,
                isVisible: true,
                isAvailable: true,
                sortOrder: (optionIndex + 1) * 10,
              },
            },
            { upsert: true, runValidators: true }
          );
        }

        await ProductGroupOption.updateMany(
          {
            productId: product._id,
            groupId: group._id,
            optionId: { $nin: allowedOptionIds },
          },
          {
            $set: {
              isActive: false,
              isVisible: false,
              isAvailable: false,
            },
          }
        );
      }
    }
  }

  return productMap;
}

async function seedSandwichCompatibility(productMap) {
  const sandwichProducts = productRows.filter((row) => ["cold_sandwich", "sourdough"].includes(row.itemType));
  for (let index = 0; index < sandwichProducts.length; index += 1) {
    const row = sandwichProducts[index];
    const product = productMap.get(row.key);
    if (!product) continue;

    await Sandwich.updateOne(
      { _id: product._id },
      {
        $set: {
          name: row.name,
          description: row.description || name("", ""),
          imageUrl: row.imageUrl || "",
          calories: 0,
          selectionType: "sandwich",
          categoryKey: "sandwich",
          pricingModel: "included",
          priceHalala: 0,
          proteinFamilyKey: row.proteinFamilyKey || "other",
          isActive: true,
          sortOrder: (index + 1) * 10,
        },
      },
      { upsert: true, runValidators: true }
    );
  }
}

async function seedSubscriptionAddons() {
  const addonProducts = productRows.filter((row) => (
    row.availableFor.includes("subscription")
    && ["juice", "dessert"].includes(row.itemType)
  ));

  for (const row of addonProducts) {
    await Addon.findOneAndUpdate(
      { name: row.name },
      {
        $set: {
          name: row.name,
          priceHalala: row.priceHalala,
          price: row.priceHalala / 100,
          kind: "item",
          category: row.itemType === "juice" ? "juice" : "snack",
          billingMode: "flat_once",
          isActive: true,
        },
      },
      { upsert: true, runValidators: true }
    );
  }

  const planAddons = [
    { name: name("اشتراك العصير", "Juice Subscription"), priceHalala: 1100, category: "juice", sortOrder: 1 },
    { name: name("اشتراك السناك", "Snack Subscription"), priceHalala: 1200, category: "snack", sortOrder: 2 },
    { name: name("اشتراك السلطة الصغيرة", "Small Salad Subscription"), priceHalala: 1200, category: "small_salad", sortOrder: 3 },
  ];

  for (const plan of planAddons) {
    await Addon.findOneAndUpdate(
      { name: plan.name },
      {
        $set: {
          ...plan,
          price: plan.priceHalala / 100,
          kind: "plan",
          billingMode: "per_day",
          isActive: true,
        },
      },
      { upsert: true, runValidators: true }
    );
  }
}

async function seedSettings() {
  if (Array.isArray(pickupLocations) && pickupLocations.length > 0) {
    await Setting.findOneAndUpdate(
      { key: "pickup_locations" },
      {
        $set: {
          key: "pickup_locations",
          value: pickupLocations,
          description: "System Pickup Locations (Branches)",
        },
      },
      { upsert: true }
    );
    console.log(`Synced ${pickupLocations.length} pickup locations.`);
  }

  if (settings && typeof settings === "object") {
    const settingEntries = Object.entries(settings);
    for (const [settingKey, value] of settingEntries) {
      await Setting.findOneAndUpdate(
        { key: settingKey },
        { $set: { key: settingKey, value, description: "System Base Setting" } },
        { upsert: true }
      );
    }
    console.log(`Synced ${settingEntries.length} base settings (VAT, Pricing, etc.).`);
  }
}

async function seed() {
  if (!uri) throw new Error("MONGO_URI or MONGODB_URI is required");
  const args = parseArgs();

  await mongoose.connect(uri);
  console.log("Connected to MongoDB for canonical catalog seeding.");

  if (args.reset) {
    console.warn("Resetting catalog-owned collections because --reset or ALLOW_CATALOG_RESET=true was provided.");
    await resetCatalogData();
  } else {
    console.log("Reset skipped. Existing catalog rows will be upserted by key.");
  }

  const builderCategoryMap = await seedBuilderCompatibilityCategories();
  const categoryMap = await seedCategories();
  const { groupMap, optionMap } = await seedOptionGroupsAndOptions();
  await seedBuilderCompatibilityMirrors({ optionMap, builderCategoryMap });
  const productMap = await seedProducts({ categoryMap, groupMap, optionMap });
  await seedSandwichCompatibility(productMap);
  await seedSubscriptionAddons();
  await seedSettings();

  await publishMenu({ notes: "Canonical Catalog Seed Cleanup" });

  console.log("Canonical catalog seed complete.");
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});
