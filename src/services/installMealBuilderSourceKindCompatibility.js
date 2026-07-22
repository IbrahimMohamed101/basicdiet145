"use strict";

const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const {
  CANONICAL_SOURCE_KINDS,
  canonicalSourceKind,
  normalizeMealBuilderSectionSourceKind,
} = require("./subscription/mealBuilderSourceKindCompatibility");

let installed = false;

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSectionByStructure(section = {}) {
  if (!isObject(section)) return section;

  const normalized = normalizeMealBuilderSectionSourceKind(section);
  const currentKind = canonicalSourceKind(normalized.sourceKind || "");
  if (CANONICAL_SOURCE_KINDS.has(currentKind)) {
    return { ...normalized, sourceKind: currentKind };
  }

  const sectionType = String(
    normalized.sectionType || normalized.type || ""
  ).trim().toLowerCase();
  const selectionType = String(normalized.selectionType || "")
    .trim()
    .toLowerCase();
  const key = String(normalized.key || normalized.sectionKey || "")
    .trim()
    .toLowerCase();
  const hasProducts =
    Array.isArray(normalized.selectedProductIds) ||
    Array.isArray(normalized.productIds);
  const hasOptions =
    Array.isArray(normalized.selectedOptionIds) ||
    Array.isArray(normalized.optionIds) ||
    Boolean(normalized.productContextId || normalized.sourceGroupId);

  if (
    sectionType === "product_list" ||
    sectionType === "product_category" ||
    selectionType === "full_meal_product" ||
    selectionType === "sandwich" ||
    (hasProducts && !hasOptions)
  ) {
    return { ...normalized, sourceKind: "product_list" };
  }

  if (
    key === "premium" ||
    selectionType === "premium_meal" ||
    selectionType === "premium_large_salad"
  ) {
    return { ...normalized, sourceKind: "premium_visual" };
  }

  if (sectionType === "option_group" || hasOptions) {
    const raw = String(
      normalized.sourceKind || normalized.source?.kind || ""
    ).toLowerCase();
    const configurable =
      raw.includes("configurable") ||
      raw.includes("product_option") ||
      raw.includes("product_context");
    return {
      ...normalized,
      sourceKind: configurable ? "configurable_product" : "visual_family",
    };
  }

  // Leave genuinely malformed/unknown shapes untouched so the core validator
  // still fails closed instead of silently changing their meaning.
  return normalized;
}

function normalizeSections(value) {
  return Array.isArray(value)
    ? value.map((section) => normalizeSectionByStructure(section))
    : value;
}

function normalizeConfig(value) {
  if (!isObject(value)) return value;
  if (!Array.isArray(value.sections)) return value;
  return {
    ...value,
    sections: normalizeSections(value.sections),
  };
}

function normalizeLifecycle(value) {
  if (!isObject(value)) return value;
  let changed = false;
  const output = { ...value };

  if (Array.isArray(value.sections)) {
    output.sections = normalizeSections(value.sections);
    changed = true;
  }

  for (const key of ["config", "draft", "published"]) {
    if (isObject(value[key])) {
      output[key] = normalizeConfig(value[key]);
      changed = true;
    }
  }

  return changed ? output : value;
}

function normalizeSectionArgs(args = {}, fieldName = "section") {
  if (!isObject(args) || !Object.prototype.hasOwnProperty.call(args, fieldName)) {
    return args;
  }
  const value = args[fieldName];
  if (!isObject(value)) return args;
  return {
    ...args,
    [fieldName]: normalizeSectionByStructure(value),
  };
}

function normalizeDraftArgs(args = {}) {
  if (!isObject(args) || !Array.isArray(args.sections)) return args;
  return {
    ...args,
    sections: normalizeSections(args.sections),
  };
}

function sameSourceKinds(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((section, index) => {
    const next = right[index] || {};
    return String(section?.sourceKind || "") === String(next?.sourceKind || "");
  });
}

function installMealBuilderSourceKindCompatibility() {
  if (installed) return;
  installed = true;

  const originalCreateDraft = mealBuilderConfigService.createDraft.bind(
    mealBuilderConfigService
  );
  const originalUpdateDraft = mealBuilderConfigService.updateDraft.bind(
    mealBuilderConfigService
  );
  const originalValidatePayload = mealBuilderConfigService.validatePayload.bind(
    mealBuilderConfigService
  );
  const originalOpenWorkingDraft = mealBuilderConfigService.openWorkingDraft.bind(
    mealBuilderConfigService
  );
  const originalGetDashboardState = mealBuilderConfigService.getDashboardState.bind(
    mealBuilderConfigService
  );
  const originalGetHydratedDraft = mealBuilderConfigService.getHydratedDraft.bind(
    mealBuilderConfigService
  );
  const originalGetCurrentPublishedConfig =
    mealBuilderConfigService.getCurrentPublishedConfig.bind(mealBuilderConfigService);
  const originalBuildPublishedContract =
    mealBuilderConfigService.buildPublishedContract.bind(mealBuilderConfigService);
  const originalBuildPlannerCatalog =
    mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder.bind(
      mealBuilderConfigService
    );
  const originalPublishDraft = mealBuilderConfigService.publishDraft.bind(
    mealBuilderConfigService
  );

  mealBuilderConfigService.createDraft = async function createDraftWithCanonicalKinds(
    args = {}
  ) {
    return normalizeLifecycle(await originalCreateDraft(normalizeDraftArgs(args)));
  };

  mealBuilderConfigService.updateDraft = async function updateDraftWithCanonicalKinds(
    args = {}
  ) {
    return normalizeLifecycle(await originalUpdateDraft(normalizeDraftArgs(args)));
  };

  mealBuilderConfigService.validatePayload = async function validateWithCanonicalKinds(
    args = {}
  ) {
    return originalValidatePayload(normalizeDraftArgs(args));
  };

  mealBuilderConfigService.openWorkingDraft = async function openCanonicalDraft(
    args = {}
  ) {
    return normalizeConfig(await originalOpenWorkingDraft(args));
  };

  mealBuilderConfigService.getDashboardState = async function getCanonicalState(
    args = {}
  ) {
    return normalizeLifecycle(await originalGetDashboardState(args));
  };

  mealBuilderConfigService.getHydratedDraft = async function getCanonicalHydratedDraft(
    args = {}
  ) {
    return normalizeLifecycle(await originalGetHydratedDraft(args));
  };

  mealBuilderConfigService.getCurrentPublishedConfig =
    async function getCanonicalPublishedConfig(args = {}) {
      return normalizeConfig(await originalGetCurrentPublishedConfig(args));
    };

  mealBuilderConfigService.buildPublishedContract =
    async function buildContractWithCanonicalKinds(args = {}) {
      const normalizedArgs = isObject(args) && isObject(args.config)
        ? { ...args, config: normalizeConfig(args.config) }
        : args;
      return originalBuildPublishedContract(normalizedArgs);
    };

  mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder =
    async function buildPlannerCatalogWithCanonicalKinds(args = {}) {
      const normalizedArgs = isObject(args) && isObject(args.config)
        ? { ...args, config: normalizeConfig(args.config) }
        : args;
      return originalBuildPlannerCatalog(normalizedArgs);
    };

  mealBuilderConfigService.publishDraft = async function publishCanonicalDraft(
    args = {}
  ) {
    // Existing production drafts may contain a Dashboard alias in an unrelated
    // card. Persist the canonical representation first so publish, validation,
    // and every later item mutation operate on the same stored contract.
    const draft = await originalOpenWorkingDraft({ actor: args.actor || {} });
    const canonicalSections = normalizeSections(draft?.sections || []);
    if (!sameSourceKinds(draft?.sections || [], canonicalSections)) {
      await originalUpdateDraft({
        sections: canonicalSections,
        notes: draft?.notes,
        actor: args.actor || {},
      });
    }
    return normalizeLifecycle(await originalPublishDraft(args));
  };
}

installMealBuilderSourceKindCompatibility();

module.exports = {
  installMealBuilderSourceKindCompatibility,
  normalizeConfig,
  normalizeDraftArgs,
  normalizeLifecycle,
  normalizeSectionArgs,
  normalizeSectionByStructure,
};
