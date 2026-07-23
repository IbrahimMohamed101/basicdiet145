#!/usr/bin/env node

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const CatalogItem = require("../../src/models/CatalogItem");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const source = require("./fixtures/menu-workbook-source");
const {
  allBuilderOptions,
  catalogItemKind,
  normalizeChannels,
  productItemType,
  rowStatus,
  validateSource,
} = require("./seed-new-menu");

function id(value) {
  return value === null || value === undefined ? "" : String(value);
}

function localized(value) {
  return {
    ar: String(value?.ar || "").trim(),
    en: String(value?.en || "").trim(),
  };
}

function same(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch (_error) {
    return false;
  }
}

function pushIssue(target, code, message, details) {
  target.push({ code, message, ...(details === undefined ? {} : { details }) });
}

function isFullyArchived(row) {
  return row
    && row.isActive === false
    && row.isVisible === false
    && row.isAvailable === false
    && !row.publishedAt;
}

function compareKeySet(errors, warnings, label, actualRows, expectedKeys, keySelector = (row) => row.key) {
  const actualKeys = new Set(actualRows.map(keySelector));
  const expected = new Set(expectedKeys);
  const missing = [...expected].filter((key) => !actualKeys.has(key)).sort();
  const extraRows = actualRows.filter((row) => !expected.has(keySelector(row)));
  const liveExtras = extraRows.filter((row) => !isFullyArchived(row)).map(keySelector).sort();
  const archivedExtras = extraRows.filter(isFullyArchived).map(keySelector).sort();

  if (missing.length) pushIssue(errors, `${label}_MISSING`, `${label} is missing workbook rows`, missing);
  if (liveExtras.length) pushIssue(errors, `${label}_EXTRA_ACTIVE`, `${label} contains live rows not present in the workbook`, liveExtras);
  if (archivedExtras.length) pushIssue(warnings, `${label}_EXTRA_ARCHIVED`, `${label} contains archived historical rows outside the workbook`, archivedExtras);
}

function expectedProductSortOrders(rows) {
  const counters = new Map();
  return new Map(rows.map((row) => {
    const next = (counters.get(row.categoryKey) || 0) + 1;
    counters.set(row.categoryKey, next);
    return [row.key, next];
  }));
}

async function verifyMenuWorkbookSource({ strict = true, log = console } = {}) {
  const counts = validateSource();
  const errors = [];
  const warnings = [];
  const builderOptions = allBuilderOptions();

  const [categories, products, optionGroups, options, productGroups, productOptions, catalogItems] = await Promise.all([
    MenuCategory.find({}).lean(),
    MenuProduct.find({}).lean(),
    MenuOptionGroup.find({}).lean(),
    MenuOption.find({}).lean(),
    ProductOptionGroup.find({}).lean(),
    ProductGroupOption.find({}).lean(),
    CatalogItem.find({}).lean(),
  ]);

  compareKeySet(errors, warnings, "MENU_CATEGORIES", categories, source.categories.map((row) => row.key));
  compareKeySet(errors, warnings, "MENU_PRODUCTS", products, source.products.map((row) => row.key));
  compareKeySet(errors, warnings, "MENU_OPTION_GROUPS", optionGroups, source.builderGroups.map((row) => row.key));
  compareKeySet(errors, warnings, "MENU_OPTIONS", options, builderOptions.map(({ option }) => option.key));

  const activeProductGroups = productGroups.filter((row) => (
    row.isActive !== false || row.isVisible !== false || row.isAvailable !== false
  ));
  const activeProductOptions = productOptions.filter((row) => (
    row.isActive !== false || row.isVisible !== false || row.isAvailable !== false
  ));
  if (activeProductGroups.length) {
    pushIssue(errors, "PRODUCT_GROUP_RELATIONS_NOT_IN_WORKBOOK", "The workbook does not define product option-group relations, but live database relations already exist", activeProductGroups.map((row) => id(row._id)));
  } else if (productGroups.length) {
    pushIssue(warnings, "PRODUCT_GROUP_RELATIONS_ARCHIVED", "Archived historical product option-group relations remain for reference", productGroups.map((row) => id(row._id)));
  }
  if (activeProductOptions.length) {
    pushIssue(errors, "PRODUCT_OPTION_RELATIONS_NOT_IN_WORKBOOK", "The workbook does not define product option relations, but live database relations already exist", activeProductOptions.map((row) => id(row._id)));
  } else if (productOptions.length) {
    pushIssue(warnings, "PRODUCT_OPTION_RELATIONS_ARCHIVED", "Archived historical product option relations remain for reference", productOptions.map((row) => id(row._id)));
  }

  const categoryByKey = new Map(categories.map((row) => [row.key, row]));
  const categoryById = new Map(categories.map((row) => [id(row._id), row]));
  const productByKey = new Map(products.map((row) => [row.key, row]));
  const groupByKey = new Map(optionGroups.map((row) => [row.key, row]));
  const optionByKey = new Map(options.map((row) => [row.key, row]));
  const catalogByKey = new Map(catalogItems.map((row) => [row.key, row]));
  const sortOrders = expectedProductSortOrders(source.products);

  for (const row of source.categories) {
    const actual = categoryByKey.get(row.key);
    if (!actual) continue;
    if (!same(localized(actual.name), localized(row.name))) pushIssue(errors, "CATEGORY_NAME_MISMATCH", `Category ${row.key} name differs from workbook`);
    if (!same(localized(actual.description), localized(row.description))) pushIssue(errors, "CATEGORY_DESCRIPTION_MISMATCH", `Category ${row.key} description differs from workbook`);
    if (!same({
      cardVariant: actual.ui?.cardVariant,
      behaviorHint: actual.ui?.behaviorHint,
      priceLabelMode: actual.ui?.priceLabelMode,
    }, row.ui)) pushIssue(errors, "CATEGORY_UI_MISMATCH", `Category ${row.key} UI differs from workbook`);
    for (const field of ["isActive", "isVisible", "isAvailable"]) {
      if (Boolean(actual[field]) !== (row[field] !== false)) pushIssue(errors, "CATEGORY_STATUS_MISMATCH", `Category ${row.key}.${field} differs from workbook`);
    }
    if (Number(actual.sortOrder || 0) !== Number(row.sortOrder || 0)) pushIssue(errors, "CATEGORY_SORT_MISMATCH", `Category ${row.key} sortOrder differs from workbook`);
  }

  for (const row of source.products) {
    const actual = productByKey.get(row.key);
    if (!actual) continue;
    const category = categoryById.get(id(actual.categoryId));
    const state = rowStatus(row.status);
    const expectedChannels = normalizeChannels(row.availableFor);

    if (!category || category.key !== row.categoryKey) pushIssue(errors, "PRODUCT_CATEGORY_MISMATCH", `Product ${row.key} is linked to the wrong category`, { expected: row.categoryKey, actual: category?.key || null });
    if (!same(localized(actual.name), localized(row.name))) pushIssue(errors, "PRODUCT_NAME_MISMATCH", `Product ${row.key} name differs from workbook`);
    if (!same(localized(actual.description), localized(row.description))) pushIssue(errors, "PRODUCT_DESCRIPTION_MISMATCH", `Product ${row.key} description differs from workbook`);
    if (Number(actual.priceHalala || 0) !== Number(row.priceHalala || 0)) pushIssue(errors, "PRODUCT_PRICE_MISMATCH", `Product ${row.key} price differs from workbook`);
    if (String(actual.currency || "") !== String(row.currency || "SAR")) pushIssue(errors, "PRODUCT_CURRENCY_MISMATCH", `Product ${row.key} currency differs from workbook`);
    if (!same([...(actual.availableFor || [])].sort(), [...expectedChannels].sort())) pushIssue(errors, "PRODUCT_CHANNEL_MISMATCH", `Product ${row.key} availableFor differs from workbook`);
    if (String(actual.pricingModel || "") !== String(row.pricingModel || "fixed")) pushIssue(errors, "PRODUCT_PRICING_MODEL_MISMATCH", `Product ${row.key} pricingModel differs from workbook`);
    if (String(actual.itemType || "") !== productItemType(row.categoryKey)) pushIssue(errors, "PRODUCT_ITEM_TYPE_MISMATCH", `Product ${row.key} itemType differs from workbook mapping`);
    if (Boolean(actual.isCustomizable) !== (row.isCustomizable === true)) pushIssue(errors, "PRODUCT_CUSTOMIZABLE_MISMATCH", `Product ${row.key} isCustomizable differs from workbook`);
    for (const field of ["isActive", "isVisible", "isAvailable"]) {
      if (Boolean(actual[field]) !== Boolean(state[field])) pushIssue(errors, "PRODUCT_STATUS_MISMATCH", `Product ${row.key}.${field} does not match workbook status ${row.status}`);
    }
    if (state.isReady !== Boolean(actual.publishedAt)) pushIssue(errors, "PRODUCT_PUBLICATION_MISMATCH", `Product ${row.key} publishedAt does not match workbook status ${row.status}`);
    if (Number(actual.sortOrder || 0) !== Number(sortOrders.get(row.key))) pushIssue(errors, "PRODUCT_SORT_MISMATCH", `Product ${row.key} sortOrder differs from workbook row order`);

    const catalog = catalogByKey.get(row.key);
    if (!catalog || id(actual.catalogItemId) !== id(catalog._id)) {
      pushIssue(errors, "PRODUCT_CATALOG_LINK_MISMATCH", `Product ${row.key} is not linked to its workbook CatalogItem`);
      continue;
    }
    if (catalog.itemKind !== catalogItemKind(row.categoryKey)) pushIssue(errors, "PRODUCT_CATALOG_KIND_MISMATCH", `CatalogItem ${row.key} itemKind differs from workbook mapping`);
    const expectedNutrition = {
      calories: Number(row.nutrition?.calories || 0),
      proteinGrams: Number(row.nutrition?.proteinGrams || 0),
      carbsGrams: Number(row.nutrition?.carbGrams || 0),
      fatGrams: Number(row.nutrition?.fatGrams || 0),
    };
    const actualNutrition = {
      calories: Number(catalog.nutrition?.calories || 0),
      proteinGrams: Number(catalog.nutrition?.proteinGrams || 0),
      carbsGrams: Number(catalog.nutrition?.carbsGrams || 0),
      fatGrams: Number(catalog.nutrition?.fatGrams || 0),
    };
    if (!same(actualNutrition, expectedNutrition)) pushIssue(errors, "PRODUCT_NUTRITION_MISMATCH", `CatalogItem ${row.key} nutrition differs from workbook`, { expected: expectedNutrition, actual: actualNutrition });
  }

  for (let groupIndex = 0; groupIndex < source.builderGroups.length; groupIndex += 1) {
    const groupRow = source.builderGroups[groupIndex];
    const group = groupByKey.get(groupRow.key);
    if (!group) continue;
    const anyReady = groupRow.options.some((row) => row.status === "Ready");

    if (!same(localized(group.name), localized(groupRow.name))) pushIssue(errors, "OPTION_GROUP_NAME_MISMATCH", `Option group ${groupRow.key} name differs from workbook`);
    if (Boolean(group.isActive) !== anyReady || Boolean(group.publishedAt) !== anyReady) pushIssue(errors, "OPTION_GROUP_STATUS_MISMATCH", `Option group ${groupRow.key} status does not match workbook rows`);
    if (Number(group.sortOrder || 0) !== groupIndex + 1) pushIssue(errors, "OPTION_GROUP_SORT_MISMATCH", `Option group ${groupRow.key} sortOrder differs from workbook`);

    for (let optionIndex = 0; optionIndex < groupRow.options.length; optionIndex += 1) {
      const row = groupRow.options[optionIndex];
      const option = optionByKey.get(row.key);
      if (!option) continue;
      const state = rowStatus(row.status);

      if (id(option.groupId) !== id(group._id)) pushIssue(errors, "OPTION_GROUP_LINK_MISMATCH", `Option ${row.key} is linked to the wrong section`);
      if (!same(localized(option.name), localized(row.name))) pushIssue(errors, "OPTION_NAME_MISMATCH", `Option ${row.key} name differs from workbook`);
      if (!same([...(option.availableFor || [])].sort(), normalizeChannels(row.availableFor).sort())) pushIssue(errors, "OPTION_CHANNEL_MISMATCH", `Option ${row.key} availableFor differs from workbook`);
      if (String(option.selectionType || "") !== String(row.selectionType || "")) pushIssue(errors, "OPTION_SELECTION_TYPE_MISMATCH", `Option ${row.key} selectionType differs from workbook`);
      for (const field of ["isActive", "isVisible", "isAvailable"]) {
        if (Boolean(option[field]) !== Boolean(state[field])) pushIssue(errors, "OPTION_STATUS_MISMATCH", `Option ${row.key}.${field} does not match workbook status ${row.status}`);
      }
      if (state.isReady !== Boolean(option.publishedAt)) pushIssue(errors, "OPTION_PUBLICATION_MISMATCH", `Option ${row.key} publishedAt does not match workbook status`);
      if (Number(option.sortOrder || 0) !== optionIndex + 1) pushIssue(errors, "OPTION_SORT_MISMATCH", `Option ${row.key} sortOrder differs from workbook row order`);
      const catalog = catalogByKey.get(row.key);
      if (!catalog || id(option.catalogItemId) !== id(catalog._id)) pushIssue(errors, "OPTION_CATALOG_LINK_MISMATCH", `Option ${row.key} is not linked to its workbook CatalogItem`);
    }
  }

  for (const candidate of source.productCandidates) {
    if (productByKey.has(candidate.key)) pushIssue(errors, "PRODUCT_CANDIDATE_WAS_PUBLISHED", `Workbook candidate ${candidate.key} was created as a MenuProduct`);
  }

  const summary = {
    sourceWorkbook: source.metadata.sourceWorkbook,
    sourceSha256: source.metadata.sha256,
    categories: categories.length,
    products: products.length,
    readyProducts: products.filter((row) => row.isActive && row.isVisible && row.isAvailable && row.publishedAt).length,
    reviewProducts: products.filter((row) => !row.publishedAt && source.products.some((expected) => expected.key === row.key)).length,
    optionGroups: optionGroups.length,
    builderOptions: options.length,
    productGroupRelations: productGroups.length,
    productOptionRelations: productOptions.length,
    productCandidatesNotSeeded: source.productCandidates.length,
    errors: errors.length,
    warnings: warnings.length,
    expected: counts,
  };

  log.log(
    `Workbook menu verification: categories=${summary.categories}/${counts.categoryCount} `
    + `products=${summary.products}/${counts.productCount} ready=${summary.readyProducts}/${counts.readyProductCount} `
    + `builderOptions=${summary.builderOptions}/${counts.builderOptionCount} errors=${summary.errors} warnings=${summary.warnings}`
  );

  if (strict && errors.length) {
    const error = new Error(`Workbook menu verification failed with ${errors.length} error(s)`);
    error.code = "WORKBOOK_MENU_SOURCE_MISMATCH";
    error.details = errors;
    throw error;
  }
  return { ok: errors.length === 0, summary, errors, warnings };
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await verifyMenuWorkbookSource({ strict: true, log: console });
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[verify-menu-workbook-source] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (Array.isArray(error.details)) console.error(JSON.stringify(error.details, null, 2));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { verifyMenuWorkbookSource };
