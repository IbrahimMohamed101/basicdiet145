#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");
const BuilderCategory = require("../src/models/BuilderCategory");
const BuilderCarb = require("../src/models/BuilderCarb");
const BuilderProtein = require("../src/models/BuilderProtein");
const SaladIngredient = require("../src/models/SaladIngredient");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  LARGE_SALAD_CATEGORY_KEY,
  PROTEIN_DISPLAY_GROUPS,
  SALAD_INGREDIENT_GROUP_KEYS,
  STANDARD_CARB_CATEGORY_KEY,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
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
const TERMINAL_DAY_STATUSES = new Set([
  "fulfilled",
  "consumed_without_preparation",
  "delivery_canceled",
  "canceled_at_branch",
  "no_show",
  "skipped",
]);

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getMongoUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || "";
}

function createSummary(mode) {
  return {
    mode,
    dbName: "",
    processed: { proteins: 0, carbs: 0, saladIngredients: 0, total: 0 },
    wouldUpdate: { proteins: 0, carbs: 0, saladIngredients: 0, total: 0 },
    updated: { proteins: 0, carbs: 0, saladIngredients: 0, total: 0 },
    skipped: { proteins: 0, carbs: 0, saladIngredients: 0, total: 0 },
    warnings: [],
    errors: [],
    actions: [],
  };
}

function bump(bucket, entity) {
  bucket[entity] += 1;
  bucket.total += 1;
}

function pushWarning(summary, message) {
  summary.warnings.push(message);
}

function pushError(summary, message) {
  summary.errors.push(message);
}

function serializeProtein(row) {
  return {
    id: String(row._id),
    key: row.key || null,
    nameEn: row.name && row.name.en ? row.name.en : "",
    nameAr: row.name && row.name.ar ? row.name.ar : "",
    displayCategoryKey: row.displayCategoryKey || null,
    proteinFamilyKey: row.proteinFamilyKey || null,
    premiumKey: row.premiumKey || null,
    isActive: Boolean(row.isActive),
    isPremium: Boolean(row.isPremium),
    availableForSubscription: row.availableForSubscription !== false,
  };
}

function serializeCarb(row) {
  return {
    id: String(row._id),
    key: row.key || null,
    nameEn: row.name && row.name.en ? row.name.en : "",
    nameAr: row.name && row.name.ar ? row.name.ar : "",
    displayCategoryKey: row.displayCategoryKey || null,
    isActive: Boolean(row.isActive),
    availableForSubscription: row.availableForSubscription !== false,
  };
}

function serializeIngredient(row) {
  return {
    id: String(row._id),
    nameEn: row.name && row.name.en ? row.name.en : "",
    nameAr: row.name && row.name.ar ? row.name.ar : "",
    groupKey: row.groupKey || null,
    isActive: Boolean(row.isActive),
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

function getCarbExpectation(row) {
  const key = String(row.key || "").trim();
  if (key === LARGE_SALAD_CATEGORY_KEY) {
    return { displayCategoryKey: LARGE_SALAD_CATEGORY_KEY };
  }
  if (CANONICAL_STANDARD_CARB_KEYS.includes(key)) {
    return { displayCategoryKey: STANDARD_CARB_CATEGORY_KEY };
  }
  return null;
}

function ensureRefEntry(map, id) {
  if (!map.has(id)) {
    map.set(id, {
      anyDayRefs: 0,
      activeDayRefs: 0,
      subscriptionRefs: 0,
    });
  }
  return map.get(id);
}

async function buildProteinReferenceMap(candidateIds) {
  const refMap = new Map(candidateIds.map((id) => [String(id), { anyDayRefs: 0, activeDayRefs: 0, subscriptionRefs: 0 }]));
  if (candidateIds.length === 0) return refMap;

  const [days, subscriptions] = await Promise.all([
    SubscriptionDay.find({
      $or: [
        { "mealSlots.proteinId": { $in: candidateIds } },
        { "premiumUpgradeSelections.proteinId": { $in: candidateIds } },
        { "materializedMeals.proteinId": { $in: candidateIds } },
      ],
    }).select("date status mealSlots premiumUpgradeSelections materializedMeals").lean(),
    Subscription.find({
      $or: [
        { "premiumBalance.proteinId": { $in: candidateIds } },
        { "premiumSelections.proteinId": { $in: candidateIds } },
      ],
    }).select("status premiumBalance premiumSelections").lean(),
  ]);

  for (const day of days) {
    const idsInDay = new Set();
    for (const slot of day.mealSlots || []) {
      if (slot && slot.proteinId) idsInDay.add(String(slot.proteinId));
    }
    for (const row of day.premiumUpgradeSelections || []) {
      if (row && row.proteinId) idsInDay.add(String(row.proteinId));
    }
    for (const row of day.materializedMeals || []) {
      if (row && row.proteinId) idsInDay.add(String(row.proteinId));
    }

    const isActiveDay = !TERMINAL_DAY_STATUSES.has(String(day.status || "").trim());
    for (const id of idsInDay) {
      const entry = ensureRefEntry(refMap, id);
      entry.anyDayRefs += 1;
      if (isActiveDay) entry.activeDayRefs += 1;
    }
  }

  for (const subscription of subscriptions) {
    const idsInSubscription = new Set();
    for (const row of subscription.premiumBalance || []) {
      if (row && row.proteinId) idsInSubscription.add(String(row.proteinId));
    }
    for (const row of subscription.premiumSelections || []) {
      if (row && row.proteinId) idsInSubscription.add(String(row.proteinId));
    }
    for (const id of idsInSubscription) {
      const entry = ensureRefEntry(refMap, id);
      entry.subscriptionRefs += 1;
    }
  }

  return refMap;
}

async function buildCarbReferenceMap(candidateIds) {
  const refMap = new Map(candidateIds.map((id) => [String(id), { anyDayRefs: 0, activeDayRefs: 0 }]));
  if (candidateIds.length === 0) return refMap;

  const days = await SubscriptionDay.find({
    $or: [
      { "mealSlots.carbId": { $in: candidateIds } },
      { "mealSlots.carbs.carbId": { $in: candidateIds } },
      { "materializedMeals.carbId": { $in: candidateIds } },
    ],
  }).select("date status mealSlots materializedMeals").lean();

  for (const day of days) {
    const idsInDay = new Set();
    for (const slot of day.mealSlots || []) {
      if (slot && slot.carbId) idsInDay.add(String(slot.carbId));
      for (const row of slot && Array.isArray(slot.carbs) ? slot.carbs : []) {
        if (row && row.carbId) idsInDay.add(String(row.carbId));
      }
    }
    for (const row of day.materializedMeals || []) {
      if (row && row.carbId) idsInDay.add(String(row.carbId));
    }

    const isActiveDay = !TERMINAL_DAY_STATUSES.has(String(day.status || "").trim());
    for (const id of idsInDay) {
      const entry = refMap.get(id) || { anyDayRefs: 0, activeDayRefs: 0 };
      entry.anyDayRefs += 1;
      if (isActiveDay) entry.activeDayRefs += 1;
      refMap.set(id, entry);
    }
  }

  return refMap;
}

async function applyDocumentUpdate({ model, entity, id, update, summary, apply, reason, preview }) {
  summary.actions.push({
    entity,
    id,
    reason,
    preview,
  });

  if (apply) {
    await model.updateOne({ _id: id }, update);
    bump(summary.updated, entity);
  } else {
    bump(summary.wouldUpdate, entity);
  }
}

function hasChanges(update) {
  return (update.$set && Object.keys(update.$set).length > 0)
    || (update.$unset && Object.keys(update.$unset).length > 0);
}

function pruneUpdate(update) {
  if (update.$set && Object.keys(update.$set).length === 0) delete update.$set;
  if (update.$unset && Object.keys(update.$unset).length === 0) delete update.$unset;
  return update;
}

function printSummary(summary) {
  console.log(`Mode: ${summary.mode}`);
  console.log(`Database: ${summary.dbName}`);
  console.log(`Processed: ${summary.processed.total} (proteins=${summary.processed.proteins}, carbs=${summary.processed.carbs}, saladIngredients=${summary.processed.saladIngredients})`);
  console.log(`Would Update: ${summary.wouldUpdate.total} (proteins=${summary.wouldUpdate.proteins}, carbs=${summary.wouldUpdate.carbs}, saladIngredients=${summary.wouldUpdate.saladIngredients})`);
  console.log(`Updated: ${summary.updated.total} (proteins=${summary.updated.proteins}, carbs=${summary.updated.carbs}, saladIngredients=${summary.updated.saladIngredients})`);
  console.log(`Skipped: ${summary.skipped.total} (proteins=${summary.skipped.proteins}, carbs=${summary.skipped.carbs}, saladIngredients=${summary.skipped.saladIngredients})`);
  console.log(`Warnings: ${summary.warnings.length}`);
  console.log(`Errors: ${summary.errors.length}`);

  if (summary.actions.length > 0) {
    console.log("\nPlanned / Applied Actions:");
    for (const action of summary.actions) {
      console.log(`- [${action.entity}] ${action.id}: ${action.reason}`);
    }
  }

  if (summary.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const message of summary.warnings) {
      console.log(`- ${message}`);
    }
  }

  if (summary.errors.length > 0) {
    console.log("\nErrors:");
    for (const message of summary.errors) {
      console.log(`- ${message}`);
    }
  }
}

async function main() {
  const uri = getMongoUri();
  if (!uri) {
    console.error("Missing MongoDB connection string (MONGO_URI, MONGODB_URI, or MONGO_URL)");
    process.exit(1);
  }

  const apply = hasFlag("--apply");
  const asJson = hasFlag("--json");
  const summary = createSummary(apply ? "apply" : "dry-run");

  if (!asJson) {
    console.log(`Connecting to MongoDB (${summary.mode})...`);
  }
  await mongoose.connect(uri);
  summary.dbName = mongoose.connection.name || (mongoose.connection.db && mongoose.connection.db.databaseName) || "";

  try {
    const [proteins, carbs, saladIngredients, categories] = await Promise.all([
      BuilderProtein.find({})
        .select("key name displayCategoryId displayCategoryKey proteinFamilyKey premiumKey isActive isPremium availableForSubscription sortOrder")
        .lean(),
      BuilderCarb.find({})
        .select("key name displayCategoryId displayCategoryKey isActive availableForSubscription sortOrder")
        .lean(),
      SaladIngredient.find({})
        .select("name groupKey isActive sortOrder")
        .lean(),
      BuilderCategory.find({ isActive: true }).select("_id key dimension").lean(),
    ]);

    const proteinCategoryIdByKey = new Map(
      categories
        .filter((row) => row.dimension === "protein")
        .map((row) => [row.key, String(row._id)])
    );
    const carbCategoryIdByKey = new Map(
      categories
        .filter((row) => row.dimension === "carb")
        .map((row) => [row.key, String(row._id)])
    );

    const proteinCandidateIds = proteins
      .filter((row) => {
        const key = String(row.key || "").trim();
        const isExtraActiveStandard = row.isActive && !row.isPremium && !CANONICAL_STANDARD_PROTEIN_KEYS.has(key);
        const hasInvalidPremiumKey = !row.isPremium && String(row.premiumKey || "").trim();
        const expectation = getProteinExpectation(row);
        const expectedCategoryId = proteinCategoryIdByKey.get(expectation.displayCategoryKey) || null;
        const hasSafeNormalizationGap = Boolean(expectedCategoryId) && (
          String(row.displayCategoryKey || "").trim() !== expectation.displayCategoryKey
          || String(row.proteinFamilyKey || "").trim() !== expectation.proteinFamilyKey
          || String(row.displayCategoryId || "") !== String(expectedCategoryId)
        );
        return isExtraActiveStandard || hasInvalidPremiumKey || hasSafeNormalizationGap;
      })
      .map((row) => row._id);

    const carbCandidateIds = carbs
      .filter((row) => {
        const expectation = getCarbExpectation(row);
        const expectedCategoryId = expectation ? carbCategoryIdByKey.get(expectation.displayCategoryKey) || null : null;
        const needsCanonicalFix = Boolean(expectation && expectedCategoryId) && (
          String(row.displayCategoryKey || "").trim() !== expectation.displayCategoryKey
          || String(row.displayCategoryId || "") !== String(expectedCategoryId)
        );

        const key = String(row.key || "").trim();
        const displayCategoryKey = String(row.displayCategoryKey || "").trim();
        const clearlyLegacyActiveCarb = row.isActive && !key && (
          row.availableForSubscription === false
          || displayCategoryKey === LARGE_SALAD_CATEGORY_KEY
          || !CANONICAL_CARB_DISPLAY_CATEGORY_KEYS.has(displayCategoryKey)
        );

        return needsCanonicalFix || clearlyLegacyActiveCarb;
      })
      .map((row) => row._id);

    const [proteinRefMap, carbRefMap] = await Promise.all([
      buildProteinReferenceMap(proteinCandidateIds),
      buildCarbReferenceMap(carbCandidateIds),
    ]);

    const duplicateProteinKeys = await BuilderProtein.aggregate([
      { $match: { key: { $type: "string", $ne: "" } } },
      { $group: { _id: "$key", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const duplicateCarbKeys = await BuilderCarb.aggregate([
      { $match: { key: { $type: "string", $ne: "" } } },
      { $group: { _id: "$key", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    if (duplicateProteinKeys.length > 0) {
      pushWarning(summary, `Duplicate protein keys reported only: ${duplicateProteinKeys.map((row) => `${row._id} (${row.count})`).join(", ")}`);
    }
    if (duplicateCarbKeys.length > 0) {
      pushWarning(summary, `Duplicate carb keys reported only: ${duplicateCarbKeys.map((row) => `${row._id} (${row.count})`).join(", ")}`);
    }

    for (const protein of proteins) {
      bump(summary.processed, "proteins");

      const update = { $set: {}, $unset: {} };
      const reasons = [];
      const key = String(protein.key || "").trim();
      const expectation = getProteinExpectation(protein);
      const expectedCategoryId = proteinCategoryIdByKey.get(expectation.displayCategoryKey) || null;
      const refs = proteinRefMap.get(String(protein._id)) || { anyDayRefs: 0, activeDayRefs: 0, subscriptionRefs: 0 };
      const totalRefs = refs.anyDayRefs + refs.subscriptionRefs;

      if (!protein.isPremium && String(protein.premiumKey || "").trim()) {
        update.$unset.premiumKey = "";
        reasons.push("unset premiumKey on non-premium protein");
      }

      if (!expectedCategoryId && (
        String(protein.displayCategoryKey || "").trim() !== expectation.displayCategoryKey
        || String(protein.proteinFamilyKey || "").trim() !== expectation.proteinFamilyKey
      )) {
        pushWarning(summary, `Skipped protein metadata remap for ${String(protein._id)} because BuilderCategory '${expectation.displayCategoryKey}' is missing`);
      } else if (expectedCategoryId) {
        if (String(protein.displayCategoryKey || "").trim() !== expectation.displayCategoryKey) {
          update.$set.displayCategoryKey = expectation.displayCategoryKey;
        }
        if (String(protein.proteinFamilyKey || "").trim() !== expectation.proteinFamilyKey) {
          update.$set.proteinFamilyKey = expectation.proteinFamilyKey;
        }
        if (String(protein.displayCategoryId || "") !== String(expectedCategoryId)) {
          update.$set.displayCategoryId = expectedCategoryId;
        }
        if (update.$set.displayCategoryKey || update.$set.proteinFamilyKey || update.$set.displayCategoryId) {
          reasons.push("normalize protein display/family/categoryId");
        }
      }

      const isExtraActiveStandardProtein = protein.isActive && !protein.isPremium && !CANONICAL_STANDARD_PROTEIN_KEYS.has(key);
      const isClearlyLegacyKeylessStandardProtein = isExtraActiveStandardProtein && !key;

      if (isExtraActiveStandardProtein && key) {
        pushWarning(summary, `Left active keyed non-canonical standard protein ${String(protein._id)} (${key}) for manual review`);
      } else if (isClearlyLegacyKeylessStandardProtein) {
        if (totalRefs > 0 || refs.activeDayRefs > 0) {
          pushWarning(
            summary,
            `Left active referenced legacy standard protein ${String(protein._id)} (${protein.name?.en || ""}) refs=${totalRefs}, activeDayRefs=${refs.activeDayRefs}`
          );
        } else if (protein.isActive) {
          update.$set.isActive = false;
          reasons.push("inactivate unreferenced legacy keyless standard protein");
        }
      }

      pruneUpdate(update);
      if (!hasChanges(update)) {
        bump(summary.skipped, "proteins");
        continue;
      }

      try {
        await applyDocumentUpdate({
          model: BuilderProtein,
          entity: "proteins",
          id: protein._id,
          update,
          summary,
          apply,
          reason: reasons.join("; "),
          preview: serializeProtein(protein),
        });
      } catch (error) {
        pushError(summary, `Protein update failed for ${String(protein._id)}: ${error.message}`);
      }
    }

    for (const carb of carbs) {
      bump(summary.processed, "carbs");

      const update = { $set: {}, $unset: {} };
      const reasons = [];
      const expectation = getCarbExpectation(carb);
      const expectedCategoryId = expectation ? carbCategoryIdByKey.get(expectation.displayCategoryKey) || null : null;
      const refs = carbRefMap.get(String(carb._id)) || { anyDayRefs: 0, activeDayRefs: 0 };
      const key = String(carb.key || "").trim();
      const displayCategoryKey = String(carb.displayCategoryKey || "").trim();

      if (expectation && expectedCategoryId) {
        if (displayCategoryKey !== expectation.displayCategoryKey) {
          update.$set.displayCategoryKey = expectation.displayCategoryKey;
        }
        if (String(carb.displayCategoryId || "") !== String(expectedCategoryId)) {
          update.$set.displayCategoryId = expectedCategoryId;
        }
        if (update.$set.displayCategoryKey || update.$set.displayCategoryId) {
          reasons.push("normalize carb display/categoryId");
        }
      }

      const isClearlyLegacyActiveCarb = carb.isActive && !key && (
        carb.availableForSubscription === false
        || displayCategoryKey === LARGE_SALAD_CATEGORY_KEY
        || !CANONICAL_CARB_DISPLAY_CATEGORY_KEYS.has(displayCategoryKey)
      );

      if (isClearlyLegacyActiveCarb) {
        if (refs.anyDayRefs > 0 || refs.activeDayRefs > 0) {
          pushWarning(
            summary,
            `Left active referenced legacy carb ${String(carb._id)} (${carb.name?.en || ""}) refs=${refs.anyDayRefs}, activeDayRefs=${refs.activeDayRefs}`
          );
        } else {
          update.$set.isActive = false;
          reasons.push("inactivate unreferenced legacy keyless carb");
        }
      }

      pruneUpdate(update);
      if (!hasChanges(update)) {
        bump(summary.skipped, "carbs");
        continue;
      }

      try {
        await applyDocumentUpdate({
          model: BuilderCarb,
          entity: "carbs",
          id: carb._id,
          update,
          summary,
          apply,
          reason: reasons.join("; "),
          preview: serializeCarb(carb),
        });
      } catch (error) {
        pushError(summary, `Carb update failed for ${String(carb._id)}: ${error.message}`);
      }
    }

    for (const ingredient of saladIngredients) {
      bump(summary.processed, "saladIngredients");

      const normalizedGroupKey = normalizeSaladIngredientGroupKey(ingredient.groupKey);
      if (!normalizedGroupKey) {
        pushWarning(summary, `Invalid salad ingredient groupKey reported only for ${String(ingredient._id)} (${ingredient.name?.en || ""})`);
        bump(summary.skipped, "saladIngredients");
        continue;
      }

      if (!VALID_SALAD_GROUP_KEYS.has(normalizedGroupKey)) {
        pushWarning(summary, `Skipped salad ingredient ${String(ingredient._id)} because normalized groupKey '${normalizedGroupKey}' is not canonical`);
        bump(summary.skipped, "saladIngredients");
        continue;
      }

      if (String(ingredient.groupKey || "").trim() === normalizedGroupKey) {
        bump(summary.skipped, "saladIngredients");
        continue;
      }

      const update = { $set: { groupKey: normalizedGroupKey } };

      try {
        await applyDocumentUpdate({
          model: SaladIngredient,
          entity: "saladIngredients",
          id: ingredient._id,
          update,
          summary,
          apply,
          reason: "normalize known legacy salad group alias",
          preview: serializeIngredient(ingredient),
        });
      } catch (error) {
        pushError(summary, `Salad ingredient update failed for ${String(ingredient._id)}: ${error.message}`);
      }
    }

    if (asJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printSummary(summary);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
