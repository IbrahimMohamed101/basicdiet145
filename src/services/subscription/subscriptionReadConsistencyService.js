"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const SubscriptionDailyAddonOperation = require("../../models/SubscriptionDailyAddonOperation");
const SubscriptionDayAppendOperation = require("../../models/SubscriptionDayAppendOperation");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");

const ELIGIBLE_DAY_STATUSES = new Set([
  "open",
  "locked",
  "in_preparation",
  "ready_for_delivery",
  "out_for_delivery",
  "ready_for_pickup",
]);
const RELEASE_DAY_STATUSES = new Set([
  "skipped",
  "frozen",
  "delivery_canceled",
  "canceled_at_branch",
  "canceled",
  "no_show",
]);
const PENDING_DAILY_OPERATION_STATUSES = ["started", "balance_reserved", "day_applied"];
const PENDING_APPEND_STATUSES = [
  "started",
  "day_saved",
  "credits_reserved",
  "addons_reserved",
  "compensating",
  "recovery_required",
];

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    if (value && typeof value === "object" && typeof value.toHexString === "function") {
      return String(value.toHexString()).trim();
    }
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function positiveInt(value, fallback = 0) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function nonNegativeInt(value) {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function bucketId(bucket) {
  return clean(bucket && (bucket._id || bucket.balanceBucketId));
}

function entitlementIdentity(entitlement, index = 0) {
  const planId = clean(entitlement && (entitlement.addonPlanId || entitlement.addonId));
  const category = clean(entitlement && (entitlement.allowanceCategory || entitlement.category));
  return {
    planId,
    category,
    key: clean(entitlement && entitlement.entitlementKey) || `${category || "addon"}:${planId || index}`,
  };
}

function findBucket(subscription, entitlement, index = 0) {
  const rows = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance.filter(Boolean)
    : [];
  const identity = entitlementIdentity(entitlement, index);
  const requestedBucketId = clean(entitlement && entitlement.balanceBucketId);
  if (requestedBucketId) {
    const matches = rows.filter((row) => bucketId(row) === requestedBucketId);
    if (matches.length === 1) return matches[0];
  }
  if (identity.planId) {
    const matches = rows.filter((row) => clean(row && (row.addonPlanId || row.addonId)) === identity.planId);
    if (matches.length === 1) return matches[0];
  }
  if (identity.key) {
    const matches = rows.filter((row) => clean(row && row.entitlementKey) === identity.key);
    if (matches.length === 1) return matches[0];
  }
  if (identity.category) {
    const matches = rows.filter((row) => clean(row && (row.allowanceCategory || row.category)) === identity.category);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function selectionMatches(selection, entitlement, bucket, index = 0) {
  if (!selection) return false;
  const identity = entitlementIdentity(entitlement, index);
  const selectionBucket = clean(selection.balanceBucketId);
  if (selectionBucket && bucketId(bucket)) return selectionBucket === bucketId(bucket);
  const selectionKey = clean(selection.entitlementKey);
  if (selectionKey) return selectionKey === identity.key;
  const selectionPlan = clean(selection.addonPlanId);
  if (selectionPlan && identity.planId) return selectionPlan === identity.planId;
  return clean(selection.entitlementCategory || selection.category) === identity.category;
}

function isActiveSelection(selection) {
  return Boolean(selection && clean(selection.addonSettlementState) !== "released");
}

function isReservedSubscriptionSelection(selection) {
  return Boolean(
    selection
      && ["subscription", "wallet"].includes(clean(selection.source))
      && clean(selection.addonSettlementState || "reserved") === "reserved"
  );
}

function walletRows(subscription = {}) {
  return (Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [])
    .filter(Boolean)
    .map((row) => {
      const purchasedQty = Math.max(
        nonNegativeInt(row.purchasedQty),
        nonNegativeInt(row.includedTotalQty) + nonNegativeInt(row.extraPurchasedQty)
      );
      const remainingQty = nonNegativeInt(row.remainingQty);
      const reservedQty = nonNegativeInt(row.reservedQty);
      const consumedQty = nonNegativeInt(row.consumedQty);
      const accountedQty = remainingQty + reservedQty + consumedQty;
      return {
        balanceBucketId: bucketId(row) || null,
        entitlementKey: clean(row.entitlementKey) || null,
        purchasedQty,
        remainingQty,
        reservedQty,
        consumedQty,
        accountedQty,
        invariantValid: purchasedQty === accountedQty,
        balanceDriftQty: purchasedQty - accountedQty,
      };
    });
}

function expectedDailyAddonDeficits(day, subscription) {
  if (!day || !subscription || !ELIGIBLE_DAY_STATUSES.has(clean(day.status || "open"))) return [];
  const confirmed = day.plannerState === "confirmed"
    || day.planningState === "confirmed"
    || clean(day.status) !== "open";
  if (!confirmed) return [];
  const selections = Array.isArray(day.addonSelections) ? day.addonSelections : [];
  const entitlements = Array.isArray(subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  const deficits = [];
  entitlements.forEach((entitlement, index) => {
    const dailyQty = positiveInt(entitlement.quantityPerDay || entitlement.purchasedDailyQty, 1);
    const bucket = findBucket(subscription, entitlement, index);
    const activeCount = selections
      .filter(isActiveSelection)
      .filter((selection) => selectionMatches(selection, entitlement, bucket, index))
      .length;
    const missingQty = Math.max(0, dailyQty - activeCount);
    if (missingQty > 0 && nonNegativeInt(bucket && bucket.remainingQty) > 0) {
      deficits.push({
        entitlementKey: entitlementIdentity(entitlement, index).key,
        balanceBucketId: bucketId(bucket) || null,
        defaultDailyQty: dailyQty,
        activeQty: activeCount,
        missingQty: Math.min(missingQty, nonNegativeInt(bucket && bucket.remainingQty)),
      });
    }
  });
  return deficits;
}

function dayActions(day, subscription) {
  const selections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];
  const reserved = selections.filter(isReservedSubscriptionSelection);
  const actions = [];
  if (clean(day && day.status) === "fulfilled" && reserved.length > 0) {
    actions.push({ action: "consume_reserved_addons", quantity: reserved.length });
  }
  if (RELEASE_DAY_STATUSES.has(clean(day && day.status)) && reserved.length > 0) {
    actions.push({ action: "release_reserved_addons", quantity: reserved.length });
  }
  const deficits = expectedDailyAddonDeficits(day, subscription);
  if (deficits.length > 0) {
    actions.push({
      action: "reserve_missing_daily_defaults",
      quantity: deficits.reduce((sum, row) => sum + row.missingQty, 0),
      entitlements: deficits,
    });
  }
  return actions;
}

async function diagnoseDayDailyAddonState({ dayId, day: providedDay = null, subscription: providedSubscription = null } = {}) {
  const day = providedDay || (dayId ? await SubscriptionDay.findById(dayId).lean() : null);
  if (!day) {
    return {
      readOnly: true,
      reconciliationApplied: false,
      state: "not_found",
      actionsRequired: [],
    };
  }
  const subscription = providedSubscription || await Subscription.findById(day.subscriptionId).lean();
  if (!subscription) {
    return {
      readOnly: true,
      reconciliationApplied: false,
      state: "subscription_not_found",
      subscriptionDayId: clean(day._id),
      actionsRequired: [],
    };
  }

  const [pendingDailyOperations, pendingAppendOperations] = await Promise.all([
    SubscriptionDailyAddonOperation.find({
      subscriptionDayId: day._id,
      status: { $in: PENDING_DAILY_OPERATION_STATUSES },
    }).select("_id status allocationKey updatedAt").lean(),
    SubscriptionDayAppendOperation.find({
      subscriptionDayId: day._id,
      status: { $in: PENDING_APPEND_STATUSES },
    }).select("_id status failureStep leaseExpiresAt updatedAt").lean(),
  ]);
  const rows = walletRows(subscription);
  const actionsRequired = dayActions(day, subscription);
  const invariantValid = rows.every((row) => row.invariantValid);
  const hasPendingOperations = pendingDailyOperations.length > 0 || pendingAppendOperations.length > 0;
  const state = !invariantValid
    ? "data_inconsistent"
    : (actionsRequired.length > 0 || hasPendingOperations ? "action_required" : "consistent");

  return {
    readOnly: true,
    reconciliationApplied: false,
    reconciliationSource: "explicit_commands_and_recovery_workers",
    state,
    subscriptionDayId: clean(day._id),
    subscriptionId: clean(day.subscriptionId),
    date: day.date,
    dayStatus: day.status,
    invariantValid,
    walletRows: rows,
    actionsRequired,
    pendingOperations: {
      dailyAddons: pendingDailyOperations.map((row) => ({
        id: clean(row._id),
        status: row.status,
        allocationKey: row.allocationKey || null,
        updatedAt: row.updatedAt || null,
      })),
      deliveryAppend: pendingAppendOperations.map((row) => ({
        id: clean(row._id),
        status: row.status,
        failureStep: row.failureStep || null,
        leaseExpiresAt: row.leaseExpiresAt || null,
        updatedAt: row.updatedAt || null,
      })),
    },
  };
}

async function diagnoseDailyAddonsForDate({ date } = {}) {
  const days = await SubscriptionDay.find({ date }).lean();
  const subscriptionIds = [...new Set(days.map((day) => clean(day.subscriptionId)).filter(Boolean))];
  const subscriptions = await Subscription.find({ _id: { $in: subscriptionIds } }).lean();
  const subscriptionMap = new Map(subscriptions.map((subscription) => [clean(subscription._id), subscription]));
  const diagnostics = [];
  for (const day of days) {
    diagnostics.push(await diagnoseDayDailyAddonState({
      day,
      subscription: subscriptionMap.get(clean(day.subscriptionId)) || null,
    }));
  }
  return diagnostics;
}

async function diagnoseDailyAddonsForUser({ userId, date = null } = {}) {
  if (!userId) return null;
  const subscription = await Subscription.findOne({ userId, status: "active" })
    .sort({ createdAt: -1 })
    .lean();
  if (!subscription) return null;
  const resolvedDate = date || await getRestaurantBusinessDate();
  const day = await SubscriptionDay.findOne({ subscriptionId: subscription._id, date: resolvedDate }).lean();
  if (!day) {
    return {
      readOnly: true,
      reconciliationApplied: false,
      reconciliationSource: "explicit_commands_and_recovery_workers",
      state: "day_not_found",
      subscriptionId: clean(subscription._id),
      date: resolvedDate,
      invariantValid: walletRows(subscription).every((row) => row.invariantValid),
      walletRows: walletRows(subscription),
      actionsRequired: [],
    };
  }
  return diagnoseDayDailyAddonState({ day, subscription });
}

async function diagnosePickupRequest({ requestId, request: providedRequest = null } = {}) {
  const request = providedRequest || (requestId ? await SubscriptionPickupRequest.findById(requestId).lean() : null);
  if (!request) return null;
  const day = request.subscriptionDayId
    ? await SubscriptionDay.findById(request.subscriptionDayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId: request.subscriptionId, date: request.date }).lean();
  const dailyAddon = day ? await diagnoseDayDailyAddonState({ day }) : null;
  const pickupActions = [];
  if (
    Number(request.mealCount || 0) > 0
    && request.creditsReserved !== true
    && !request.creditsConsumedAt
    && !request.creditsReleasedAt
    && !["fulfilled", "no_show", "canceled"].includes(clean(request.status))
  ) {
    pickupActions.push({ action: "recover_pickup_reservation", quantity: Number(request.mealCount || 0) });
  }
  return {
    readOnly: true,
    reconciliationApplied: false,
    state: pickupActions.length > 0 || (dailyAddon && dailyAddon.state !== "consistent")
      ? "action_required"
      : "consistent",
    pickupRequestId: clean(request._id),
    reservationState: request.reservationState || (request.creditsReserved ? "reserved" : "pending"),
    actionsRequired: pickupActions,
    dailyAddon,
  };
}

module.exports = {
  diagnoseDailyAddonsForDate,
  diagnoseDailyAddonsForUser,
  diagnoseDayDailyAddonState,
  diagnosePickupRequest,
  expectedDailyAddonDeficits,
  walletRows,
};
