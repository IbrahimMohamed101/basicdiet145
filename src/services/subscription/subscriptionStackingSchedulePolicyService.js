"use strict";

const {
  buildFulfillmentSignature,
  normalizeDateString,
} = require("./subscriptionEntitlementProjectionService");

const COMMITTED_DAY_STATUSES = new Set([
  "locked",
  "in_preparation",
  "ready_for_pickup",
  "ready_for_delivery",
  "out_for_delivery",
  "fulfilled",
  "consumed_without_preparation",
  "no_show",
]);

function scheduleError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = 422;
  err.details = details;
  return err;
}

function dateToUtc(value) {
  const normalized = normalizeDateString(value);
  if (!normalized) {
    throw scheduleError("INVALID_STACKING_DATE", "A valid schedule date is required", { value });
  }
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateValue, days) {
  const date = dateToUtc(dateValue);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function differenceInDays(left, right) {
  return Math.round((dateToUtc(left).getTime() - dateToUtc(right).getTime()) / 86400000);
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const aStart = normalizeDateString(leftStart);
  const aEnd = normalizeDateString(leftEnd);
  const bStart = normalizeDateString(rightStart);
  const bEnd = normalizeDateString(rightEnd);
  return Boolean(aStart && aEnd && bStart && bEnd && aStart <= bEnd && bStart <= aEnd);
}

function isCommittedDay(day) {
  if (!day || typeof day !== "object") return false;
  if (COMMITTED_DAY_STATUSES.has(String(day.status || ""))) return true;
  if (["confirmed"].includes(String(day.plannerState || day.planningState || ""))) return true;
  return Boolean(day.lockedSnapshot || day.fulfilledSnapshot);
}

function normalizePurchaseWindow(purchase = {}) {
  const requestedStartDate = normalizeDateString(
    purchase.requestedStartDate || purchase.effectiveStartDate
  );
  const effectiveStartDate = normalizeDateString(
    purchase.effectiveStartDate || purchase.requestedStartDate
  );
  const endDate = normalizeDateString(purchase.endDate);
  const validityEndDate = normalizeDateString(purchase.validityEndDate || purchase.endDate);
  const daysCount = Number(purchase.daysCount || 0);

  if (!requestedStartDate || !effectiveStartDate || !endDate || !validityEndDate) {
    throw scheduleError(
      "INVALID_STACKING_PURCHASE_WINDOW",
      "Purchase start/end dates are required"
    );
  }
  if (!Number.isInteger(daysCount) || daysCount < 1) {
    throw scheduleError(
      "INVALID_STACKING_PURCHASE_WINDOW",
      "Purchase daysCount must be a positive integer"
    );
  }

  const expectedEndDate = addDays(effectiveStartDate, daysCount - 1);
  const timelineExtraDays = Math.max(0, differenceInDays(validityEndDate, endDate));
  return {
    requestedStartDate,
    effectiveStartDate,
    endDate: expectedEndDate,
    validityEndDate: addDays(expectedEndDate, timelineExtraDays),
    daysCount,
    timelineExtraDays,
  };
}

function projectWindowFromStart(window, startDate) {
  const effectiveStartDate = normalizeDateString(startDate);
  const endDate = addDays(effectiveStartDate, window.daysCount - 1);
  return {
    ...window,
    effectiveStartDate,
    endDate,
    validityEndDate: addDays(endDate, window.timelineExtraDays),
  };
}

function activeScheduleBatches(batches = []) {
  return (Array.isArray(batches) ? batches : []).filter((batch) => (
    batch && ["active", "paid_scheduled"].includes(String(batch.status || ""))
  ));
}

function findFulfillmentConflicts({ purchase, window, batches }) {
  const purchaseSignature = buildFulfillmentSignature(purchase);
  return activeScheduleBatches(batches).filter((batch) => {
    const batchStart = normalizeDateString(batch.effectiveStartDate);
    const batchEnd = normalizeDateString(batch.validityEndDate || batch.endDate);
    if (!rangesOverlap(window.effectiveStartDate, window.validityEndDate, batchStart, batchEnd)) {
      return false;
    }
    return buildFulfillmentSignature(batch) !== purchaseSignature;
  });
}

function resolveStackingPurchaseSchedule({
  purchase,
  existingBatches = [],
  businessDate,
  requestedStartDay = null,
} = {}) {
  if (!purchase || typeof purchase !== "object") {
    throw scheduleError("STACKING_PURCHASE_REQUIRED", "Purchase batch payload is required");
  }
  const normalizedBusinessDate = normalizeDateString(businessDate);
  if (!normalizedBusinessDate) {
    throw scheduleError("INVALID_STACKING_BUSINESS_DATE", "businessDate is required");
  }

  const originalWindow = normalizePurchaseWindow(purchase);
  let resolvedWindow = { ...originalWindow };
  const adjustments = [];

  if (
    resolvedWindow.effectiveStartDate <= normalizedBusinessDate
    && isCommittedDay(requestedStartDay)
  ) {
    resolvedWindow = projectWindowFromStart(
      resolvedWindow,
      addDays(normalizedBusinessDate, 1)
    );
    adjustments.push({
      reason: "REQUESTED_START_DAY_COMMITTED",
      from: originalWindow.effectiveStartDate,
      to: resolvedWindow.effectiveStartDate,
    });
  }

  // Repeat because shifting after one conflict can enter another incompatible
  // period. The monotonic start-date movement guarantees termination.
  for (let attempt = 0; attempt < activeScheduleBatches(existingBatches).length + 1; attempt += 1) {
    const conflicts = findFulfillmentConflicts({
      purchase,
      window: resolvedWindow,
      batches: existingBatches,
    });
    if (conflicts.length === 0) break;

    const latestConflictEnd = conflicts
      .map((batch) => normalizeDateString(batch.validityEndDate || batch.endDate))
      .sort()
      .at(-1);
    const nextStart = addDays(latestConflictEnd, 1);
    const previousStart = resolvedWindow.effectiveStartDate;
    resolvedWindow = projectWindowFromStart(resolvedWindow, nextStart);
    adjustments.push({
      reason: "FULFILLMENT_PROFILE_CONFLICT",
      from: previousStart,
      to: nextStart,
      conflictingBatchIds: conflicts.map((batch) => String(batch._id || "")).filter(Boolean),
    });
  }

  const unresolvedConflicts = findFulfillmentConflicts({
    purchase,
    window: resolvedWindow,
    batches: existingBatches,
  });
  if (unresolvedConflicts.length > 0) {
    throw scheduleError(
      "STACKING_FULFILLMENT_CONFLICT_UNRESOLVED",
      "Could not resolve incompatible fulfillment overlap",
      { conflictingBatchIds: unresolvedConflicts.map((batch) => String(batch._id || "")) }
    );
  }

  const overlappingBatches = activeScheduleBatches(existingBatches).filter((batch) => (
    rangesOverlap(
      resolvedWindow.effectiveStartDate,
      resolvedWindow.validityEndDate,
      batch.effectiveStartDate,
      batch.validityEndDate || batch.endDate
    )
  ));
  const purchaseGrams = Number(purchase.proteinGrams || 0);
  const mixedProteinGrams = overlappingBatches.some(
    (batch) => Number(batch.proteinGrams || 0) !== purchaseGrams
  );

  return {
    requestedStartDate: originalWindow.requestedStartDate,
    effectiveStartDate: resolvedWindow.effectiveStartDate,
    endDate: resolvedWindow.endDate,
    validityEndDate: resolvedWindow.validityEndDate,
    daysCount: resolvedWindow.daysCount,
    timelineExtraDays: resolvedWindow.timelineExtraDays,
    adjusted: adjustments.length > 0,
    adjustments,
    overlapsExistingBatches: overlappingBatches.length > 0,
    overlappingBatchIds: overlappingBatches
      .map((batch) => String(batch._id || ""))
      .filter(Boolean),
    mixedProteinGrams,
    startsNow: resolvedWindow.effectiveStartDate <= normalizedBusinessDate,
    shouldExposeBalanceNow:
      resolvedWindow.effectiveStartDate <= normalizedBusinessDate
      && normalizedBusinessDate <= resolvedWindow.validityEndDate,
  };
}

function applyResolvedScheduleToBatchPayload(purchase, resolution) {
  if (!purchase || !resolution) {
    throw scheduleError("STACKING_SCHEDULE_REQUIRED", "Purchase and schedule resolution are required");
  }
  return {
    ...purchase,
    requestedStartDate: resolution.requestedStartDate,
    effectiveStartDate: resolution.effectiveStartDate,
    endDate: resolution.endDate,
    validityEndDate: resolution.validityEndDate,
    status: resolution.shouldExposeBalanceNow ? "active" : "paid_scheduled",
    metadata: {
      ...(purchase.metadata && typeof purchase.metadata === "object" ? purchase.metadata : {}),
      scheduleResolution: {
        adjusted: resolution.adjusted,
        adjustments: resolution.adjustments,
        mixedProteinGrams: resolution.mixedProteinGrams,
      },
    },
  };
}

module.exports = {
  COMMITTED_DAY_STATUSES,
  addDays,
  applyResolvedScheduleToBatchPayload,
  differenceInDays,
  findFulfillmentConflicts,
  isCommittedDay,
  normalizePurchaseWindow,
  rangesOverlap,
  resolveStackingPurchaseSchedule,
};
