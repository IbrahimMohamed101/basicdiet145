/**
 * repairMealBuilderProducts.js
 *
 * Scans MealBuilderConfig sections and backfills publishedAt / fixes selectionType
 * for products/categories that are missing required fields for Meal Builder publication.
 *
 * Usage:
 *   node scripts/repairMealBuilderProducts.js              # dry-run (default, no DB writes)
 *   node scripts/repairMealBuilderProducts.js --apply      # apply mutations
 *   node scripts/repairMealBuilderProducts.js --all-active # extend scope to all active products/categories
 *   node scripts/repairMealBuilderProducts.js --allow-ambiguous  # do not exit non-zero for ambiguous products
 *
 * Safety:
 *   - Dry-run by default: no data is written unless --apply is passed.
 *   - Targeted scope: only operates on products/categories referenced by MealBuilderConfig (not all active).
 *   - --all-active extends scope but is explicit opt-in.
 *   - Never prints MongoDB URI, credentials, or sensitive environment variables.
 *   - Does not perform destructive deletes or hard resets.
 *   - Exits non-zero if ambiguous products are found unless --allow-ambiguous is passed.
 *
 * Security: MONGO_URI is read from environment, never printed.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const MenuProduct = require("../src/models/MenuProduct");
const MenuCategory = require("../src/models/MenuCategory");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const MealBuilderConfig = require("../src/models/MealBuilderConfig");
const { MEAL_SELECTION_TYPES } = require("../src/config/mealPlannerContract");

const isDryRun = !process.argv.includes("--apply");
const isAllActive = process.argv.includes("--all-active");
const allowAmbiguous = process.argv.includes("--allow-ambiguous");

// ─── Summary counters ────────────────────────────────────────────────────────
const summary = {
  scannedProducts: 0,
  scannedCategories: 0,
  publishBackfillCandidates: 0,
  sectionConversionCandidates: 0,
  ambiguousProducts: 0,
  appliedChanges: 0,
  skippedChanges: 0,
};

function log(...args) {
  console.log(...args);
}

function logSection(title) {
  log(`\n${"─".repeat(60)}`);
  log(`  ${title}`);
  log("─".repeat(60));
}

async function main() {
  if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
    console.error("ERROR: MONGO_URI or MONGODB_URI environment variable is required.");
    process.exit(1);
  }

  // Connect without printing the URI
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  log("Connected to MongoDB");
  log(isDryRun ? "MODE: DRY-RUN (pass --apply to write changes)" : "MODE: APPLY (writing changes to DB)");
  log(isAllActive ? "SCOPE: --all-active (all active products/categories)" : "SCOPE: MealBuilderConfig-referenced only");

  // ── 1. Collect targeted product/category IDs from MealBuilderConfig ────────
  const configs = await MealBuilderConfig.find({
    status: { $in: ["published", "draft"] },
    isCurrent: true,
  }).lean();

  log(`\nFound ${configs.length} current MealBuilderConfig(s) (published + draft)`);

  const configProductIds = new Set();
  const configCategoryIds = new Set();
  const configSectionsByProductId = new Map(); // productId → [section]

  for (const config of configs) {
    for (const section of config.sections || []) {
      if (section.sourceCategoryId) configCategoryIds.add(String(section.sourceCategoryId));
      if (section.productContextId) configProductIds.add(String(section.productContextId));
      for (const productId of section.selectedProductIds || []) {
        const key = String(productId);
        configProductIds.add(key);
        if (!configSectionsByProductId.has(key)) configSectionsByProductId.set(key, []);
        configSectionsByProductId.get(key).push(section);
      }
    }
  }

  log(`Targeted product IDs from configs: ${configProductIds.size}`);
  log(`Targeted category IDs from configs: ${configCategoryIds.size}`);

  // ── 2. Determine product/category query scope ───────────────────────────────
  let productQuery = isAllActive
    ? { isActive: true, publishedAt: null }
    : { _id: { $in: [...configProductIds] }, isActive: true, publishedAt: null };

  let categoryQuery = isAllActive
    ? { isActive: true, publishedAt: null }
    : { _id: { $in: [...configCategoryIds] }, isActive: true, publishedAt: null };

  const [unpublishedProducts, unpublishedCategories] = await Promise.all([
    MenuProduct.find(productQuery).lean(),
    MenuCategory.find(categoryQuery).lean(),
  ]);

  summary.scannedProducts = unpublishedProducts.length + configProductIds.size;
  summary.scannedCategories = unpublishedCategories.length + configCategoryIds.size;

  // ── 3. Phase A: Publish backfill candidates ────────────────────────────────
  logSection("Phase A: publishedAt Backfill Candidates");

  for (const category of unpublishedCategories) {
    const name = category.name?.en || category.key || String(category._id);
    log(`  [CATEGORY] "${name}" — publishedAt is null, would set to now`);
    summary.publishBackfillCandidates++;
    if (!isDryRun) {
      await MenuCategory.updateOne({ _id: category._id }, { $set: { publishedAt: new Date() } });
      summary.appliedChanges++;
      log(`    → APPLIED`);
    } else {
      summary.skippedChanges++;
    }
  }

  for (const product of unpublishedProducts) {
    const name = product.name?.en || product.key || String(product._id);
    log(`  [PRODUCT]  "${name}" — publishedAt is null, would set to now`);
    summary.publishBackfillCandidates++;
    if (!isDryRun) {
      await MenuProduct.updateOne({ _id: product._id }, { $set: { publishedAt: new Date() } });
      summary.appliedChanges++;
      log(`    → APPLIED`);
    } else {
      summary.skippedChanges++;
    }
  }

  if (unpublishedProducts.length === 0 && unpublishedCategories.length === 0) {
    log("  (no unpublished products or categories found in scope)");
  }

  // ── 4. Phase B: Section selectionType conversion candidates ────────────────
  logSection("Phase B: standard_meal → full_meal_product Section Conversion");

  const ambiguousProductKeys = [];

  for (const config of configs) {
    let configModified = false;

    for (const section of config.sections || []) {
      const isStandardMeal = section.selectionType === MEAL_SELECTION_TYPES.STANDARD_MEAL || !section.selectionType;
      if (!isStandardMeal) continue;
      if (!section.selectedProductIds || section.selectedProductIds.length === 0) continue;

      const hasAnyOptionGroup = await Promise.all(
        section.selectedProductIds.map(async (productId) => {
          const count = await ProductOptionGroup.countDocuments({ productId, isActive: true });
          return count > 0;
        })
      );

      const anyHasGroups = hasAnyOptionGroup.some(Boolean);
      const allHaveNoGroups = hasAnyOptionGroup.every((v) => !v);

      if (anyHasGroups && !allHaveNoGroups) {
        // Mixed state: some products have option groups, some don't — ambiguous
        log(`  [AMBIGUOUS] Section "${section.key}" has mixed products (some with option groups, some without)`);
        log(`    Skipping — manual review required`);
        summary.ambiguousProducts++;
        ambiguousProductKeys.push(section.key);
        continue;
      }

      if (!allHaveNoGroups) continue; // some have groups — this is a normal builder section

      // All products have zero option groups in a standard_meal section → conversion candidate
      const productIds = section.selectedProductIds.map(String);
      const products = await MenuProduct.find({ _id: { $in: productIds } }).lean();
      const productNames = products.map((p) => p.name?.en || p.key).join(", ");

      log(`  [CONVERT] Section "${section.key}" (${config.status}) → full_meal_product`);
      log(`    Products: ${productNames}`);
      log(`    Before: selectionType="${section.selectionType || "(none)"}"`);
      log(`    After:  selectionType="full_meal_product", metadata.requiresBuilder=false, metadata.treatAsFullMeal=true`);
      summary.sectionConversionCandidates++;

      if (!isDryRun) {
        section.selectionType = MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
        section.metadata = {
          ...section.metadata,
          requiresBuilder: false,
          treatAsFullMeal: true,
        };
        configModified = true;
        summary.appliedChanges++;
        log(`    → APPLIED`);
      } else {
        summary.skippedChanges++;
      }
    }

    if (configModified) {
      await MealBuilderConfig.updateOne(
        { _id: config._id },
        { $set: { sections: config.sections } }
      );
      log(`  MealBuilderConfig (${config.status}) updated.`);
    }
  }

  // ── 5. Final summary ────────────────────────────────────────────────────────
  logSection("Summary");
  log(`  scannedProducts           : ${summary.scannedProducts}`);
  log(`  scannedCategories         : ${summary.scannedCategories}`);
  log(`  publishBackfillCandidates : ${summary.publishBackfillCandidates}`);
  log(`  sectionConversionCandidates: ${summary.sectionConversionCandidates}`);
  log(`  ambiguousProducts         : ${summary.ambiguousProducts}`);
  log(`  appliedChanges            : ${summary.appliedChanges}`);
  log(`  skippedChanges            : ${summary.skippedChanges}`);

  if (isDryRun && (summary.publishBackfillCandidates > 0 || summary.sectionConversionCandidates > 0)) {
    log("\n  DRY-RUN: No data was written. Pass --apply to apply changes.");
  }

  await mongoose.disconnect();

  if (summary.ambiguousProducts > 0 && !allowAmbiguous) {
    console.error(`\nEXIT 1: ${summary.ambiguousProducts} ambiguous product section(s) require manual review.`);
    console.error("Pass --allow-ambiguous to suppress this error and skip ambiguous sections.");
    process.exit(1);
  }

  log("\nRepair script finished successfully.");
}

main().catch(async (err) => {
  console.error("ERROR:", err && err.stack ? err.stack : err);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exit(1);
});
