"use strict";

const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
const { MEAL_SELECTION_TYPES } = require("../config/mealPlannerContract");

const DIRECT_CARD_TYPE = "direct_product";
const DIRECT_SECTION_TYPE = "product_list";
const CANONICAL_DIRECT_TYPE = MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
const LEGACY_DIRECT_TYPE = MEAL_SELECTION_TYPES.SANDWICH;
let installed = false;

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isDirectSection(section = {}) {
  const cardType = token(section.cardType || section.metadata?.cardType);
  const sectionType = token(section.sectionType || section.type);
  if (cardType) return cardType === DIRECT_CARD_TYPE;
  if (sectionType) return sectionType === DIRECT_SECTION_TYPE;
  return (
    Array.isArray(section.selectedProductIds) ||
    Array.isArray(section.productIds)
  );
}

function canonicalDirectSection(section = {}) {
  if (!isDirectSection(section)) return section;
  const selectionType = token(section.selectionType);
  if (selectionType && selectionType !== LEGACY_DIRECT_TYPE) return section;
  return {
    ...section,
    selectionType: CANONICAL_DIRECT_TYPE,
  };
}

function canonicalSections(sections) {
  return Array.isArray(sections)
    ? sections.map(canonicalDirectSection)
    : sections;
}

function installCanonicalDirectSelectionDefault() {
  if (installed) return;
  installed = true;

  const originalCreateSection =
    mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalUpdateSection =
    mealBuilderService.updateProductSection.bind(mealBuilderService);
  const originalCreateDraft =
    mealBuilderService.createDraft.bind(mealBuilderService);
  const originalUpdateDraft =
    mealBuilderService.updateDraft.bind(mealBuilderService);
  const originalValidate =
    mealBuilderService.validatePayload.bind(mealBuilderService);

  mealBuilderService.createProductSection = (args = {}) =>
    originalCreateSection({
      ...args,
      section: canonicalDirectSection(args.section || {}),
    });

  mealBuilderService.updateProductSection = (args = {}) => {
    const patch = args.patch || {};
    const normalizedPatch =
      Object.prototype.hasOwnProperty.call(patch, "selectionType") &&
      !token(patch.selectionType)
        ? { ...patch, selectionType: CANONICAL_DIRECT_TYPE }
        : patch;
    return originalUpdateSection({ ...args, patch: normalizedPatch });
  };

  mealBuilderService.createDraft = (args = {}) =>
    originalCreateDraft({
      ...args,
      sections: canonicalSections(args.sections),
    });

  mealBuilderService.updateDraft = (args = {}) =>
    originalUpdateDraft({
      ...args,
      sections: canonicalSections(args.sections),
    });

  mealBuilderService.validatePayload = (payload = {}) =>
    originalValidate({
      ...payload,
      sections: canonicalSections(payload.sections),
    });
}

installCanonicalDirectSelectionDefault();

module.exports = {
  CANONICAL_DIRECT_TYPE,
  canonicalDirectSection,
  installCanonicalDirectSelectionDefault,
};
