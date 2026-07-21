"use strict";

function toPlainObject(value) {
  if (!value || typeof value !== "object") return value || {};
  return typeof value.toObject === "function"
    ? value.toObject({ depopulate: false })
    : value;
}

function nonEmptyObjects(value) {
  return (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object");
}

function isMeaningfulMealSlot(slot) {
  if (!slot || typeof slot !== "object") return false;
  if (slot.status === "complete") return true;
  return Boolean(
    slot.productId
      || slot.productKey
      || slot.sandwichId
      || slot.sandwichKey
      || slot.proteinId
      || slot.proteinKey
      || slot.premiumKey
      || (Array.isArray(slot.selectedOptions) && slot.selectedOptions.length > 0)
  );
}

function materializedMealToSlot(meal, index) {
  const sandwichId = meal.sandwichId || null;
  const productId = meal.productId || sandwichId || null;
  const selectionType = meal.selectionType || (sandwichId ? "sandwich" : "standard_meal");
  return {
    ...meal,
    slotIndex: Number(meal.slotIndex || index + 1),
    slotKey: meal.slotKey || `slot_${index + 1}`,
    status: "complete",
    selectionType,
    productId,
    sandwichId,
    carbSelections: Array.isArray(meal.carbSelections)
      ? meal.carbSelections
      : (meal.carbId ? [{ carbId: meal.carbId, grams: null }] : []),
    quantity: Number(meal.quantity || 1),
  };
}

function legacyMealIdToSlot(value, index, sourceSlot = null) {
  const source = sourceSlot && typeof sourceSlot === "object" ? sourceSlot : {};
  const mealValue = value && typeof value === "object"
    ? (value.mealId || value.productId || value.sandwichId || value._id || value.id)
    : value;
  if (!mealValue) return null;

  return {
    ...source,
    slotIndex: Number(source.slotIndex || index + 1),
    slotKey: source.slotKey || `slot_${index + 1}`,
    status: "complete",
    selectionType: source.selectionType || "sandwich",
    productId: source.productId || mealValue,
    sandwichId: source.sandwichId || source.mealId || mealValue,
    quantity: Number(source.quantity || 1),
  };
}

function resolveFromContainer(rawContainer) {
  const container = toPlainObject(rawContainer);
  if (!container || typeof container !== "object") return [];

  const explicitSlots = nonEmptyObjects(container.mealSlots).filter(isMeaningfulMealSlot);
  if (explicitSlots.length > 0) return explicitSlots;

  const materialized = nonEmptyObjects(container.materializedMeals);
  if (materialized.length > 0) return materialized.map(materializedMealToSlot);

  const planningBaseSlots = container.planning && typeof container.planning === "object"
    ? nonEmptyObjects(container.planning.baseMealSlots)
    : [];
  const baseSlots = nonEmptyObjects(container.baseMealSlots);
  const effectiveBaseSlots = baseSlots.length > 0 ? baseSlots : planningBaseSlots;
  if (effectiveBaseSlots.length > 0) {
    return effectiveBaseSlots
      .map((slot, index) => legacyMealIdToSlot(slot.mealId || slot.productId || slot.sandwichId, index, slot))
      .filter(Boolean);
  }

  const selections = Array.isArray(container.selections) ? container.selections : [];
  if (selections.filter(Boolean).length > 0) {
    return selections.map((selection, index) => legacyMealIdToSlot(selection, index)).filter(Boolean);
  }

  return [];
}

function resolveEffectiveMealSlots(rawDay = {}) {
  const day = toPlainObject(rawDay);
  const direct = resolveFromContainer(day);
  if (direct.length > 0) return direct;

  const locked = resolveFromContainer(day.lockedSnapshot);
  if (locked.length > 0) return locked;

  return resolveFromContainer(day.fulfilledSnapshot);
}

function firstSnapshotArray(day, field) {
  if (Array.isArray(day && day[field]) && day[field].length > 0) return day[field];
  for (const snapshot of [day && day.lockedSnapshot, day && day.fulfilledSnapshot]) {
    if (snapshot && Array.isArray(snapshot[field]) && snapshot[field].length > 0) {
      return snapshot[field];
    }
  }
  return day && day[field];
}

function hydrateSubscriptionDayMealSources(rawDay = {}) {
  const day = toPlainObject(rawDay);
  const mealSlots = resolveEffectiveMealSlots(day);
  const directSlots = nonEmptyObjects(day.mealSlots).filter(isMeaningfulMealSlot);
  const needsMealHydration = mealSlots.length > 0 && directSlots.length === 0;

  return {
    ...day,
    mealSlots: needsMealHydration ? mealSlots : day.mealSlots,
    materializedMeals: firstSnapshotArray(day, "materializedMeals"),
    addonSelections: firstSnapshotArray(day, "addonSelections"),
    premiumUpgradeSelections: firstSnapshotArray(day, "premiumUpgradeSelections"),
  };
}

module.exports = {
  hydrateSubscriptionDayForOps: hydrateSubscriptionDayMealSources,
  hydrateSubscriptionDayMealSources,
  isMeaningfulMealSlot,
  resolveEffectiveMealSlots,
};
