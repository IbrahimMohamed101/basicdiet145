"use strict";

const MealBuilderConfig = require("../../src/models/MealBuilderConfig");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../../src/models/PremiumUpgradeConfig");
const {
  computeRevisionHash,
  validateConfigObject,
} = require("../../src/services/subscription/mealBuilderConfigService");
const source = require("./fixtures/menu-workbook-source");

const PREMIUM_LARGE_SALAD_KEY = "premium_large_salad";
const PREMIUM_BASE_PRICE_HALALA = 1900;

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

function buildSection({ categoryId, products }) {
  return {
    key: PREMIUM_LARGE_SALAD_KEY,
    sectionType: "product_list",
    sourceKind: "product_list",
    titleOverride: { ar: "السلطات الكبيرة المميزة", en: "Premium Large Salads" },
    productContextId: null,
    sourceGroupId: null,
    sourceCategoryId: categoryId,
    selectedOptionIds: [],
    selectedProductIds: products.map((product) => product._id),
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
      workbookSourceSha256: source.metadata.sha256,
      classificationAuthority: "meal_product_classification.v1",
    },
    rules: {},
  };
}

async function upsertPremiumConfig({ pricingProduct, sync = true }) {
  const upgradeDeltaHalala = Math.max(
    1,
    Number(pricingProduct.priceHalala || 0) - PREMIUM_BASE_PRICE_HALALA
  );
  const existing = await PremiumUpgradeConfig.findOne({ premiumKey: PREMIUM_LARGE_SALAD_KEY });
  const payload = {
    sourceType: "menu_product",
    sourceId: pricingProduct._id,
    sourceProductId: null,
    sourceGroupId: null,
    selectionType: PREMIUM_LARGE_SALAD_KEY,
    premiumKey: PREMIUM_LARGE_SALAD_KEY,
    displayGroupKey: "premium",
    upgradeDeltaHalala,
    currency: pricingProduct.currency || "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 130,
    archiveReason: null,
    metadata: {
      workbookSourceSha256: source.metadata.sha256,
      workbookPricingProductKey: pricingProduct.key,
    },
    sourceSnapshot: {
      key: pricingProduct.key,
      name: clone(pricingProduct.name || {}),
      context: { categoryKey: "salads" },
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

async function installMealBuilderSection({ category, products }) {
  const configs = await MealBuilderConfig.find({
    isCurrent: true,
    status: { $in: ["published", "draft"] },
  });
  if (configs.length === 0) {
    throw new Error("Current Meal Builder published/draft configs are missing");
  }

  const section = buildSection({ categoryId: category._id, products });
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

async function seedWorkbookPremiumLargeSalad({ sync = true, log = console } = {}) {
  const rows = largeSaladSourceRows();
  if (rows.length === 0) throw new Error("Workbook contains no ready large salad products");

  const category = await MenuCategory.findOne({ key: "salads", isActive: true });
  if (!category) throw new Error("Active workbook salads category is missing");

  const products = await MenuProduct.find({
    key: { $in: rows.map((row) => row.key) },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: { $ne: null },
  }).sort({ sortOrder: 1, createdAt: 1 });
  if (products.length !== rows.length) {
    throw new Error(`Expected ${rows.length} ready large salads, found ${products.length}`);
  }

  const pricingProduct = products[0];
  const premiumConfig = await upsertPremiumConfig({ pricingProduct, sync });
  const builder = await installMealBuilderSection({ category, products });

  const summary = {
    premiumKey: PREMIUM_LARGE_SALAD_KEY,
    productCount: products.length,
    pricingProductKey: pricingProduct.key,
    upgradeDeltaHalala: premiumConfig.upgradeDeltaHalala,
    mealBuilderConfigsUpdated: builder.configCount,
  };
  (log.log || log.info).call(log, "Premium large salad workbook entitlement seeded.", summary);
  return summary;
}

module.exports = {
  PREMIUM_LARGE_SALAD_KEY,
  buildSection,
  largeSaladSourceRows,
  seedWorkbookPremiumLargeSalad,
};
