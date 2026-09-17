"use strict";

const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");

const CARD_TYPES = Object.freeze({
  DIRECT_PRODUCT: "direct_product",
  OPTION_FAMILY: "option_family",
  SYSTEM_PREMIUM: "system_premium",
});

let installed = false;

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function productIds(section = {}) {
  return [
    ...new Set(
      (section.selectedProductIds || section.productIds || []).map(String)
    ),
  ];
}

function optionIds(section = {}) {
  return [
    ...new Set((section.selectedOptionIds || section.optionIds || []).map(String)),
  ];
}

function cardType(section = {}) {
  if (
    sectionKey(section) === "premium" ||
    token(section.sourceKind) === "premium_visual" ||
    section.metadata?.systemManaged === true ||
    section.metadata?.cardType === CARD_TYPES.SYSTEM_PREMIUM
  ) {
    return CARD_TYPES.SYSTEM_PREMIUM;
  }
  const explicit = token(section.cardType || section.metadata?.cardType);
  if (explicit) return explicit;
  if (token(section.sectionType || section.type) === "product_list") {
    return CARD_TYPES.DIRECT_PRODUCT;
  }
  return CARD_TYPES.OPTION_FAMILY;
}

function optionRole(section = {}) {
  const explicit = token(section.optionRole || section.metadata?.optionRole);
  if (explicit) return explicit;
  if (
    sectionKey(section) === "carbs" ||
    ["carb", "carbs"].includes(token(section.metadata?.sourceGroupKey))
  ) {
    return "carbs";
  }
  return "protein";
}

function decorateSection(section) {
  if (!section || typeof section !== "object") return section;
  const resolvedType = cardType(section);
  const role =
    resolvedType === CARD_TYPES.OPTION_FAMILY ? optionRole(section) : null;
  return {
    ...section,
    cardType: resolvedType,
    optionRole: role,
    systemManaged: resolvedType === CARD_TYPES.SYSTEM_PREMIUM,
    itemEntity:
      resolvedType === CARD_TYPES.DIRECT_PRODUCT
        ? "MenuProduct"
        : resolvedType === CARD_TYPES.OPTION_FAMILY
          ? "MenuOption"
          : "PremiumUpgradeConfig",
    completeByItself: resolvedType === CARD_TYPES.DIRECT_PRODUCT,
    flutterSlotContract:
      resolvedType === CARD_TYPES.DIRECT_PRODUCT
        ? { idField: "sandwichId", requiresCompanionCard: false }
        : resolvedType === CARD_TYPES.OPTION_FAMILY
          ? {
              idField: role === "carbs" ? "carbs[].carbId" : "proteinId",
              requiresCompanionCard: true,
            }
          : null,
  };
}

function decorateConfig(config) {
  return config && typeof config === "object"
    ? { ...config, sections: (config.sections || []).map(decorateSection) }
    : config;
}

function decorateLifecycleResult(result) {
  if (!result || typeof result !== "object") return result;
  if (result.draft || Array.isArray(result.sections)) {
    const topLevelSections = Array.isArray(result.sections)
      ? result.sections.map(decorateSection)
      : result.sections;
    return {
      ...result,
      draft: result.draft ? decorateConfig(result.draft) : result.draft,
      ...(Array.isArray(topLevelSections) && { sections: topLevelSections }),
    };
  }
  return Array.isArray(result.sections) ? decorateConfig(result) : result;
}

async function decorateActionResult(result) {
  if (!result || typeof result !== "object") return result;
  const draft = decorateConfig(result.draft);
  const section = decorateSection(result.section);
  const validation = draft
    ? await mealBuilderService.validatePayload({ sections: draft.sections || [] })
    : result.validation;
  return {
    ...result,
    section,
    draft,
    validation,
    summary: {
      ...(result.summary || {}),
      sectionCount:
        draft?.sections?.length ?? result.summary?.sectionCount ?? 0,
      selectedProductCount:
        draft?.sections?.reduce(
          (sum, item) => sum + productIds(item).length,
          0
        ) ??
        result.summary?.selectedProductCount ??
        0,
      selectedOptionCount:
        draft?.sections?.reduce(
          (sum, item) => sum + optionIds(item).length,
          0
        ) ??
        result.summary?.selectedOptionCount ??
        0,
      ready: validation?.ready === true,
      errorCount: validation?.errors?.length || 0,
      warningCount: validation?.warnings?.length || 0,
    },
  };
}

function wrapAction(methodName) {
  const original = mealBuilderService[methodName];
  if (
    typeof original !== "function" ||
    original.__mealPlannerCardActionDecorator
  ) {
    return;
  }
  const decorated = async function decoratedCardAction(args = {}) {
    return decorateActionResult(
      await original.call(mealBuilderService, args)
    );
  };
  decorated.__mealPlannerCardActionDecorator = true;
  mealBuilderService[methodName] = decorated;
}

function wrapLifecycle(methodName) {
  const original = mealBuilderService[methodName];
  if (
    typeof original !== "function" ||
    original.__mealPlannerCardLifecycleDecorator
  ) {
    return;
  }
  const decorated = async function decoratedCardLifecycle(...args) {
    return decorateLifecycleResult(
      await original.apply(mealBuilderService, args)
    );
  };
  decorated.__mealPlannerCardLifecycleDecorator = true;
  mealBuilderService[methodName] = decorated;
}

function installDashboardMealPlannerCardActionDecorator() {
  if (installed) return;
  installed = true;

  for (const methodName of [
    "createProductSection",
    "updateProductSection",
    "deleteProductSection",
    "replaceSectionItems",
    "addProductsToSection",
    "removeProductFromSection",
    "addOptionsToSection",
    "removeOptionFromSection",
  ]) {
    wrapAction(methodName);
  }

  for (const methodName of [
    "createDraft",
    "openWorkingDraft",
    "resetDraftToPublished",
    "updateDraft",
    "getHydratedDraft",
  ]) {
    wrapLifecycle(methodName);
  }
}

installDashboardMealPlannerCardActionDecorator();

module.exports = {
  installDashboardMealPlannerCardActionDecorator,
};
