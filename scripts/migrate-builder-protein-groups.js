#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderProtein = require("../src/models/BuilderProtein");
const {
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
} = require("../src/config/mealPlannerContract");

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    console.error("Missing MongoDB connection string (MONGO_URI, MONGODB_URI, or MONGO_URL)");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);

  const proteinCategories = MEAL_PLANNER_CATEGORY_DEFINITIONS.filter((category) => category.dimension === "protein");
  const categoryIdByKey = new Map();

  for (const category of proteinCategories) {
    const doc = await BuilderCategory.findOneAndUpdate(
      { key: category.key, dimension: category.dimension },
      {
        $set: {
          name: category.name,
          description: category.description || { ar: "", en: "" },
          rules: category.rules || {},
          sortOrder: category.sortOrder,
          isActive: true,
        },
      },
      { upsert: true, new: true, lean: true }
    );
    categoryIdByKey.set(category.key, doc._id);
  }

  const proteins = await BuilderProtein.find({}).lean();
  console.log(`Found ${proteins.length} BuilderProtein documents\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const protein of proteins) {
    processed += 1;
    try {
      const proteinFamilyKey = normalizeProteinFamilyKey(protein.proteinFamilyKey);
      const displayCategoryKey = normalizeProteinDisplayCategoryKey(protein.displayCategoryKey, {
        isPremium: Boolean(protein.isPremium),
        proteinFamilyKey,
      });
      const displayCategoryId = categoryIdByKey.get(displayCategoryKey);

      if (!displayCategoryId) {
        console.warn(`  SKIPPED: missing BuilderCategory for ${displayCategoryKey} (${protein.key || protein.premiumKey || protein._id})`);
        skipped += 1;
        continue;
      }

      const needsUpdate = String(protein.proteinFamilyKey || "") !== proteinFamilyKey
        || String(protein.displayCategoryKey || "") !== displayCategoryKey
        || String(protein.displayCategoryId || "") !== String(displayCategoryId || "");

      if (!needsUpdate) {
        skipped += 1;
        continue;
      }

      await BuilderProtein.updateOne(
        { _id: protein._id },
        {
          $set: {
            proteinFamilyKey,
            displayCategoryKey,
            displayCategoryId,
          },
        }
      );

      console.log(`  UPDATED: ${protein.key || protein.premiumKey || protein._id} -> family=${proteinFamilyKey}, display=${displayCategoryKey}`);
      updated += 1;
    } catch (error) {
      console.warn(`  FAILED: ${protein.key || protein.premiumKey || protein._id} -> ${error.message}`);
      failed += 1;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
