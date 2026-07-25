"use strict";

const MealBuilderConfig = require("../models/MealBuilderConfig");
const baseService = require("./subscription/mealBuilderConfigService");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");
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
  return JSON.stringify(baseService.normalizeSections(left || [])) === JSON.stringify(right || []);
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
    // The retired card is intentionally idempotent: repeated delete requests after
    // cleanup should still return the current draft instead of reviving the card.
    if (targetKey === "sandwich") {
      const cleanedDraft = await persistSanitizedCurrentDraft({ actor });
      const sections = cleanedDraft?.sections || [];
      const validation = await originalValidate({ sections });
      return {
        contractVersion: ACTION_VERSION,
        action: "deleted",
        sectionKey: null,
        previousSectionKey: targetKey,
        itemId: null,
        section: null,
        draft: cleanedDraft,
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
  const validation = await originalValidate({ sections: updated.sections || [] });
  const sections = updated.sections || [];

  return {
    contractVersion: ACTION_VERSION,
    action: "deleted",
    sectionKey: null,
    previousSectionKey: targetKey,
    itemId: null,
    section: null,
    draft: updated,
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

function wrapAsyncOutput(target, methodName) {
  const original = target[methodName];
  if (typeof original !== "function" || original.__retiredLegacySandwich === true) {
    return;
  }
  const wrapped = async function retiredLegacySandwichOutput(...args) {
    return sanitizePayload(await original.apply(target, args));
  };
  wrapped.__retiredLegacySandwich = true;
  wrapped.__original = original;
  target[methodName] = wrapped;
}

function installRetiredLegacySandwichCard() {
  if (installed) return;
  installed = true;

  const originalCreateDraft = mealBuilderService.createDraft.bind(mealBuilderService);
  const originalOpenWorkingDraft = mealBuilderService.openWorkingDraft.bind(mealBuilderService);
  const originalUpdateDraft = mealBuilderService.updateDraft.bind(mealBuilderService);
  const originalPublishDraft = mealBuilderService.publishDraft.bind(mealBuilderService);
  const originalDelete = mealBuilderService.deleteProductSection.bind(mealBuilderService);
  const originalValidate = mealBuilderService.validatePayload.bind(mealBuilderService);
  const originalSerialize = mealBuilderService.serializeConfig.bind(mealBuilderService);
  const originalPublicCatalog =
    CatalogService.getSubscriptionBuilderCatalogWithV2.bind(CatalogService);

  mealBuilderService.createDraft = async function createWithoutLegacySandwich(args = {}) {
    const nextArgs = Array.isArray(args.sections)
      ? { ...args, sections: normalizedForWrite(args.sections) }
      : args;
    const result = await originalCreateDraft(nextArgs);
    const persisted = await persistSanitizedCurrentDraft({ actor: args.actor || {} });
    return sanitizePayload(persisted || result);
  };

  mealBuilderService.openWorkingDraft = async function openWithoutLegacySandwich(args = {}) {
    const result = await originalOpenWorkingDraft(args);
    const persisted = await persistSanitizedCurrentDraft({ actor: args.actor || {} });
    return sanitizePayload(persisted || result);
  };

  mealBuilderService.updateDraft = async function updateWithoutLegacySandwich(args = {}) {
    const nextArgs = Array.isArray(args.sections)
      ? { ...args, sections: normalizedForWrite(args.sections) }
      : args;
    return sanitizePayload(await originalUpdateDraft(nextArgs));
  };

  mealBuilderService.publishDraft = async function publishWithoutLegacySandwich(args = {}) {
    await persistSanitizedCurrentDraft({ actor: args.actor || {} });
    return sanitizePayload(await originalPublishDraft(args));
  };

  mealBuilderService.deleteProductSection = async function deleteAnyEditableCard(args = {}) {
    return deleteEditableCard({
      ...args,
      originalDelete,
      originalValidate,
    });
  };

  mealBuilderService.serializeConfig = function serializeWithoutLegacySandwich(config) {
    return sanitizeConfig(originalSerialize(config));
  };

  CatalogService.getSubscriptionBuilderCatalogWithV2 = async function publicCatalogWithoutLegacySandwich(
    options = {}
  ) {
    return sanitizePayload(await originalPublicCatalog(options));
  };

  for (const methodName of [
    "getDashboardState",
    "getHydratedDraft",
    "getReadinessReport",
    "getSectionPicker",
    "getDirectProductPicker",
    "buildPlannerCatalogFromPublishedBuilder",
    "buildPublishedContract",
    "createProductSection",
    "updateProductSection",
    "addProductsToSection",
    "removeProductFromSection",
    "replaceSectionItems",
    "addOptionsToSection",
    "removeOptionFromSection",
  ]) {
    wrapAsyncOutput(mealBuilderService, methodName);
  }
}

installRetiredLegacySandwichCard();

module.exports = {
  deleteEditableCard,
  installRetiredLegacySandwichCard,
  persistSanitizedCurrentDraft,
};
