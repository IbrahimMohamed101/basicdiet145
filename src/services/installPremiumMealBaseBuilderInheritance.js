"use strict";

const { MEAL_SELECTION_TYPES } = require("../config/mealPlannerContract");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const canonicalPlannerService = require("./subscription/canonicalMealSlotPlannerService");

const STATE_KEY = Symbol.for("basicdiet.premiumMealBaseBuilderInheritance.state");
const WRAPPER_MARKER = "__premiumMealBaseBuilderInheritance";

const CASCADE_SOURCE_CODES = new Set([
  "PLANNER_BUILDER_GROUP_NOT_INCLUDED",
  "PLANNER_BUILDER_OPTION_NOT_INCLUDED",
  "PLANNER_OPTION_GROUP_MISMATCH",
  "PLANNER_OPTION_GROUP_RELATION_NOT_FOUND",
  "PLANNER_OPTION_GROUP_RELATION_UNAVAILABLE",
  "PLANNER_PRODUCT_OPTION_RELATION_NOT_FOUND",
  "PLANNER_PRODUCT_OPTION_RELATION_UNAVAILABLE",
  "PLANNER_OPTION_NOT_FOUND",
  "PLANNER_OPTION_INACTIVE",
  "PLANNER_OPTION_UNPUBLISHED",
  "PLANNER_OPTION_UNAVAILABLE",
]);

function normalizedSelectionType(value) {
  return String(value || "").trim();
}

/**
 * A Premium meal is an upgrade of the same configurable base meal. The Premium
 * section owns the upgraded source option, while the ordinary base groups
 * (carbs and any future administrator-authored side groups) remain inherited
 * from the standard-meal section for the same product.
 *
 * This deliberately works by selection type + product/group/option IDs. It does
 * not depend on fixed group keys such as `carbs`, so new base groups authored by
 * the administrator inherit automatically.
 */
function compatibleMembershipSelectionTypes(selectionType) {
  const normalized = normalizedSelectionType(selectionType);
  if (normalized === MEAL_SELECTION_TYPES.PREMIUM_MEAL) {
    return [
      MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      MEAL_SELECTION_TYPES.STANDARD_MEAL,
    ];
  }
  return [normalized];
}

function wrapMembershipCheck(original, kind) {
  if (typeof original !== "function") {
    const error = new Error(`Missing Meal Builder ${kind} membership function`);
    error.code = "PREMIUM_MEAL_BASE_MEMBERSHIP_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPER_MARKER] === true) return original;

  const wrapped = function premiumMealBaseMembership(membership, selectionType, ...identity) {
    return compatibleMembershipSelectionTypes(selectionType)
      .some((candidateType) => original.call(
        mealBuilderConfigService,
        membership,
        candidateType,
        ...identity
      ));
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

function slotGroupKey(error) {
  if (!error || !error.groupId) return "";
  return `${Number(error.slotIndex || 0)}:${String(error.groupId)}`;
}

/**
 * Do not tell the client both “this submitted option/group is invalid” and
 * “nothing was selected in that group”. The second error is only a consequence
 * of the first option being rejected and is misleading.
 */
function suppressCascadingMinimumErrors(result) {
  if (!result || result.valid !== false || !Array.isArray(result.slotErrors)) {
    return result;
  }

  const blockedGroups = new Set(
    result.slotErrors
      .filter((error) => CASCADE_SOURCE_CODES.has(String(error && error.code || "")))
      .map(slotGroupKey)
      .filter(Boolean)
  );

  if (!blockedGroups.size) return result;

  const slotErrors = result.slotErrors.filter((error) => {
    if (String(error && error.code || "") !== "PLANNER_MIN_SELECTION_NOT_MET") {
      return true;
    }
    return !blockedGroups.has(slotGroupKey(error));
  });

  if (slotErrors.length === result.slotErrors.length) return result;

  const debug = result.debug && typeof result.debug === "object"
    ? { ...result.debug }
    : result.debug;
  if (debug && Array.isArray(debug.slots)) {
    debug.slots = debug.slots.map((slot) => {
      const slotIndex = Number(slot && slot.slotIndex || 0);
      const groupValidation = Array.isArray(slot && slot.groupValidation)
        ? slot.groupValidation.map((group) => {
            const key = `${slotIndex}:${String(group && group.groupId || "")}`;
            return blockedGroups.has(key) ? { ...group, status: "BLOCKED" } : group;
          })
        : slot && slot.groupValidation;
      const missingGroups = Array.isArray(slot && slot.missingGroups)
        ? slot.missingGroups.filter((groupKey) => {
            const expected = Array.isArray(slot.expectedGroups)
              ? slot.expectedGroups.find((group) => String(group.groupKey || "") === String(groupKey || ""))
              : null;
            return !expected || !blockedGroups.has(`${slotIndex}:${String(expected.groupId || "")}`);
          })
        : slot && slot.missingGroups;
      return {
        ...slot,
        productConfiguration: {
          ...(slot && slot.productConfiguration || {}),
          groups: Array.isArray(slot && slot.expectedGroups)
            ? slot.expectedGroups
            : (slot && slot.productConfiguration && slot.productConfiguration.groups) || [],
        },
        groupValidation,
        missingGroups,
      };
    });
  }

  const first = slotErrors[0] || null;
  return {
    ...result,
    slotErrors,
    errorCode: first && first.code || result.errorCode,
    errorMessage: first && first.message || result.errorMessage,
    debug,
  };
}

function wrapCanonicalValidator(original) {
  if (typeof original !== "function") {
    const error = new Error("Missing canonical Meal Planner validator");
    error.code = "PREMIUM_MEAL_BASE_MEMBERSHIP_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPER_MARKER] === true) return original;

  const wrapped = async function premiumMealBaseAwareCanonicalValidation(...args) {
    const result = await original.apply(canonicalPlannerService, args);
    return suppressCascadingMinimumErrors(result);
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

function installPremiumMealBaseBuilderInheritance() {
  const current = globalThis[STATE_KEY];
  if (current && current.status === "installed") return current;
  if (current && current.status === "installing") {
    const error = new Error("Premium Meal base membership installation was re-entered");
    error.code = "PREMIUM_MEAL_BASE_MEMBERSHIP_INSTALL_REENTRANT";
    throw error;
  }

  const state = {
    status: "installing",
    installedAt: null,
  };
  globalThis[STATE_KEY] = state;

  try {
    mealBuilderConfigService.isGroupIncluded = wrapMembershipCheck(
      mealBuilderConfigService.isGroupIncluded,
      "group"
    );
    mealBuilderConfigService.isOptionIncluded = wrapMembershipCheck(
      mealBuilderConfigService.isOptionIncluded,
      "option"
    );
    canonicalPlannerService.validateCanonicalMealSlots = wrapCanonicalValidator(
      canonicalPlannerService.validateCanonicalMealSlots
    );

    state.status = "installed";
    state.installedAt = new Date();
    state.groupMembershipInherited = true;
    state.optionMembershipInherited = true;
    state.cascadingMinimumErrorsSuppressed = true;
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode = error && error.code || "PREMIUM_MEAL_BASE_MEMBERSHIP_INSTALL_FAILED";
    state.errorMessage = error && error.message || "Premium Meal base membership installation failed";
    throw error;
  }
}

installPremiumMealBaseBuilderInheritance();

module.exports = {
  CASCADE_SOURCE_CODES,
  STATE_KEY,
  compatibleMembershipSelectionTypes,
  installPremiumMealBaseBuilderInheritance,
  suppressCascadingMinimumErrors,
};
