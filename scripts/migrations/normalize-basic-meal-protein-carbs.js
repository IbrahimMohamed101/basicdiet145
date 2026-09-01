#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");

const BASIC_MEAL_PROTEIN_GROUP_ID = "6a62197279ee075a57f70107";

// 13 Required Regular Proteins (in exact restaurant order)
const APPROVED_REGULAR_PROTEINS = Object.freeze([
  { requestedAr: "لحم كفته", candidateKeys: ["beef_kofta", "kofta", "beef_kofta_meat"], defaultKey: "beef_kofta", en: "Kofta Meat" },
  { requestedAr: "لحم ماشروم", candidateKeys: ["beef_mushroom_beef", "mushroom_beef", "beef_mushroom"], defaultKey: "beef_mushroom_beef", en: "Mushroom Beef" },
  { requestedAr: "لحم اسيوي", candidateKeys: ["beef_asian_beef", "asian_beef", "beef_asian"], defaultKey: "beef_asian_beef", en: "Asian Beef" },
  { requestedAr: "دجاج مشوي", candidateKeys: ["chicken_grilled_chicken", "grilled_chicken"], defaultKey: "chicken_grilled_chicken", en: "Grilled Chicken" },
  { requestedAr: "دجاج مكسيكي", candidateKeys: ["chicken_mexican_chicken", "mexican_chicken"], defaultKey: "chicken_mexican_chicken", en: "Mexican Chicken" },
  { requestedAr: "دجاج كريمه", candidateKeys: ["chicken_creamy_chicken", "creamy_chicken"], defaultKey: "chicken_creamy_chicken", en: "Creamy Chicken" },
  { requestedAr: "دجاج ليمون باربكيو", candidateKeys: ["chicken_lemon_bbq", "lemon_bbq_chicken"], defaultKey: "chicken_lemon_bbq", en: "Lemon BBQ Chicken" },
  { requestedAr: "دجاج ٦٥", candidateKeys: ["chicken_chicken_65", "chicken_65"], defaultKey: "chicken_chicken_65", en: "Chicken 65" },
  { requestedAr: "دجاج باميه", candidateKeys: ["chicken_chicken_with_okra", "chicken_okra"], defaultKey: "chicken_chicken_with_okra", en: "Chicken with Okra" },
  { requestedAr: "دجاج شيش طاؤوق", candidateKeys: ["chicken_shish_tawook", "shish_tawook"], defaultKey: "chicken_shish_tawook", en: "Shish Tawook" },
  { requestedAr: "سمك كريمه", candidateKeys: ["fish_creamy_fish", "creamy_fish"], defaultKey: "fish_creamy_fish", en: "Creamy Fish" },
  { requestedAr: "سمك مشوي", candidateKeys: ["fish_grilled_fish", "grilled_fish"], defaultKey: "fish_grilled_fish", en: "Grilled Fish" },
  { requestedAr: "دجاج اسيوي", candidateKeys: ["chicken_asian_chicken", "asian_chicken"], defaultKey: "chicken_asian_chicken", en: "Asian Chicken" },
]);

// 5 Preserved Paid Options
const PRESERVED_PAID_PROTEIN_KEYS = Object.freeze([
  "meatballs",
  "beef_stroganoff",
  "beef_steak",
  "shrimp",
  "salmon",
]);

// 9 Required Carbohydrates (in exact restaurant order)
const APPROVED_CARBS = Object.freeze([
  { requestedAr: "رز عدس", candidateKeys: ["carbs_lentil_rice", "lentil_rice"], defaultKey: "carbs_lentil_rice", en: "Lentil Rice" },
  { requestedAr: "رز ابيض جاوي", candidateKeys: ["carbs_javanese_white_rice", "javanese_white_rice", "java_white_rice"], defaultKey: "carbs_javanese_white_rice", en: "Javanese White Rice" },
  { requestedAr: "رز ابيض بسمتي", candidateKeys: ["carbs_white_rice", "white_rice", "carbs_basmati_white_rice", "basmati_white_rice"], defaultKey: "carbs_white_rice", en: "Basmati White Rice" },
  { requestedAr: "بطاطس مهروسه", candidateKeys: ["carbs_mashed_potatoes", "mashed_potatoes", "mash"], defaultKey: "carbs_mashed_potatoes", en: "Mashed Potatoes" },
  { requestedAr: "بطاطس مشويه", candidateKeys: ["carbs_roasted_potatoes", "roasted_potatoes", "roasted_potato"], defaultKey: "carbs_roasted_potatoes", en: "Roasted Potatoes" },
  { requestedAr: "بطاطا حلوه", candidateKeys: ["carbs_sweet_potatoes", "sweet_potatoes", "sweet_potato"], defaultKey: "carbs_sweet_potatoes", en: "Sweet Potatoes" },
  { requestedAr: "خضار مشكل", candidateKeys: ["carbs_mixed_vegetables", "mixed_vegetables", "grilled_mixed_vegetables"], defaultKey: "carbs_mixed_vegetables", en: "Mixed Vegetables" },
  { requestedAr: "مكرونه حمره", candidateKeys: ["carbs_red_sauce_pasta", "red_sauce_pasta", "red_pasta"], defaultKey: "carbs_red_sauce_pasta", en: "Red Sauce Pasta" },
  { requestedAr: "مكرونه بيضه", candidateKeys: ["carbs_creamy_pasta", "creamy_pasta", "white_pasta", "alfredo_pasta"], defaultKey: "carbs_creamy_pasta", en: "White Pasta" },
]);

function parseArgs(argv = process.argv.slice(2)) {
  const isExecute = argv.includes("--execute") || argv.includes("--apply");
  const isDryRun = argv.includes("--dry-run") || !isExecute;
  return {
    dryRun: isDryRun,
    execute: isExecute,
  };
}

function normalizeAr(str) {
  if (!str) return "";
  return String(str)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/٦/g, "6")
    .replace(/٥/g, "5")
    .trim()
    .toLowerCase();
}

function findBestOptionMatch(reqItem, availableOptions, claimedOptionIds) {
  const normTarget = normalizeAr(reqItem.requestedAr);
  const pool = availableOptions.filter((o) => !claimedOptionIds.has(String(o._id)));

  // 1. Candidate key exact match
  for (const candidateKey of reqItem.candidateKeys) {
    const match = pool.find((o) => o.key === candidateKey);
    if (match) return match;
  }

  // 2. Arabic name match
  for (const o of pool) {
    const normName = normalizeAr(o.name?.ar);
    if (normName === normTarget) return o;
  }

  // 3. Exact word containment match
  for (const o of pool) {
    const normName = normalizeAr(o.name?.ar);
    if (normName && (normName.includes(normTarget) || normTarget.includes(normName))) {
      // Prevent false positives like "رز أبيض" matching "رز ابيض جاوي" when target is "جاوي"
      const targetWords = normTarget.split(/\s+/);
      const hasSpecificDistinctWord = targetWords.some((w) => ["جاوي", "عدس", "بسمتي", "باربكيو"].includes(w));
      if (hasSpecificDistinctWord) {
        const containsSpecificWord = targetWords.every((w) => normName.includes(w));
        if (containsSpecificWord) return o;
      } else {
        return o;
      }
    }
  }

  return null;
}

async function runNormalization(options = {}) {
  const {
    argv = process.argv.slice(2),
    mongoUri = process.env.MONGO_URI || process.env.MONGO_URI_TEST || process.env.MONGODB_URI,
    closeConnection = true,
    log = console,
  } = options;

  const args = parseArgs(argv);

  if (mongoUri && mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  try {
    // 1. Basic Meal product
    const basicProduct = await MenuProduct.findOne({
      $or: [
        { key: "basic_meal" },
        { itemType: "basic_meal" },
        { "name.en": { $regex: /^basic meal$/i } },
        { "name.ar": { $regex: /^وجبة أساسية$/i } },
      ],
    }).lean();

    if (!basicProduct) {
      throw new Error("Basic Meal product not found in database.");
    }

    // 2. Product Option Groups
    const productGroups = await ProductOptionGroup.find({ productId: basicProduct._id }).lean();
    const groupIds = productGroups.map((pg) => pg.groupId);
    const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
    const groupsById = new Map(groups.map((g) => [String(g._id), g]));

    // Find protein group (ID 6a62197279ee075a57f70107 or key 'proteins')
    let proteinGroup = groups.find((g) => String(g._id) === BASIC_MEAL_PROTEIN_GROUP_ID)
      || groups.find((g) => g.key === "proteins");

    if (!proteinGroup) {
      proteinGroup = await MenuOptionGroup.findById(BASIC_MEAL_PROTEIN_GROUP_ID).lean();
    }

    if (!proteinGroup) {
      throw new Error(`Basic Meal protein group (${BASIC_MEAL_PROTEIN_GROUP_ID}) not found.`);
    }

    // Find carb group
    const carbGroup = groups.find((g) => g.key === "carbs" || g.key === "carb");
    if (!carbGroup) {
      throw new Error("Basic Meal carb group not found.");
    }

    const proteinGroupIdStr = String(proteinGroup._id);
    const carbGroupIdStr = String(carbGroup._id);

    // Load all options in database
    const allOptions = await MenuOption.find({}).lean();
    const allOptionsById = new Map(allOptions.map((o) => [String(o._id), o]));

    // Load all relations for basic_meal
    const allRelations = await ProductGroupOption.find({ productId: basicProduct._id }).lean();
    const relationByOptionId = new Map(allRelations.map((r) => [String(r.optionId), r]));

    const proteinResolutions = [];
    const carbResolutions = [];
    let unknownAmbiguousCount = 0;
    const resolvedOptionIds = new Set();
    const newOptionsToCreate = [];
    const relationUpdates = [];

    // --- Resolve 13 Regular Proteins ---
    for (let index = 0; index < APPROVED_REGULAR_PROTEINS.length; index++) {
      const req = APPROVED_REGULAR_PROTEINS[index];
      const match = findBestOptionMatch(req, allOptions, resolvedOptionIds);
      const sortOrder = index + 1;

      if (match) {
        resolvedOptionIds.add(String(match._id));
        const existingRel = relationByOptionId.get(String(match._id));
        const currentActive = existingRel ? Boolean(existingRel.isActive) : Boolean(match.isActive);

        proteinResolutions.push({
          requestedAr: req.requestedAr,
          resolvedId: String(match._id),
          resolvedKey: match.key,
          oldStatus: currentActive ? "ACTIVE" : "INACTIVE",
          newStatus: "ACTIVE",
          created: false,
          sortOrder,
          optionDoc: match,
        });

        relationUpdates.push({
          optionId: match._id,
          groupId: proteinGroup._id,
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder,
        });
      } else {
        // Missing option to create
        const newId = new mongoose.Types.ObjectId();
        proteinResolutions.push({
          requestedAr: req.requestedAr,
          resolvedId: String(newId),
          resolvedKey: req.defaultKey,
          oldStatus: "ABSENT",
          newStatus: "ACTIVE",
          created: true,
          sortOrder,
        });

        newOptionsToCreate.push({
          _id: newId,
          key: req.defaultKey,
          groupId: proteinGroup._id,
          name: { ar: req.requestedAr, en: req.en },
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder,
        });

        relationUpdates.push({
          optionId: newId,
          groupId: proteinGroup._id,
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder,
        });

        resolvedOptionIds.add(String(newId));
      }
    }

    // --- Resolve Preserved Paid Options ---
    const preservedPaidResolutions = [];
    for (const key of PRESERVED_PAID_PROTEIN_KEYS) {
      const match = allOptions.find((o) => o.key === key);
      if (match) {
        resolvedOptionIds.add(String(match._id));
        const existingRel = relationByOptionId.get(String(match._id));
        const currentActive = existingRel ? Boolean(existingRel.isActive) : Boolean(match.isActive);

        preservedPaidResolutions.push({
          key,
          resolvedId: String(match._id),
          nameAr: match.name?.ar || key,
          oldStatus: currentActive ? "ACTIVE" : "INACTIVE",
          newStatus: "ACTIVE (PRESERVED)",
          extraPriceHalala: match.extraPriceHalala || 0,
        });

        relationUpdates.push({
          optionId: match._id,
          groupId: proteinGroup._id,
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder: match.sortOrder || 100,
        });
      } else {
        unknownAmbiguousCount++;
      }
    }

    // --- Resolve 9 Carbs ---
    for (let index = 0; index < APPROVED_CARBS.length; index++) {
      const req = APPROVED_CARBS[index];
      const match = findBestOptionMatch(req, allOptions, resolvedOptionIds);
      const sortOrder = index + 1;

      if (match) {
        resolvedOptionIds.add(String(match._id));
        const existingRel = relationByOptionId.get(String(match._id));
        const currentActive = existingRel ? Boolean(existingRel.isActive) : Boolean(match.isActive);

        carbResolutions.push({
          requestedAr: req.requestedAr,
          resolvedId: String(match._id),
          resolvedKey: match.key,
          oldStatus: currentActive ? "ACTIVE" : "INACTIVE",
          newStatus: "ACTIVE",
          created: false,
          sortOrder,
          optionDoc: match,
        });

        relationUpdates.push({
          optionId: match._id,
          groupId: carbGroup._id,
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder,
        });
      } else {
        // Missing carb option to create
        const newId = new mongoose.Types.ObjectId();
        carbResolutions.push({
          requestedAr: req.requestedAr,
          resolvedId: String(newId),
          resolvedKey: req.defaultKey,
          oldStatus: "ABSENT",
          newStatus: "ACTIVE",
          created: true,
          sortOrder,
        });

        newOptionsToCreate.push({
          _id: newId,
          key: req.defaultKey,
          groupId: carbGroup._id,
          name: { ar: req.requestedAr, en: req.en },
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder,
        });

        relationUpdates.push({
          optionId: newId,
          groupId: carbGroup._id,
          isActive: true,
          isAvailable: true,
          isVisible: true,
          sortOrder,
        });

        resolvedOptionIds.add(String(newId));
      }
    }

    // --- Identify Non-Approved Options to Deactivate ---
    const deactivatedProteins = [];
    const deactivatedCarbs = [];

    for (const rel of allRelations) {
      const optionIdStr = String(rel.optionId);
      if (resolvedOptionIds.has(optionIdStr)) continue;

      const option = allOptionsById.get(optionIdStr);
      if (!option) continue;

      const relGroupIdStr = String(rel.groupId);
      if (relGroupIdStr === proteinGroupIdStr) {
        deactivatedProteins.push({
          id: optionIdStr,
          key: option.key,
          nameAr: option.name?.ar,
        });
        relationUpdates.push({
          optionId: rel.optionId,
          groupId: rel.groupId,
          isActive: false,
          isAvailable: false,
          isVisible: false,
        });
      } else if (relGroupIdStr === carbGroupIdStr) {
        deactivatedCarbs.push({
          id: optionIdStr,
          key: option.key,
          nameAr: option.name?.ar,
        });
        relationUpdates.push({
          optionId: rel.optionId,
          groupId: rel.groupId,
          isActive: false,
          isAvailable: false,
          isVisible: false,
        });
      }
    }

    // --- Build Report Object ---
    const report = {
      mode: args.dryRun ? "dry_run" : "execute",
      success: true,
      proteinGroup: { id: proteinGroupIdStr, key: proteinGroup.key },
      carbGroup: { id: carbGroupIdStr, key: carbGroup.key },
      proteinResolutions,
      preservedPaidResolutions,
      carbResolutions,
      deactivatedProteins,
      deactivatedCarbs,
      createdOptionsCount: newOptionsToCreate.length,
      summaryCounters: {
        regularProteinActiveAfter: proteinResolutions.length,
        paidPreservedOptionsActive: preservedPaidResolutions.length,
        carbsActiveAfter: carbResolutions.length,
        deletedRecords: 0,
        historicalRewrites: 0,
        premiumPricingChanges: 0,
        premiumBalanceLogicChanges: 0,
        saladChanges: 0,
        unknownAmbiguousOptions: unknownAmbiguousCount,
      },
    };

    // --- Log Dry Run Table Output ---
    log.log("\n==================================================");
    log.log(`BASIC MEAL MENU NORMALIZATION REPORT (${report.mode.toUpperCase()})`);
    log.log("==================================================");
    log.log(`Protein Group ID: ${proteinGroupIdStr} (key: ${proteinGroup.key})`);
    log.log(`Carb Group ID:    ${carbGroupIdStr} (key: ${carbGroup.key})`);

    log.log("\n--- A) 13 REGULAR PROTEINS ---");
    console.table(proteinResolutions.map((p) => ({
      Order: p.sortOrder,
      "Requested Arabic": p.requestedAr,
      "_id": p.resolvedId,
      Key: p.resolvedKey,
      "Old Status": p.oldStatus,
      "New Status": p.newStatus,
      Created: p.created ? "YES" : "NO",
    })));

    log.log("\n--- B) PRESERVED PAID PROTEIN OPTIONS ---");
    console.table(preservedPaidResolutions.map((p) => ({
      Key: p.key,
      "_id": p.resolvedId,
      "Arabic Name": p.nameAr,
      "Extra Price (Halala)": p.extraPriceHalala,
      Status: p.newStatus,
    })));

    log.log("\n--- C) 9 CARBS ---");
    console.table(carbResolutions.map((c) => ({
      Order: c.sortOrder,
      "Requested Arabic": c.requestedAr,
      "_id": c.resolvedId,
      Key: c.resolvedKey,
      "Old Status": c.oldStatus,
      "New Status": c.newStatus,
      Created: c.created ? "YES" : "NO",
    })));

    log.log("\n--- SUMMARY COUNTERS ---");
    log.log(`regular protein active after = ${report.summaryCounters.regularProteinActiveAfter}`);
    log.log(`paid preserved options active = ${report.summaryCounters.paidPreservedOptionsActive}`);
    log.log(`carbs active after = ${report.summaryCounters.carbsActiveAfter}`);
    log.log(`deleted records = ${report.summaryCounters.deletedRecords}`);
    log.log(`historical rewrites = ${report.summaryCounters.historicalRewrites}`);
    log.log(`premium pricing changes = ${report.summaryCounters.premiumPricingChanges}`);
    log.log(`premium balance logic changes = ${report.summaryCounters.premiumBalanceLogicChanges}`);
    log.log(`salad changes = ${report.summaryCounters.saladChanges}`);
    log.log(`unknown/ambiguous options = ${report.summaryCounters.unknownAmbiguousOptions}`);

    if (unknownAmbiguousCount > 0) {
      log.error("\n[STOP] Ambiguous/unknown paid options detected. Refusing execution.");
      report.success = false;
      return report;
    }

    // --- Perform Writes if Execute Mode ---
    if (args.execute) {
      log.log("\n[EXECUTE MODE] Applying menu changes to MongoDB...");

      // 1. Create missing options
      if (newOptionsToCreate.length > 0) {
        await MenuOption.insertMany(newOptionsToCreate);
        log.log(`Created ${newOptionsToCreate.length} new MenuOption documents.`);
      }

      // 2. Update ProductGroupOption relations
      const relOps = relationUpdates.map((u) => ({
        updateOne: {
          filter: { productId: basicProduct._id, groupId: u.groupId, optionId: u.optionId },
          update: {
            $set: {
              isActive: u.isActive,
              isAvailable: u.isAvailable,
              isVisible: u.isVisible,
              ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
            },
          },
          upsert: true,
        },
      }));

      if (relOps.length > 0) {
        await ProductGroupOption.bulkWrite(relOps);
        log.log(`Updated ${relOps.length} ProductGroupOption relations.`);
      }

      log.log("\n[SUCCESS] Menu normalization applied successfully to MongoDB.");
    }

    return report;
  } finally {
    if (closeConnection && mongoUri && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

async function main() {
  const report = await runNormalization({ argv: process.argv.slice(2) });
  if (!report.success) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[normalize-basic-meal] Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  APPROVED_REGULAR_PROTEINS,
  APPROVED_CARBS,
  PRESERVED_PAID_PROTEIN_KEYS,
  BASIC_MEAL_PROTEIN_GROUP_ID,
  parseArgs,
  runNormalization,
};
