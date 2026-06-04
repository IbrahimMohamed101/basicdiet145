#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const CatalogItem = require("../../src/models/CatalogItem");
const MenuOption = require("../../src/models/MenuOption");
const MenuProduct = require("../../src/models/MenuProduct");

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
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
    const [catalogItems, products, options] = await Promise.all([
      CatalogItem.find({}).lean(),
      MenuProduct.find({}).lean(),
      MenuOption.find({}).lean(),
    ]);
    const report = buildReport({ catalogItems, products, options });

    if (!args.apply) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const productOps = report.proposedProductLinks.map((link) => ({
      updateOne: {
        filter: { _id: link.menuProductId, catalogItemId: { $in: [null, undefined] } },
        update: { $set: { catalogItemId: link.newValue } },
      },
    }));
    const optionOps = report.proposedOptionLinks.map((link) => ({
      updateOne: {
        filter: { _id: link.menuOptionId, catalogItemId: { $in: [null, undefined] } },
        update: { $set: { catalogItemId: link.newValue } },
      },
    }));

    const [productResult, optionResult] = await Promise.all([
      productOps.length ? MenuProduct.bulkWrite(productOps) : Promise.resolve({ modifiedCount: 0 }),
      optionOps.length ? MenuOption.bulkWrite(optionOps) : Promise.resolve({ modifiedCount: 0 }),
    ]);
    console.log(JSON.stringify({
      ...report,
      mode: "apply",
      applied: {
        productLinksModified: productResult.modifiedCount || 0,
        optionLinksModified: optionResult.modifiedCount || 0,
      },
    }, null, 2));
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
