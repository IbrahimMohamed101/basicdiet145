"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const { MEAL_SELECTION_TYPES } = require("../config/mealPlannerContract");
const baseService = require("./subscription/mealBuilderConfigService");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
const completeCatalogService = require("./subscription/dashboardMealBuilderCatalogService");
const CatalogService = require("./catalog/CatalogService");

const DIRECT_CARD_TYPE = "direct_product";
const OPTION_CARD_TYPE = "option_family";
const FULL_MEAL_SELECTION_TYPE = MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
const STANDARD_MEAL_SELECTION_TYPE = MEAL_SELECTION_TYPES.STANDARD_MEAL;
const LEGACY_SANDWICH_SELECTION_TYPE = MEAL_SELECTION_TYPES.SANDWICH;

let installed = false;

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sectionCardType(section = {}) {
  const explicit = token(section.cardType || section.metadata?.cardType);
  if (explicit) return explicit;
  const sectionType = token(section.sectionType || section.type);
  if (sectionType === "product_list") return DIRECT_CARD_TYPE;
  if (sectionType === "option_group" || sectionType === "option_family") {
    return OPTION_CARD_TYPE;
  }
  if (section.itemEntity === "MenuProduct" || section.completeByItself === true) {
    return DIRECT_CARD_TYPE;
  }
  return "";
}

function requestedCardType(section = {}) {
  const explicit = token(section.cardType || section.metadata?.cardType);
  if (explicit) return explicit;
  if (
    Array.isArray(section.selectedOptionIds) ||
    Array.isArray(section.optionIds) ||
    section.productContextId ||
    section.sourceGroupId ||
    section.optionRole
  ) {
    return OPTION_CARD_TYPE;
  }
  return DIRECT_CARD_TYPE;
}

function canonicalDirectSelectionType(value) {
  const selectionType = token(value);
  return selectionType === LEGACY_SANDWICH_SELECTION_TYPE
    ? FULL_MEAL_SELECTION_TYPE
    : selectionType || value;
}

function canonicalizeSelectionTypesDeep(value) {
  if (Array.isArray(value)) return value.map(canonicalizeSelectionTypesDeep);
  if (!isPlainObject(value)) return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      (key === "selectionType" || key === "directSelectionType") &&
      token(entry) === LEGACY_SANDWICH_SELECTION_TYPE
    ) {
      output[key] = FULL_MEAL_SELECTION_TYPE;
    } else {
      output[key] = canonicalizeSelectionTypesDeep(entry);
    }
  }
  return output;
}

function canonicalizeSection(section = {}) {
  if (!isPlainObject(section)) return section;
  const canonical = canonicalizeSelectionTypesDeep(section);
  if (sectionCardType(canonical) !== DIRECT_CARD_TYPE) return canonical;
  return {
    ...canonical,
    selectionType: canonicalDirectSelectionType(canonical.selectionType),
    metadata: {
      ...(canonical.metadata || {}),
      cardType: DIRECT_CARD_TYPE,
      requiresBuilder: false,
      treatAsFullMeal: true,
      cardKind: FULL_MEAL_SELECTION_TYPE,
    },
  };
}

function canonicalizeConfig(config) {
  if (!isPlainObject(config)) return config;
  const canonical = canonicalizeSelectionTypesDeep(config);
  return {
    ...canonical,
    sections: Array.isArray(canonical.sections)
      ? canonical.sections.map(canonicalizeSection)
      : canonical.sections,
  };
}

function canonicalCardContract(contract = {}) {
  const next = canonicalizeSelectionTypesDeep(contract || {});
  return {
    ...next,
    canonicalSelectionTypes: {
      directProduct: FULL_MEAL_SELECTION_TYPE,
      optionMeal: STANDARD_MEAL_SELECTION_TYPE,
      deprecatedAliases: [LEGACY_SANDWICH_SELECTION_TYPE],
    },
    dynamicCardTypes: (next.dynamicCardTypes || []).map((entry) =>
      entry.cardType === DIRECT_CARD_TYPE
        ? {
            ...entry,
            allowedSelectionTypes: [FULL_MEAL_SELECTION_TYPE],
            deprecatedSelectionTypes: [LEGACY_SANDWICH_SELECTION_TYPE],
            legacyInputPolicy: "normalize_to_full_meal_product",
          }
        : entry
    ),
  };
}

function canonicalPicker(picker = {}) {
  const next = canonicalizeSelectionTypesDeep(picker || {});
  if (next.candidateType !== "product") return next;
  return {
    ...next,
    rules: {
      ...(next.rules || {}),
      allowedSelectionTypes: [FULL_MEAL_SELECTION_TYPE],
      deprecatedSelectionTypes: [LEGACY_SANDWICH_SELECTION_TYPE],
      canonicalSelectionType: FULL_MEAL_SELECTION_TYPE,
      legacyInputPolicy: "normalize_to_full_meal_product",
    },
    candidates: (next.candidates || []).map((candidate) => ({
      ...candidate,
      selectionType: FULL_MEAL_SELECTION_TYPE,
    })),
  };
}

function canonicalResult(result) {
  if (!isPlainObject(result)) return result;
  const next = canonicalizeSelectionTypesDeep(result);
  if (next.section) next.section = canonicalizeSection(next.section);
  if (next.draft) next.draft = canonicalizeConfig(next.draft);
  if (next.published) next.published = canonicalizeConfig(next.published);
  if (next.cardContract) next.cardContract = canonicalCardContract(next.cardContract);
  return next;
}

function canonicalSectionsForWrite(sections = []) {
  if (!Array.isArray(sections)) return sections;
  return sections.map((section) =>
    sectionCardType(section) === DIRECT_CARD_TYPE
      ? canonicalizeSection(section)
      : section
  );
}

function hasLegacyDirectSection(sections = []) {
  return (sections || []).some(
    (section) =>
      sectionCardType(section) === DIRECT_CARD_TYPE &&
      token(section.selectionType) === LEGACY_SANDWICH_SELECTION_TYPE
  );
}

async function migrateCurrentDraft(actor = {}) {
  const draft = await MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
    .sort({ updatedAt: -1 })
    .lean();
  if (!draft || !hasLegacyDirectSection(draft.sections || [])) return null;
  return baseService.updateDraft({
    sections: canonicalSectionsForWrite(draft.sections || []),
    notes: draft.notes,
    actor,
  });
}

function directWriteSection(section = {}) {
  if (requestedCardType(section) !== DIRECT_CARD_TYPE) return section;
  if (token(section.selectionType) !== LEGACY_SANDWICH_SELECTION_TYPE) {
    return section;
  }
  return { ...section, selectionType: FULL_MEAL_SELECTION_TYPE };
}

function wrapResultMethod(methodName) {
  const original = mealBuilderService[methodName];
  if (typeof original !== "function" || original.__twoTypePolicy === true) return;
  const wrapped = async function twoTypeResult(args = {}) {
    return canonicalResult(await original.call(mealBuilderService, args));
  };
  wrapped.__twoTypePolicy = true;
  mealBuilderService[methodName] = wrapped;
}

function installDashboardMealPlannerTwoTypePolicy() {
  if (installed) return;
  installed = true;

  const originalCreateSection = mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalUpdateSection = mealBuilderService.updateProductSection.bind(mealBuilderService);
  const originalCreateDraft = mealBuilderService.createDraft.bind(mealBuilderService);
  const originalUpdateDraft = mealBuilderService.updateDraft.bind(mealBuilderService);
  const originalValidate = mealBuilderService.validatePayload.bind(mealBuilderService);
  const originalPublish = mealBuilderService.publishDraft.bind(mealBuilderService);
  const originalGetState = mealBuilderService.getDashboardState.bind(mealBuilderService);
  const originalSerialize = mealBuilderService.serializeConfig.bind(mealBuilderService);
  const originalCardContract = mealBuilderService.getCardContract.bind(mealBuilderService);
  const originalDirectPicker = mealBuilderService.getDirectProductPicker.bind(mealBuilderService);
  const originalSectionPicker = mealBuilderService.getSectionPicker.bind(mealBuilderService);
  const originalCompleteCatalog = completeCatalogService.getCompleteCatalog.bind(completeCatalogService);
  const originalPublicCatalog = CatalogService.getSubscriptionBuilderCatalogWithV2.bind(CatalogService);

  mealBuilderService.createProductSection = async function createTwoTypeCard(args = {}) {
    return canonicalResult(
      await originalCreateSection({
        ...args,
        section: directWriteSection(args.section || {}),
      })
    );
  };

  mealBuilderService.updateProductSection = async function updateTwoTypeCard(args = {}) {
    const patch = { ...(args.patch || {}) };
    if (token(patch.selectionType) === LEGACY_SANDWICH_SELECTION_TYPE) {
      patch.selectionType = FULL_MEAL_SELECTION_TYPE;
    }
    return canonicalResult(await originalUpdateSection({ ...args, patch }));
  };

  mealBuilderService.createDraft = async function createTwoTypeDraft(args = {}) {
    const sections = Array.isArray(args.sections)
      ? canonicalSectionsForWrite(args.sections)
      : args.sections;
    return canonicalResult(await originalCreateDraft({ ...args, sections }));
  };

  mealBuilderService.updateDraft = async function updateTwoTypeDraft(args = {}) {
    const sections = Array.isArray(args.sections)
      ? canonicalSectionsForWrite(args.sections)
      : args.sections;
    return canonicalResult(await originalUpdateDraft({ ...args, sections }));
  };

  mealBuilderService.validatePayload = async function validateTwoTypes(payload = {}) {
    const sections = Array.isArray(payload.sections)
      ? canonicalSectionsForWrite(payload.sections)
      : payload.sections;
    return canonicalResult(await originalValidate({ ...payload, sections }));
  };

  mealBuilderService.publishDraft = async function publishTwoTypes(args = {}) {
    await migrateCurrentDraft(args.actor || {});
    return canonicalResult(await originalPublish(args));
  };

  mealBuilderService.getDashboardState = async function getTwoTypeState(options = {}) {
    const state = canonicalResult(await originalGetState(options));
    return {
      ...state,
      cardContract: canonicalCardContract(state.cardContract || originalCardContract()),
    };
  };

  mealBuilderService.serializeConfig = function serializeTwoTypes(config) {
    return canonicalizeConfig(originalSerialize(config));
  };

  mealBuilderService.getCardContract = function getTwoTypeContract() {
    return canonicalCardContract(originalCardContract());
  };

  mealBuilderService.getDirectProductPicker = async function getTwoTypeDirectPicker(options = {}) {
    return canonicalPicker(await originalDirectPicker(options));
  };

  mealBuilderService.getSectionPicker = async function getTwoTypePicker(options = {}) {
    return canonicalPicker(await originalSectionPicker(options));
  };

  completeCatalogService.getCompleteCatalog = async function getTwoTypeCatalog(options = {}) {
    const catalog = canonicalResult(await originalCompleteCatalog(options));
    return {
      ...catalog,
      cardContract: canonicalCardContract(catalog.cardContract || originalCardContract()),
    };
  };

  CatalogService.getSubscriptionBuilderCatalogWithV2 = async function getTwoTypePublicCatalog(options = {}) {
    return canonicalizeSelectionTypesDeep(await originalPublicCatalog(options));
  };

  for (const methodName of [
    "openWorkingDraft",
    "resetDraftToPublished",
    "getHydratedDraft",
    "addProductsToSection",
    "removeProductFromSection",
    "replaceSectionItems",
    "addOptionsToSection",
    "removeOptionFromSection",
    "deleteProductSection",
    "getReadinessReport",
  ]) {
    wrapResultMethod(methodName);
  }
}

installDashboardMealPlannerTwoTypePolicy();

module.exports = {
  FULL_MEAL_SELECTION_TYPE,
  LEGACY_SANDWICH_SELECTION_TYPE,
  STANDARD_MEAL_SELECTION_TYPE,
  canonicalDirectSelectionType,
  canonicalizeSelectionTypesDeep,
  installDashboardMealPlannerTwoTypePolicy,
};
