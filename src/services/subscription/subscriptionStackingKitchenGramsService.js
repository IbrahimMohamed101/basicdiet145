"use strict";

const {
  resolveProteinGramsForSlot,
} = require("./subscriptionEntitlementSlotBlueprintService");

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSlotKey(slot = {}) {
  const explicit = String(slot.slotKey || "").trim();
  if (explicit) return explicit;
  const slotIndex = Number(slot.slotIndex || 0);
  return Number.isInteger(slotIndex) && slotIndex > 0 ? `slot_${slotIndex}` : "";
}

function resolveStoredProteinGrams(slot = {}, fallbackGrams = null) {
  const candidates = [
    slot.entitlementSnapshot && slot.entitlementSnapshot.proteinGrams,
    slot.fulfillmentSnapshot && slot.fulfillmentSnapshot.proteinGrams,
    slot.confirmationSnapshot && slot.confirmationSnapshot.proteinGrams,
    slot.displaySnapshot && slot.displaySnapshot.proteinGrams,
    slot.proteinGrams,
    fallbackGrams,
  ];
  for (const value of candidates) {
    const normalized = normalizePositiveInteger(value);
    if (normalized) return normalized;
  }
  return null;
}

function applyBlueprintProteinGramsToMealSlots({
  mealSlots = [],
  blueprint,
  fallbackGrams = null,
} = {}) {
  return (Array.isArray(mealSlots) ? mealSlots : []).map((slot) => {
    const proteinGrams = resolveProteinGramsForSlot({
      blueprint,
      slot,
      fallbackGrams: resolveStoredProteinGrams(slot, fallbackGrams),
    });
    if (!proteinGrams) return { ...slot };

    return {
      ...slot,
      entitlementSnapshot: {
        ...(slot && slot.entitlementSnapshot && typeof slot.entitlementSnapshot === "object"
          ? slot.entitlementSnapshot
          : {}),
        proteinGrams,
        slotKey: normalizeSlotKey(slot),
        blueprintId: blueprint && blueprint._id ? String(blueprint._id) : "",
        blueprintSourceHash: blueprint && blueprint.sourceHash
          ? String(blueprint.sourceHash)
          : "",
      },
      fulfillmentSnapshot: {
        ...(slot && slot.fulfillmentSnapshot && typeof slot.fulfillmentSnapshot === "object"
          ? slot.fulfillmentSnapshot
          : {}),
        proteinGrams,
      },
    };
  });
}

function decorateKitchenDetailsWithStoredGrams({
  kitchenDetails,
  day,
  subscription,
} = {}) {
  if (!kitchenDetails || typeof kitchenDetails !== "object") return kitchenDetails;
  if (!Array.isArray(kitchenDetails.mealSlots)) return kitchenDetails;

  const sourceByKey = new Map(
    (day && Array.isArray(day.mealSlots) ? day.mealSlots : [])
      .map((slot) => [normalizeSlotKey(slot), slot])
      .filter(([slotKey]) => Boolean(slotKey))
  );
  const fallbackGrams = normalizePositiveInteger(
    subscription && subscription.selectedGrams
  );
  let changed = false;
  const mealSlots = kitchenDetails.mealSlots.map((outputSlot) => {
    const slotKey = normalizeSlotKey(outputSlot);
    const sourceSlot = sourceByKey.get(slotKey) || {};
    const proteinGrams = resolveStoredProteinGrams(sourceSlot, outputSlot.proteinGrams || fallbackGrams);
    if (!proteinGrams || Number(outputSlot.proteinGrams || 0) === proteinGrams) {
      return outputSlot;
    }
    changed = true;
    return {
      ...outputSlot,
      proteinGrams,
    };
  });

  return changed ? { ...kitchenDetails, mealSlots } : kitchenDetails;
}

function createKitchenDetailsGramsWrapper(original) {
  if (typeof original !== "function") {
    throw new TypeError("original kitchen details builder must be a function");
  }
  return function buildKitchenDetailsWithStackingGrams(
    day = {},
    subscription = {},
    lang = "en",
    catalogMaps = {}
  ) {
    const result = original(day, subscription, lang, catalogMaps);
    return decorateKitchenDetailsWithStoredGrams({
      kitchenDetails: result,
      day,
      subscription,
    });
  };
}

module.exports = {
  applyBlueprintProteinGramsToMealSlots,
  createKitchenDetailsGramsWrapper,
  decorateKitchenDetailsWithStoredGrams,
  normalizeSlotKey,
  resolveStoredProteinGrams,
};
