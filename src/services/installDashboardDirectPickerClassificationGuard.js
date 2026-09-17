"use strict";

const MenuProduct = require("../models/MenuProduct");
const compatibilityService = require("./subscription/dashboardMealPlannerCompatibilityService");
const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");
const baseService = require("./subscription/mealBuilderConfigService");
const {
  isProductionDirectProduct,
} = require("./catalog/mealProductClassificationService");

const STATE_KEY = Symbol.for(
  "basicdiet.dashboardDirectPickerClassificationGuard.state"
);
const WRAPPER_MARKER = "__dashboardDirectPickerClassificationGuard";
const CARD_REPAIR_MARKER = "__dashboardDirectCardSystemManagedRepair";
const AUTHORITY = "meal_product_classification.v1";
const MAX_PICKER_LIMIT = 1000;
const CARD_TYPES = Object.freeze({
  DIRECT_PRODUCT: "direct_product",
  OPTION_FAMILY: "option_family",
  SYSTEM_PREMIUM: "system_premium",
});
const FULL_MEAL_SELECTION_TYPE = "full_meal_product";
const LEGACY_SANDWICH_SELECTION_TYPE = "sandwich";
const PREMIUM_SELECTION_TYPES = new Set([
  "premium",
  "premium_meal",
  "premium_large_salad",
]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function candidateId(candidate = {}) {
  return String(candidate.productId || candidate.id || "").trim();
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDirectCardEvidence(section = {}) {
  const topLevelType = token(section.cardType);
  const metadataType = token(section.metadata?.cardType);
  const sectionType = token(section.sectionType || section.type);
  const selectionType = token(section.selectionType);
  return (
    topLevelType === CARD_TYPES.DIRECT_PRODUCT ||
    metadataType === CARD_TYPES.DIRECT_PRODUCT ||
    sectionType === "product_list" ||
    selectionType === FULL_MEAL_SELECTION_TYPE ||
    selectionType === LEGACY_SANDWICH_SELECTION_TYPE ||
    section.itemEntity === "MenuProduct" ||
    section.completeByItself === true
  );
}

function hasOptionCardEvidence(section = {}) {
  const topLevelType = token(section.cardType);
  const metadataType = token(section.metadata?.cardType);
  const sectionType = token(section.sectionType || section.type);
  return (
    topLevelType === CARD_TYPES.OPTION_FAMILY ||
    metadataType === CARD_TYPES.OPTION_FAMILY ||
    sectionType === "option_group" ||
    sectionType === "option_family" ||
    Array.isArray(section.selectedOptionIds) ||
    Boolean(section.productContextId || section.sourceGroupId)
  );
}

function isIntrinsicPremiumSection(section = {}) {
  const selectionType = token(section.selectionType);
  return (
    sectionKey(section) === "premium" ||
    token(section.sourceKind) === "premium_visual" ||
    token(section.metadata?.visualRole) === "premium" ||
    PREMIUM_SELECTION_TYPES.has(selectionType)
  );
}

function isExplicitDirectSection(section = {}) {
  return !isIntrinsicPremiumSection(section) && hasDirectCardEvidence(section);
}

function resolvedCardType(section = {}) {
  if (isIntrinsicPremiumSection(section)) return CARD_TYPES.SYSTEM_PREMIUM;
  if (hasDirectCardEvidence(section)) return CARD_TYPES.DIRECT_PRODUCT;
  if (hasOptionCardEvidence(section)) return CARD_TYPES.OPTION_FAMILY;

  const topLevelType = token(section.cardType);
  const metadataType = token(section.metadata?.cardType);
  if (
    topLevelType === CARD_TYPES.SYSTEM_PREMIUM ||
    metadataType === CARD_TYPES.SYSTEM_PREMIUM ||
    section.systemManaged === true ||
    section.metadata?.systemManaged === true
  ) {
    return CARD_TYPES.SYSTEM_PREMIUM;
  }
  return metadataType || topLevelType;
}

function canonicalDirectSelectionType(value) {
  const selectionType = token(value);
  return !selectionType || selectionType === LEGACY_SANDWICH_SELECTION_TYPE
    ? FULL_MEAL_SELECTION_TYPE
    : value;
}

function sanitizeDashboardSection(section = {}) {
  if (!isPlainObject(section)) return section;
  const cardType = resolvedCardType(section);

  if (cardType === CARD_TYPES.DIRECT_PRODUCT) {
    return {
      ...section,
      cardType: CARD_TYPES.DIRECT_PRODUCT,
      selectionType: canonicalDirectSelectionType(section.selectionType),
      systemManaged: false,
      itemEntity: "MenuProduct",
      completeByItself: true,
      metadata: {
        ...(section.metadata || {}),
        cardType: CARD_TYPES.DIRECT_PRODUCT,
        cardKind: FULL_MEAL_SELECTION_TYPE,
        systemManaged: false,
        dashboardManaged: true,
        requiresBuilder: false,
        treatAsFullMeal: true,
      },
    };
  }

  if (cardType === CARD_TYPES.OPTION_FAMILY) {
    return {
      ...section,
      cardType: CARD_TYPES.OPTION_FAMILY,
      systemManaged: false,
      itemEntity: "MenuOption",
      completeByItself: false,
      metadata: {
        ...(section.metadata || {}),
        cardType: CARD_TYPES.OPTION_FAMILY,
        systemManaged: false,
      },
    };
  }

  if (cardType === CARD_TYPES.SYSTEM_PREMIUM) {
    return {
      ...section,
      cardType: CARD_TYPES.SYSTEM_PREMIUM,
      systemManaged: true,
      itemEntity: "PremiumUpgradeConfig",
      completeByItself: false,
      metadata: {
        ...(section.metadata || {}),
        cardType: CARD_TYPES.SYSTEM_PREMIUM,
        systemManaged: true,
      },
    };
  }

  return { ...section };
}

function looksLikeSection(value = {}) {
  return (
    isPlainObject(value) &&
    Boolean(value.key || value.sectionKey) &&
    (Object.prototype.hasOwnProperty.call(value, "sectionType") ||
      Object.prototype.hasOwnProperty.call(value, "sourceKind") ||
      Object.prototype.hasOwnProperty.call(value, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(value, "selectedOptionIds") ||
      Object.prototype.hasOwnProperty.call(value, "titleOverride"))
  );
}

function sanitizeDashboardValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeDashboardValue);
  if (!isPlainObject(value)) return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = sanitizeDashboardValue(entry);
  }
  return looksLikeSection(output) ? sanitizeDashboardSection(output) : output;
}

function sectionNeedsStoredRepair(section = {}) {
  return (
    isExplicitDirectSection(section) &&
    !isIntrinsicPremiumSection(section) &&
    (section.systemManaged === true ||
      section.metadata?.systemManaged === true ||
      token(section.cardType) === CARD_TYPES.SYSTEM_PREMIUM ||
      token(section.metadata?.cardType) === CARD_TYPES.SYSTEM_PREMIUM ||
      token(section.selectionType) === LEGACY_SANDWICH_SELECTION_TYPE)
  );
}

function repairStoredSection(section = {}) {
  if (!sectionNeedsStoredRepair(section)) return section;
  return {
    ...section,
    selectionType: canonicalDirectSelectionType(section.selectionType),
    metadata: {
      ...(section.metadata || {}),
      cardType: CARD_TYPES.DIRECT_PRODUCT,
      cardKind: FULL_MEAL_SELECTION_TYPE,
      systemManaged: false,
      dashboardManaged: true,
      requiresBuilder: false,
      treatAsFullMeal: true,
    },
  };
}

function repairSectionsForWrite(sections) {
  return Array.isArray(sections) ? sections.map(repairStoredSection) : sections;
}

async function repairWorkingDraft({ sectionKey: targetSectionKey, actor = {} } = {}) {
  const draft = await baseService.openWorkingDraft({ actor });
  const target = token(targetSectionKey);
  let changed = false;
  const sections = (draft.sections || []).map((section) => {
    if (target && sectionKey(section) !== target) return section;
    if (!sectionNeedsStoredRepair(section)) return section;
    changed = true;
    return repairStoredSection(section);
  });

  if (!changed) return draft;
  return baseService.updateDraft({
    sections,
    notes: draft.notes,
    actor,
  });
}

function recalculateMeta(rows, page, limit, previousMeta = {}) {
  const total = rows.length;
  return {
    ...previousMeta,
    page,
    limit,
    total,
    pages: total === 0 ? 0 : Math.ceil(total / limit),
    catalogTotal: total,
    selectedInCurrentCard: rows.filter((row) => row.selected).length,
    assignedToOtherCards: rows.filter(
      (row) => row.state === "assigned_elsewhere"
    ).length,
    unassigned: rows.filter((row) => row.state === "eligible").length,
    unavailable: rows.filter((row) => row.state === "unavailable").length,
  };
}

function normalizeClassificationAuthority(result) {
  if (!result || result.candidateType !== "product") return result;
  return {
    ...result,
    rules: {
      ...(result.rules || {}),
      classificationAuthority: AUTHORITY,
    },
  };
}

async function filterDirectCandidates(result, options = {}) {
  if (!result || result.candidateType !== "product") return result;

  const ids = (result.candidates || []).map(candidateId).filter(Boolean);
  const products = ids.length
    ? await MenuProduct.find({ _id: { $in: ids } })
        .select({ _id: 1, itemType: 1, isCustomizable: 1, ui: 1 })
        .lean()
    : [];
  const allowedIds = new Set(
    products
      .filter((product) => isProductionDirectProduct(product))
      .map((product) => String(product._id))
  );
  const rows = (result.candidates || []).filter((candidate) =>
    allowedIds.has(candidateId(candidate))
  );

  const page = positiveInteger(options.page, 1);
  const limit = Math.min(
    MAX_PICKER_LIMIT,
    positiveInteger(options.limit, 100)
  );
  const skip = (page - 1) * limit;

  return normalizeClassificationAuthority({
    ...result,
    candidates: rows.slice(skip, skip + limit),
    meta: recalculateMeta(rows, page, limit, result.meta || {}),
  });
}

function wrapCompatibilityPicker() {
  const original = compatibilityService.getDirectProductPicker;
  if (typeof original !== "function") {
    throw new Error("Missing dashboard direct product picker");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function classifiedDashboardDirectPicker(options = {}) {
    const requestedPage = positiveInteger(options.page, 1);
    const requestedLimit = Math.min(
      MAX_PICKER_LIMIT,
      positiveInteger(options.limit, 100)
    );
    const complete = await original.call(compatibilityService, {
      ...options,
      page: 1,
      limit: MAX_PICKER_LIMIT,
    });
    return filterDirectCandidates(complete, {
      ...options,
      page: requestedPage,
      limit: requestedLimit,
    });
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  compatibilityService.getDirectProductPicker = wrapped;
}

function wrapFinalDashboardPicker() {
  const original = dashboardMealBuilderService.getSectionPicker;
  if (typeof original !== "function") {
    throw new Error("Missing final dashboard Meal Builder picker");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function canonicalDashboardPickerAuthority(options = {}) {
    return normalizeClassificationAuthority(
      await original.call(dashboardMealBuilderService, options)
    );
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  dashboardMealBuilderService.getSectionPicker = wrapped;
}

function wrapDashboardResultMethod(methodName) {
  const original = dashboardMealBuilderService[methodName];
  if (typeof original !== "function" || original[CARD_REPAIR_MARKER]) return;

  const wrapped = async function repairedDashboardCardResult(...args) {
    return sanitizeDashboardValue(
      await original.apply(dashboardMealBuilderService, args)
    );
  };
  Object.defineProperty(wrapped, CARD_REPAIR_MARKER, { value: true });
  dashboardMealBuilderService[methodName] = wrapped;
}

function wrapDashboardWriteMethod(methodName) {
  const original = dashboardMealBuilderService[methodName];
  if (typeof original !== "function" || original[CARD_REPAIR_MARKER]) return;

  const wrapped = async function repairedDashboardCardWrite(args = {}) {
    await repairWorkingDraft({
      sectionKey: args.sectionKey,
      actor: args.actor || {},
    });
    return sanitizeDashboardValue(
      await original.call(dashboardMealBuilderService, args)
    );
  };
  Object.defineProperty(wrapped, CARD_REPAIR_MARKER, { value: true });
  dashboardMealBuilderService[methodName] = wrapped;
}

function wrapDashboardSectionInputMethod(methodName, fieldName) {
  const original = dashboardMealBuilderService[methodName];
  if (typeof original !== "function" || original[CARD_REPAIR_MARKER]) return;

  const wrapped = async function repairedDashboardCardInput(args = {}) {
    const nextArgs = { ...args };
    if (fieldName === "section") {
      nextArgs.section = repairStoredSection(args.section || {});
    } else if (Array.isArray(args.sections)) {
      nextArgs.sections = repairSectionsForWrite(args.sections);
    }
    return sanitizeDashboardValue(
      await original.call(dashboardMealBuilderService, nextArgs)
    );
  };
  Object.defineProperty(wrapped, CARD_REPAIR_MARKER, { value: true });
  dashboardMealBuilderService[methodName] = wrapped;
}

function wrapPublishMethod() {
  const original = dashboardMealBuilderService.publishDraft;
  if (typeof original !== "function" || original[CARD_REPAIR_MARKER]) return;

  const wrapped = async function publishRepairedDashboardCards(args = {}) {
    await repairWorkingDraft({ actor: args.actor || {} });
    return sanitizeDashboardValue(
      await original.call(dashboardMealBuilderService, args)
    );
  };
  Object.defineProperty(wrapped, CARD_REPAIR_MARKER, { value: true });
  dashboardMealBuilderService.publishDraft = wrapped;
}

function wrapSerializeConfig() {
  const original = dashboardMealBuilderService.serializeConfig;
  if (typeof original !== "function" || original[CARD_REPAIR_MARKER]) return;

  const wrapped = function serializeRepairedDashboardCards(config) {
    return sanitizeDashboardValue(
      original.call(dashboardMealBuilderService, config)
    );
  };
  Object.defineProperty(wrapped, CARD_REPAIR_MARKER, { value: true });
  dashboardMealBuilderService.serializeConfig = wrapped;
}

function wrapDashboardCardClassification() {
  for (const methodName of [
    "getDashboardState",
    "openWorkingDraft",
    "resetDraftToPublished",
    "getHydratedDraft",
    "getReadinessReport",
    "buildPublishedContract",
    "addOptionsToSection",
    "removeOptionFromSection",
  ]) {
    wrapDashboardResultMethod(methodName);
  }

  for (const methodName of [
    "updateProductSection",
    "deleteProductSection",
    "addProductsToSection",
    "removeProductFromSection",
    "replaceSectionItems",
  ]) {
    wrapDashboardWriteMethod(methodName);
  }

  wrapDashboardSectionInputMethod("createProductSection", "section");
  for (const methodName of ["createDraft", "updateDraft", "validatePayload"]) {
    wrapDashboardSectionInputMethod(methodName, "sections");
  }
  wrapPublishMethod();
  wrapSerializeConfig();
}

function installDashboardDirectPickerClassificationGuard() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;

  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;

  try {
    wrapCompatibilityPicker();
    wrapFinalDashboardPicker();
    wrapDashboardCardClassification();

    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      classificationAuthority: AUTHORITY,
      preservesGenericStandaloneProducts: true,
      excludesNonMealAndBuilderProducts: true,
      staleDirectSystemManagedRepair: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error.code || "DASHBOARD_DIRECT_PICKER_CLASSIFICATION_GUARD_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installDashboardDirectPickerClassificationGuard();

module.exports = {
  CARD_TYPES,
  filterDirectCandidates,
  installDashboardDirectPickerClassificationGuard,
  isExplicitDirectSection,
  isIntrinsicPremiumSection,
  normalizeClassificationAuthority,
  repairStoredSection,
  resolvedCardType,
  sanitizeDashboardSection,
  sanitizeDashboardValue,
};
