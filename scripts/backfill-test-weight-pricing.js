#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const { assertValidWeightPricingConfiguration } = require("../src/services/orders/weightPricingService");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");
const {
  hasTestWeightPricing,
  testWeightPricingEligibility,
  testWeightPricingUpdate,
} = require("./lib/test-weight-pricing");

async function categoryKeysById(products) {
  const categoryIds = [
    ...new Set(products.map((product) => String(product.categoryId || "")).filter(Boolean)),
  ];
  const categories = await MenuCategory.find({ _id: { $in: categoryIds } }).select("key").lean();
  return new Map(categories.map((category) => [String(category._id), category.key]));
}

function createReport(inspected) {
  return { inspected, updated: 0, skipped: 0, unchanged: 0, skippedProducts: [] };
}

function recordSkip(report, product, reason, log) {
  const skippedProduct = { key: product.key || String(product._id), reason };
  report.skipped += 1;
  report.skippedProducts.push(skippedProduct);
  log.log(`[test-weight-pricing] skipped ${skippedProduct.key}: ${reason}`);
}

async function updateEligibleProduct(product, report) {
  const update = testWeightPricingUpdate(product);
  assertValidWeightPricingConfiguration(update);
  if (hasTestWeightPricing(product, update)) {
    report.unchanged += 1;
    return;
  }

  await MenuProduct.updateOne({ _id: product._id }, { $set: update }, { runValidators: true });
  report.updated += 1;
}

async function backfillTestWeightPricing({ log = console } = {}) {
  const products = await MenuProduct.find({ isActive: true }).lean();
  const categoryKeys = await categoryKeysById(products);
  const report = createReport(products.length);

  for (const product of products) {
    const categoryKey = categoryKeys.get(String(product.categoryId)) || "";
    const eligibility = testWeightPricingEligibility(product, categoryKey);
    if (!eligibility.eligible) {
      recordSkip(report, product, eligibility.reason, log);
      continue;
    }

    await updateEligibleProduct(product, report);
  }

  log.log(
    `[test-weight-pricing] inspected=${report.inspected} updated=${report.updated} `
      + `skipped=${report.skipped} unchanged=${report.unchanged}`
  );
  return report;
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await backfillTestWeightPricing();
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err && err.stack ? err.stack : err);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { backfillTestWeightPricing };
