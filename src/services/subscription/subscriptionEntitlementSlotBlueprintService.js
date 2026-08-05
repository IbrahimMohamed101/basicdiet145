"use strict";

const {
  isBatchProjectableOnDate,
  normalizeDateString,
} = require("./subscriptionEntitlementProjectionService");

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 0;
  return parsed;
}

function compareBatchesForAllocation(left, right) {
  const leftEnd = normalizeDateString(left.validityEndDate || left.endDate);
  const rightEnd = normalizeDateString(right.validityEndDate || right.endDate);
  if (leftEnd !== rightEnd) return leftEnd.localeCompare(rightEnd);

  const leftStart = normalizeDateString(left.effectiveStartDate);
  const rightStart = normalizeDateString(right.effectiveStartDate);
  if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);

  return String(left._id || "").localeCompare(String(right._id || ""));
}

function buildEntitlementSlotBlueprint({ batches = [], businessDate } = {}) {
  const targetDate = normalizeDateString(businessDate);
  const projectable = (Array.isArray(batches) ? batches : [])
    .filter((batch) => isBatchProjectableOnDate(batch, targetDate))
    .sort(compareBatchesForAllocation);

  const slots = [];
  let slotIndex = 1;

  for (const batch of projectable) {
    const batchId = String(batch._id || "");
    const mealsPerDay = normalizePositiveInteger(batch.mealsPerDay);
    const proteinGrams = normalizePositiveInteger(batch.proteinGrams);

    for (let contributionIndex = 1; contributionIndex <= mealsPerDay; contributionIndex += 1) {
      slots.push({
        slotIndex,
        slotKey: `slot_${slotIndex}`,
        entitlementBatchId: batchId || null,
        contributionIndex,
        sourceMealsPerDay: mealsPerDay,
        proteinGrams: proteinGrams || null,
        effectiveStartDate: normalizeDateString(batch.effectiveStartDate),
        validityEndDate: normalizeDateString(batch.validityEndDate || batch.endDate),
      });
      slotIndex += 1;
    }
  }

  return {
    businessDate: targetDate,
    requiredSlotCount: slots.length,
    slots,
  };
}

function indexBlueprintBySlotKey(blueprint) {
  return new Map(
    (blueprint && Array.isArray(blueprint.slots) ? blueprint.slots : [])
      .map((slot) => [String(slot.slotKey || ""), slot])
      .filter(([slotKey]) => Boolean(slotKey))
  );
}

function resolveSlotEntitlement(blueprint, slotLike) {
  if (!slotLike) return null;
  const lookup = indexBlueprintBySlotKey(blueprint);
  const explicitKey = String(slotLike.slotKey || "").trim();
  if (explicitKey && lookup.has(explicitKey)) return lookup.get(explicitKey);

  const slotIndex = Number(slotLike.slotIndex || 0);
  if (Number.isInteger(slotIndex) && slotIndex > 0) {
    return lookup.get(`slot_${slotIndex}`) || null;
  }
  return null;
}

function resolveProteinGramsForSlot({ blueprint, slot, fallbackGrams = null } = {}) {
  const entitlement = resolveSlotEntitlement(blueprint, slot);
  if (entitlement && normalizePositiveInteger(entitlement.proteinGrams)) {
    return entitlement.proteinGrams;
  }
  const fallback = normalizePositiveInteger(fallbackGrams);
  return fallback || null;
}

function preserveExistingSelectionsForBlueprint({ blueprint, existingMealSlots = [] } = {}) {
  const existingByKey = new Map(
    (Array.isArray(existingMealSlots) ? existingMealSlots : [])
      .map((slot) => {
        const slotIndex = Number(slot && slot.slotIndex || 0);
        const slotKey = String(
          slot && slot.slotKey
          || (Number.isInteger(slotIndex) && slotIndex > 0 ? `slot_${slotIndex}` : "")
        ).trim();
        return [slotKey, slot];
      })
      .filter(([slotKey]) => Boolean(slotKey))
  );

  return (blueprint && Array.isArray(blueprint.slots) ? blueprint.slots : []).map((entry) => {
    const existing = existingByKey.get(entry.slotKey);
    if (!existing) {
      return {
        slotIndex: entry.slotIndex,
        slotKey: entry.slotKey,
        status: "empty",
      };
    }
    return {
      ...existing,
      slotIndex: entry.slotIndex,
      slotKey: entry.slotKey,
    };
  });
}

module.exports = {
  buildEntitlementSlotBlueprint,
  compareBatchesForAllocation,
  preserveExistingSelectionsForBlueprint,
  resolveProteinGramsForSlot,
  resolveSlotEntitlement,
};
