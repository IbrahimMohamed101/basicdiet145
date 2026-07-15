#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const CatalogItem = require("../../src/models/CatalogItem");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const source = require("./fixtures/new-menu-source");

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function localized(ar, en = ar) {
  return { ar: String(ar || "").trim(), en: String(en || ar || "").trim() };
}

function productGroupKeys(productKey, customizationKind) {
  if (customizationKind === "bread") return ["new_menu_bread_choice"];
  if (customizationKind === "fruit") return ["new_menu_fruit_choice"];
  if (customizationKind === "custom_sandwich") return ["new_menu_bread_choice", "new_menu_sandwich_filling"];
  if (customizationKind === "salad_size") return [`${productKey}_size`];
  return [];
}

function productUi(categoryKey, customizable) {
  return {
    cardVariant: customizable ? "ready_meal_customizable" : (categoryKey === "new_menu_sandwiches" ? "sandwich_card" : "ready_meal"),
    cardSize: "medium",
    showDescription: true,
    showPrice: true,
    priceLabelMode: customizable ? "final_depends_on_options" : "fixed",
    behaviorHint: customizable ? "open_builder" : "direct_add",
  };
}

function buildSharedGroups() {
  return source.sharedOptionGroups.map((group) => ({
    key: group.key,
    name: localized(group.name[0], group.name[1]),
    description: localized(group.name[0], group.name[1]),
    minSelections: group.min,
    maxSelections: group.max,
    isRequired: group.min > 0,
    options: group.options.map(([suffix, ar, en, extraPriceHalala], index) => ({
      key: `${group.key}_${suffix}`,
      name: localized(ar, en),
      extraPriceHalala,
      sortOrder: index + 1,
      nutrition: { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
    })),
  }));
}

function buildSaladGroup(product) {
  const [key, , , , , , calories, protein, carbs, fat] = product;
  const large = source.saladLargeNutrition[key];
  return {
    key: `${key}_size`,
    name: localized("الحجم", "Size"),
    description: localized("اختر حجم السلطة", "Choose salad size"),
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    options: [
      { key: `${key}_size_small`, name: localized("صغير", "Small"), extraPriceHalala: 0, sortOrder: 1, nutrition: { calories, proteinGrams: protein, carbGrams: carbs, fatGrams: fat } },
      { key: `${key}_size_large`, name: localized("كبير", "Large"), extraPriceHalala: 1000, sortOrder: 2, nutrition: { calories: large[0], proteinGrams: large[1], carbGrams: large[2], fatGrams: large[3] } },
    ],
  };
}

async function upsert(Model, query, payload, { sync, unset = null } = {}) {
  const existing = await Model.findOne(query);
  if (!existing) return { document: await Model.create(payload), status: "created" };
  if (!sync) return { document: existing, status: "skipped" };
  const update = { $set: payload };
  if (unset) update.$unset = unset;
  await Model.updateOne({ _id: existing._id }, update, { runValidators: true });
  return { document: await Model.findById(existing._id), status: "updated" };
}

function increment(stats, label, status) {
  if (!stats[label]) stats[label] = { created: 0, skipped: 0, updated: 0 };
  stats[label][status] += 1;
}

async function seedNewMenu({ sync = false, log = console } = {}) {
  const stats = {};
  const now = new Date();
  const categoryByKey = new Map();
  const groupByKey = new Map();
  const optionByKey = new Map();

  for (const [key, ar, en, sortOrder, cardVariant] of source.categories) {
    const result = await upsert(MenuCategory, { key }, {
      key,
      name: localized(ar, en),
      description: localized(ar, en),
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder,
      ui: { cardVariant },
      publishedAt: now,
    }, { sync });
    categoryByKey.set(key, result.document);
    increment(stats, "categories", result.status);
  }

  const allGroups = buildSharedGroups();
  for (const product of source.products) {
    if (product[10] === "salad_size") allGroups.push(buildSaladGroup(product));
  }

  for (const group of allGroups) {
    const groupResult = await upsert(MenuOptionGroup, { key: group.key }, {
      key: group.key,
      name: group.name,
      description: group.description,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: 1,
      ui: { displayStyle: group.maxSelections === 1 ? "radio_cards" : "checkbox_grid" },
      publishedAt: now,
    }, { sync });
    groupByKey.set(group.key, { ...group, document: groupResult.document });
    increment(stats, "optionGroups", groupResult.status);

    for (const option of group.options) {
      const optionResult = await upsert(MenuOption, { groupId: groupResult.document._id, key: option.key }, {
        groupId: groupResult.document._id,
        key: option.key,
        name: option.name,
        description: option.name,
        extraPriceHalala: option.extraPriceHalala,
        extraFeeHalala: option.extraPriceHalala,
        nutrition: option.nutrition,
        availableFor: ["one_time"],
        availableForSubscription: false,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: option.sortOrder,
        publishedAt: now,
      }, { sync });
      optionByKey.set(option.key, optionResult.document);
      increment(stats, "options", optionResult.status);
    }
  }

  for (let index = 0; index < source.products.length; index += 1) {
    const [key, categoryKey, nameAr, ingredients, priceHalala, weightGrams, calories, protein, carbs, fat, customizationKind] = source.products[index];
    const category = categoryByKey.get(categoryKey);
    if (!category) throw new Error(`Missing seeded category ${categoryKey}`);

    const catalogResult = await upsert(CatalogItem, { key }, {
      key,
      nameI18n: localized(nameAr),
      descriptionI18n: localized(ingredients),
      itemKind: categoryKey === "new_menu_sandwiches" ? "sandwich" : "product",
      nutrition: { calories, proteinGrams: protein, carbsGrams: carbs, fatGrams: fat },
      isActive: true,
      isAvailable: true,
    }, { sync });
    increment(stats, "catalogItems", catalogResult.status);

    const groupKeys = productGroupKeys(key, customizationKind);
    const customizable = groupKeys.length > 0;
    const productResult = await upsert(MenuProduct, { key }, {
      categoryId: category._id,
      catalogItemId: catalogResult.document._id,
      key,
      name: localized(nameAr),
      description: localized(ingredients),
      itemType: "product",
      pricingModel: "fixed",
      priceHalala,
      defaultWeightGrams: weightGrams,
      currency: "SAR",
      availableFor: ["one_time"],
      isCustomizable: customizable,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: index + 1,
      ui: productUi(categoryKey, customizable),
      publishedAt: now,
    }, { sync });
    increment(stats, "products", productResult.status);

    for (let groupIndex = 0; groupIndex < groupKeys.length; groupIndex += 1) {
      const groupEntry = groupByKey.get(groupKeys[groupIndex]);
      if (!groupEntry) throw new Error(`Missing option group ${groupKeys[groupIndex]} for ${key}`);
      const relationResult = await upsert(ProductOptionGroup, { productId: productResult.document._id, groupId: groupEntry.document._id }, {
        productId: productResult.document._id,
        groupId: groupEntry.document._id,
        minSelections: groupEntry.minSelections,
        maxSelections: groupEntry.maxSelections,
        isRequired: groupEntry.isRequired,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: groupIndex + 1,
      }, { sync });
      increment(stats, "productGroups", relationResult.status);

      for (const optionDefinition of groupEntry.options) {
        const option = optionByKey.get(optionDefinition.key);
        const relationPrice = customizationKind === "custom_sandwich" && groupEntry.key === "new_menu_sandwich_filling"
          ? 0
          : optionDefinition.extraPriceHalala;
        const optionRelation = await upsert(ProductGroupOption, {
          productId: productResult.document._id,
          groupId: groupEntry.document._id,
          optionId: option._id,
        }, {
          productId: productResult.document._id,
          groupId: groupEntry.document._id,
          optionId: option._id,
          extraPriceHalala: relationPrice,
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: optionDefinition.sortOrder,
        }, { sync });
        increment(stats, "productOptions", optionRelation.status);
      }
    }
  }

  log.log("New menu bootstrap complete.");
  for (const [label, value] of Object.entries(stats)) {
    log.log(`${label}: created=${value.created} skipped=${value.skipped} updated=${value.updated}`);
  }
  return stats;
}

async function main() {
  const sync = process.argv.includes("--sync") || isTruthy(process.env.BOOTSTRAP_SYNC);
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await seedNewMenu({ sync });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[seed-new-menu] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { buildSaladGroup, buildSharedGroups, productGroupKeys, seedNewMenu };
