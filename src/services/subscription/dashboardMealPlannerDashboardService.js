"use strict";

const canonicalService = require("./dashboardMealPlannerCanonicalService");
const cardFacade = require("./dashboardMealPlannerCardFacadeService");
const CatalogService = require("../catalog/CatalogService");

const DIRECT_PICKER_VERSION = "dashboard_meal_builder_picker.v1";
const DIRECT_ACTION_VERSION = "dashboard_meal_builder_card_action.v1";
const OPTION_ACTION_VERSION = "dashboard_meal_builder_card_action.v2";
const DIRECT_SELECTION_TYPE = "full_meal_product";
const MAX_PICKER_LIMIT = 1000;

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(
    MAX_PICKER_LIMIT,
    Math.max(1, Number.parseInt(limit || "100", 10) || 100)
  );
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

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

function directPublicSection(section = {}) {
  const items = [
    ...(Array.isArray(section.products) ? section.products : []),
    ...(Array.isArray(section.items) ? section.items : []),
  ];
  return items.some(
    (item) =>
      item?.type === "product" &&
      (item.selectionType === DIRECT_SELECTION_TYPE ||
        item.action?.type === "direct_add" ||
        item.action?.treatAsFullMeal === true)
  );
}

function decoratePublicSections(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decoratePublicSections);
  const output = { ...value };
  if (Array.isArray(output.sections)) {
    output.sections = output.sections.map((section) => {
      const decorated = decoratePublicSections(section);
      return directPublicSection(decorated)
        ? { ...decorated, selectionType: DIRECT_SELECTION_TYPE }
        : decorated;
    });
  }
  for (const key of ["plannerCatalog", "builderCatalog", "contract"]) {
    if (output[key] && typeof output[key] === "object") {
      output[key] = decoratePublicSections(output[key]);
    }
  }
  return output;
}

function installPublicSectionSelectionType() {
  const original = CatalogService.getSubscriptionBuilderCatalogWithV2;
  if (
    typeof original !== "function" ||
    original.__dashboardSectionSelectionType === true
  ) {
    return;
  }
  const wrapped = async function dashboardSectionSelectionType(options = {}) {
    return decoratePublicSections(await original.call(CatalogService, options));
  };
  wrapped.__dashboardSectionSelectionType = true;
  CatalogService.getSubscriptionBuilderCatalogWithV2 = wrapped;
}

installPublicSectionSelectionType();

async function getDirectPicker(options = {}) {
  const pagination = normalizePagination(options);
  const includeUnavailable = normalizeBoolean(options.includeUnavailable, false);
  const unassignedOnly = normalizeBoolean(options.unassignedOnly, true);
  const complete = await canonicalService.getSectionPicker({
    ...options,
    includeUnavailable: true,
    unassignedOnly: false,
    page: 1,
    limit: MAX_PICKER_LIMIT,
  });
  const catalogRows = (complete.candidates || []).filter(
    (candidate) =>
      candidate.selected || includeUnavailable || candidate.available !== false
  );
  const rows = unassignedOnly
    ? catalogRows.filter(
        (candidate) => candidate.selected || candidate.assignable === true
      )
    : catalogRows;
  const total = rows.length;
  const candidates = rows.slice(
    pagination.skip,
    pagination.skip + pagination.limit
  );
  return {
    ...complete,
    contractVersion: DIRECT_PICKER_VERSION,
    candidates,
    rules: {
      ...(complete.rules || {}),
      excludeProductsAssignedToOtherCards: unassignedOnly,
    },
    meta: {
      ...(complete.meta || {}),
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      catalogTotal: catalogRows.length,
      selectedInCurrentCard: catalogRows.filter((row) => row.selected).length,
      assignedToOtherCards: catalogRows.filter(
        (row) => row.state === "assigned_elsewhere"
      ).length,
      unassigned: catalogRows.filter((row) => row.state === "eligible").length,
      unavailable: catalogRows.filter((row) => row.state === "unavailable").length,
    },
  };
}

async function getSectionPicker(options = {}) {
  const sectionKey = String(options.sectionKey || "").trim().toLowerCase();
  if (sectionKey === "products" || sectionKey === "sandwich") {
    return getDirectPicker(options);
  }
  const response = await canonicalService.getSectionPicker(options);
  if (response?.candidateType !== "product") return response;
  return getDirectPicker(options);
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

async function createDraft(args = {}) {
  return cardFacade.createDraft(args);
}

async function updateDraft(args = {}) {
  return cardFacade.updateDraft(args);
}

async function validatePayload(args = {}) {
  return cardFacade.validatePayload(args);
}

async function publishDraft(args = {}) {
  return cardFacade.publishDraft(args);
}

module.exports = {
  ...canonicalService,
  addOptionsToSection,
  addProductsToSection,
  createDraft,
  createProductSection,
  deleteProductSection,
  getSectionPicker,
  publishDraft,
  removeOptionFromSection,
  removeProductFromSection,
  replaceSectionItems,
  updateDraft,
  updateProductSection,
  validatePayload,
};
