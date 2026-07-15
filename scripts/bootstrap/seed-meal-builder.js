#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const MealBuilderConfig = require("../../src/models/MealBuilderConfig");
const {
  CONTRACT_VERSION,
  buildDefaultVisualTemplateSections,
  computeRevisionHash,
  getReadinessReport,
  validateConfigObject,
} = require("../../src/services/subscription/mealBuilderConfigService");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

const BOOTSTRAP_KEY = "initial_subscription_meal_builder";
const BOOTSTRAP_NOTES = "Initial subscription meal builder generated from catalog seed";

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function isBootstrapOwned(config) {
  return Boolean(config)
    && config.source === "bootstrap"
    && config.createdBySystem === true
    && config.bootstrapKey === BOOTSTRAP_KEY;
}

function validationMessage(validation) {
  return (validation.errors || []).map((item) => `${item.code}: ${item.message}`).join("; ");
}

function createConfigPayload({ status, sections, publishedAt = null }) {
  const payload = {
    status,
    isCurrent: true,
    contractVersion: CONTRACT_VERSION,
    source: "bootstrap",
    createdBySystem: true,
    bootstrapKey: BOOTSTRAP_KEY,
    sections,
    notes: BOOTSTRAP_NOTES,
    publishedAt,
    publishedBy: null,
    createdBy: null,
    updatedBy: null,
  };
  payload.revisionHash = computeRevisionHash(payload);
  return payload;
}

async function buildValidatedSeedPayload() {
  const seed = await buildDefaultVisualTemplateSections({ returnDetails: true });
  if (seed.errors.length) {
    const message = seed.errors.map((item) => `${item.code}: ${item.message}`).join("; ");
    const err = new Error(`Meal Builder seed catalog is invalid: ${message}`);
    err.code = "MEAL_BUILDER_BOOTSTRAP_INVALID_CATALOG";
    err.details = seed.errors;
    throw err;
  }

  const validation = await validateConfigObject({ sections: seed.sections });
  if (!validation.ready) {
    const err = new Error(`Generated Meal Builder config is not publishable: ${validationMessage(validation)}`);
    err.code = "MEAL_BUILDER_BOOTSTRAP_VALIDATION_FAILED";
    err.details = validation;
    throw err;
  }

  return { sections: seed.sections, warnings: seed.warnings, validation };
}

async function seedMealBuilderConfig({ sync = false, dryRun = false, log = console } = {}) {
  const result = {
    dryRun: Boolean(dryRun),
    sync: Boolean(sync),
    createdDraft: false,
    updatedDraft: false,
    skippedDraft: false,
    createdPublished: false,
    updatedPublished: false,
    skippedPublished: false,
    protectedDraft: false,
    protectedPublished: false,
    warnings: [],
    validation: null,
    readiness: null,
  };

  const { sections, warnings, validation } = await buildValidatedSeedPayload();
  result.warnings = warnings;
  result.validation = validation;

  const [currentDraft, currentPublished] = await Promise.all([
    MealBuilderConfig.findOne({ status: "draft", isCurrent: true }).sort({ updatedAt: -1 }).lean(),
    MealBuilderConfig.findOne({ status: "published", isCurrent: true }).sort({ publishedAt: -1, updatedAt: -1 }).lean(),
  ]);

  const canSyncDraft = sync && isBootstrapOwned(currentDraft);
  const canSyncPublished = sync && isBootstrapOwned(currentPublished);

  for (const warning of warnings) {
    (log.warn || log.log).call(log, `[meal-builder-bootstrap:warning] ${warning.code}: ${warning.message}`);
  }

  if (dryRun) {
    log.log("[meal-builder-bootstrap:dry-run] No Meal Builder config writes will be attempted.");
    log.log(`[meal-builder-bootstrap:dry-run] sections=${sections.length} validation=${validation.status}`);
    log.log(`[meal-builder-bootstrap:dry-run] draft=${!currentDraft ? "would-create" : canSyncDraft ? "would-update-bootstrap-owned" : "protect-existing"}`);
    log.log(`[meal-builder-bootstrap:dry-run] published=${!currentPublished ? "would-publish" : canSyncPublished ? "would-update-bootstrap-owned" : "protect-existing"}`);
    return result;
  }

  const draftPayload = createConfigPayload({ status: "draft", sections });
  if (!currentDraft) {
    await MealBuilderConfig.create(draftPayload);
    result.createdDraft = true;
  } else if (canSyncDraft) {
    await MealBuilderConfig.updateOne({ _id: currentDraft._id }, { $set: draftPayload }, { runValidators: true });
    result.updatedDraft = true;
  } else {
    result.skippedDraft = true;
    result.protectedDraft = !isBootstrapOwned(currentDraft);
  }

  const publishedPayload = createConfigPayload({ status: "published", sections, publishedAt: new Date() });
  if (!currentPublished) {
    await MealBuilderConfig.create(publishedPayload);
    result.createdPublished = true;
  } else if (canSyncPublished) {
    await MealBuilderConfig.updateOne({ _id: currentPublished._id }, { $set: publishedPayload }, { runValidators: true });
    result.updatedPublished = true;
  } else {
    result.skippedPublished = true;
    result.protectedPublished = !isBootstrapOwned(currentPublished);
  }

  if (result.createdPublished || result.updatedPublished || currentPublished) {
    result.readiness = await getReadinessReport();
  }

  log.log([
    "Meal Builder bootstrap:",
    `draft=${result.createdDraft ? "created" : result.updatedDraft ? "updated-bootstrap-owned" : result.protectedDraft ? "protected-user-owned" : "skipped"}`,
    `published=${result.createdPublished ? "created" : result.updatedPublished ? "updated-bootstrap-owned" : result.protectedPublished ? "protected-user-owned" : "skipped"}`,
    `warnings=${result.warnings.length}`,
    `validation=${validation.status}`,
  ].join(" "));

  if (result.readiness) {
    log.log(`Meal Builder readiness: status=${result.readiness.status} sections=${result.readiness.summary.sections} errors=${result.readiness.summary.errors} warnings=${result.readiness.summary.warnings}`);
  }

  return result;
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes("--dry-run");
  const sync = argv.includes("--sync") && isTruthy(process.env.MEAL_BUILDER_BOOTSTRAP_SYNC);
  const uri = resolveMongoUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await seedMealBuilderConfig({ dryRun, sync });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`[meal-builder-bootstrap] ${err.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  BOOTSTRAP_KEY,
  BOOTSTRAP_NOTES,
  buildValidatedSeedPayload,
  isBootstrapOwned,
  seedMealBuilderConfig,
};
