"use strict";

const ActivityLog = require("../../models/ActivityLog");
const { MANUAL_DEDUCTION_ACTION } = require("../dashboard/manualDeduction/constants");
const {
  buildSubscriptionDashboardTracking,
} = require("./subscriptionDashboardTrackingService");

const FULFILLED_DAY_STATUSES = new Set(["fulfilled", "delivered"]);
const CONSUMED_WITHOUT_PREPARATION_STATUS = "consumed_without_preparation";
const OPERATIONAL_DAY_STATUSES = new Set([
  "in_preparation",
  "preparing",
  "ready_for_delivery",
  "ready_for_pickup",
  "out_for_delivery",
]);
const EXCEPTION_DAY_STATUSES = new Set([
  "frozen",
  "skipped",
  "delivery_canceled",
  "canceled_at_branch",
  "no_show",
]);

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(asNumber(value, 0)));
}

function percentage(value, total) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function serializeManualDeduction(log) {
  const meta = log && log.meta && typeof log.meta === "object" ? log.meta : {};
  return {
    id: log && log._id ? String(log._id) : null,
    businessDate: meta.businessDate || null,
    deducted: {
      regularMeals: nonNegativeInteger(meta.deductedRegularMeals),
      premiumMeals: nonNegativeInteger(meta.deductedPremiumMeals),
      totalMeals: nonNegativeInteger(meta.deductedTotalMeals),
      addons: Array.isArray(meta.deductedAddons) ? meta.deductedAddons : [],
    },
    fulfillmentMethod: meta.fulfillmentMethod || null,
    reason: String(meta.reason || ""),
    notes: String(meta.notes || ""),
    actor: {
      id: meta.actorId || (log && log.byUserId ? String(log.byUserId) : null),
      role: meta.actorRole || (log && log.byRole ? String(log.byRole) : null),
    },
    createdAt: log && log.createdAt ? log.createdAt : null,
  };
}

async function loadManualDeductions(subscriptionId) {
  const logs = await ActivityLog.find({
    entityType: "subscription",
    entityId: subscriptionId,
    action: MANUAL_DEDUCTION_ACTION,
  })
    .select("_id meta byUserId byRole createdAt")
    .sort({ createdAt: 1 })
    .lean();

  return logs.map(serializeManualDeduction);
}

function resolveDayStatus(day = {}) {
  return String(day.dayStatus || day.status || "").trim().toLowerCase();
}

function resolveTrackingState({ day, status, receivedMeals, consumedWithoutPreparationMeals }) {
  const selectedMeals = nonNegativeInteger(day && day.selectedMeals);
  const isPast = Boolean(day && day.isPast);
  const isToday = Boolean(day && day.isToday);

  if (receivedMeals > 0) return "received";
  if (consumedWithoutPreparationMeals > 0) return "consumed_without_preparation";
  if (EXCEPTION_DAY_STATUSES.has(status) || nonNegativeInteger(day && day.forfeitedMeals) > 0) {
    return "exception";
  }
  if (isPast && status === "locked" && selectedMeals === 0) return "missed_selection";
  if (OPERATIONAL_DAY_STATUSES.has(status) || (status === "locked" && selectedMeals > 0)) {
    return "in_progress";
  }
  if (selectedMeals > 0) return "planned";
  if (isToday && status === "open") return "available_today";
  if (!isPast) return "upcoming";
  return "historical_empty";
}

function resolveTrackingStatusLabel(day, trackingState) {
  switch (trackingState) {
    case "received":
      return "تم الاستلام";
    case "consumed_without_preparation":
      return "محسوم بدون تحضير";
    case "missed_selection":
      return "انتهى بدون اختيار";
    case "available_today":
      return "متاح اليوم";
    case "upcoming":
      return "غير متاح للاختيار بعد";
    case "planned":
      return "تم اختيار الوجبات";
    default:
      return String(day && day.statusLabel || day && day.dayStatus || day && day.status || "غير محدد");
  }
}

function normalizeTrackingDays(days = []) {
  return (Array.isArray(days) ? days : []).map((day) => {
    const status = resolveDayStatus(day);
    const timelineConsumedMeals = nonNegativeInteger(day && day.receivedMeals);
    const receivedMeals = FULFILLED_DAY_STATUSES.has(status)
      ? timelineConsumedMeals
      : 0;
    const consumedWithoutPreparationMeals = status === CONSUMED_WITHOUT_PREPARATION_STATUS
      ? timelineConsumedMeals
      : 0;
    const otherDayConsumedMeals = Math.max(
      0,
      timelineConsumedMeals - receivedMeals - consumedWithoutPreparationMeals
    );
    const trackingState = resolveTrackingState({
      day,
      status,
      receivedMeals,
      consumedWithoutPreparationMeals,
    });

    return {
      ...day,
      consumedMeals: timelineConsumedMeals,
      receivedMeals,
      consumedWithoutPreparationMeals,
      otherDayConsumedMeals,
      trackingState,
      statusLabel: resolveTrackingStatusLabel(day, trackingState),
    };
  });
}

function buildDayConsumptionBreakdown(days = []) {
  return (Array.isArray(days) ? days : []).reduce(
    (summary, day) => {
      const receivedMeals = nonNegativeInteger(day && day.receivedMeals);
      const consumedWithoutPreparationMeals = nonNegativeInteger(
        day && day.consumedWithoutPreparationMeals
      );
      const otherDayConsumedMeals = nonNegativeInteger(day && day.otherDayConsumedMeals);
      summary.receivedMeals += receivedMeals;
      summary.consumedWithoutPreparationMeals += consumedWithoutPreparationMeals;
      summary.otherDayConsumedMeals += otherDayConsumedMeals;
      if (receivedMeals > 0) summary.deliveredDays += 1;
      return summary;
    },
    {
      receivedMeals: 0,
      consumedWithoutPreparationMeals: 0,
      otherDayConsumedMeals: 0,
      deliveredDays: 0,
    }
  );
}

function reconcileTrackingSummary({
  subscription,
  baseSummary = {},
  manualDeductions = [],
  dayConsumption = null,
}) {
  const totalMeals = nonNegativeInteger(subscription.totalMeals ?? baseSummary.totalMeals);

  // Dashboard tracking must always expose persisted, unreserved capacity as the
  // available balance. The client timeline may optionally project
  // remainingMeals = available + reserved for mobile display, which must not be
  // reused in the accounting equation or labelled as available here.
  const availableMeals = nonNegativeInteger(
    subscription.remainingMeals
      ?? baseSummary.availableMeals
      ?? baseSummary.remainingMeals
  );
  const remainingMeals = availableMeals;
  const reservedMeals = nonNegativeInteger(
    subscription.reservedMeals ?? baseSummary.reservedMeals
  );
  const balanceConsumedMeals = nonNegativeInteger(
    subscription.consumedMeals
      ?? baseSummary.consumedMeals
      ?? Math.max(0, totalMeals - availableMeals)
  );
  const forfeitedMeals = nonNegativeInteger(
    subscription.forfeitedMeals ?? baseSummary.forfeitedMeals
  );

  // A customer receipt requires a fulfilled/delivered operational day. A
  // consumed allocation on a consumed_without_preparation day is a known
  // operational balance movement, but it is not physical customer receipt.
  const receivedMeals = nonNegativeInteger(
    dayConsumption && dayConsumption.receivedMeals !== undefined
      ? dayConsumption.receivedMeals
      : baseSummary.timelineReceivedMeals ?? baseSummary.receivedMeals
  );
  const consumedWithoutPreparationMeals = nonNegativeInteger(
    dayConsumption && dayConsumption.consumedWithoutPreparationMeals
  );
  const otherDayConsumedMeals = nonNegativeInteger(
    dayConsumption && dayConsumption.otherDayConsumedMeals
  );
  const timelineConsumedMeals =
    receivedMeals + consumedWithoutPreparationMeals + otherDayConsumedMeals;
  const deliveredDays = nonNegativeInteger(
    dayConsumption && dayConsumption.deliveredDays !== undefined
      ? dayConsumption.deliveredDays
      : baseSummary.deliveredDays
  );

  const manualDeductedMeals = manualDeductions.reduce(
    (sum, row) => sum + nonNegativeInteger(row && row.deducted && row.deducted.totalMeals),
    0
  );

  const attributedConsumedMeals = timelineConsumedMeals + manualDeductedMeals;
  const consumedAttributionDifference = balanceConsumedMeals - attributedConsumedMeals;
  const otherConsumedMeals = Math.max(0, consumedAttributionDifference);
  const overAttributedMeals = Math.max(0, -consumedAttributionDifference);
  const displayRemainingMeals = availableMeals + reservedMeals;

  // Entitlement v2 invariant:
  // total = available + reserved + consumed + forfeited.
  // Legacy subscriptions normally reduce to total = remaining + consumed.
  const accountedBalanceMeals = availableMeals + reservedMeals + balanceConsumedMeals + forfeitedMeals;
  const balanceEquationDifference = totalMeals - accountedBalanceMeals;

  return {
    ...baseSummary,
    totalMeals,
    consumedMeals: balanceConsumedMeals,
    balanceConsumedMeals,
    receivedMeals,
    timelineReceivedMeals: receivedMeals,
    timelineConsumedMeals,
    consumedWithoutPreparationMeals,
    otherDayConsumedMeals,
    deliveredDays,
    manualDeductedMeals,
    otherConsumedMeals,
    overAttributedMeals,
    unattributedConsumedMeals: otherConsumedMeals,
    remainingMeals,
    availableMeals,
    displayRemainingMeals,
    reservedMeals,
    forfeitedMeals,
    unconsumedMeals: Math.max(0, displayRemainingMeals),
    progressPercent: percentage(receivedMeals, totalMeals),
    balanceUsagePercent: percentage(balanceConsumedMeals + forfeitedMeals, totalMeals),
    reconciliation: {
      status: consumedAttributionDifference === 0 ? "balanced" : "difference",
      authoritativeSource:
        baseSummary.reconciliation && baseSummary.reconciliation.authoritativeSource
          ? baseSummary.reconciliation.authoritativeSource
          : Number(subscription.entitlementVersion || 0) >= 2
            ? "base_meal_allocation_ledger"
            : "subscription_balance_legacy",
      consumedMeals: balanceConsumedMeals,
      balanceConsumedMeals,
      receivedMeals,
      timelineConsumedMeals,
      consumedWithoutPreparationMeals,
      otherDayConsumedMeals,
      attributedToTimeline: timelineConsumedMeals,
      manualDeductedMeals,
      attributedKnownTotal: attributedConsumedMeals,
      otherConsumedMeals,
      overAttributedMeals,
      difference: consumedAttributionDifference,
    },
    balanceIntegrity: {
      status: balanceEquationDifference === 0 ? "balanced" : "difference",
      totalMeals,
      remainingMeals: availableMeals,
      reservedMeals,
      consumedMeals: balanceConsumedMeals,
      forfeitedMeals,
      accountedMeals: accountedBalanceMeals,
      difference: balanceEquationDifference,
    },
  };
}

async function buildSubscriptionDashboardTrackingReadModel({
  subscription,
  timeline,
  lang = "ar",
  businessDate = null,
}) {
  const [baseTracking, manualDeductions] = await Promise.all([
    buildSubscriptionDashboardTracking({
      subscription,
      timeline,
      lang,
      businessDate,
    }),
    loadManualDeductions(subscription._id),
  ]);

  const days = normalizeTrackingDays(baseTracking.days);
  const dayConsumption = buildDayConsumptionBreakdown(days);
  const summary = reconcileTrackingSummary({
    subscription,
    baseSummary: baseTracking.summary,
    manualDeductions,
    dayConsumption,
  });

  return {
    ...baseTracking,
    contractVersion: "dashboard_subscription_tracking.v2",
    summary,
    adjustments: {
      manualDeductions,
      totals: {
        manualDeductedMeals: summary.manualDeductedMeals,
        consumedWithoutPreparationMeals: summary.consumedWithoutPreparationMeals,
        otherDayConsumedMeals: summary.otherDayConsumedMeals,
        otherConsumedMeals: summary.otherConsumedMeals,
        forfeitedMeals: summary.forfeitedMeals,
      },
    },
    days,
  };
}

module.exports = {
  buildDayConsumptionBreakdown,
  buildSubscriptionDashboardTrackingReadModel,
  loadManualDeductions,
  normalizeTrackingDays,
  reconcileTrackingSummary,
  resolveTrackingState,
  serializeManualDeduction,
};
