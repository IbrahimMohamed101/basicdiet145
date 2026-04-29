/**
 * Utility to map legacy meal selection types to the canonical planner types.
 */

const {
  LEGACY_MEAL_SELECTION_TYPES,
  MEAL_SELECTION_TYPES,
} = require("../../config/mealPlannerContract");

const LEGACY_TYPES = LEGACY_MEAL_SELECTION_TYPES;
const NEW_TYPES = MEAL_SELECTION_TYPES;

const LEGACY_TO_NEXT_SELECTION_TYPE = {
  [LEGACY_TYPES.STANDARD_COMBO]: NEW_TYPES.STANDARD_MEAL,
  [LEGACY_TYPES.CUSTOM_PREMIUM_SALAD]: NEW_TYPES.PREMIUM_LARGE_SALAD,
  [LEGACY_TYPES.SANDWICH]: NEW_TYPES.SANDWICH,
};

/**
 * Maps a legacy selection type to the new domain model.
 * 
 * @param {string} selectionType The raw selection type from input/legacy
 * @param {Object} slot Optional slot object to check for premium status
 * @returns {string} The new selection type
 */
function mapLegacySelectionType(selectionType, slot = {}) {
  const isPremium = slot && (slot.isPremium || slot.isPremiumProtein);
  
  // 1. Direct mapping from table
  let mappedType = LEGACY_TO_NEXT_SELECTION_TYPE[selectionType];
  
  // 2. If not in table, use as is (for already-normalized types or fallbacks)
  if (!mappedType) {
    mappedType = selectionType;
  }

  // 3. Handle specific transitions for Standard -> Premium
  if (mappedType === NEW_TYPES.STANDARD_MEAL && isPremium) {
    return NEW_TYPES.PREMIUM_MEAL;
  }

  // 4. Final fallback for unknown/empty values as per test requirements
  const isKnownType = Object.values(NEW_TYPES).includes(mappedType);
  if (!mappedType || !isKnownType) {
    return isPremium ? NEW_TYPES.PREMIUM_MEAL : NEW_TYPES.STANDARD_MEAL;
  }

  return mappedType;
}

/**
 * Normalizes carb selections from legacy carbId to the new carbs array structure.
 */
function normalizeCarbs(slot, selectionType = slot && slot.selectionType) {
  if (Array.isArray(slot.carbs) && slot.carbs.length > 0) {
    return slot.carbs;
  }
  
  if (Array.isArray(slot.carbSelections) && slot.carbSelections.length > 0) {
    if (
      selectionType !== NEW_TYPES.STANDARD_MEAL
      && selectionType !== NEW_TYPES.PREMIUM_MEAL
      && selectionType !== LEGACY_TYPES.STANDARD_COMBO
    ) {
      return slot.carbSelections;
    }
    return slot.carbSelections;
  }

  if (
    selectionType !== NEW_TYPES.STANDARD_MEAL
    && selectionType !== NEW_TYPES.PREMIUM_MEAL
    && selectionType !== LEGACY_TYPES.STANDARD_COMBO
  ) {
    return [];
  }

  if (slot.carbId) {
    return [{ carbId: slot.carbId, grams: 300 }];
  }

  return [];
}

module.exports = {
  LEGACY_TYPES,
  NEW_TYPES,
  LEGACY_TO_NEXT_SELECTION_TYPE,
  mapLegacySelectionType,
  normalizeCarbs,
};
