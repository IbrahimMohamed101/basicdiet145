"use strict";

const canonicalService = require("./dashboardMealPlannerCanonicalService");

const DIRECT_PICKER_VERSION = "dashboard_meal_builder_picker.v1";
const DIRECT_ACTION_VERSION = "dashboard_meal_builder_card_action.v1";
const OPTION_ACTION_VERSION = "dashboard_meal_builder_card_action.v2";

function isOptionSection(section = {}) {
  return (
    section.cardType === "option_family" ||
    section.metadata?.cardType === "option_family" ||
    section.sectionType === "option_group" ||
    Boolean(section.productContextId && section.sourceGroupId)
  );
}

function compatibleAction(response) {
  if (!response || typeof response !== "object") return response;
  return {
    ...response,
    contractVersion: isOptionSection(response.section || {})
      ? OPTION_ACTION_VERSION
      : DIRECT_ACTION_VERSION,
  };
}

async function getSectionPicker(options = {}) {
  const response = await canonicalService.getSectionPicker(options);
  if (response?.candidateType !== "product") return response;
  return {
    ...response,
    contractVersion: DIRECT_PICKER_VERSION,
  };
}

async function createProductSection(args = {}) {
  return compatibleAction(await canonicalService.createProductSection(args));
}

async function updateProductSection(args = {}) {
  return compatibleAction(await canonicalService.updateProductSection(args));
}

async function deleteProductSection(args = {}) {
  return compatibleAction(await canonicalService.deleteProductSection(args));
}

async function replaceSectionItems(args = {}) {
  return compatibleAction(await canonicalService.replaceSectionItems(args));
}

async function addProductsToSection(args = {}) {
  return compatibleAction(await canonicalService.addProductsToSection(args));
}

async function removeProductFromSection(args = {}) {
  return compatibleAction(await canonicalService.removeProductFromSection(args));
}

async function addOptionsToSection(args = {}) {
  return compatibleAction(await canonicalService.addOptionsToSection(args));
}

async function removeOptionFromSection(args = {}) {
  return compatibleAction(await canonicalService.removeOptionFromSection(args));
}

module.exports = {
  ...canonicalService,
  addOptionsToSection,
  addProductsToSection,
  createProductSection,
  deleteProductSection,
  getSectionPicker,
  removeOptionFromSection,
  removeProductFromSection,
  replaceSectionItems,
  updateProductSection,
};
