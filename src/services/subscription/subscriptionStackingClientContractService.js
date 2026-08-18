"use strict";

const {
  isBatchProjectableOnDate,
  normalizeDateString,
} = require("./subscriptionEntitlementProjectionService");
const {
  resolveStoredProteinGrams,
} = require("./subscriptionStackingKitchenGramsService");

const INTERNAL_SLOT_FIELDS = Object.freeze([
  "entitlementSnapshot",
  "fulfillmentSnapshot",
  "confirmationSnapshot",
  "displaySnapshot",
]);

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function toPlain(value) {
  if (!value || typeof value !== "object") return {};
  if (typeof value.toObject === "function") return value.toObject();
  return { ...value };
}

function serializeMealSlotsForClient(mealSlots = [], fallbackGrams = null) {
  return (Array.isArray(mealSlots) ? mealSlots : []).map((slot) => {
    const source = toPlain(slot);
    const proteinGrams = resolveStoredProteinGrams(source, fallbackGrams);
    for (const field of INTERNAL_SLOT_FIELDS) delete source[field];
    return {
      ...source,
      ...(proteinGrams ? { proteinGrams } : {}),
    };
  });
}

function buildPublicEntitlementGroups(projection = {}) {
  return (Array.isArray(projection.grams) ? projection.grams : []).map((row) => ({
    proteinGrams: normalizeNonNegativeInteger(row && row.proteinGrams),
    requiredMeals: normalizeNonNegativeInteger(row && row.mealsPerDay),
  })).filter((row) => row.proteinGrams > 0 && row.requiredMeals > 0);
}

function resolveDeliveryMode(batch = {}) {
  const delivery = batch.deliverySnapshot && typeof batch.deliverySnapshot === "object"
    ? batch.deliverySnapshot
    : {};
  return String(delivery.mode || delivery.type || "").trim().toLowerCase() || null;
}

function buildPublicEntitlementPackages(batches = [], businessDate = "") {
  const targetDate = normalizeDateString(businessDate);
  return (Array.isArray(batches) ? batches : []).map((batch) => {
    const packageId = String(batch && batch._id || "");
    const remainingMeals = normalizeNonNegativeInteger(batch && batch.remainingMeals);
    return {
      packageId,
      planId: batch && batch.planId ? String(batch.planId) : null,
      status: String(batch && batch.status || ""),
      requestedStartDate: normalizeDateString(batch && batch.requestedStartDate) || null,
      effectiveStartDate: normalizeDateString(batch && batch.effectiveStartDate) || null,
      endDate: normalizeDateString(batch && batch.endDate) || null,
      validityEndDate: normalizeDateString(
        batch && (batch.validityEndDate || batch.endDate)
      ) || null,
      mealsPerDay: normalizeNonNegativeInteger(batch && batch.mealsPerDay),
      proteinGrams: normalizeNonNegativeInteger(batch && batch.proteinGrams),
      totalMeals: normalizeNonNegativeInteger(batch && batch.totalMeals),
      remainingMeals,
      reservedMeals: normalizeNonNegativeInteger(batch && batch.reservedMeals),
      consumedMeals: normalizeNonNegativeInteger(batch && batch.consumedMeals),
      forfeitedMeals: normalizeNonNegativeInteger(batch && batch.forfeitedMeals),
      deliveryMode: resolveDeliveryMode(batch),
      spendableNow: Boolean(
        targetDate
        && remainingMeals > 0
        && isBatchProjectableOnDate(batch, targetDate)
      ),
    };
  }).filter((row) => Boolean(row.packageId));
}

module.exports = {
  INTERNAL_SLOT_FIELDS,
  buildPublicEntitlementGroups,
  buildPublicEntitlementPackages,
  serializeMealSlotsForClient,
};
