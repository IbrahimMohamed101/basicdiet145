#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");

const CatalogItem = require("../../src/models/CatalogItem");
const MealBuilderConfig = require("../../src/models/MealBuilderConfig");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuOption = require("../../src/models/MenuOption");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuProduct = require("../../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const {
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  SALAD_SELECTION_GROUPS,
} = require("../../src/config/mealPlannerContract");
const {
  getSubscriptionBuilderCatalogWithV2,
} = require("../../src/services/catalog/CatalogService");
const {
  computeRevisionHash,
  validateConfigObject,
} = require("../../src/services/subscription/mealBuilderConfigService");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const {
  SALAD_GROUPS,
  seedBasicSaladBuilder,
} = require("./seed-basic-salad-builder");
const source = require("./fixtures/menu-workbook-source");

const PREMIUM_LARGE_SALAD_KEY = "premium_large_salad";
const BASIC_SALAD_KEY = "basic_salad";

const PREMIUM_LARGE_SALAD_NAME = Object.freeze({
  ar: "سلطة كبيرة + بروتين",
  en: "Large Salad + Protein",
});

const PREMIUM_LARGE_SALAD_DESCRIPTION = Object.freeze({
  ar: "سلطة كبيرة مميزة مع اختيار بروتين واحد ومكونات السلطة المتاحة.",
  en: "A premium large salad with one protein choice and the available salad ingredients.",
});

const CANONICAL_GROUP_SOURCE_KEYS = Object.freeze({
  leafy_greens: "salad_greens",
  vegetables: "salad_vegetables_legumes",
  protein: "salad_proteins",
  cheese_nuts: "salad_cheese_nuts",
  fruits: "salad_fruits",
  sauce: "salad_sauces",
});

const PREMIUM_PROTEIN_KEY_ALIASES = Object.freeze({
  boiled_egg: "boiled_eggs",
  fajita: "chicken_fajita",
  italian_chicken: "italian_spiced_chicken",
  tikka_chicken: "chicken_tikka",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toPlainSection(section) {
  if (!section) return null;
  if (typeof section.toObject === "function") {
    return section.toObject({ depopulate: true, getters: false, virtuals: false });
  }
  return clone(section);
}

function largeSaladSourceRows() {
  return source.products.filter((row) => (
    row.categoryKey === "salads"
    && row.key.endsWith("_large")
    && row.status === "Ready"
    && Number(row.priceHalala || 0) > 0
  ));
}

function saladDefinitionByKey(key) {
  return SALAD_GROUPS.find((group) => group.key === key) || null;
}

function canonicalOptionKey(groupKey, optionKey) {
  if (groupKey !== "protein") return optionKey;
  return PREMIUM_PROTEIN_KEY_ALIASES[optionKey] || optionKey;
}

function buildSection({ categoryId, product }) {
  return {
    key: PREMIUM_LARGE_SALAD_KEY,
    sectionType: "product_list",
    sourceKind: "product_list",
    titleOverride: clone(PREMIUM_LARGE_SALAD_NAME),
    productContextId: null,
    sourceGroupId: null,
    sourceCategoryId: categoryId,
    selectedOptionIds: [],
    selectedProductIds: [product._id],
    includeMode: "selected",
    selectionType: PREMIUM_LARGE_SALAD_KEY,
    sortOrder: 15,
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    availableFor: ["subscription"],
    metadata: {
      treatAsFullMeal: true,
      canonicalProductKey: PREMIUM_LARGE_SALAD_KEY,
      workbookSourceSha256: source.metadata.sha256,
      classificationAuthority: "meal_product_classification.v1",
    },
    rules: {},
  };
}

async function ensureCanonicalProduct({ category, imageUrl, now }) {
  const catalogItem = await CatalogItem.findOneAndUpdate(
    { key: PREMIUM_LARGE_SALAD_KEY },
    {
      $set: {
        nameI18n: clone(PREMIUM_LARGE_SALAD_NAME),
        descriptionI18n: clone(PREMIUM_LARGE_SALAD_DESCRIPTION),
        imageUrl: imageUrl || "",
        itemKind: "product",
        nutrition: {
          calories: 0,
          proteinGrams: 0,
          carbsGrams: 0,
          fatGrams: 0,
        },
        isActive: true,
        isAvailable: true,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return MenuProduct.findOneAndUpdate(
    { key: PREMIUM_LARGE_SALAD_KEY },
    {
      $set: {
        categoryId: category._id,
        catalogItemId: catalogItem._id,
        key: PREMIUM_LARGE_SALAD_KEY,
        name: clone(PREMIUM_LARGE_SALAD_NAME),
        description: clone(PREMIUM_LARGE_SALAD_DESCRIPTION),
        imageUrl: imageUrl || "",
        itemType: PREMIUM_LARGE_SALAD_KEY,
        pricingModel: "fixed",
        priceHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
        baseUnitGrams: 100,
        defaultWeightGrams: 100,
        minWeightGrams: 100,
        maxWeightGrams: 100,
        weightStepGrams: 1,
        weightStepPriceHalala: 0,
        currency: "SAR",
        availableFor: ["subscription"],
        isCustomizable: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        sortOrder: 15,
        ui: {
          cardVariant: "large_salad",
          cardSize: "large",
          badge: "",
          ctaLabel: "",
          imageRatio: "square",
          showDescription: true,
          showPrice: true,
          priceLabelMode: "fixed",
          behaviorHint: "open_builder",
        },
        branchAvailability: [],
        publishedAt: now,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function installCanonicalBuilderRelations({ product, now }) {
  const activeGroupRelationIds = [];
  const activeOptionRelationIds = [];
  const summary = [];

  for (const [index, rule] of SALAD_SELECTION_GROUPS.entries()) {
    if (rule.key === "extra_protein_50g") continue;

    const sourceKey = CANONICAL_GROUP_SOURCE_KEYS[rule.key];
    const definition = saladDefinitionByKey(sourceKey);
    if (!definition) {
      throw new Error(`Missing salad source definition for canonical group ${rule.key}`);
    }

    const group = await MenuOptionGroup.findOneAndUpdate(
      { key: rule.key },
      {
        $set: {
          key: rule.key,
          name: clone(rule.name),
          description: { ar: "", en: "" },
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: Number(rule.sortOrder || index + 1),
          ui: { displayStyle: definition.displayStyle || "checkbox_grid" },
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
          minSelections: Number(rule.minSelect || 0),
          maxSelections: Number(rule.maxSelect || 0),
          isRequired: Number(rule.minSelect || 0) > 0,
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: Number(rule.sortOrder || index + 1),
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    activeGroupRelationIds.push(groupRelation._id);

    let optionCount = 0;
    for (const [optionIndex, optionDefinition] of definition.options.entries()) {
      const optionKey = canonicalOptionKey(rule.key, optionDefinition.key);
      const extraPriceHalala = Number(optionDefinition.extraPriceHalala || 0);
      const extraWeightUnitGrams = Number(optionDefinition.extraWeightUnitGrams || 0);

      const option = await MenuOption.findOneAndUpdate(
        { groupId: group._id, key: optionKey },
        {
          $set: {
            groupId: group._id,
            catalogItemId: null,
            key: optionKey,
            name: clone(optionDefinition.name),
            description: { ar: "", en: "" },
            imageUrl: "",
            extraPriceHalala,
            extraFeeHalala: extraPriceHalala,
            extraWeightUnitGrams,
            extraWeightPriceHalala: 0,
            currency: "SAR",
            availableFor: ["subscription"],
            availableForSubscription: true,
            nutrition: {
              calories: Number(optionDefinition.calories || 0),
              proteinGrams: 0,
              carbGrams: 0,
              fatGrams: 0,
            },
            proteinFamilyKey: "",
            displayCategoryKey: rule.key,
            premiumKey: "",
            ruleTags: rule.key === "protein" ? ["salad_only"] : [],
            selectionType: PREMIUM_LARGE_SALAD_KEY,
            isActive: true,
            isVisible: true,
            isAvailable: true,
            sortOrder: optionIndex + 1,
            publishedAt: now,
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );

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
      optionCount += 1;
    }

    summary.push({
      key: rule.key,
      minSelections: Number(rule.minSelect || 0),
      maxSelections: Number(rule.maxSelect || 0),
      options: optionCount,
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

async function upsertPremiumConfig({ product, sync = true }) {
  const existing = await PremiumUpgradeConfig.findOne({ premiumKey: PREMIUM_LARGE_SALAD_KEY });
  const payload = {
    sourceType: "menu_product",
    sourceId: product._id,
    sourceProductId: null,
    sourceGroupId: null,
    selectionType: PREMIUM_LARGE_SALAD_KEY,
    premiumKey: PREMIUM_LARGE_SALAD_KEY,
    displayGroupKey: "premium",
    upgradeDeltaHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
    currency: product.currency || "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 130,
    archiveReason: null,
    metadata: {
      workbookSourceSha256: source.metadata.sha256,
      canonicalProductKey: PREMIUM_LARGE_SALAD_KEY,
    },
    sourceSnapshot: {
      key: product.key,
      name: clone(product.name || {}),
      context: { categoryKey: "salads", productKey: product.key },
    },
  };

  if (!existing) {
    return PremiumUpgradeConfig.create({ ...payload, revision: 1 });
  }
  if (!sync) return existing;
  return PremiumUpgradeConfig.findOneAndUpdate(
    { _id: existing._id },
    { $set: payload, $inc: { revision: 1 } },
    { new: true, runValidators: true }
  );
}

async function installMealBuilderSection({ category, product }) {
  const configs = await MealBuilderConfig.find({
    isCurrent: true,
    status: { $in: ["published", "draft"] },
  });
  if (configs.length === 0) {
    throw new Error("Current Meal Builder published/draft configs are missing");
  }

  const section = buildSection({ categoryId: category._id, product });
  for (const config of configs) {
    const existingSections = (config.sections || [])
      .map(toPlainSection)
      .filter(Boolean)
      .filter((row) => row.key !== PREMIUM_LARGE_SALAD_KEY);
    const sections = [...existingSections, clone(section)]
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));

    const validation = await validateConfigObject({ sections });
    if (Number(validation?.summary?.errors || 0) > 0) {
      const error = new Error("Premium large salad section makes Meal Builder invalid");
      error.code = "PREMIUM_LARGE_SALAD_SECTION_INVALID";
      error.details = validation.errors || [];
      throw error;
    }

    const revisionHash = computeRevisionHash({
      ...config.toObject({ depopulate: true, getters: false, virtuals: false }),
      sections,
    });
    await MealBuilderConfig.updateOne(
      { _id: config._id },
      { $set: { sections, revisionHash } },
      { runValidators: true }
    );
  }

  return { section, configCount: configs.length };
}

async function verifyMobileContract() {
  const bundle = await getSubscriptionBuilderCatalogWithV2({
    lang: "ar",
    includeV2: true,
    includeV3: true,
    ignorePublishedMealBuilder: true,
  });
  const catalogs = [bundle?.plannerCatalog, bundle?.builderCatalogV2].filter(Boolean);
  const sections = catalogs.flatMap((catalog) => catalog.sections || []);
  const section = sections.find((row) => row.key === PREMIUM_LARGE_SALAD_KEY);
  const product = (section?.products || []).find((row) => row.key === PREMIUM_LARGE_SALAD_KEY);

  if (!section || !product) {
    throw new Error("Mobile subscription catalog does not expose canonical premium_large_salad product");
  }
  if (product.ui?.cardVariant !== "large_salad") {
    throw new Error(`premium_large_salad cardVariant is ${product.ui?.cardVariant || "missing"}; expected large_salad`);
  }
  if (product.action && product.action.requiresBuilder === false) {
    throw new Error("premium_large_salad must require its custom builder");
  }

  return {
    sectionKey: section.key,
    productKey: product.key,
    productName: product.name,
    cardVariant: product.ui?.cardVariant,
    selectionType: product.selectionType,
    requiresBuilder: product.action?.requiresBuilder ?? true,
    optionGroups: (product.optionGroups || []).map((group) => ({
      key: group.key,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      options: (group.options || []).length,
    })),
  };
}

async function seedWorkbookPremiumLargeSalad({ sync = true, log = console } = {}) {
  const rows = largeSaladSourceRows();
  if (rows.length === 0) throw new Error("Workbook contains no ready large salad products");

  await seedBasicSaladBuilder();

  const category = await MenuCategory.findOne({ key: "salads", isActive: true });
  if (!category) throw new Error("Active workbook salads category is missing");

  const pricingProduct = await MenuProduct.findOne({
    key: rows[0].key,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: { $ne: null },
  }).lean();
  const basicSalad = await MenuProduct.findOne({ key: BASIC_SALAD_KEY }).lean();
  if (!basicSalad) throw new Error("basic_salad is missing after salad builder seed");

  const now = new Date();
  const product = await ensureCanonicalProduct({
    category,
    imageUrl: basicSalad.imageUrl || pricingProduct?.imageUrl || "",
    now,
  });
  const builderGroups = await installCanonicalBuilderRelations({ product, now });
  const premiumConfig = await upsertPremiumConfig({ product, sync });
  const builder = await installMealBuilderSection({ category, product });
  const mobileContract = await verifyMobileContract();

  const summary = {
    premiumKey: PREMIUM_LARGE_SALAD_KEY,
    productId: product._id.toString(),
    productKey: product.key,
    productName: product.name,
    priceHalala: product.priceHalala,
    upgradeDeltaHalala: premiumConfig.upgradeDeltaHalala,
    cardVariant: product.ui?.cardVariant,
    builderGroups,
    mealBuilderConfigsUpdated: builder.configCount,
    mobileContract,
  };
  (log.log || log.info).call(log, "Premium large salad subscription card seeded.", summary);
  return summary;
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await seedWorkbookPremiumLargeSalad({ sync: true, log: console });
    console.log("[seed-workbook-premium-large-salad] completed", JSON.stringify(result, null, 2));
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[seed-workbook-premium-large-salad:error] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (Array.isArray(error.details)) console.error(JSON.stringify(error.details, null, 2));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  PREMIUM_LARGE_SALAD_KEY,
  buildSection,
  largeSaladSourceRows,
  seedWorkbookPremiumLargeSalad,
};
