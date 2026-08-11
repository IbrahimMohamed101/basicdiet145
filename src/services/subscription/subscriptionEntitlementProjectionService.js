"use strict";

const dateUtils = require("../../utils/date");

const PROJECTABLE_STATUSES = new Set(["paid_scheduled", "active"]);
const HISTORICAL_PROJECTABLE_STATUSES = new Set([
  "paid_scheduled",
  "active",
  "exhausted",
  "expired",
  "canceled",
]);

function normalizeDateString(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return dateUtils.toKSADateString(parsed);
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizePositiveCount(value) {
  const parsed = normalizeCount(value);
  return parsed > 0 ? parsed : 0;
}

function resolveBatchDailyContribution(
  batch,
  { historicalLifecycle = false } = {}
) {
  const mealsPerDay = normalizePositiveCount(batch && batch.mealsPerDay);
  if (!mealsPerDay) return 0;
  if (historicalLifecycle) return mealsPerDay;

  // New reservations cannot exceed credits that are still available in the
  // exact batch. This prevents a final one-credit balance from exposing three
  // required slots and then failing only during confirmation.
  const remainingMeals = normalizeCount(batch && batch.remainingMeals);
  return Math.min(mealsPerDay, remainingMeals);
}

function buildFulfillmentSignature(batch = {}) {
  const delivery = batch.deliverySnapshot && typeof batch.deliverySnapshot === "object"
    ? batch.deliverySnapshot
    : {};
  const mode = String(delivery.mode || delivery.type || "").trim().toLowerCase();
  const pickupLocationId = String(delivery.pickupLocationId || "").trim();
  const zoneId = String(delivery.zoneId || "").trim();
  const window = String(
    delivery.window
    || (delivery.slot && delivery.slot.window)
    || delivery.deliveryWindow
    || ""
  ).trim();
  const address = delivery.address && typeof delivery.address === "object"
    ? delivery.address
    : {};
  const addressIdentity = [
    address.city,
    address.district,
    address.street,
    address.building,
    address.apartment,
    address.line1,
  ].map((value) => String(value || "").trim().toLowerCase()).join("|");

  // Pickup fulfillment is owned by the branch (and pickup window when one is
  // explicitly selected). Customer delivery-address data can still be carried
  // in canonical snapshots for compatibility, but it is irrelevant to whether
  // two pickup entitlements can overlap. Including it here incorrectly shifts
  // same-branch pickup purchases to a later date.
  if (mode === "pickup") {
    return [mode, pickupLocationId, window].join("::");
  }

  // Delivery fulfillment depends on the destination profile. A stale or
  // irrelevant pickupLocationId must not affect delivery compatibility.
  if (mode === "delivery") {
    return [mode, zoneId, window, addressIdentity].join("::");
  }

  // Preserve a fail-safe identity for historical/unknown fulfillment modes.
  return [mode, pickupLocationId, zoneId, window, addressIdentity].join("::");
}

function isHistoricalLifecycleAvailable(batch, targetDate) {
  const status = String(batch && batch.status || "");
  if (!HISTORICAL_PROJECTABLE_STATUSES.has(status)) return false;

  if (status === "canceled") {
    const canceledDate = normalizeDateString(batch && batch.canceledAt);
    return Boolean(canceledDate && targetDate < canceledDate);
  }
  if (status === "exhausted") {
    const exhaustedDate = normalizeDateString(batch && batch.exhaustedAt);
    return !exhaustedDate || targetDate <= exhaustedDate;
  }
  // Expired batches still own their historical dates. The date-window check
  // below prevents them from contributing to today's balance.
  return true;
}

function isBatchProjectableOnDate(
  batch,
  businessDate,
  { historicalLifecycle = false } = {}
) {
  if (!batch) return false;

  const targetDate = normalizeDateString(businessDate);
  const startDate = normalizeDateString(batch.effectiveStartDate);
  const validityEndDate = normalizeDateString(batch.validityEndDate || batch.endDate);
  if (!targetDate || !startDate || !validityEndDate) return false;
  if (!(startDate <= targetDate && targetDate <= validityEndDate)) return false;

  if (historicalLifecycle) {
    return isHistoricalLifecycleAvailable(batch, targetDate);
  }
  return PROJECTABLE_STATUSES.has(String(batch.status || ""));
}

function buildGramContributions(
  projectableBatches,
  { historicalLifecycle = false } = {}
) {
  const byGrams = new Map();

  for (const batch of projectableBatches) {
    const proteinGrams = normalizePositiveCount(batch.proteinGrams);
    const mealsPerDay = resolveBatchDailyContribution(batch, { historicalLifecycle });
    if (!proteinGrams || !mealsPerDay) continue;

    const current = byGrams.get(proteinGrams) || {
      proteinGrams,
      mealsPerDay: 0,
      batchIds: [],
    };
    current.mealsPerDay += mealsPerDay;
    if (batch._id) current.batchIds.push(String(batch._id));
    byGrams.set(proteinGrams, current);
  }

  return Array.from(byGrams.values()).sort(
    (left, right) => left.proteinGrams - right.proteinGrams
  );
}

function buildFulfillmentProjection(
  projectableBatches,
  { historicalLifecycle = false } = {}
) {
  const bySignature = new Map();

  for (const batch of projectableBatches) {
    const contribution = resolveBatchDailyContribution(batch, { historicalLifecycle });
    if (!contribution) continue;
    const signature = buildFulfillmentSignature(batch);
    const current = bySignature.get(signature) || {
      signature,
      mealsPerDay: 0,
      batchIds: [],
    };
    current.mealsPerDay += contribution;
    if (batch._id) current.batchIds.push(String(batch._id));
    bySignature.set(signature, current);
  }

  const profiles = Array.from(bySignature.values());
  return {
    profiles,
    hasConflict: profiles.length > 1,
  };
}

function projectSubscriptionEntitlements({
  batches = [],
  businessDate,
  historicalLifecycle = false,
} = {}) {
  const targetDate = normalizeDateString(businessDate);
  const projectableBatches = (Array.isArray(batches) ? batches : [])
    .filter((batch) => isBatchProjectableOnDate(batch, targetDate, { historicalLifecycle }))
    .sort((left, right) => {
      const leftEnd = normalizeDateString(left.validityEndDate || left.endDate);
      const rightEnd = normalizeDateString(right.validityEndDate || right.endDate);
      if (leftEnd !== rightEnd) return leftEnd.localeCompare(rightEnd);

      const leftStart = normalizeDateString(left.effectiveStartDate);
      const rightStart = normalizeDateString(right.effectiveStartDate);
      if (leftStart !== rightStart) return leftStart.localeCompare(rightStart);

      return String(left._id || "").localeCompare(String(right._id || ""));
    });

  const mealBalance = projectableBatches.reduce(
    (summary, batch) => {
      summary.totalMeals += normalizeCount(batch.totalMeals);
      summary.remainingMeals += normalizeCount(batch.remainingMeals);
      summary.reservedMeals += normalizeCount(batch.reservedMeals);
      summary.consumedMeals += normalizeCount(batch.consumedMeals);
      summary.forfeitedMeals += normalizeCount(batch.forfeitedMeals);
      return summary;
    },
    {
      totalMeals: 0,
      remainingMeals: 0,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
    }
  );

  const dailyContributions = projectableBatches.map((batch) => ({
    entitlementBatchId: String(batch._id || ""),
    meals: resolveBatchDailyContribution(batch, { historicalLifecycle }),
  }));
  const requiredMealsPerDay = dailyContributions.reduce(
    (sum, contribution) => sum + contribution.meals,
    0
  );
  const grams = buildGramContributions(projectableBatches, { historicalLifecycle });
  const fulfillment = buildFulfillmentProjection(projectableBatches, { historicalLifecycle });

  return {
    businessDate: targetDate,
    batchCount: projectableBatches.length,
    batchIds: projectableBatches.map((batch) => String(batch._id || "")).filter(Boolean),
    dailyContributions,
    mealBalance,
    requiredMealsPerDay,
    grams,
    hasMixedProteinGrams: grams.length > 1,
    fulfillmentProfiles: fulfillment.profiles,
    hasFulfillmentConflict: fulfillment.hasConflict,
  };
}

module.exports = {
  HISTORICAL_PROJECTABLE_STATUSES,
  PROJECTABLE_STATUSES,
  buildFulfillmentSignature,
  isBatchProjectableOnDate,
  isHistoricalLifecycleAvailable,
  normalizeDateString,
  projectSubscriptionEntitlements,
  resolveBatchDailyContribution,
};
