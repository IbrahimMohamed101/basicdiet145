#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const SaladIngredient = require("../src/models/SaladIngredient");
const {
  LARGE_SALAD_CATEGORY_KEY,
  PROTEIN_DISPLAY_GROUPS,
  SALAD_INGREDIENT_GROUP_KEYS,
  STANDARD_CARB_CATEGORY_KEY,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
} = require("../src/config/mealPlannerContract");

const CANONICAL_STANDARD_CARB_KEYS = Object.freeze([
  "white_rice",
  "turmeric_rice",
  "biryani_rice",
  "quinoa",
  "alfredo_pasta",
  "red_sauce_pasta",
  "roasted_potato",
  "sweet_potato",
  "grilled_mixed_vegetables",
]);

const CANONICAL_STANDARD_PROTEIN_DEFINITIONS = Object.freeze([
  { key: "boiled_eggs", displayCategoryKey: "eggs", proteinFamilyKey: "eggs" },
  { key: "tuna", displayCategoryKey: "fish", proteinFamilyKey: "fish" },
  { key: "fajita", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "butter_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "cream_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "coconut_curry_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "spicy_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "italian_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "chicken_tikka", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "asian_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "strips", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "grilled_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "mexican_chicken", displayCategoryKey: "chicken", proteinFamilyKey: "chicken" },
  { key: "meatballs", displayCategoryKey: "beef", proteinFamilyKey: "beef" },
  { key: "beef_stroganoff", displayCategoryKey: "beef", proteinFamilyKey: "beef" },
]);

const CANONICAL_STANDARD_PROTEIN_BY_KEY = new Map(
  CANONICAL_STANDARD_PROTEIN_DEFINITIONS.map((row) => [row.key, row])
);
const CANONICAL_STANDARD_PROTEIN_KEYS = new Set(CANONICAL_STANDARD_PROTEIN_BY_KEY.keys());
const VALID_PROTEIN_DISPLAY_CATEGORY_KEYS = new Set(PROTEIN_DISPLAY_GROUPS.map((group) => group.key));
const VALID_SALAD_GROUP_KEYS = new Set(Array.from(SALAD_INGREDIENT_GROUP_KEYS));
const CANONICAL_CARB_DISPLAY_CATEGORY_KEYS = new Set([STANDARD_CARB_CATEGORY_KEY, LARGE_SALAD_CATEGORY_KEY]);

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getMongoUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || "";
}

function sortObject(input) {
  const keys = Object.keys(input).sort();
  const out = {};
  for (const key of keys) out[key] = input[key];
  return out;
}

function countBy(rows, getKey) {
  const counts = {};
  for (const row of rows) {
    const key = getKey(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortObject(counts);
}

function serializeProtein(row) {
  return {
    id: String(row._id),
    key: row.key || null,
    premiumKey: row.premiumKey || null,
    nameEn: row.name && row.name.en ? row.name.en : "",
    nameAr: row.name && row.name.ar ? row.name.ar : "",
    isActive: Boolean(row.isActive),
    isPremium: Boolean(row.isPremium),
    availableForSubscription: row.availableForSubscription !== false,
    displayCategoryKey: row.displayCategoryKey || null,
    proteinFamilyKey: row.proteinFamilyKey || null,
    sortOrder: Number(row.sortOrder || 0),
  };
}

function serializeCarb(row) {
  return {
    id: String(row._id),
    key: row.key || null,
    nameEn: row.name && row.name.en ? row.name.en : "",
    nameAr: row.name && row.name.ar ? row.name.ar : "",
    isActive: Boolean(row.isActive),
    availableForSubscription: row.availableForSubscription !== false,
    displayCategoryKey: row.displayCategoryKey || null,
    sortOrder: Number(row.sortOrder || 0),
  };
}

function serializeIngredient(row) {
  return {
    id: String(row._id),
    nameEn: row.name && row.name.en ? row.name.en : "",
    nameAr: row.name && row.name.ar ? row.name.ar : "",
    isActive: Boolean(row.isActive),
    groupKey: row.groupKey || null,
    sortOrder: Number(row.sortOrder || 0),
  };
}

function getProteinExpectation(row) {
  const keyedExpectation = CANONICAL_STANDARD_PROTEIN_BY_KEY.get(String(row.key || "").trim());
  if (keyedExpectation) {
    return keyedExpectation;
  }

  const proteinFamilyKey = normalizeProteinFamilyKey(row.proteinFamilyKey);
  const displayCategoryKey = normalizeProteinDisplayCategoryKey(row.displayCategoryKey, {
    isPremium: Boolean(row.isPremium),
    proteinFamilyKey,
  });

  return {
    displayCategoryKey,
    proteinFamilyKey,
  };
}

async function buildReport() {
  const proteins = await BuilderProtein.find({})
    .select("key premiumKey name isActive isPremium availableForSubscription displayCategoryKey proteinFamilyKey sortOrder")
    .lean();
  const carbs = await BuilderCarb.find({})
    .select("key name isActive availableForSubscription displayCategoryKey sortOrder")
    .lean();
  const saladIngredients = await SaladIngredient.find({})
    .select("name isActive groupKey sortOrder")
    .lean();

  const activeCarbs = carbs.filter((row) => row.isActive);
  const selectableCarbs = activeCarbs.filter((row) => row.availableForSubscription !== false);
  const activeStandardProteins = proteins.filter((row) => row.isActive && !row.isPremium);
  const activePremiumProteins = proteins.filter((row) => row.isActive && row.isPremium);

  const standardProteinsWithInvalidPremiumKey = activeStandardProteins
    .filter((row) => String(row.premiumKey || "").trim())
    .map(serializeProtein);

  const proteinsWithInvalidOrMissingDisplayCategoryKey = proteins
    .filter((row) => !VALID_PROTEIN_DISPLAY_CATEGORY_KEYS.has(String(row.displayCategoryKey || "").trim()))
    .map(serializeProtein);

  const proteinFamilyMismatches = proteins
    .map((row) => {
      const expectation = getProteinExpectation(row);
      const currentDisplayCategoryKey = String(row.displayCategoryKey || "").trim() || null;
      const currentProteinFamilyKey = String(row.proteinFamilyKey || "").trim() || null;

      if (
        currentDisplayCategoryKey === expectation.displayCategoryKey
        && currentProteinFamilyKey === expectation.proteinFamilyKey
      ) {
        return null;
      }

      return {
        ...serializeProtein(row),
        expectedDisplayCategoryKey: expectation.displayCategoryKey,
        expectedProteinFamilyKey: expectation.proteinFamilyKey,
      };
    })
    .filter(Boolean);

  const duplicateProteinKeys = await BuilderProtein.aggregate([
    { $match: { key: { $type: "string", $ne: "" } } },
    { $group: { _id: "$key", ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const duplicateCarbKeys = await BuilderCarb.aggregate([
    { $match: { key: { $type: "string", $ne: "" } } },
    { $group: { _id: "$key", ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const activeLargeSaladRows = selectableCarbs
    .filter((row) => String(row.displayCategoryKey || "").trim() === LARGE_SALAD_CATEGORY_KEY)
    .sort((left, right) => left.sortOrder - right.sortOrder || String(left._id).localeCompare(String(right._id)))
    .map(serializeCarb);

  const largeSaladIdentity = activeLargeSaladRows.find((row) => row.key === LARGE_SALAD_CATEGORY_KEY) || null;

  const activeLegacyStandardProteins = activeStandardProteins
    .filter((row) => !CANONICAL_STANDARD_PROTEIN_KEYS.has(String(row.key || "").trim()))
    .map(serializeProtein);

  const activeLegacyCarbRows = activeCarbs
    .filter((row) => {
      const key = String(row.key || "").trim();
      const displayCategoryKey = String(row.displayCategoryKey || "").trim();
      if (key && (CANONICAL_STANDARD_CARB_KEYS.includes(key) || key === LARGE_SALAD_CATEGORY_KEY)) {
        return false;
      }
      return !CANONICAL_CARB_DISPLAY_CATEGORY_KEYS.has(displayCategoryKey) || displayCategoryKey === LARGE_SALAD_CATEGORY_KEY || row.availableForSubscription === false;
    })
    .map(serializeCarb);

  const invalidOrMissingSaladGroupKey = saladIngredients
    .filter((row) => !VALID_SALAD_GROUP_KEYS.has(String(row.groupKey || "").trim()))
    .map(serializeIngredient);

  return {
    generatedAt: new Date().toISOString(),
    dbName: mongoose.connection.name || (mongoose.connection.db && mongoose.connection.db.databaseName) || "",
    carbs: {
      activeByDisplayCategoryKey: countBy(activeCarbs, (row) => row.displayCategoryKey || "(missing)"),
      selectableByDisplayCategoryKey: countBy(selectableCarbs, (row) => row.displayCategoryKey || "(missing)"),
      canonicalSelectableStandardCount: selectableCarbs.filter(
        (row) => String(row.displayCategoryKey || "").trim() === STANDARD_CARB_CATEGORY_KEY
          && CANONICAL_STANDARD_CARB_KEYS.includes(String(row.key || "").trim())
      ).length,
      largeSaladIdentityExists: Boolean(largeSaladIdentity),
      largeSaladIdentity,
      activeLargeSaladRows,
      duplicateKeys: duplicateCarbKeys.map((row) => ({
        key: row._id,
        count: row.count,
        ids: row.ids.map((id) => String(id)),
      })),
      activeLegacyRows: activeLegacyCarbRows,
    },
    proteins: {
      activeStandardByDisplayCategoryKey: countBy(activeStandardProteins, (row) => row.displayCategoryKey || "(missing)"),
      activePremiumByPremiumKey: countBy(activePremiumProteins, (row) => row.premiumKey || "(missing)"),
      standardProteinsWithInvalidPremiumKey,
      invalidOrMissingDisplayCategoryKey: proteinsWithInvalidOrMissingDisplayCategoryKey,
      proteinFamilyMismatches,
      duplicateKeys: duplicateProteinKeys.map((row) => ({
        key: row._id,
        count: row.count,
        ids: row.ids.map((id) => String(id)),
      })),
      activeLegacyStandardProteins,
    },
    saladIngredients: {
      groupedByGroupKey: countBy(saladIngredients, (row) => row.groupKey || "(missing)"),
      invalidOrMissingGroupKey: invalidOrMissingSaladGroupKey,
    },
  };
}

function printReport(report) {
  console.log(`Database: ${report.dbName}`);
  console.log(`Generated At: ${report.generatedAt}`);

  console.log("\n=== Carbs ===");
  console.log(`Active by displayCategoryKey: ${JSON.stringify(report.carbs.activeByDisplayCategoryKey)}`);
  console.log(`Selectable by displayCategoryKey: ${JSON.stringify(report.carbs.selectableByDisplayCategoryKey)}`);
  console.log(`Canonical selectable standard carbs: ${report.carbs.canonicalSelectableStandardCount}/${CANONICAL_STANDARD_CARB_KEYS.length}`);
  console.log(`large_salad identity exists: ${report.carbs.largeSaladIdentityExists ? "yes" : "no"}`);
  console.log(`Active large_salad rows: ${report.carbs.activeLargeSaladRows.length}`);
  if (report.carbs.activeLegacyRows.length > 0) {
    console.log(`Legacy active carb rows: ${report.carbs.activeLegacyRows.length}`);
  }
  if (report.carbs.duplicateKeys.length > 0) {
    console.log(`Duplicate carb keys: ${report.carbs.duplicateKeys.length}`);
  }

  console.log("\n=== Proteins ===");
  console.log(`Active standard by displayCategoryKey: ${JSON.stringify(report.proteins.activeStandardByDisplayCategoryKey)}`);
  console.log(`Active premium by premiumKey: ${JSON.stringify(report.proteins.activePremiumByPremiumKey)}`);
  console.log(`Standard proteins with invalid premiumKey: ${report.proteins.standardProteinsWithInvalidPremiumKey.length}`);
  console.log(`Proteins with invalid or missing displayCategoryKey: ${report.proteins.invalidOrMissingDisplayCategoryKey.length}`);
  console.log(`Proteins with family/display mismatches: ${report.proteins.proteinFamilyMismatches.length}`);
  console.log(`Active legacy standard proteins: ${report.proteins.activeLegacyStandardProteins.length}`);
  if (report.proteins.duplicateKeys.length > 0) {
    console.log(`Duplicate protein keys: ${report.proteins.duplicateKeys.length}`);
  }

  console.log("\n=== Salad Ingredients ===");
  console.log(`Grouped by groupKey: ${JSON.stringify(report.saladIngredients.groupedByGroupKey)}`);
  console.log(`Invalid or missing salad groupKey rows: ${report.saladIngredients.invalidOrMissingGroupKey.length}`);

  if (report.proteins.standardProteinsWithInvalidPremiumKey.length > 0) {
    console.log("\nStandard proteins with invalid premiumKey:");
    for (const row of report.proteins.standardProteinsWithInvalidPremiumKey) {
      console.log(`- ${row.id} | ${row.nameEn} | premiumKey=${row.premiumKey}`);
    }
  }

  if (report.proteins.activeLegacyStandardProteins.length > 0) {
    console.log("\nActive legacy standard proteins:");
    for (const row of report.proteins.activeLegacyStandardProteins) {
      console.log(`- ${row.id} | key=${row.key || "(missing)"} | ${row.nameEn} | group=${row.displayCategoryKey}`);
    }
  }

  if (report.carbs.activeLegacyRows.length > 0) {
    console.log("\nActive legacy carb rows:");
    for (const row of report.carbs.activeLegacyRows) {
      console.log(`- ${row.id} | key=${row.key || "(missing)"} | ${row.nameEn} | group=${row.displayCategoryKey} | selectable=${row.availableForSubscription ? "yes" : "no"}`);
    }
  }

  if (report.saladIngredients.invalidOrMissingGroupKey.length > 0) {
    console.log("\nInvalid or missing salad groupKey rows:");
    for (const row of report.saladIngredients.invalidOrMissingGroupKey) {
      console.log(`- ${row.id} | ${row.nameEn} | groupKey=${row.groupKey || "(missing)"}`);
    }
  }
}

async function main() {
  const uri = getMongoUri();
  if (!uri) {
    console.error("Missing MongoDB connection string (MONGO_URI, MONGODB_URI, or MONGO_URL)");
    process.exit(1);
  }

  const asJson = hasFlag("--json");

  if (!asJson) {
    console.log("Connecting to MongoDB...");
  }
  await mongoose.connect(uri);

  try {
    const report = await buildReport();
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
