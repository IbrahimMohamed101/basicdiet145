"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionDayAppendOperation = require("../../models/SubscriptionDayAppendOperation");
const SubscriptionDailyAddonOperation = require("../../models/SubscriptionDailyAddonOperation");
const lockService = require("./subscriptionDayMutationLockService");

const DEFAULT_STALE_MS = 5 * 60 * 1000;
const APPEND_TERMINAL = new Set(["completed", "payment_pending", "compensated", "failed"]);
const ADDON_TERMINAL = new Set(["completed", "consumed", "released", "compensated", "failed"]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (typeof value === "object" && typeof value.toHexString === "function") return String(value.toHexString()).trim();
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function isStale(record, now = new Date(), staleMs = DEFAULT_STALE_MS) {
  const last = dateMs(record && (record.lastAttemptAt || record.updatedAt || record.startedAt));
  return !last || now.getTime() - last >= staleMs;
}

function slotKey(slot, index) {
  return clean(slot && (slot.slotKey || (slot.slotIndex ? `slot_${slot.slotIndex}` : ""))) || `slot_${index + 1}`;
}

function expectedSlotsPresent(day, operation) {
  const present = new Set((Array.isArray(day && day.mealSlots) ? day.mealSlots : []).map(slotKey));
  return (Array.isArray(operation && operation.expectedSlotKeys) ? operation.expectedSlotKeys : [])
    .map(clean)
    .filter(Boolean)
    .every((key) => present.has(key));
}

function allocationStateMap(subscription) {
  return new Map((Array.isArray(subscription && subscription.baseMealAllocations) ? subscription.baseMealAllocations : [])
    .map((row) => [clean(row && row.allocationKey), clean(row && row.state)]));
}

function classifyAppendOperation({ operation, day, subscription, addonOperations = [], now = new Date(), staleMs = DEFAULT_STALE_MS } = {}) {
  if (!operation) return { kind: "append", classification: "missing_operation", safeAction: null };
  if (APPEND_TERMINAL.has(operation.status)) {
    return { kind: "append", classification: "terminal", safeAction: null };
  }
  if (!day) {
    return { kind: "append", classification: "day_missing", safeAction: null, requiresManualReview: true };
  }

  const stale = isStale(operation, now, staleMs);
  const currentRevision = clean(day.plannerRevisionHash);
  const previousRevision = clean(operation.previousPlannerRevisionHash);
  const appliedRevision = clean(operation.appliedPlannerRevisionHash);
  const slotsPresent = expectedSlotsPresent(day, operation);

  if (operation.status === "started" && stale && currentRevision === previousRevision && !slotsPresent) {
    return {
      kind: "append",
      classification: "stale_before_day_save",
      safeAction: "fail_stale_started",
      stale,
      slotsPresent,
      currentRevision,
    };
  }

  if (operation.status === "recovery_required") {
    return {
      kind: "append",
      classification: "recovery_required",
      safeAction: null,
      requiresManualReview: true,
      stale,
      slotsPresent,
      currentRevision,
      appliedRevision,
    };
  }

  if (operation.status === "addons_reserved" && stale && slotsPresent && appliedRevision && currentRevision === appliedRevision) {
    const stateByKey = allocationStateMap(subscription);
    const allocationKeys = (operation.allocationKeys || []).map(clean).filter(Boolean);
    const previousConfirmed = Boolean(operation.previousDaySnapshot
      && [operation.previousDaySnapshot.plannerState, operation.previousDaySnapshot.planningState].includes("confirmed"));
    const allocationsValid = previousConfirmed
      ? allocationKeys.length === (operation.expectedSlotKeys || []).length
        && allocationKeys.every((key) => ["reserved", "consumed", "forfeited"].includes(stateByKey.get(key)))
      : allocationKeys.length === 0
        || allocationKeys.every((key) => ["reserved", "consumed", "forfeited"].includes(stateByKey.get(key)));
    const addonIntermediate = addonOperations.some((row) => ["started", "balance_reserved", "day_applied"].includes(clean(row && row.status)));

    if (allocationsValid && !addonIntermediate) {
      return {
        kind: "append",
        classification: "durably_settled_not_finalized",
        safeAction: "finalize_completed",
        stale,
        slotsPresent,
        allocationsValid,
      };
    }
  }

  return {
    kind: "append",
    classification: "resume_or_manual_review",
    safeAction: null,
    requiresManualReview: true,
    stale,
    slotsPresent,
    currentRevision,
    previousRevision,
    appliedRevision,
  };
}

function findBucket(subscription, operation) {
  const wanted = clean(operation && operation.balanceBucketId);
  return (Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [])
    .find((row) => clean(row && (row._id || row.balanceBucketId)) === wanted) || null;
}

function findDaySelection(day, operation) {
  const key = clean(operation && operation.allocationKey);
  return (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .find((row) => clean(row && row.dailyAllocationKey) === key) || null;
}

function classifyDailyAddonOperation({ operation, day, subscription, now = new Date(), staleMs = DEFAULT_STALE_MS } = {}) {
  if (!operation) return { kind: "daily_addon", classification: "missing_operation", safeAction: null };
  if (ADDON_TERMINAL.has(operation.status)) {
    return { kind: "daily_addon", classification: "terminal", safeAction: null };
  }
  const stale = isStale(operation, now, staleMs);
  const selection = findDaySelection(day, operation);
  const bucket = findBucket(subscription, operation);
  const allocationKey = clean(operation.allocationKey);
  const reservationKeys = new Set((bucket && bucket.reservationKeys || []).map(clean));
  const consumedKeys = new Set((bucket && bucket.consumedAllocationKeys || []).map(clean));
  const releasedKeys = new Set((bucket && bucket.releasedAllocationKeys || []).map(clean));
  const selectionState = clean(selection && selection.addonSettlementState);

  if (stale && selection && ["reserved", "consumed", "released"].includes(selectionState)) {
    const ledgerMatches = selectionState === "reserved"
      ? reservationKeys.has(allocationKey)
      : selectionState === "consumed"
        ? consumedKeys.has(allocationKey)
        : releasedKeys.has(allocationKey);
    if (ledgerMatches) {
      return {
        kind: "daily_addon",
        classification: "projection_and_ledger_agree",
        safeAction: selectionState === "reserved" ? "finalize_completed" : `finalize_${selectionState}`,
        stale,
        selectionState,
      };
    }
  }

  if (operation.status === "started" && stale && !selection
    && !reservationKeys.has(allocationKey)
    && !consumedKeys.has(allocationKey)
    && !releasedKeys.has(allocationKey)) {
    return {
      kind: "daily_addon",
      classification: "stale_before_balance_reserve",
      safeAction: "fail_stale_started",
      stale,
    };
  }

  return {
    kind: "daily_addon",
    classification: "ledger_projection_mismatch",
    safeAction: null,
    requiresManualReview: true,
    stale,
    selectionState: selectionState || null,
    reservationRecorded: reservationKeys.has(allocationKey),
    consumedRecorded: consumedKeys.has(allocationKey),
    releasedRecorded: releasedKeys.has(allocationKey),
  };
}

async function applyAppendAction(operation, analysis, now = new Date()) {
  if (analysis.safeAction === "fail_stale_started") {
    const updated = await SubscriptionDayAppendOperation.findOneAndUpdate(
      { _id: operation._id, status: "started", active: true },
      {
        $set: {
          status: "failed",
          active: false,
          failedAt: now,
          failureStep: "stale_before_day_save",
          errorCode: "STALE_APPEND_OPERATION",
          errorMessage: "Recovery closed a stale append that never changed the day",
          leaseExpiresAt: null,
        },
      },
      { new: true }
    );
    if (updated) {
      await lockService.releaseDayMutationLock({
        subscriptionDayId: operation.subscriptionDayId,
        token: operation.leaseToken,
      }).catch(() => {});
    }
    return updated;
  }

  if (analysis.safeAction === "finalize_completed") {
    const updated = await SubscriptionDayAppendOperation.findOneAndUpdate(
      { _id: operation._id, status: "addons_reserved", active: true },
      {
        $set: {
          status: "completed",
          active: false,
          completedAt: now,
          failureStep: null,
          errorCode: null,
          errorMessage: null,
          leaseExpiresAt: null,
        },
      },
      { new: true }
    );
    if (updated) {
      await lockService.releaseDayMutationLock({
        subscriptionDayId: operation.subscriptionDayId,
        token: operation.leaseToken,
      }).catch(() => {});
    }
    return updated;
  }
  return null;
}

async function applyDailyAddonAction(operation, analysis, now = new Date()) {
  if (analysis.safeAction === "fail_stale_started") {
    return SubscriptionDailyAddonOperation.findOneAndUpdate(
      { _id: operation._id, status: "started" },
      {
        $set: {
          status: "failed",
          failedAt: now,
          errorCode: "STALE_DAILY_ADDON_OPERATION",
          errorMessage: "Recovery closed a stale daily add-on operation before balance reservation",
        },
      },
      { new: true }
    );
  }

  const targetStatus = analysis.safeAction === "finalize_completed"
    ? "completed"
    : analysis.safeAction === "finalize_consumed"
      ? "consumed"
      : analysis.safeAction === "finalize_released"
        ? "released"
        : null;
  if (!targetStatus) return null;
  const timestampField = targetStatus === "completed"
    ? "completedAt"
    : targetStatus === "consumed"
      ? "consumedAt"
      : "releasedAt";
  return SubscriptionDailyAddonOperation.findOneAndUpdate(
    { _id: operation._id, status: { $in: ["started", "balance_reserved", "day_applied"] } },
    { $set: { status: targetStatus, [timestampField]: now, errorCode: null, errorMessage: null } },
    { new: true }
  );
}

async function inspectAndRecoverOperations({
  apply = false,
  operationType = "all",
  operationId = null,
  limit = 100,
  staleMs = DEFAULT_STALE_MS,
  now = new Date(),
} = {}) {
  const report = { apply, staleMs, append: [], dailyAddon: [], changedCount: 0 };

  if (["all", "append"].includes(operationType)) {
    const query = operationId ? { _id: operationId } : { status: { $nin: [...APPEND_TERMINAL] } };
    const operations = await SubscriptionDayAppendOperation.find(query).sort({ updatedAt: 1 }).limit(limit).lean();
    for (const operation of operations) {
      const [day, subscription, addonOperations] = await Promise.all([
        SubscriptionDay.findById(operation.subscriptionDayId).lean(),
        Subscription.findById(operation.subscriptionId).select("baseMealAllocations addonBalance").lean(),
        SubscriptionDailyAddonOperation.find({ subscriptionDayId: operation.subscriptionDayId }).lean(),
      ]);
      const analysis = classifyAppendOperation({ operation, day, subscription, addonOperations, now, staleMs });
      let changed = false;
      if (apply && analysis.safeAction) changed = Boolean(await applyAppendAction(operation, analysis, now));
      if (changed) report.changedCount += 1;
      report.append.push({
        operationId: clean(operation._id),
        subscriptionId: clean(operation.subscriptionId),
        dayId: clean(operation.subscriptionDayId),
        date: operation.date,
        status: operation.status,
        ...analysis,
        changed,
      });
    }
  }

  if (["all", "daily-addon"].includes(operationType)) {
    const query = operationId ? { _id: operationId } : { status: { $nin: [...ADDON_TERMINAL] } };
    const operations = await SubscriptionDailyAddonOperation.find(query).sort({ updatedAt: 1 }).limit(limit).lean();
    for (const operation of operations) {
      const [day, subscription] = await Promise.all([
        SubscriptionDay.findById(operation.subscriptionDayId).lean(),
        Subscription.findById(operation.subscriptionId).select("addonBalance").lean(),
      ]);
      const analysis = classifyDailyAddonOperation({ operation, day, subscription, now, staleMs });
      let changed = false;
      if (apply && analysis.safeAction) changed = Boolean(await applyDailyAddonAction(operation, analysis, now));
      if (changed) report.changedCount += 1;
      report.dailyAddon.push({
        operationId: clean(operation._id),
        subscriptionId: clean(operation.subscriptionId),
        dayId: clean(operation.subscriptionDayId),
        date: operation.date,
        allocationKey: operation.allocationKey,
        status: operation.status,
        ...analysis,
        changed,
      });
    }
  }

  report.reviewRequiredCount = [...report.append, ...report.dailyAddon]
    .filter((row) => row.requiresManualReview).length;
  report.safeActionCount = [...report.append, ...report.dailyAddon]
    .filter((row) => row.safeAction).length;
  return report;
}

module.exports = {
  DEFAULT_STALE_MS,
  classifyAppendOperation,
  classifyDailyAddonOperation,
  inspectAndRecoverOperations,
  isStale,
};
