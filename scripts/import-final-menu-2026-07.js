#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuOption = require("../src/models/MenuOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const source = require("./bootstrap/fixtures/final-menu-2026-07");

const CONFIRM_PHRASE = "IMPORT_BASIC_DIET_FINAL_MENU_2026_07";

function truthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function normalizedText(value) {
  return String(value || "").trim();
}

function localized(value) {
  return {
    ar: normalizedText(value && value.ar),
    en: normalizedText(value && value.en),
  };
}

function requiredEnv(name) {
  const value = normalizedText(process.env[name]);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function integerOrZero(value) {
  return Math.round(numberOrZero(value));
}

function inferWeightGrams(product) {
  const joined = `${product.name?.ar || ""} ${product.name?.en || ""}`;
  const match = joined.match(/(\d+)\s*(?:g|gram|grams|جرام)/i);
  return match ? Number(match[1]) : 0;
}

function itemKindFor(product) {
  if (product.categoryKey === "sandwiches") return "sandwich";
  if (product.categoryKey === "desserts") return "dessert";
  if (product.categoryKey === "ice_cream") {
    return product.key === "ice_cream_ice_cream_add_on" ? "addon" : "dessert";
  }
  if (product.categoryKey === "juices" || product.categoryKey === "drinks") return "drink";
  if (product.categoryKey === "carbs") return "carb";
  return "product";
}

function productUi(product, customizable) {
  let cardVariant = "ready_meal";
  if (product.categoryKey === "sandwiches") cardVariant = "sandwich_card";
  if (["carbs", "greek_yogurt", "desserts", "juices", "drinks"].includes(product.categoryKey)) {
    cardVariant = "compact_product";
  }
  if (product.categoryKey === "ice_cream") cardVariant = "addon_card";
  if (customizable && product.categoryKey !== "sandwiches") cardVariant = "ready_meal_customizable";

  return {
    cardVariant,
    cardSize: "medium",
    showDescription: true,
    showPrice: true,
    priceLabelMode: customizable ? "final_depends_on_options" : "fixed",
    behaviorHint: customizable ? "open_builder" : "direct_add",
  };
}

function shouldPublish(product, publishIncomplete) {
  if (product.key === "sandwiches_build_your_own_sandwich") return true;
  if (product.status === "Needs Builder Setup") return false;
  if (product.status === "Needs Clarification") return false;
  return product.status === "Ready" || publishIncomplete;
}

function validateSource() {
  const errors = [];
  const categoryKeys = new Set();
  const productKeys = new Set();

  for (const category of source.categories) {
    if (!category.key) errors.push("Category without key");
    if (categoryKeys.has(category.key)) errors.push(`Duplicate category key: ${category.key}`);
    categoryKeys.add(category.key);
    if (!category.name?.ar || !category.name?.en) {
      errors.push(`Category ${category.key} must have Arabic and English names`);
    }
  }

  for (const product of source.products) {
    if (!product.key) errors.push("Product without key");
    if (productKeys.has(product.key)) errors.push(`Duplicate product key: ${product.key}`);
    productKeys.add(product.key);
    if (!categoryKeys.has(product.categoryKey)) {
      errors.push(`Product ${product.key} references missing category ${product.categoryKey}`);
    }
    if (!product.name?.ar || !product.name?.en) {
      errors.push(`Product ${product.key} must have Arabic and English names`);
    }
    if (!Number.isInteger(product.priceHalala) || product.priceHalala < 0) {
      errors.push(`Product ${product.key} has invalid priceHalala`);
    }
  }

  if (errors.length) {
    const error = new Error(`Final menu fixture is invalid:\n- ${errors.join("\n- ")}`);
    error.code = "FINAL_MENU_FIXTURE_INVALID";
    throw error;
  }
}

async function upsert(Model, query, createPayload, updatePayload, { sync }) {
  const existing = await Model.findOne(query);
  if (!existing) {
    return { document: await Model.create(createPayload), status: "created" };
  }
  if (!sync) return { document: existing, status: "skipped" };
  await Model.updateOne(
    { _id: existing._id },
    { $set: updatePayload || createPayload },
    { runValidators: true }
  );
  return { document: await Model.findById(existing._id), status: "updated" };
}

function increment(stats, label, status) {
  if (!stats[label]) stats[label] = { created: 0, skipped: 0, updated: 0 };
  stats[label][status] += 1;
}

const sharedGroups = [
  {
    key: "final_menu_bread_choice",
    name: { ar: "اختيار الخبز", en: "Bread Choice" },
    description: { ar: "اختر نوع الخبز", en: "Choose your bread" },
    minSelections: 1,
    maxSelections: 1,
    options: [
      { key: "final_menu_bread_whole_wheat", name: { ar: "خبز حبة كاملة", en: "Whole Wheat Bread" } },
      { key: "final_menu_bread_brown_toast", name: { ar: "توست أسمر", en: "Brown Toast" } },
      { key: "final_menu_bread_whole_wheat_wrap", name: { ar: "تورتيلا حبة كاملة", en: "Whole Wheat Wrap" } },
    ],
  },
  {
    key: "final_menu_sandwich_filling",
    name: { ar: "حشوة الساندويتش", en: "Sandwich Filling" },
    description: { ar: "اختر حشوة الساندويتش", en: "Choose the sandwich filling" },
    minSelections: 1,
    maxSelections: 1,
    options: [
      { key: "final_menu_filling_tuna", name: { ar: "تونا", en: "Tuna" } },
      { key: "final_menu_filling_halloumi", name: { ar: "حلومي", en: "Halloumi" } },
      { key: "final_menu_filling_turkey", name: { ar: "تركي", en: "Turkey" } },
      { key: "final_menu_filling_grilled_chicken", name: { ar: "دجاج مشوي", en: "Grilled Chicken" } },
      { key: "final_menu_filling_beef", name: { ar: "لحم", en: "Beef" } },
      { key: "final_menu_filling_liver", name: { ar: "كبدة", en: "Liver" } },
      { key: "final_menu_filling_boiled_egg", name: { ar: "بيض مسلوق", en: "Boiled Egg" } },
      { key: "final_menu_filling_labneh", name: { ar: "لبنة", en: "Labneh" } },
    ],
  },
];

async function importSharedGroups({ sync, now, stats }) {
  const groups = new Map();

  for (let groupIndex = 0; groupIndex < sharedGroups.length; groupIndex += 1) {
    const definition = sharedGroups[groupIndex];
    const groupPayload = {
      key: definition.key,
      name: localized(definition.name),
      description: localized(definition.description),
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: groupIndex + 1,
      ui: { displayStyle: "radio_cards" },
      publishedAt: now,
    };
    const groupResult = await upsert(
      MenuOptionGroup,
      { key: definition.key },
      groupPayload,
      groupPayload,
      { sync }
    );
    increment(stats, "optionGroups", groupResult.status);

    const options = [];
    for (let optionIndex = 0; optionIndex < definition.options.length; optionIndex += 1) {
      const optionDefinition = definition.options[optionIndex];
      const optionPayload = {
        groupId: groupResult.document._id,
        key: optionDefinition.key,
        name: localized(optionDefinition.name),
        description: localized(optionDefinition.name),
        extraPriceHalala: 0,
        extraFeeHalala: 0,
        currency: "SAR",
        availableFor: ["one_time"],
        availableForSubscription: false,
        nutrition: { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: optionIndex + 1,
        publishedAt: now,
      };
      const optionResult = await upsert(
        MenuOption,
        { groupId: groupResult.document._id, key: optionDefinition.key },
        optionPayload,
        optionPayload,
        { sync }
      );
      increment(stats, "options", optionResult.status);
      options.push(optionResult.document);
    }

    groups.set(definition.key, {
      definition,
      document: groupResult.document,
      options,
    });
  }

  return groups;
}

async function linkProductGroup({
  product,
  group,
  sortOrder,
  sync,
  stats,
}) {
  const relationPayload = {
    productId: product._id,
    groupId: group.document._id,
    minSelections: group.definition.minSelections,
    maxSelections: group.definition.maxSelections,
    isRequired: group.definition.minSelections > 0,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder,
  };
  const groupRelation = await upsert(
    ProductOptionGroup,
    { productId: product._id, groupId: group.document._id },
    relationPayload,
    relationPayload,
    { sync }
  );
  increment(stats, "productGroups", groupRelation.status);

  for (let index = 0; index < group.options.length; index += 1) {
    const option = group.options[index];
    const optionRelationPayload = {
      productId: product._id,
      groupId: group.document._id,
      optionId: option._id,
      extraPriceHalala: 0,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: index + 1,
    };
    const optionRelation = await upsert(
      ProductGroupOption,
      {
        productId: product._id,
        groupId: group.document._id,
        optionId: option._id,
      },
      optionRelationPayload,
      optionRelationPayload,
      { sync }
    );
    increment(stats, "productOptions", optionRelation.status);
  }
}

async function runImport({
  execute,
  sync,
  publishIncomplete,
  allowExisting,
  log = console,
}) {
  validateSource();

  const uri = resolveMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    const actualDatabaseName = mongoose.connection.name;
    const existing = {
      categories: await MenuCategory.countDocuments({}),
      products: await MenuProduct.countDocuments({}),
      catalogItems: await CatalogItem.countDocuments({}),
    };

    log.log("");
    log.log("Basic Diet final menu import plan");
    log.log(`- database: ${actualDatabaseName}`);
    log.log(`- categories in fixture: ${source.categories.length}`);
    log.log(`- products in fixture: ${source.products.length}`);
    log.log(`- products marked Ready: ${source.products.filter((item) => item.status === "Ready").length}`);
    log.log(`- publish incomplete products: ${publishIncomplete}`);
    log.log(`- current categories: ${existing.categories}`);
    log.log(`- current products: ${existing.products}`);
    log.log(`- current catalog items: ${existing.catalogItems}`);
    log.log(`- mode: ${execute ? "EXECUTE" : "DRY RUN"}`);
    log.log(`- existing-row policy: ${sync ? "SYNC" : "KEEP EXISTING"}`);

    if (!execute) {
      log.log("");
      log.log("Dry run only. No database documents were changed.");
      return { dryRun: true, existing };
    }

    if (!truthy(process.env.ALLOW_FINAL_MENU_IMPORT)) {
      throw new Error("ALLOW_FINAL_MENU_IMPORT=true is required");
    }
    if (!truthy(process.env.BACKUP_CONFIRMED)) {
      throw new Error("BACKUP_CONFIRMED=true is required");
    }

    const expectedDatabaseName = requiredEnv("FINAL_MENU_DATABASE_NAME");
    if (expectedDatabaseName !== actualDatabaseName) {
      throw new Error(
        `Database mismatch: expected "${expectedDatabaseName}", connected to "${actualDatabaseName}"`
      );
    }

    if (requiredEnv("FINAL_MENU_CONFIRM_PHRASE") !== CONFIRM_PHRASE) {
      throw new Error(`FINAL_MENU_CONFIRM_PHRASE must equal ${CONFIRM_PHRASE}`);
    }

    if ((existing.categories > 0 || existing.products > 0) && !allowExisting) {
      throw new Error(
        "Menu collections are not empty. Set FINAL_MENU_ALLOW_EXISTING=true only after reviewing the dry run."
      );
    }

    const stats = {};
    const now = new Date();
    const categoryByKey = new Map();

    for (const category of source.categories) {
      const payload = {
        key: category.key,
        name: localized(category.name),
        description: localized(category.description),
        imageUrl: "",
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: category.sortOrder,
        ui: {
          ...category.ui,
        },
        availability: { branchIds: [] },
        publishedAt: now,
      };
      const result = await upsert(
        MenuCategory,
        { key: category.key },
        payload,
        payload,
        { sync }
      );
      categoryByKey.set(category.key, result.document);
      increment(stats, "categories", result.status);
    }

    const groups = await importSharedGroups({ sync, now, stats });

    for (const product of source.products) {
      const category = categoryByKey.get(product.categoryKey);
      if (!category) throw new Error(`Missing category ${product.categoryKey}`);

      const publish = shouldPublish(product, publishIncomplete);
      const nutrition = {
        calories: numberOrZero(product.nutrition?.calories),
        proteinGrams: numberOrZero(product.nutrition?.proteinGrams),
        carbsGrams: numberOrZero(product.nutrition?.carbsGrams),
        fatGrams: numberOrZero(product.nutrition?.fatGrams),
      };

      const catalogPayload = {
        key: product.key,
        nameI18n: localized(product.name),
        descriptionI18n: localized(product.description),
        imageUrl: "",
        itemKind: itemKindFor(product),
        nutrition,
        isActive: true,
        isAvailable: publish,
      };
      const catalogUpdatePayload = {
        nameI18n: catalogPayload.nameI18n,
        descriptionI18n: catalogPayload.descriptionI18n,
        imageUrl: catalogPayload.imageUrl,
        itemKind: catalogPayload.itemKind,
        nutrition: catalogPayload.nutrition,
        isActive: catalogPayload.isActive,
        isAvailable: catalogPayload.isAvailable,
      };
      const catalogResult = await upsert(
        CatalogItem,
        { key: product.key },
        catalogPayload,
        catalogUpdatePayload,
        { sync }
      );
      increment(stats, "catalogItems", catalogResult.status);

      const isSandwich = product.categoryKey === "sandwiches";
      const customizable = isSandwich || Boolean(product.isCustomizable);
      const productPayload = {
        categoryId: category._id,
        catalogItemId: catalogResult.document._id,
        key: product.key,
        name: localized(product.name),
        description: localized(product.description),
        imageUrl: "",
        itemType: "product",
        pricingModel: product.pricingModel || "fixed",
        priceHalala: integerOrZero(product.priceHalala),
        baseUnitGrams: 100,
        defaultWeightGrams: inferWeightGrams(product),
        minWeightGrams: 0,
        maxWeightGrams: 0,
        weightStepGrams: 50,
        weightStepPriceHalala: null,
        currency: product.currency || "SAR",
        availableFor: ["one_time"],
        isCustomizable: customizable,
        isActive: true,
        isVisible: publish,
        isAvailable: publish,
        sortOrder: product.sortOrder,
        ui: productUi(product, customizable),
        branchAvailability: [],
        publishedAt: publish ? now : null,
      };
      const productResult = await upsert(
        MenuProduct,
        { key: product.key },
        productPayload,
        productPayload,
        { sync }
      );
      increment(stats, "products", productResult.status);

      if (isSandwich) {
        await linkProductGroup({
          product: productResult.document,
          group: groups.get("final_menu_bread_choice"),
          sortOrder: 1,
          sync,
          stats,
        });
      }

      if (product.key === "sandwiches_build_your_own_sandwich") {
        await linkProductGroup({
          product: productResult.document,
          group: groups.get("final_menu_sandwich_filling"),
          sortOrder: 2,
          sync,
          stats,
        });
      }
    }

    const sourceProductKeys = source.products.map((item) => item.key);
    const sourceCategoryKeys = source.categories.map((item) => item.key);

    const verification = {
      categories: await MenuCategory.countDocuments({ key: { $in: sourceCategoryKeys } }),
      products: await MenuProduct.countDocuments({ key: { $in: sourceProductKeys } }),
      visibleProducts: await MenuProduct.countDocuments({
        key: { $in: sourceProductKeys },
        isVisible: true,
        isAvailable: true,
        publishedAt: { $ne: null },
      }),
      hiddenDraftProducts: await MenuProduct.countDocuments({
        key: { $in: sourceProductKeys },
        $or: [
          { isVisible: false },
          { isAvailable: false },
          { publishedAt: null },
        ],
      }),
      catalogItems: await CatalogItem.countDocuments({ key: { $in: sourceProductKeys } }),
    };

    log.log("");
    log.log("Final menu import completed.");
    for (const [label, value] of Object.entries(stats)) {
      log.log(`${label}: created=${value.created} skipped=${value.skipped} updated=${value.updated}`);
    }
    log.log("Verification:", JSON.stringify(verification, null, 2));

    if (
      verification.categories !== source.categories.length ||
      verification.products !== source.products.length ||
      verification.catalogItems !== source.products.length
    ) {
      throw new Error("Post-import verification counts do not match the fixture");
    }

    return { dryRun: false, stats, verification };
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  const execute = process.argv.includes("--execute");
  const sync = process.argv.includes("--sync") || truthy(process.env.FINAL_MENU_SYNC);
  const publishIncomplete = truthy(process.env.FINAL_MENU_PUBLISH_INCOMPLETE);
  const allowExisting = truthy(process.env.FINAL_MENU_ALLOW_EXISTING);

  await runImport({
    execute,
    sync,
    publishIncomplete,
    allowExisting,
  });
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[final-menu-import] ${error.message}`);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
    process.exit(1);
  });
}

module.exports = {
  CONFIRM_PHRASE,
  inferWeightGrams,
  itemKindFor,
  productUi,
  shouldPublish,
  validateSource,
  runImport,
};
