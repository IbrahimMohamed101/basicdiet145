#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const {
  MEAL_SELECTION_TYPES,
  SYSTEM_CURRENCY,
} = require("../src/config/mealPlannerContract");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function localizedValues(row) {
  return [
    row && row.name && row.name.en,
    row && row.name && row.name.ar,
  ].map(normalizeText).filter(Boolean);
}

function optionLookupKey(option) {
  return {
    key: normalizeText(option.key),
    names: localizedValues(option),
  };
}

async function loadOptionsForGroup(groupKey) {
  const group = await MenuOptionGroup.findOne({ key: groupKey }).lean();
  if (!group) {
    return { group: null, options: [], byKey: new Map(), byName: new Map() };
  }

  const options = await MenuOption.find({ groupId: group._id }).lean();
  const byKey = new Map();
  const byName = new Map();

  for (const option of options) {
    const lookup = optionLookupKey(option);
    if (lookup.key && !byKey.has(lookup.key)) byKey.set(lookup.key, option);
    for (const name of lookup.names) {
      if (!byName.has(name)) byName.set(name, option);
    }
  }

  return { group, options, byKey, byName };
}

function findMatchingOption(row, lookup) {
  const key = normalizeText(row.key || row.premiumKey);
  if (key && lookup.byKey.has(key)) return lookup.byKey.get(key);

  for (const name of localizedValues(row)) {
    if (lookup.byName.has(name)) return lookup.byName.get(name);
  }

  return null;
}

function reportBucket() {
  return {
    total: 0,
    matched: 0,
    updated: 0,
    skipped: 0,
    unresolved: [],
  };
}

function hasChanges(option, patch) {
  return Object.entries(patch).some(([field, value]) => {
    if (Array.isArray(value)) {
      return JSON.stringify(option[field] || []) !== JSON.stringify(value);
    }
    return String(option[field] ?? "") !== String(value ?? "");
  });
}

async function migrateProteins() {
  const report = reportBucket();
  const lookup = await loadOptionsForGroup("proteins");
  if (!lookup.group) {
    report.unresolved.push({ reason: "Missing MenuOptionGroup with key proteins" });
    return report;
  }

  const rows = await BuilderProtein.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();
  report.total = rows.length;

  for (const row of rows) {
    const option = findMatchingOption(row, lookup);
    if (!option) {
      report.unresolved.push({
        id: String(row._id),
        key: row.key || "",
        premiumKey: row.premiumKey || "",
        name: row.name || {},
      });
      continue;
    }

    report.matched += 1;
    const isPremium = Boolean(row.isPremium);
    const patch = {
      availableForSubscription: row.availableForSubscription !== false,
      proteinFamilyKey: row.proteinFamilyKey || "",
      displayCategoryKey: row.displayCategoryKey || (isPremium ? "premium" : ""),
      premiumKey: row.premiumKey || row.key || option.key || "",
      ruleTags: Array.isArray(row.ruleTags) ? row.ruleTags : [],
      selectionType: row.selectionType || (isPremium ? MEAL_SELECTION_TYPES.PREMIUM_MEAL : MEAL_SELECTION_TYPES.STANDARD_MEAL),
      currency: row.currency || SYSTEM_CURRENCY,
    };

    if (isPremium) {
      patch.extraPriceHalala = Number(row.extraFeeHalala || 0);
    }

    if (!hasChanges(option, patch)) {
      report.skipped += 1;
      continue;
    }

    await MenuOption.updateOne({ _id: option._id }, { $set: patch });
    report.updated += 1;
  }

  return report;
}

async function migrateCarbs() {
  const report = reportBucket();
  const lookup = await loadOptionsForGroup("carbs");
  if (!lookup.group) {
    report.unresolved.push({ reason: "Missing MenuOptionGroup with key carbs" });
    return report;
  }

  const rows = await BuilderCarb.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();
  report.total = rows.length;

  for (const row of rows) {
    const option = findMatchingOption(row, lookup);
    if (!option) {
      report.unresolved.push({
        id: String(row._id),
        key: row.key || "",
        name: row.name || {},
      });
      continue;
    }

    report.matched += 1;
    const patch = {
      availableForSubscription: row.availableForSubscription !== false,
      displayCategoryKey: row.displayCategoryKey || "standard_carbs",
      selectionType: row.selectionType || "",
    };

    if (!hasChanges(option, patch)) {
      report.skipped += 1;
      continue;
    }

    await MenuOption.updateOne({ _id: option._id }, { $set: patch });
    report.updated += 1;
  }

  return report;
}

async function run() {
  await mongoose.connect(uri);
  const [proteins, carbs] = await Promise.all([
    migrateProteins(),
    migrateCarbs(),
  ]);

  const report = { proteins, carbs };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  run()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}

module.exports = {
  migrateProteins,
  migrateCarbs,
  run,
};
