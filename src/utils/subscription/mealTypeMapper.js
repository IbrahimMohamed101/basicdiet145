/**
 * Utility to map legacy meal selection types to the new canonical types.
 */

const LEGACY_TYPES = {
  standard_combo: "standard_combo",
  custom_premium_salad: "custom_premium_salad",
  sandwich: "sandwich",
};

const NEW_TYPES = {
  standard_meal: "standard_meal",
  premium_meal: "premium_meal",
  premium_large_salad: "premium_large_salad",
  sandwich: "sandwich",
};

const LEGACY_TO_NEXT_SELECTION_TYPE = {
  [LEGACY_TYPES.standard_combo]: NEW_TYPES.standard_meal,
  [LEGACY_TYPES.custom_premium_salad]: NEW_TYPES.premium_large_salad,
  [LEGACY_TYPES.sandwich]: NEW_TYPES.sandwich,
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
  if (mappedType === NEW_TYPES.standard_meal && isPremium) {
    return NEW_TYPES.premium_meal;
  }

  // 4. Final fallback for unknown/empty values as per test requirements
  const isKnownType = Object.values(NEW_TYPES).includes(mappedType);
  if (!mappedType || !isKnownType) {
    return isPremium ? NEW_TYPES.premium_meal : NEW_TYPES.standard_meal;
  }

  return mappedType;
}

/**
 * Normalizes carb selections from legacy carbId to the new carbs array structure.
 */
function normalizeCarbs(slot) {
  if (Array.isArray(slot.carbs) && slot.carbs.length > 0) {
    return slot.carbs;
  }
  
  if (Array.isArray(slot.carbSelections) && slot.carbSelections.length > 0) {
    return slot.carbSelections;
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
