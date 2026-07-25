"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const baseService = require("./subscription/mealBuilderConfigService");
const compatibilityService = require("./subscription/dashboardMealPlannerCompatibilityService");
const canonicalService = require("./subscription/dashboardMealPlannerCanonicalService");
const dashboardService = require("./subscription/dashboardMealPlannerDashboardService");
const dashboardCatalogService = require("./subscription/dashboardMealBuilderAuthoringContractService");
const CatalogService = require("./catalog/CatalogService");
const {
  isPremiumSection,
  isRetiredLegacySandwichSection,
  sanitizeConfig,
  sanitizePayload,
  sanitizeSections,
  sectionKey,
} = require("./subscription/retiredLegacySandwichPolicy");

const ACTION_VERSION = "dashboard_meal_builder_card_action.v2";
const WRAPPER_MARK = "__retiredLegacySandwichCard";
let installed = false;

function selectedProductCount(sections = []) {
  return (sections || []).reduce(
    (total, section) =>
      total +
      (Array.isArray(section.selectedProductIds)
        ? section.selectedProductIds.length
        : Array.isArray(section.productIds)
          ? section.productIds.length
          : 0),
    0
  );
}

function selectedOptionCount(sections = []) {
  return (sections || []).reduce(
    (total, section) =>
      total +
      (Array.isArray(section.selectedOptionIds)
        ? section.selectedOptionIds.length
        : Array.isArray(section.optionIds)
          ? section.optionIds.length
          : 0),
    0
  );
}

function normalizedForWrite(sections = []) {
  return baseService.normalizeSections(sanitizeSections(sections || []));
}

function sameSections(left = [], right = []) {
  return (
    JSON.stringify(baseService.normalizeSections(left || [])) ===
    JSON.stringify(right || [])
  );
}

async function currentDraft() {
  return MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
    .sort({ updatedAt: -1 })
    .lean();
}

async function persistSanitizedCurrentDraft({ actor = {}, createIfMissing = false } = {}) {
  let draft = await currentDraft();
  if (!draft && createIfMissing) {
    await baseService.createDraft({ actor });
    draft = await currentDraft();
  }
  if (!draft) return null;

  const nextSections = normalizedForWrite(draft.sections || []);
  if (sameSections(draft.sections || [], nextSections)) {
    return sanitizeConfig(baseService.serializeConfig(draft));
  }

  return sanitizeConfig(
    await baseService.updateDraft({
      sections: nextSections,
      notes: draft.notes,
      actor,
    })
  );
}

function deleteResponse({ draft, validation, targetKey }) {
  const sections = draft?.sections || [];
  return {
    contractVersion: ACTION_VERSION,
    action: "deleted",
    sectionKey: null,
    previousSectionKey: targetKey,
    itemId: null,
    section: null,
    draft,
    validation,
    summary: {
      sectionCount: sections.length,
      selectedProductCount: selectedProductCount(sections),
      selectedOptionCount: selectedOptionCount(sections),
      ready: validation.ready === true,
      errorCount: (validation.errors || []).length,
      warningCount: (validation.warnings || []).length,
    },
  };
}

async function deleteEditableCard({
  sectionKey: requestedSectionKey,
  actor = {},
  originalDelete,
  originalValidate,
} = {}) {
  const targetKey = sectionKey({ key: requestedSectionKey });
  let draft = await currentDraft();
  if (!draft) {
    await baseService.createDraft({ actor });
    draft = await currentDraft();
  }

  if (!draft) {
    return sanitizePayload(
      await originalDelete({ sectionKey: requestedSectionKey, actor })
    );
  }

  const sourceSections = baseService.normalizeSections(draft.sections || []);
  const target = sourceSections.find((section) => sectionKey(section) === targetKey);

  if (!target) {
    if (targetKey === "sandwich") {
      const cleanedDraft =
        (await persistSanitizedCurrentDraft({ actor })) ||
        sanitizeConfig(baseService.serializeConfig(draft));
      const validation = await originalValidate({
        sections: cleanedDraft.sections || [],
      });
      return deleteResponse({ draft: cleanedDraft, validation, targetKey });
    }
    return sanitizePayload(
      await originalDelete({ sectionKey: requestedSectionKey, actor })
    );
  }

  if (isPremiumSection(target)) {
    return sanitizePayload(
      await originalDelete({ sectionKey: requestedSectionKey, actor })
    );
  }

  const staleLockedCard =
    target.systemManaged === true ||
    target.metadata?.systemManaged === true ||
    target.cardType === "system_premium" ||
    target.metadata?.cardType === "system_premium";

  if (!isRetiredLegacySandwichSection(target) && !staleLockedCard) {
    return sanitizePayload(
      await originalDelete({ sectionKey: requestedSectionKey, actor })
    );
  }

  const nextSections = normalizedForWrite(sourceSections).filter(
    (section) => sectionKey(section) !== targetKey
  );
  const updated = sanitizeConfig(
    await baseService.updateDraft({
      sections: nextSections,
      notes: draft.notes,
      actor,
    })
  );
  const validation = await originalValidate({
    sections: updated.sections || [],
  });
  return deleteResponse({ draft: updated, validation, targetKey });
}

function mark(wrapped, original) {
  Object.defineProperty(wrapped, WRAPPER_MARK, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  return wrapped;
}

function wrapAsyncOutput(target, methodName) {
  const original = target[methodName];
  if (typeof original !== "function" || original[WRAPPER_MARK] === true) return;
  target[methodName] = mark(
    async function retiredLegacySandwichOutput(...args) {
      return sanitizePayload(await original.apply(target, args));
    },
    original
  );
}

function wrapPreWriteOutput(target, methodName) {
  const original = target[methodName];
  if (typeof original !== "function" || original[WRAPPER_MARK] === true) return;
  target[methodName] = mark(
    async function retiredLegacySandwichWrite(args = {}) {
      await persistSanitizedCurrentDraft({ actor: args.actor || {} });
      return sanitizePayload(await original.call(target, args));
    },
    original
  );
}

function installBoundary(target) {
  if (!target || typeof target !== "object") return;

  const originalCreateDraft = target.createDraft;
  if (
    typeof originalCreateDraft === "function" &&
    originalCreateDraft[WRAPPER_MARK] !== true
  ) {
    target.createDraft = mark(
      async function createWithoutLegacySandwich(args = {}) {
        const nextArgs = Array.isArray(args.sections)
          ? { ...args, sections: normalizedForWrite(args.sections) }
          : args;
        const result = await originalCreateDraft.call(target, nextArgs);
        const persisted = await persistSanitizedCurrentDraft({
          actor: args.actor || {},
        });
        return sanitizePayload(persisted || result);
      },
      originalCreateDraft
    );
  }

  const originalOpenWorkingDraft = target.openWorkingDraft;
  if (
    typeof originalOpenWorkingDraft === "function" &&
    originalOpenWorkingDraft[WRAPPER_MARK] !== true
  ) {
    target.openWorkingDraft = mark(
      async function openWithoutLegacySandwich(args = {}) {
        const result = await originalOpenWorkingDraft.call(target, args);
        const persisted = await persistSanitizedCurrentDraft({
          actor: args.actor || {},
        });
        return sanitizePayload(persisted || result);
      },
      originalOpenWorkingDraft
    );
  }

  const originalResetDraft = target.resetDraftToPublished;
  if (
    typeof originalResetDraft === "function" &&
    originalResetDraft[WRAPPER_MARK] !== true
  ) {
    target.resetDraftToPublished = mark(
      async function resetWithoutLegacySandwich(args = {}) {
        const result = await originalResetDraft.call(target, args);
        const persisted = await persistSanitizedCurrentDraft({
          actor: args.actor || {},
        });
        return sanitizePayload(persisted || result);
      },
      originalResetDraft
    );
  }

  const originalUpdateDraft = target.updateDraft;
  if (
    typeof originalUpdateDraft === "function" &&
    originalUpdateDraft[WRAPPER_MARK] !== true
  ) {
    target.updateDraft = mark(
      async function updateWithoutLegacySandwich(args = {}) {
        const nextArgs = Array.isArray(args.sections)
          ? { ...args, sections: normalizedForWrite(args.sections) }
          : args;
        return sanitizePayload(await originalUpdateDraft.call(target, nextArgs));
      },
      originalUpdateDraft
    );
  }

  const originalValidate = target.validatePayload;
  if (
    typeof originalValidate === "function" &&
    originalValidate[WRAPPER_MARK] !== true
  ) {
    target.validatePayload = mark(
      async function validateWithoutLegacySandwich(args = {}) {
        const nextArgs = Array.isArray(args.sections)
          ? { ...args, sections: normalizedForWrite(args.sections) }
          : args;
        return sanitizePayload(await originalValidate.call(target, nextArgs));
      },
      originalValidate
    );
  }

  const originalPublishDraft = target.publishDraft;
  if (
    typeof originalPublishDraft === "function" &&
    originalPublishDraft[WRAPPER_MARK] !== true
  ) {
    target.publishDraft = mark(
      async function publishWithoutLegacySandwich(args = {}) {
        await persistSanitizedCurrentDraft({ actor: args.actor || {} });
        return sanitizePayload(await originalPublishDraft.call(target, args));
      },
      originalPublishDraft
    );
  }

  const originalDelete = target.deleteProductSection;
  if (
    typeof originalDelete === "function" &&
    originalDelete[WRAPPER_MARK] !== true
  ) {
    const validationMethod =
      typeof target.validatePayload === "function"
        ? target.validatePayload.bind(target)
        : baseService.validatePayload.bind(baseService);
    target.deleteProductSection = mark(
      async function deleteAnyEditableCard(args = {}) {
        return deleteEditableCard({
          ...args,
          originalDelete: originalDelete.bind(target),
          originalValidate: validationMethod,
        });
      },
      originalDelete
    );
  }

  const originalSerialize = target.serializeConfig;
  if (
    typeof originalSerialize === "function" &&
    originalSerialize[WRAPPER_MARK] !== true
  ) {
    target.serializeConfig = mark(
      function serializeWithoutLegacySandwich(config) {
        return sanitizeConfig(originalSerialize.call(target, config));
      },
      originalSerialize
    );
  }

  for (const methodName of [
    "getDashboardState",
    "getHydratedDraft",
    "getReadinessReport",
    "getSectionPicker",
    "getDirectProductPicker",
    "buildPlannerCatalogFromPublishedBuilder",
    "buildPublishedContract",
  ]) {
    wrapAsyncOutput(target, methodName);
  }

  for (const methodName of [
    "updateProductSection",
    "addProductsToSection",
    "removeProductFromSection",
    "replaceSectionItems",
    "addOptionsToSection",
    "removeOptionFromSection",
  ]) {
    wrapPreWriteOutput(target, methodName);
  }

  wrapAsyncOutput(target, "createProductSection");
}

function installRetiredLegacySandwichCard() {
  if (installed) return;
  installed = true;

  // The dashboard controller imports dashboardService, while older endpoints and
  // internal helpers still call canonical/compatibility services directly. Apply
  // the same retirement invariant at every final boundary.
  installBoundary(compatibilityService);
  installBoundary(canonicalService);
  installBoundary(dashboardService);
  wrapAsyncOutput(dashboardCatalogService, "getCompleteCatalog");

  const originalPublicCatalog = CatalogService.getSubscriptionBuilderCatalogWithV2;
  if (
    typeof originalPublicCatalog === "function" &&
    originalPublicCatalog[WRAPPER_MARK] !== true
  ) {
    CatalogService.getSubscriptionBuilderCatalogWithV2 = mark(
      async function publicCatalogWithoutLegacySandwich(options = {}) {
        return sanitizePayload(
          await originalPublicCatalog.call(CatalogService, options)
        );
      },
      originalPublicCatalog
    );
  }
}

installRetiredLegacySandwichCard();

module.exports = {
  deleteEditableCard,
  installBoundary,
  installRetiredLegacySandwichCard,
  persistSanitizedCurrentDraft,
};
