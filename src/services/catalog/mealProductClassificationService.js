"use strict";

const {
  MEAL_SELECTION_TYPES,
} = require("../../config/mealPlannerContract");

const EXPLICIT_DIRECT_PRODUCT_TYPES = Object.freeze([
  "cold_sandwich",
  "full_meal_product",
]);

const DIRECT_PRODUCT_CARD_VARIANTS = Object.freeze([
  "ready_meal",
  "ready_meal_customizable",
  "sandwich_card",
]);

const FULL_MEAL_CARD_VARIANTS = new Set([
  "ready_meal",
  "ready_meal_customizable",
]);
const SANDWICH_CARD_VARIANTS = new Set(["sandwich_card"]);
const BUILDER_CARD_VARIANTS = new Set([
  "hero_builder",
  "compact_builder",
]);
const NON_MEAL_CARD_VARIANTS = new Set([
  "addon",
  "addon_card",
]);
const NON_MEAL_ITEM_TYPES = new Set([
  "addon",
  "subscription_addon",
]);
const BUILDER_ITEM_TYPES = new Set([
  "basic_meal",
  "custom_meal",
  "meal_builder",
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function productCardVariant(product = {}) {
  return normalize(product?.ui?.cardVariant);
}

function productItemType(product = {}) {
  return normalize(product.itemType || "product");
}

function classifyMealProduct(
  product = {},
  {
    hasBuilderRelations = false,
    hasActiveBuilderRelations = false,
  } = {}
) {
  const itemType = productItemType(product);
  const cardVariant = productCardVariant(product);
  const explicitSandwich =
    itemType === "cold_sandwich" ||
    itemType === "sourdough" ||
    itemType.includes("sandwich") ||
    itemType.includes("sourdough") ||
    SANDWICH_CARD_VARIANTS.has(cardVariant);
  const explicitFullMeal =
    itemType === "full_meal_product" ||
    FULL_MEAL_CARD_VARIANTS.has(cardVariant);
  const nonMeal =
    NON_MEAL_ITEM_TYPES.has(itemType) || NON_MEAL_CARD_VARIANTS.has(cardVariant);
  const builderPreferred =
    !nonMeal &&
    !explicitSandwich &&
    !explicitFullMeal &&
    (BUILDER_ITEM_TYPES.has(itemType) ||
      Boolean(hasBuilderRelations) ||
      product.isCustomizable === true ||
      BUILDER_CARD_VARIANTS.has(cardVariant));
  const genericStandalone =
    !nonMeal &&
    !explicitSandwich &&
    !explicitFullMeal &&
    !builderPreferred;
  const sandwich = explicitSandwich;
  const fullMeal = !sandwich && (explicitFullMeal || genericStandalone);
  const directCompatible = !nonMeal && (sandwich || fullMeal);
  const composedCompatible = builderPreferred;

  const directSelectionType = sandwich
    ? MEAL_SELECTION_TYPES.SANDWICH
    : fullMeal
      ? MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
      : null;

  let kind = "unclassified";
  if (nonMeal) kind = "non_meal";
  else if (sandwich) kind = "sandwich";
  else if (fullMeal) kind = "full_meal_product";
  else if (composedCompatible) kind = "composed_meal";

  const suggestedSelectionTypes = [];
  if (directSelectionType) suggestedSelectionTypes.push(directSelectionType);
  if (composedCompatible) {
    suggestedSelectionTypes.push(MEAL_SELECTION_TYPES.STANDARD_MEAL);
  }

  return {
    canonicalAuthority: "meal_builder_section.selectionType",
    kind,
    itemType,
    cardVariant,
    nonMeal,
    sandwich,
    fullMeal,
    directCompatible,
    directSelectionType,
    composedCompatible,
    hasBuilderRelations: Boolean(hasBuilderRelations),
    hasActiveBuilderRelations: Boolean(hasActiveBuilderRelations),
    suggestedSelectionTypes: [...new Set(suggestedSelectionTypes)],
  };
}

function isProductionDirectProduct(product = {}) {
  return classifyMealProduct(product).directCompatible;
}

function directSelectionType(product = {}) {
  return classifyMealProduct(product).directSelectionType;
}

function groupIsCustomerReady(group = {}) {
  if (group?.effectiveStatus?.customerReady !== undefined) {
    return group.effectiveStatus.customerReady === true;
  }
  if (
    group?.relationStatus?.customerReady !== undefined ||
    group?.groupStatus?.customerReady !== undefined
  ) {
    return (
      group?.relationStatus?.customerReady !== false &&
      group?.groupStatus?.customerReady !== false
    );
  }
  return (
    group?.relation?.isActive !== false &&
    group?.relation?.isVisible !== false &&
    group?.relation?.isAvailable !== false &&
    group?.group?.isActive !== false &&
    group?.group?.isVisible !== false &&
    group?.group?.isAvailable !== false
  );
}

function buildMealPlannerClassification({
  product = {},
  optionGroups = [],
  status = {},
} = {}) {
  const groups = Array.isArray(optionGroups) ? optionGroups : [];
  const activeGroups = groups.filter(groupIsCustomerReady);
  const classification = classifyMealProduct(product, {
    hasBuilderRelations: groups.length > 0,
    hasActiveBuilderRelations: activeGroups.length > 0,
  });
  const customerReady = status.customerReady === true;
  const reasonCodes = [];

  if (!customerReady && Array.isArray(status.reasonCodes)) {
    reasonCodes.push(...status.reasonCodes);
  }
  if (classification.nonMeal) reasonCodes.push("NON_MEAL_CARD_VARIANT");
  if (!classification.directCompatible) {
    reasonCodes.push("NOT_DIRECT_MEAL_PRODUCT");
  }
  if (!classification.composedCompatible) {
    reasonCodes.push("NO_BUILDER_RELATIONS");
  }
  if (
    classification.composedCompatible &&
    !classification.hasActiveBuilderRelations
  ) {
    reasonCodes.push("NO_ACTIVE_BUILDER_RELATIONS");
  }

  return {
    canonicalAuthority: classification.canonicalAuthority,
    kind: classification.kind,
    itemType: classification.itemType,
    cardVariant: classification.cardVariant,
    suggestedSelectionTypes: classification.suggestedSelectionTypes,
    directAdd: {
      compatible: classification.directCompatible,
      eligible: classification.directCompatible && customerReady,
      selectionType: classification.directSelectionType,
      requiresBuilder: false,
      carbsRequired: false,
    },
    composedMeal: {
      compatible: classification.composedCompatible,
      eligible:
        classification.composedCompatible &&
        classification.hasActiveBuilderRelations &&
        customerReady,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      requiresBuilder: true,
      carbsRequired: groups.some(
        (group) => normalize(group?.group?.key || group?.key) === "carbs"
      ),
      hasProteinGroup: groups.some((group) =>
        ["protein", "proteins"].includes(
          normalize(group?.group?.key || group?.key)
        )
      ),
      hasCarbGroup: groups.some(
        (group) => normalize(group?.group?.key || group?.key) === "carbs"
      ),
      hasBuilderRelations: classification.hasBuilderRelations,
      hasActiveBuilderRelations: classification.hasActiveBuilderRelations,
    },
    reasonCodes: [...new Set(reasonCodes)],
  };
}

module.exports = {
  BUILDER_CARD_VARIANTS,
  BUILDER_ITEM_TYPES,
  DIRECT_PRODUCT_CARD_VARIANTS,
  EXPLICIT_DIRECT_PRODUCT_TYPES,
  FULL_MEAL_CARD_VARIANTS,
  NON_MEAL_CARD_VARIANTS,
  classifyMealProduct,
  buildMealPlannerClassification,
  directSelectionType,
  isProductionDirectProduct,
  productCardVariant,
  productItemType,
};
