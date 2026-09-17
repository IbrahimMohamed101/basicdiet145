"use strict";

const TERMINAL_RELEASE_STATUSES = new Set([
  "skipped",
  "frozen",
  "delivery_canceled",
  "canceled_at_branch",
  "canceled",
  "no_show",
]);
const FULFILLED_STATUSES = new Set(["fulfilled", "consumed_without_preparation"]);
const NON_TERMINAL_PICKUP_STATUSES = new Set([
  "requested",
  "locked",
  "confirmed",
  "in_preparation",
  "ready_for_pickup",
]);
const NON_TERMINAL_APPEND_STATUSES = new Set([
  "started",
  "day_saved",
  "credits_reserved",
  "addons_reserved",
  "compensating",
  "recovery_required",
]);
const NON_TERMINAL_ADDON_OPERATION_STATUSES = new Set([
  "started",
  "balance_reserved",
  "day_applied",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) ? number : null;
}

function duplicateStrings(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const key = clean(value);
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}

function stringSet(values) {
  return new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean));
}

function overlaps(...sets) {
  const counts = new Map();
  for (const set of sets) {
    for (const key of set) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key).sort();
}

function issue({ severity = "error", code, message, context = {} }) {
  return { severity, code, message, context };
}

function auditMealWallet(subscription) {
  const issues = [];
  const total = finiteInteger(subscription && subscription.totalMeals);
  const remaining = finiteInteger(subscription && subscription.remainingMeals);
  const reserved = finiteInteger(subscription && subscription.reservedMeals);
  const consumed = finiteInteger(subscription && subscription.consumedMeals);
  const forfeited = finiteInteger(subscription && subscription.forfeitedMeals);

  for (const [field, value] of [
    ["totalMeals", total],
    ["remainingMeals", remaining],
    ["reservedMeals", reserved],
    ["consumedMeals", consumed],
    ["forfeitedMeals", forfeited],
  ]) {
    const raw = subscription && subscription[field];
    if (raw !== undefined && raw !== null && (value === null || value < 0)) {
      issues.push(issue({
        code: "INVALID_MEAL_COUNTER",
        message: `${field} must be a non-negative integer`,
        context: { field, value: raw },
      }));
    }
  }

  if ([total, remaining, reserved, consumed, forfeited].every((value) => value !== null)) {
    const accounted = remaining + reserved + consumed + forfeited;
    if (accounted !== total) {
      issues.push(issue({
        code: "MEAL_BALANCE_DRIFT",
        message: "totalMeals does not equal remaining + reserved + consumed + forfeited",
        context: { totalMeals: total, remainingMeals: remaining, reservedMeals: reserved, consumedMeals: consumed, forfeitedMeals: forfeited, accounted, drift: total - accounted },
      }));
    }
  }

  const allocations = Array.isArray(subscription && subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : [];
  const duplicateAllocationKeys = duplicateStrings(allocations.map((row) => row && row.allocationKey));
  if (duplicateAllocationKeys.length) {
    issues.push(issue({
      code: "DUPLICATE_BASE_ALLOCATION_KEY",
      message: "baseMealAllocations contains duplicate allocation keys",
      context: { allocationKeys: duplicateAllocationKeys },
    }));
  }

  const activeTuples = allocations
    .filter((row) => row && ["reserved", "consumed", "forfeited"].includes(clean(row.state)))
    .map((row) => `${clean(row.dayId)}:${clean(row.slotKey)}`)
    .filter((key) => !key.startsWith(":"));
  const duplicateActiveTuples = duplicateStrings(activeTuples);
  if (duplicateActiveTuples.length) {
    issues.push(issue({
      code: "DUPLICATE_ACTIVE_DAY_SLOT_ALLOCATION",
      message: "more than one active meal allocation targets the same day and slot",
      context: { daySlotKeys: duplicateActiveTuples },
    }));
  }

  return issues;
}

function auditAddonBuckets(subscription) {
  const issues = [];
  const buckets = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance
    : [];

  buckets.forEach((bucket, index) => {
    const bucketId = clean(bucket && (bucket._id || bucket.balanceBucketId)) || `index:${index}`;
    const numeric = {};
    for (const field of ["purchasedQty", "remainingQty", "reservedQty", "consumedQty"]) {
      numeric[field] = finiteInteger(bucket && bucket[field]);
      if (numeric[field] === null || numeric[field] < 0) {
        issues.push(issue({
          code: "INVALID_ADDON_COUNTER",
          message: `${field} must be a non-negative integer`,
          context: { bucketId, field, value: bucket && bucket[field] },
        }));
      }
    }

    if (Object.values(numeric).every((value) => value !== null && value >= 0)) {
      const accounted = numeric.remainingQty + numeric.reservedQty + numeric.consumedQty;
      if (accounted !== numeric.purchasedQty) {
        issues.push(issue({
          code: "ADDON_BALANCE_DRIFT",
          message: "purchasedQty does not equal remaining + reserved + consumed",
          context: { bucketId, ...numeric, accounted, drift: numeric.purchasedQty - accounted },
        }));
      }
    }

    const ledgers = {
      reservationKeys: stringSet(bucket && bucket.reservationKeys),
      consumedAllocationKeys: stringSet(bucket && bucket.consumedAllocationKeys),
      releasedAllocationKeys: stringSet(bucket && bucket.releasedAllocationKeys),
    };
    for (const field of Object.keys(ledgers)) {
      const duplicates = duplicateStrings(bucket && bucket[field]);
      if (duplicates.length) {
        issues.push(issue({
          code: "DUPLICATE_ADDON_LEDGER_KEY",
          message: `${field} contains duplicate allocation keys`,
          context: { bucketId, field, allocationKeys: duplicates },
        }));
      }
    }
    const overlappingKeys = overlaps(
      ledgers.reservationKeys,
      ledgers.consumedAllocationKeys,
      ledgers.releasedAllocationKeys
    );
    if (overlappingKeys.length) {
      issues.push(issue({
        code: "ADDON_LEDGER_STATE_OVERLAP",
        message: "an add-on allocation key appears in more than one settlement ledger",
        context: { bucketId, allocationKeys: overlappingKeys },
      }));
    }
  });

  return issues;
}

function buildBucketIndexes(subscription) {
  const buckets = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance
    : [];
  const byId = new Map();
  const byEntitlementKey = new Map();
  const byPlanId = new Map();
  buckets.forEach((bucket) => {
    const id = clean(bucket && (bucket._id || bucket.balanceBucketId));
    if (id) byId.set(id, bucket);
    const entitlementKey = clean(bucket && bucket.entitlementKey);
    if (entitlementKey) {
      const rows = byEntitlementKey.get(entitlementKey) || [];
      rows.push(bucket);
      byEntitlementKey.set(entitlementKey, rows);
    }
    const planId = clean(bucket && (bucket.addonPlanId || bucket.addonId));
    if (planId) {
      const rows = byPlanId.get(planId) || [];
      rows.push(bucket);
      byPlanId.set(planId, rows);
    }
  });
  return { byId, byEntitlementKey, byPlanId };
}

function resolveSelectionBucket(selection, indexes) {
  const bucketId = clean(selection && selection.balanceBucketId);
  if (bucketId && indexes.byId.has(bucketId)) return indexes.byId.get(bucketId);
  const entitlementKey = clean(selection && selection.entitlementKey);
  const byKey = entitlementKey ? indexes.byEntitlementKey.get(entitlementKey) || [] : [];
  if (byKey.length === 1) return byKey[0];
  const planId = clean(selection && (selection.addonPlanId || selection.addonId));
  const byPlan = planId ? indexes.byPlanId.get(planId) || [] : [];
  return byPlan.length === 1 ? byPlan[0] : null;
}

function isSubscriptionFundedSelection(selection) {
  const source = clean(selection && selection.source);
  const state = clean(selection && selection.addonSettlementState);
  return Boolean(selection && (
    selection.autoDailyAddon === true
    || selection.dailyEntitlement === true
    || ["subscription", "wallet"].includes(source)
    || ["reserved", "consumed", "released"].includes(state)
  ));
}

function auditDaySelections(subscription, days) {
  const issues = [];
  const indexes = buildBucketIndexes(subscription);
  const globalKeys = [];

  for (const day of Array.isArray(days) ? days : []) {
    const dayId = clean(day && day._id);
    const dayStatus = clean(day && day.status);
    const selections = (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
      .filter(isSubscriptionFundedSelection);

    for (const selection of selections) {
      const state = clean(selection && selection.addonSettlementState);
      const allocationKey = clean(selection && selection.dailyAllocationKey);
      const context = {
        dayId,
        date: day && day.date,
        dayStatus,
        selectionId: clean(selection && selection._id),
        allocationKey: allocationKey || null,
        settlementState: state || null,
      };

      if (["reserved", "consumed", "released"].includes(state) && !allocationKey) {
        issues.push(issue({
          code: "MISSING_DAILY_ADDON_ALLOCATION_KEY",
          message: "a settled subscription add-on selection has no dailyAllocationKey",
          context,
        }));
        continue;
      }
      if (allocationKey) globalKeys.push(allocationKey);

      const bucket = resolveSelectionBucket(selection, indexes);
      if (!bucket) {
        issues.push(issue({
          code: "ADDON_SELECTION_BUCKET_NOT_FOUND",
          message: "the add-on selection cannot be linked to exactly one balance bucket",
          context: { ...context, balanceBucketId: clean(selection && selection.balanceBucketId) || null, entitlementKey: clean(selection && selection.entitlementKey) || null },
        }));
        continue;
      }

      const ledgers = {
        reserved: stringSet(bucket.reservationKeys),
        consumed: stringSet(bucket.consumedAllocationKeys),
        released: stringSet(bucket.releasedAllocationKeys),
      };
      if (state && ledgers[state] && !ledgers[state].has(allocationKey)) {
        issues.push(issue({
          code: "ADDON_PROJECTION_LEDGER_MISMATCH",
          message: "the day selection settlement state is missing from the matching wallet ledger",
          context: { ...context, bucketId: clean(bucket._id || bucket.balanceBucketId) },
        }));
      }

      if (state === "reserved" && FULFILLED_STATUSES.has(dayStatus)) {
        issues.push(issue({
          code: "FULFILLED_DAY_HAS_RESERVED_ADDON",
          message: "a fulfilled day still has a reserved subscription add-on",
          context,
        }));
      }
      if (state === "reserved" && TERMINAL_RELEASE_STATUSES.has(dayStatus)) {
        issues.push(issue({
          code: "TERMINAL_DAY_HAS_RESERVED_ADDON",
          message: "a skipped, canceled, frozen, or no-show day still has a reserved subscription add-on",
          context,
        }));
      }
      if (state === "consumed" && !FULFILLED_STATUSES.has(dayStatus)) {
        issues.push(issue({
          code: "ADDON_CONSUMED_BEFORE_FULFILLMENT",
          message: "a subscription add-on is consumed before the day reaches fulfillment",
          context,
        }));
      }
    }
  }

  const duplicates = duplicateStrings(globalKeys);
  if (duplicates.length) {
    issues.push(issue({
      code: "DUPLICATE_DAILY_ADDON_ALLOCATION_KEY",
      message: "dailyAllocationKey is reused by more than one day selection",
      context: { allocationKeys: duplicates },
    }));
  }
  return issues;
}

function recordAgeMs(record, now) {
  const raw = record && (record.lastAttemptAt || record.updatedAt || record.startedAt || record.createdAt);
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) && time > 0 ? Math.max(0, now.getTime() - time) : null;
}

function auditPendingOperations({ pickupRequests = [], appendOperations = [], addonOperations = [], now = new Date(), staleMs = 5 * 60 * 1000 } = {}) {
  const issues = [];
  for (const request of pickupRequests) {
    const status = clean(request && request.status);
    if (NON_TERMINAL_PICKUP_STATUSES.has(status) && request.creditsReserved !== true) {
      issues.push(issue({
        code: "PICKUP_REQUEST_RESERVATION_INCOMPLETE",
        message: "a non-terminal Pickup request does not have confirmed meal-credit reservation",
        context: { requestId: clean(request._id), status, reservationState: clean(request.reservationState) || null },
      }));
    }
  }
  for (const operation of appendOperations) {
    const status = clean(operation && operation.status);
    const ageMs = recordAgeMs(operation, now);
    if (NON_TERMINAL_APPEND_STATUSES.has(status) && (ageMs === null || ageMs >= staleMs)) {
      issues.push(issue({
        severity: "warning",
        code: "STALE_DELIVERY_APPEND_OPERATION",
        message: "a Delivery append operation is non-terminal beyond the stale threshold",
        context: { operationId: clean(operation._id), status, ageMs },
      }));
    }
  }
  for (const operation of addonOperations) {
    const status = clean(operation && operation.status);
    const ageMs = recordAgeMs(operation, now);
    if (NON_TERMINAL_ADDON_OPERATION_STATUSES.has(status) && (ageMs === null || ageMs >= staleMs)) {
      issues.push(issue({
        severity: "warning",
        code: "STALE_DAILY_ADDON_OPERATION",
        message: "a daily add-on operation is non-terminal beyond the stale threshold",
        context: { operationId: clean(operation._id), status, allocationKey: clean(operation.allocationKey) || null, ageMs },
      }));
    }
  }
  return issues;
}

function auditSubscriptionEntitlements({ subscription, days = [], pickupRequests = [], appendOperations = [], addonOperations = [], now = new Date(), staleMs } = {}) {
  const subscriptionId = clean(subscription && subscription._id);
  const issues = [
    ...auditMealWallet(subscription),
    ...auditAddonBuckets(subscription),
    ...auditDaySelections(subscription, days),
    ...auditPendingOperations({ pickupRequests, appendOperations, addonOperations, now, staleMs }),
  ].map((row) => ({ ...row, subscriptionId }));

  const errors = issues.filter((row) => row.severity === "error");
  const warnings = issues.filter((row) => row.severity === "warning");
  return {
    subscriptionId,
    status: clean(subscription && subscription.status) || null,
    ok: errors.length === 0,
    issueCount: issues.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    issues,
  };
}

module.exports = {
  auditAddonBuckets,
  auditDaySelections,
  auditMealWallet,
  auditPendingOperations,
  auditSubscriptionEntitlements,
  duplicateStrings,
  isSubscriptionFundedSelection,
};
