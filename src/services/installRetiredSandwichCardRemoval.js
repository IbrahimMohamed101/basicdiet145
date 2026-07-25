"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const baseService = require("./subscription/mealBuilderConfigService");
const dashboardService = require("./subscription/dashboardMealPlannerDashboardService");
const CatalogService = require("./catalog/CatalogService");

const RETIRED_SECTION_KEY = "sandwich";
const WRAP_MARK = "__retiredSandwichCardRemoval";
let installed = false;

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function metadataOf(section = {}) {
  return isPlainObject(section.metadata) ? section.metadata : {};
}

function isExplicitDashboardCard(section = {}) {
  const metadata = metadataOf(section);
  return (
    metadata.configuredExplicitly === true ||
    token(metadata.configuredBy) === "dashboard_user"
  );
}

function hasHistoricalFixedMarker(section = {}) {
  const metadata = metadataOf(section);
  return (
    section.systemManaged === true ||
    metadata.systemManaged === true ||
    token(section.cardType) === "system_premium" ||
    token(metadata.cardType) === "system_premium"
  );
}

function isRetiredSandwichSection(section = {}) {
  if (sectionKey(section) !== RETIRED_SECTION_KEY) return false;
  // Remove the historical bootstrap/fixed card. A future card explicitly created
  // from the Dashboard may reuse the same key and remains an ordinary card.
  return hasHistoricalFixedMarker(section) || !isExplicitDashboardCard(section);
}

function removeRetiredSections(sections = []) {
  if (!Array.isArray(sections)) return sections;
  return sections.filter((section) => !isRetiredSandwichSection(section));
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isPlainObject(value)) return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "sections" && Array.isArray(entry)) {
      output[key] = removeRetiredSections(entry).map(sanitizeValue);
      continue;
    }
    // The legacy catalog mirror is opt-in only, but it must not resurrect the
    // removed historical sandwiches while a replacement card is being authored.
    if (key === "sandwiches" && Array.isArray(entry)) {
      output[key] = [];
      continue;
    }
    output[key] = sanitizeValue(entry);
  }
  return output;
}

async function currentDraft() {
  return MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
    .sort({ updatedAt: -1 })
    .lean();
}

async function persistRetiredCardRemoval({ actor = {} } = {}) {
  const draft = await currentDraft();
  if (!draft) return null;

  const currentSections = Array.isArray(draft.sections) ? draft.sections : [];
  const nextSections = removeRetiredSections(currentSections);
  if (nextSections.length === currentSections.length) return null;

  return baseService.updateDraft({
    sections: nextSections,
    notes: draft.notes,
    actor,
  });
}

function mark(wrapped, original) {
  Object.defineProperty(wrapped, WRAP_MARK, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  return wrapped;
}

function wrapRead(methodName, { persistDraft = false } = {}) {
  const original = dashboardService[methodName];
  if (typeof original !== "function" || original[WRAP_MARK]) return;

  dashboardService[methodName] = mark(
    async function retiredSandwichRead(args = {}) {
      if (persistDraft) {
        await persistRetiredCardRemoval({ actor: args.actor || {} });
      }
      return sanitizeValue(await original.call(dashboardService, args));
    },
    original
  );
}

function wrapSectionsInput(methodName) {
  const original = dashboardService[methodName];
  if (typeof original !== "function" || original[WRAP_MARK]) return;

  dashboardService[methodName] = mark(
    async function retiredSandwichSectionsInput(args = {}) {
      const nextArgs = Array.isArray(args.sections)
        ? { ...args, sections: removeRetiredSections(args.sections) }
        : args;
      return sanitizeValue(await original.call(dashboardService, nextArgs));
    },
    original
  );
}

function wrapDraftCreation(methodName) {
  const original = dashboardService[methodName];
  if (typeof original !== "function" || original[WRAP_MARK]) return;

  dashboardService[methodName] = mark(
    async function retiredSandwichDraftCreation(args = {}) {
      const result = await original.call(dashboardService, args);
      const cleaned = await persistRetiredCardRemoval({ actor: args.actor || {} });
      return sanitizeValue(cleaned || result);
    },
    original
  );
}

function wrapWrite(methodName) {
  const original = dashboardService[methodName];
  if (typeof original !== "function" || original[WRAP_MARK]) return;

  dashboardService[methodName] = mark(
    async function retiredSandwichWrite(args = {}) {
      await persistRetiredCardRemoval({ actor: args.actor || {} });
      return sanitizeValue(await original.call(dashboardService, args));
    },
    original
  );
}

function wrapPublish() {
  const original = dashboardService.publishDraft;
  if (typeof original !== "function" || original[WRAP_MARK]) return;

  dashboardService.publishDraft = mark(
    async function publishWithoutRetiredSandwich(args = {}) {
      await persistRetiredCardRemoval({ actor: args.actor || {} });
      return sanitizeValue(await original.call(dashboardService, args));
    },
    original
  );
}

function wrapPublicCatalog() {
  const original = CatalogService.getSubscriptionBuilderCatalogWithV2;
  if (typeof original !== "function" || original[WRAP_MARK]) return;

  CatalogService.getSubscriptionBuilderCatalogWithV2 = mark(
    async function catalogWithoutRetiredSandwich(options = {}) {
      return sanitizeValue(await original.call(CatalogService, options));
    },
    original
  );
}

function installRetiredSandwichCardRemoval() {
  if (installed) return;
  installed = true;

  for (const methodName of ["createDraft", "updateDraft", "validatePayload"]) {
    wrapSectionsInput(methodName);
  }
  for (const methodName of ["openWorkingDraft", "resetDraftToPublished"]) {
    wrapDraftCreation(methodName);
  }
  for (const methodName of [
    "getDashboardState",
    "getHydratedDraft",
    "getReadinessReport",
  ]) {
    wrapRead(methodName, { persistDraft: true });
  }
  for (const methodName of [
    "buildPublishedContract",
    "buildPlannerCatalogFromPublishedBuilder",
    "getSectionPicker",
    "getDirectProductPicker",
  ]) {
    wrapRead(methodName);
  }
  for (const methodName of [
    "createProductSection",
    "updateProductSection",
    "deleteProductSection",
    "addProductsToSection",
    "removeProductFromSection",
    "replaceSectionItems",
    "addOptionsToSection",
    "removeOptionFromSection",
  ]) {
    wrapWrite(methodName);
  }
  wrapPublish();
  wrapPublicCatalog();
}

installRetiredSandwichCardRemoval();

module.exports = {
  RETIRED_SECTION_KEY,
  hasHistoricalFixedMarker,
  installRetiredSandwichCardRemoval,
  isExplicitDashboardCard,
  isRetiredSandwichSection,
  persistRetiredCardRemoval,
  removeRetiredSections,
  sanitizeValue,
};
