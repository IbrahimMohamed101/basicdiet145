"use strict";

const { MEAL_SELECTION_TYPES } = require("../config/mealPlannerContract");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");

const STATE_KEY = Symbol.for(
  "basicdiet.fullMealProductMembershipCompatibility.state"
);
const WRAPPER_MARKER = "__fullMealProductMembershipCompatibility";

function normalizedSelectionType(value) {
  return String(value || "").trim();
}

/**
 * The Dashboard/public catalog canonicalizes the historical `sandwich` direct
 * card type to `full_meal_product`. Existing published Meal Builder versions may
 * still store those products under the historical selection type, so validator
 * membership must understand both names until those versions are republished.
 *
 * The compatibility is intentionally limited to product membership. It does not
 * make option groups or options from one type available to another, and it does
 * not use product keys, names, or categories.
 */
function compatibleDirectProductSelectionTypes(selectionType) {
  const normalized = normalizedSelectionType(selectionType);
  if (
    normalized === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT ||
    normalized === MEAL_SELECTION_TYPES.SANDWICH
  ) {
    return [
      MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
      MEAL_SELECTION_TYPES.SANDWICH,
    ];
  }
  return [normalized];
}

function wrapProductMembershipCheck(original) {
  if (typeof original !== "function") {
    const error = new Error("Missing Meal Builder product membership function");
    error.code = "FULL_MEAL_PRODUCT_MEMBERSHIP_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPER_MARKER] === true) return original;

  const wrapped = function fullMealProductMembership(
    membership,
    selectionType,
    productId
  ) {
    return compatibleDirectProductSelectionTypes(selectionType).some(
      (candidateType) =>
        original.call(
          mealBuilderConfigService,
          membership,
          candidateType,
          productId
        )
    );
  };

  Object.defineProperty(wrapped, WRAPPER_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(wrapped, "__original", {
    value: original,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return wrapped;
}

function installFullMealProductMembershipCompatibility() {
  const current = globalThis[STATE_KEY];
  if (current && current.status === "installed") return current;
  if (current && current.status === "installing") {
    const error = new Error(
      "Full meal product membership installation was re-entered"
    );
    error.code = "FULL_MEAL_PRODUCT_MEMBERSHIP_INSTALL_REENTRANT";
    throw error;
  }

  const state = {
    status: "installing",
    installedAt: null,
  };
  globalThis[STATE_KEY] = state;

  try {
    mealBuilderConfigService.isProductIncluded = wrapProductMembershipCheck(
      mealBuilderConfigService.isProductIncluded
    );

    state.status = "installed";
    state.installedAt = new Date();
    state.canonicalSelectionType = MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
    state.compatibleLegacySelectionType = MEAL_SELECTION_TYPES.SANDWICH;
    state.productMembershipCompatibility = true;
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      (error && error.code) || "FULL_MEAL_PRODUCT_MEMBERSHIP_INSTALL_FAILED";
    state.errorMessage =
      (error && error.message) ||
      "Full meal product membership installation failed";
    throw error;
  }
}

installFullMealProductMembershipCompatibility();

module.exports = {
  STATE_KEY,
  compatibleDirectProductSelectionTypes,
  installFullMealProductMembershipCompatibility,
};
