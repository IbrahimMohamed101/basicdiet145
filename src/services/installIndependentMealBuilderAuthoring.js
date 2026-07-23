"use strict";

const mongoose = require("mongoose");

const MealBuilderConfig = require("../models/MealBuilderConfig");
const baseMealBuilderService = require("./subscription/mealBuilderConfigService");
const compatibilityService = require("./subscription/dashboardMealPlannerCompatibilityService");
const dashboardService = require("./subscription/dashboardMealPlannerDashboardService");

const LEGACY_SEED_ERRORS = new Set([
  "MEAL_BUILDER_DEFAULT_SANDWICH_SOURCE_MISSING",
  "MEAL_BUILDER_DEFAULT_SEED_INCOMPLETE",
  "MEAL_BUILDER_DEFAULT_PREMIUM_SOURCE_MISSING",
  "MEAL_BUILDER_DEFAULT_CARBS_SOURCE_MISSING",
]);

let installed = false;

function actorId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(String(value)) ? value : null;
}

function isLegacySeedDependencyError(error) {
  return Boolean(error && LEGACY_SEED_ERRORS.has(String(error.code || "")));
}

async function getCurrentDraft() {
  return MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
    .sort({ updatedAt: -1 })
    .lean();
}

async function createIndependentEmptyDraft({ actor = {}, notes = "" } = {}) {
  const existing = await getCurrentDraft();
  if (existing) return baseMealBuilderService.serializeConfig(existing);

  await MealBuilderConfig.updateMany(
    { status: "draft", isCurrent: true },
    { $set: { isCurrent: false } }
  );

  const userId = actorId(actor.userId);
  const draft = await MealBuilderConfig.create({
    status: "draft",
    isCurrent: true,
    contractVersion: baseMealBuilderService.CONTRACT_VERSION,
    basedOnPublishedVersionId: null,
    source: "dashboard",
    createdBySystem: false,
    bootstrapKey: "independent_dashboard_authoring_v1",
    sections: [],
    notes: String(notes || ""),
    createdBy: userId,
    updatedBy: userId,
  });

  return baseMealBuilderService.serializeConfig(draft.toObject());
}

function wrapCreateDraft(service) {
  const original = service.createDraft;
  if (typeof original !== "function" || original.__independentAuthoring === true) {
    return;
  }

  const wrapped = async function independentCreateDraft(args = {}) {
    if (args.sections !== undefined && args.sections !== null) {
      return original.call(service, args);
    }

    const existing = await getCurrentDraft();
    if (existing) return baseMealBuilderService.serializeConfig(existing);

    try {
      return await original.call(service, args);
    } catch (error) {
      if (!isLegacySeedDependencyError(error)) throw error;
      return createIndependentEmptyDraft(args);
    }
  };

  wrapped.__independentAuthoring = true;
  wrapped.__original = original;
  service.createDraft = wrapped;
}

function wrapOpenWorkingDraft(service) {
  const original = service.openWorkingDraft;
  if (typeof original !== "function" || original.__independentAuthoring === true) {
    return;
  }

  const wrapped = async function independentOpenWorkingDraft(args = {}) {
    const existing = await getCurrentDraft();
    if (existing) return baseMealBuilderService.serializeConfig(existing);

    try {
      return await original.call(service, args);
    } catch (error) {
      if (!isLegacySeedDependencyError(error)) throw error;
      return createIndependentEmptyDraft(args);
    }
  };

  wrapped.__independentAuthoring = true;
  wrapped.__original = original;
  service.openWorkingDraft = wrapped;
}

function installIndependentMealBuilderAuthoring() {
  if (installed) return;
  installed = true;

  for (const service of [compatibilityService, dashboardService]) {
    wrapCreateDraft(service);
    wrapOpenWorkingDraft(service);
  }
}

installIndependentMealBuilderAuthoring();

module.exports = {
  LEGACY_SEED_ERRORS,
  createIndependentEmptyDraft,
  installIndependentMealBuilderAuthoring,
  isLegacySeedDependencyError,
};
