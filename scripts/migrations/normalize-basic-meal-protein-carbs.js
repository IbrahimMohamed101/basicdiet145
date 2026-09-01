#!/usr/bin/env node
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");

// Approved Business Menu Allowlists for Basic Meal
const APPROVED_BASIC_MEAL_PROTEIN_KEYS = Object.freeze([
  "chicken",
  "chicken_breast",
  "chicken_fajita",
  "grilled_chicken",
  "spicy_chicken",
  "chicken_musakhan",
  "chicken_meatballs",
  "chicken_tikka",
  "pesto_chicken",
  "mustard_chicken",
  "shish_tawook",
  "salmon",
  "meatballs",
  "sayadieh_fish",
]);

const APPROVED_BASIC_MEAL_CARB_KEYS = Object.freeze([
  "white_rice",
  "sayadieh_rice",
  "biryani_rice",
  "kabul_rice",
  "masbhoosh_rice",
  "mashed_potatoes",
  "mash",
  "potato_wedges",
  "sweet_potato",
  "pasta",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const isApply = argv.includes("--apply");
  const isDryRun = argv.includes("--dry-run") || !isApply;
  return {
    dryRun: isDryRun,
    apply: isApply,
  };
}

function normalizeKey(key) {
  return String(key || "").trim().toLowerCase();
}

async function runNormalization(options = {}) {
  const {
    argv = process.argv.slice(2),
    mongoUri = process.env.MONGO_URI_TEST || process.env.MONGO_URI || process.env.MONGODB_URI,
    closeConnection = true,
  } = options;

  const args = parseArgs(argv);

  if (mongoUri && mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  try {
    // 1. Locate Basic Meal product(s)
    const basicProducts = await MenuProduct.find({
      $or: [
        { key: "basic_meal" },
        { itemType: "basic_meal" },
        { "name.en": { $regex: /^basic meal$/i } },
        { "name.ar": { $regex: /^وجبة أساسية$/i } },
      ],
    }).lean();

    if (!basicProducts.length) {
      return {
        mode: args.dryRun ? "dry_run" : "apply",
        success: true,
        message: "No Basic Meal products found in database.",
        deleted_records: 0,
        historical_rewrites: 0,
        productCount: 0,
        updates: [],
      };
    }

    const productIds = basicProducts.map((p) => p._id);

    // 2. Locate groups for these products
    const groupRelations = await ProductOptionGroup.find({
      productId: { $in: productIds },
    }).lean();

    const groupIds = groupRelations.map((g) => g.groupId);
    const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
    const groupsById = new Map(groups.map((g) => [String(g._id), g]));

    // 3. Locate option relations for these product groups
    const optionRelations = await ProductGroupOption.find({
      productId: { $in: productIds },
    }).lean();

    const optionIds = optionRelations.map((o) => o.optionId);
    const options = await MenuOption.find({ _id: { $in: optionIds } }).lean();
    const optionsById = new Map(options.map((o) => [String(o._id), o]));

    const approvedProteinSet = new Set(APPROVED_BASIC_MEAL_PROTEIN_KEYS.map(normalizeKey));
    const approvedCarbSet = new Set(APPROVED_BASIC_MEAL_CARB_KEYS.map(normalizeKey));

    const proposedActions = [];
    let enabledCount = 0;
    let disabledCount = 0;

    for (const relation of optionRelations) {
      const group = groupsById.get(String(relation.groupId));
      const option = optionsById.get(String(relation.optionId));

      if (!group || !option) continue;

      const groupKey = normalizeKey(group.key);
      const optionKey = normalizeKey(option.key);

      let shouldBeActive = null;

      if (groupKey === "proteins" || groupKey === "protein") {
        shouldBeActive = approvedProteinSet.has(optionKey);
      } else if (groupKey === "carbs" || groupKey === "carb") {
        shouldBeActive = approvedCarbSet.has(optionKey);
      }

      if (shouldBeActive !== null) {
        const currentlyActive = Boolean(relation.isActive);
        if (currentlyActive !== shouldBeActive) {
          if (shouldBeActive) enabledCount++;
          else disabledCount++;

          proposedActions.push({
            relationId: String(relation._id),
            productId: String(relation.productId),
            groupKey,
            optionKey,
            optionName: option.name,
            currentActive: currentlyActive,
            targetActive: shouldBeActive,
          });
        }
      }
    }

    if (!args.dryRun && proposedActions.length > 0) {
      const bulkOps = proposedActions.map((action) => ({
        updateOne: {
          filter: { _id: action.relationId },
          update: {
            $set: {
              isActive: action.targetActive,
              isAvailable: action.targetActive,
              isVisible: action.targetActive,
            },
          },
        },
      }));
      await ProductGroupOption.bulkWrite(bulkOps);
    }

    return {
      mode: args.dryRun ? "dry_run" : "apply",
      success: true,
      deleted_records: 0,
      historical_rewrites: 0,
      productCount: basicProducts.length,
      proposedUpdatesCount: proposedActions.length,
      enabledCount,
      disabledCount,
      proposedActions,
      allowlists: {
        proteins: APPROVED_BASIC_MEAL_PROTEIN_KEYS,
        carbs: APPROVED_BASIC_MEAL_CARB_KEYS,
      },
    };
  } finally {
    if (closeConnection && mongoUri && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

async function main() {
  const result = await runNormalization({ argv: process.argv.slice(2) });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[normalize-basic-meal] Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  APPROVED_BASIC_MEAL_PROTEIN_KEYS,
  APPROVED_BASIC_MEAL_CARB_KEYS,
  parseArgs,
  runNormalization,
};
