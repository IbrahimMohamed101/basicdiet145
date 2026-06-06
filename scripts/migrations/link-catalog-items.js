#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const CatalogItem = require("../../src/models/CatalogItem");
const MenuOption = require("../../src/models/MenuOption");
const MenuProduct = require("../../src/models/MenuProduct");

const SAMPLE_VERIFY_KEYS = Object.freeze(["white_rice", "alfredo_pasta", "chicken", "beef_steak"]);

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    confirm: argv.includes("--confirm-catalog-link-apply"),
  };
}

function isProductionUri(uri) {
  const value = String(uri || "").toLowerCase();
  return value.includes("prod") || value.includes("production") || value.includes("render.com");
}

function stableKey(row) {
  return String(row && row.key ? row.key : "").trim().toLowerCase();
}

function compatibleKindForProduct(product) {
  const itemType = String(product.itemType || "").trim();
  if (["juice", "drink"].includes(itemType)) return "drink";
  if (["dessert", "ice_cream"].includes(itemType)) return "dessert";
  if (["cold_sandwich", "sourdough"].includes(itemType)) return "sandwich";
  if (["basic_meal", "basic_salad", "fruit_salad", "green_salad", "greek_yogurt"].includes(itemType)) return "product";
  return "product";
}

function compatibleKindForOption(option) {
  const groupKey = String(option.groupKey || option.displayCategoryKey || "").trim().toLowerCase();
  if (groupKey.includes("carb") || option.displayCategoryKey === "standard_carbs") return "carb";
  if (option.proteinFamilyKey || option.premiumKey) return "protein";
  return "other";
}

function buildReport({ catalogItems, products, options }) {
  const catalogByKey = new Map(catalogItems.map((item) => [stableKey(item), item]));
  const proposedCatalogItems = [];
  const proposedProductLinks = [];
  const proposedOptionLinks = [];
  const manualReviewRequired = [];

  for (const product of products) {
    if (product.catalogItemId) continue;
    const key = stableKey(product);
    const catalogItem = catalogByKey.get(key);
    if (catalogItem) {
      proposedProductLinks.push({
        menuProductId: String(product._id),
        key,
        oldValue: null,
        newValue: String(catalogItem._id),
        reason: "stable_key_match",
        confidence: 0.95,
      });
    } else if (key) {
      proposedCatalogItems.push({
        sourceModel: "MenuProduct",
        sourceId: String(product._id),
        key,
        itemKind: compatibleKindForProduct(product),
        nameI18n: product.name || { ar: "", en: "" },
        descriptionI18n: product.description || { ar: "", en: "" },
        imageUrl: product.imageUrl || "",
        reason: "stable_product_key_without_existing_catalog_item",
        confidence: 0.8,
      });
      manualReviewRequired.push({
        sourceModel: "MenuProduct",
        sourceId: String(product._id),
        key,
        reason: "new_catalog_item_requires_operator_review_before_apply",
      });
    }
  }

  for (const option of options) {
    if (option.catalogItemId) continue;
    const key = stableKey(option);
    const catalogItem = catalogByKey.get(key);
    if (catalogItem) {
      proposedOptionLinks.push({
        menuOptionId: String(option._id),
        key,
        oldValue: null,
        newValue: String(catalogItem._id),
        reason: "stable_key_match",
        confidence: 0.95,
      });
    } else if (key) {
      manualReviewRequired.push({
        sourceModel: "MenuOption",
        sourceId: String(option._id),
        key,
        suggestedItemKind: compatibleKindForOption(option),
        reason: "no_existing_catalog_item_for_stable_key",
      });
    }
  }

  return {
    mode: "dry_run",
    generatedAt: new Date().toISOString(),
    proposedCatalogItems,
    proposedProductLinks,
    proposedOptionLinks,
    manualReviewRequired,
    rollback: {
      note: "If --apply is used in the future, persist this report before applying and unset catalogItemId on listed records to roll back links.",
    },
  };
}

function missingCatalogItemIdFilter(id) {
  return {
    _id: id,
    $or: [
      { catalogItemId: null },
      { catalogItemId: { $exists: false } },
    ],
  };
}

async function loadCatalogLinkInputs() {
  const [catalogItems, products, options] = await Promise.all([
    CatalogItem.find({}).lean(),
    MenuProduct.find({}).lean(),
    MenuOption.find({}).lean(),
  ]);
  return { catalogItems, products, options };
}

async function countUsageForCatalogIds(ids) {
  if (!ids.length) return {};
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(String(id)));
  const [productCounts, optionCounts] = await Promise.all([
    MenuProduct.aggregate([
      { $match: { catalogItemId: { $in: objectIds } } },
      { $group: { _id: "$catalogItemId", count: { $sum: 1 } } },
    ]),
    MenuOption.aggregate([
      { $match: { catalogItemId: { $in: objectIds } } },
      { $group: { _id: "$catalogItemId", count: { $sum: 1 } } },
    ]),
  ]);
  const counts = {};
  for (const id of ids) {
    counts[String(id)] = { linkedProductsCount: 0, linkedOptionsCount: 0, usageCount: 0 };
  }
  for (const row of productCounts) {
    const key = String(row._id);
    counts[key] = { ...(counts[key] || {}), linkedProductsCount: row.count };
  }
  for (const row of optionCounts) {
    const key = String(row._id);
    counts[key] = { ...(counts[key] || {}), linkedOptionsCount: row.count };
  }
  for (const row of Object.values(counts)) {
    row.linkedProductsCount = Number(row.linkedProductsCount || 0);
    row.linkedOptionsCount = Number(row.linkedOptionsCount || 0);
    row.usageCount = row.linkedProductsCount + row.linkedOptionsCount;
  }
  return counts;
}

async function buildSampleVerification(keys = SAMPLE_VERIFY_KEYS) {
  const samples = [];
  for (const key of keys) {
    const [catalogItem, product, option] = await Promise.all([
      CatalogItem.findOne({ key }).select("_id key").lean(),
      MenuProduct.findOne({ key }).select("_id key catalogItemId").lean(),
      MenuOption.findOne({ key }).select("_id key groupId catalogItemId").lean(),
    ]);
    const countByCatalogId = catalogItem ? await countUsageForCatalogIds([catalogItem._id]) : {};
    samples.push({
      key,
      catalogItemId: catalogItem ? String(catalogItem._id) : null,
      menuProductCatalogItemId: product && product.catalogItemId ? String(product.catalogItemId) : null,
      menuOptionCatalogItemId: option && option.catalogItemId ? String(option.catalogItemId) : null,
      productMatchesCatalog: Boolean(product && catalogItem && product.catalogItemId && String(product.catalogItemId) === String(catalogItem._id)),
      optionMatchesCatalog: Boolean(option && catalogItem && option.catalogItemId && String(option.catalogItemId) === String(catalogItem._id)),
      counts: catalogItem ? countByCatalogId[String(catalogItem._id)] : { linkedProductsCount: 0, linkedOptionsCount: 0, usageCount: 0 },
    });
  }
  return samples;
}

async function verifyReportLinks(report) {
  const [productRows, optionRows] = await Promise.all([
    report.proposedProductLinks.length
      ? MenuProduct.find({ _id: { $in: report.proposedProductLinks.map((link) => link.menuProductId) } }).select("_id catalogItemId").lean()
      : [],
    report.proposedOptionLinks.length
      ? MenuOption.find({ _id: { $in: report.proposedOptionLinks.map((link) => link.menuOptionId) } }).select("_id catalogItemId").lean()
      : [],
  ]);
  const productsById = new Map(productRows.map((row) => [String(row._id), row]));
  const optionsById = new Map(optionRows.map((row) => [String(row._id), row]));
  const linkFailures = [];

  for (const link of report.proposedProductLinks) {
    const row = productsById.get(link.menuProductId);
    if (!row || String(row.catalogItemId || "") !== String(link.newValue)) {
      linkFailures.push({ sourceModel: "MenuProduct", sourceId: link.menuProductId, key: link.key, expectedCatalogItemId: link.newValue });
    }
  }
  for (const link of report.proposedOptionLinks) {
    const row = optionsById.get(link.menuOptionId);
    if (!row || String(row.catalogItemId || "") !== String(link.newValue)) {
      linkFailures.push({ sourceModel: "MenuOption", sourceId: link.menuOptionId, key: link.key, expectedCatalogItemId: link.newValue });
    }
  }

  const catalogIds = [...new Set([
    ...report.proposedProductLinks.map((link) => link.newValue),
    ...report.proposedOptionLinks.map((link) => link.newValue),
  ])];
  return {
    ok: linkFailures.length === 0,
    checkedProductLinks: report.proposedProductLinks.length,
    checkedOptionLinks: report.proposedOptionLinks.length,
    linkFailures,
    countsByCatalogItemId: await countUsageForCatalogIds(catalogIds),
    sampleKeys: await buildSampleVerification(),
  };
}

async function applyReport(report) {
  const productOps = report.proposedProductLinks.map((link) => ({
    updateOne: {
      filter: missingCatalogItemIdFilter(link.menuProductId),
      update: { $set: { catalogItemId: link.newValue } },
    },
  }));
  const optionOps = report.proposedOptionLinks.map((link) => ({
    updateOne: {
      filter: missingCatalogItemIdFilter(link.menuOptionId),
      update: { $set: { catalogItemId: link.newValue } },
    },
  }));

  const [productResult, optionResult] = await Promise.all([
    productOps.length ? MenuProduct.bulkWrite(productOps) : Promise.resolve({ modifiedCount: 0 }),
    optionOps.length ? MenuOption.bulkWrite(optionOps) : Promise.resolve({ modifiedCount: 0 }),
  ]);
  return {
    productLinksModified: productResult.modifiedCount || 0,
    optionLinksModified: optionResult.modifiedCount || 0,
  };
}

async function runCatalogLinkMigration({ argv = process.argv.slice(2), mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI } = {}) {
  const args = parseArgs(argv);
  if (!mongoUri) {
    throw new Error("MONGO_URI or MONGODB_URI is required");
  }
  if (args.apply && (!args.confirm || process.env.ALLOW_CATALOG_LINK_APPLY !== "true")) {
    throw new Error("--apply requires --confirm-catalog-link-apply and ALLOW_CATALOG_LINK_APPLY=true");
  }
  if (args.apply && isProductionUri(mongoUri) && process.env.ALLOW_PRODUCTION_CATALOG_LINK_APPLY !== "true") {
    throw new Error("Refusing production apply without ALLOW_PRODUCTION_CATALOG_LINK_APPLY=true");
  }

  await mongoose.connect(mongoUri);
  try {
    const report = buildReport(await loadCatalogLinkInputs());

    if (!args.apply) {
      return report;
    }

    const applied = await applyReport(report);
    return {
      ...report,
      mode: "apply",
      applied,
      verification: await verifyReportLinks(report),
    };
  } finally {
    await mongoose.connection.close();
  }
}

async function main() {
  const report = await runCatalogLinkMigration({ argv: process.argv.slice(2) });
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  applyReport,
  buildReport,
  buildSampleVerification,
  countUsageForCatalogIds,
  isProductionUri,
  loadCatalogLinkInputs,
  parseArgs,
  runCatalogLinkMigration,
  stableKey,
  verifyReportLinks,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
