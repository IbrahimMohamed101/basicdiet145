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
const source = require("./fixtures/menu-workbook-source");
const { allBuilderOptions, seedNewMenu } = require("./seed-new-menu");
const { verifyMenuWorkbookSource } = require("./verify-menu-workbook-source");

function expectedSets() {
  return {
    categoryKeys: new Set(source.categories.map((row) => row.key)),
    productKeys: new Set(source.products.map((row) => row.key)),
    groupKeys: new Set(source.builderGroups.map((row) => row.key)),
    optionKeys: new Set(allBuilderOptions().map(({ option }) => option.key)),
  };
}

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function assertExecutionAllowed({ execute }) {
  if (!execute) return;
  if (!isTruthy(process.env.ALLOW_WORKBOOK_MENU_RECONCILE)) {
    throw new Error("Set ALLOW_WORKBOOK_MENU_RECONCILE=true before using --execute");
  }
  if (
    String(process.env.NODE_ENV || "").toLowerCase() === "production"
    && String(process.env.WORKBOOK_MENU_RECONCILE_CONFIRM || "") !== source.metadata.sha256
  ) {
    throw new Error(
      "Production reconciliation requires WORKBOOK_MENU_RECONCILE_CONFIRM "
      + `to equal workbook SHA-256 ${source.metadata.sha256}`
    );
  }
}

async function buildPlan() {
  const sets = expectedSets();
  const [categories, products, groups, options, productGroups, productOptions] = await Promise.all([
    MenuCategory.find({}).select("_id key").lean(),
    MenuProduct.find({}).select("_id key catalogItemId").lean(),
    MenuOptionGroup.find({}).select("_id key").lean(),
    MenuOption.find({}).select("_id key catalogItemId").lean(),
    ProductOptionGroup.find({}).select("_id").lean(),
    ProductGroupOption.find({}).select("_id").lean(),
  ]);

  const extraCategories = categories.filter((row) => !sets.categoryKeys.has(row.key));
  const extraProducts = products.filter((row) => !sets.productKeys.has(row.key));
  const extraGroups = groups.filter((row) => !sets.groupKeys.has(row.key));
  const extraOptions = options.filter((row) => !sets.optionKeys.has(row.key));
  const catalogItemIds = [...new Set(
    [...extraProducts, ...extraOptions]
      .map((row) => row.catalogItemId)
      .filter(Boolean)
      .map(String)
  )];

  return {
    extraCategories,
    extraProducts,
    extraGroups,
    extraOptions,
    productGroups,
    productOptions,
    catalogItemIds,
    missing: {
      categories: source.categories.filter((row) => !categories.some((actual) => actual.key === row.key)).length,
      products: source.products.filter((row) => !products.some((actual) => actual.key === row.key)).length,
      groups: source.builderGroups.filter((row) => !groups.some((actual) => actual.key === row.key)).length,
      options: allBuilderOptions().filter(({ option }) => !options.some((actual) => actual.key === option.key)).length,
    },
  };
}

function planSummary(plan) {
  return {
    sourceWorkbook: source.metadata.sourceWorkbook,
    sourceSha256: source.metadata.sha256,
    archiveCategories: plan.extraCategories.length,
    archiveProducts: plan.extraProducts.length,
    archiveOptionGroups: plan.extraGroups.length,
    archiveOptions: plan.extraOptions.length,
    archiveProductGroupRelations: plan.productGroups.length,
    archiveProductOptionRelations: plan.productOptions.length,
    archiveLinkedCatalogItems: plan.catalogItemIds.length,
    createMissing: plan.missing,
    replaceWorkbookRows: {
      categories: source.categories.length,
      products: source.products.length,
      optionGroups: source.builderGroups.length,
      options: allBuilderOptions().length,
    },
  };
}

async function reconcileWorkbookMenu({ execute = false, log = console } = {}) {
  assertExecutionAllowed({ execute });
  const plan = await buildPlan();
  const summary = planSummary(plan);
  log.log(`[workbook-menu-reconcile] ${JSON.stringify(summary)}`);

  if (!execute) {
    log.log("[workbook-menu-reconcile] dry-run only; no database rows were changed");
    return { dryRun: true, summary };
  }

  const archive = {
    isActive: false,
    isVisible: false,
    isAvailable: false,
    publishedAt: null,
  };

  await Promise.all([
    plan.extraCategories.length
      ? MenuCategory.updateMany({ _id: { $in: plan.extraCategories.map((row) => row._id) } }, { $set: archive })
      : null,
    plan.extraProducts.length
      ? MenuProduct.updateMany({ _id: { $in: plan.extraProducts.map((row) => row._id) } }, { $set: archive })
      : null,
    plan.extraGroups.length
      ? MenuOptionGroup.updateMany({ _id: { $in: plan.extraGroups.map((row) => row._id) } }, { $set: archive })
      : null,
    plan.extraOptions.length
      ? MenuOption.updateMany({ _id: { $in: plan.extraOptions.map((row) => row._id) } }, { $set: archive })
      : null,
    ProductOptionGroup.updateMany({}, { $set: { isActive: false, isVisible: false, isAvailable: false } }),
    ProductGroupOption.updateMany({}, { $set: { isActive: false, isVisible: false, isAvailable: false } }),
    plan.catalogItemIds.length
      ? CatalogItem.updateMany(
        { _id: { $in: plan.catalogItemIds } },
        { $set: { isActive: false, isAvailable: false } }
      )
      : null,
  ]);

  await seedNewMenu({ replaceExisting: true, sync: false, log });
  const verification = await verifyMenuWorkbookSource({ strict: true, log });
  log.log("[workbook-menu-reconcile] completed; workbook rows are now the only live menu rows");

  return { dryRun: false, summary, verification };
}

async function main() {
  const execute = process.argv.includes("--execute");
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await reconcileWorkbookMenu({ execute, log: console });
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[workbook-menu-reconcile] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (Array.isArray(error.details)) console.error(JSON.stringify(error.details, null, 2));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  buildPlan,
  reconcileWorkbookMenu,
};
