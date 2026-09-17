"use strict";

/**
 * Idempotent, narrowly scoped repair for the four production MenuOptions whose
 * identity and intended Chicken-card membership were verified on 2026-09-05.
 *
 * Default: dry run
 * Execute: node scripts/repair-basic-meal-protein-family-metadata.js --execute
 *
 * This script never creates/deletes MenuOptions or ProductGroupOptions and
 * never publishes Meal Builder configuration.
 */

const mongoose = require("mongoose");

const MenuOption = require("../src/models/MenuOption");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const {
  resolveProteinFamilyClassification,
} = require("../src/config/mealPlannerContract");

const BASIC_MEAL_ID = "6a62197079ee075a57f70106";
const PROTEINS_GROUP_ID = "6a62197279ee075a57f70107";
const TARGETS = Object.freeze([
  { id: "6a9b4e939fbb9859232f422d", key: "chicken_molokhia", family: "chicken" },
  { id: "6a9b4f5f9fbb9859232f4461", key: "bbq_chicken_2", family: "chicken" },
  { id: "6a9b4f7a9fbb9859232f4473", key: "lemon_chicken_2", family: "chicken" },
  { id: "6a9b4f959fbb9859232f4488", key: "chicken_strips_2", family: "chicken" },
]);

function connectionUri() {
  return process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_PUBLIC_URL || "";
}

function redactedDatabaseIdentity(uri) {
  try {
    const parsed = new URL(uri);
    return {
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "unknown",
      service: process.env.RAILWAY_SERVICE_NAME || "unknown",
      host: "[redacted]",
      database: parsed.pathname.replace(/^\//, "") || "driver-default",
      credentials: "[redacted]",
    };
  } catch {
    return {
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "unknown",
      service: process.env.RAILWAY_SERVICE_NAME || "unknown",
      host: "[redacted]",
      database: "unknown",
      credentials: "[redacted]",
    };
  }
}

function raw(value) {
  return String(value || "").trim().toLowerCase();
}

function inspectTarget(target, option, relations) {
  const currentProteinFamilyKey = raw(option?.proteinFamilyKey);
  const currentDisplayCategoryKey = raw(option?.displayCategoryKey);
  const resolved = option
    ? resolveProteinFamilyClassification(option)
    : { familyKey: "", source: "missing", valid: false };
  const identityMatches = Boolean(
    option &&
    String(option._id) === target.id &&
    option.key === target.key &&
    String(option.groupId) === PROTEINS_GROUP_ID
  );
  const metadataSafe =
    ["", target.family].includes(currentProteinFamilyKey) &&
    ["", target.family].includes(currentDisplayCategoryKey);
  const alreadyCorrect =
    currentProteinFamilyKey === target.family &&
    currentDisplayCategoryKey === target.family;

  let action = "BLOCKED_AMBIGUOUS";
  let why = "TARGET_IDENTITY_OR_EXISTING_METADATA_CONFLICT";
  if (identityMatches && metadataSafe) {
    action = alreadyCorrect ? "NO-OP" : "UPDATE";
    why = "VERIFIED_ID_KEY_GROUP_AND_EXPLICIT_CHICKEN_CARD_INCIDENT_SCOPE";
  }

  return {
    optionId: target.id,
    key: option?.key || target.key,
    currentProteinFamilyKey,
    currentDisplayCategoryKey,
    resolvedFamilyBefore: resolved.familyKey || "",
    resolvedFamilySourceBefore: resolved.source,
    proposedFamily: target.family,
    why,
    action,
    basicMealRelationCount: relations.length,
    effectiveBasicMealRelationCount: relations.filter(
      (relation) =>
        relation.isActive !== false &&
        relation.isVisible !== false &&
        relation.isAvailable !== false
    ).length,
  };
}

async function repairBasicMealProteinFamilyMetadata({ execute = false } = {}) {
  let blocked = false;
  const plan = [];
  for (const target of TARGETS) {
    const [option, relations] = await Promise.all([
      MenuOption.findById(target.id).lean(),
      ProductGroupOption.find({
        productId: BASIC_MEAL_ID,
        groupId: PROTEINS_GROUP_ID,
        optionId: target.id,
      }).lean(),
    ]);
    const audit = inspectTarget(target, option, relations);
    plan.push(audit);
    if (audit.action === "BLOCKED_AMBIGUOUS") {
      blocked = true;
      continue;
    }
    if (execute && audit.action === "UPDATE") {
      const result = await MenuOption.updateOne(
        {
          _id: target.id,
          key: target.key,
          groupId: PROTEINS_GROUP_ID,
          proteinFamilyKey: { $in: ["", null, target.family] },
          displayCategoryKey: { $in: ["", null, target.family] },
        },
        { $set: { proteinFamilyKey: target.family, displayCategoryKey: target.family } }
      );
      if (result.matchedCount !== 1) {
        blocked = true;
        plan.push({
          optionId: target.id,
          key: target.key,
          action: "BLOCKED_AMBIGUOUS",
          why: "CONCURRENT_CHANGE_OR_IDENTITY_GUARD_FAILED",
        });
      }
    }
  }

  let readBack = [];
  if (execute && !blocked) {
    const after = await MenuOption.find({ _id: { $in: TARGETS.map((target) => target.id) } })
      .sort({ _id: 1 })
      .lean();
    readBack = after.map((option) => ({
      optionId: String(option._id),
      key: option.key,
      proteinFamilyKey: option.proteinFamilyKey || "",
      displayCategoryKey: option.displayCategoryKey || "",
      resolvedFamily: resolveProteinFamilyClassification(option).familyKey || "",
    }));
  }

  return { mode: execute ? "EXECUTE" : "DRY_RUN", blocked, plan, readBack };
}

async function main() {
  const execute = process.argv.includes("--execute");
  const uri = connectionUri();
  if (!uri) throw new Error("MONGODB_URI, MONGO_URI, or MONGO_PUBLIC_URL is required");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(JSON.stringify({
    mode: execute ? "EXECUTE" : "DRY_RUN",
    database: redactedDatabaseIdentity(uri),
    scope: {
      basicMealId: BASIC_MEAL_ID,
      proteinsGroupId: PROTEINS_GROUP_ID,
      optionIds: TARGETS.map((target) => target.id),
    },
  }, null, 2));
  const result = await repairBasicMealProteinFamilyMetadata({ execute });
  for (const row of result.plan) console.log(JSON.stringify(row));
  if (result.readBack.length) console.log(JSON.stringify({ readBack: result.readBack }, null, 2));

  await mongoose.disconnect();
  if (result.blocked) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error.message);
    try {
      await mongoose.disconnect();
    } catch {
      // Best-effort disconnect only.
    }
    process.exitCode = 1;
  });
}

module.exports = {
  BASIC_MEAL_ID,
  PROTEINS_GROUP_ID,
  TARGETS,
  inspectTarget,
  redactedDatabaseIdentity,
  repairBasicMealProteinFamilyMetadata,
};
