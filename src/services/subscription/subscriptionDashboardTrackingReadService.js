"use strict";

const ActivityLog = require("../../models/ActivityLog");
const { MANUAL_DEDUCTION_ACTION } = require("../dashboard/manualDeduction/constants");
const {
  buildSubscriptionDashboardTracking,
} = require("./subscriptionDashboardTrackingService");

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

function reconcileTrackingSummary({ subscription, baseSummary = {}, manualDeductions = [] }) {
  const totalMeals = nonNegativeInteger(baseSummary.totalMeals ?? subscription.totalMeals);
  const remainingMeals = nonNegativeInteger(baseSummary.remainingMeals ?? subscription.remainingMeals);
  const availableMeals = nonNegativeInteger(baseSummary.availableMeals ?? remainingMeals);
  const reservedMeals = nonNegativeInteger(baseSummary.reservedMeals ?? subscription.reservedMeals);
  const balanceConsumedMeals = nonNegativeInteger(
    baseSummary.consumedMeals
      ?? subscription.consumedMeals
      ?? Math.max(0, totalMeals - remainingMeals)
  );
  const forfeitedMeals = nonNegativeInteger(baseSummary.forfeitedMeals ?? subscription.forfeitedMeals);

  // Only a fulfilled/consumed day (or a consumed base allocation for that day)
  // represents a meal the customer actually received. The aggregate consumed
  // counter also includes manual deductions, so it must not be labelled as
  // customer receipt.
  const receivedMeals = nonNegativeInteger(
    baseSummary.timelineReceivedMeals ?? baseSummary.receivedMeals
  );
  const manualDeductedMeals = manualDeductions.reduce(
    (sum, row) => sum + nonNegativeInteger(row && row.deducted && row.deducted.totalMeals),
    0
  );

  const attributedConsumedMeals = receivedMeals + manualDeductedMeals;
  const consumedAttributionDifference = balanceConsumedMeals - attributedConsumedMeals;
  const otherConsumedMeals = Math.max(0, consumedAttributionDifference);
  const overAttributedMeals = Math.max(0, -consumedAttributionDifference);

  // Entitlement v2 invariant:
  // total = available + reserved + consumed + forfeited.
  // Legacy subscriptions normally reduce to total = remaining + consumed.
  const accountedBalanceMeals = remainingMeals + reservedMeals + balanceConsumedMeals + forfeitedMeals;
  const balanceEquationDifference = totalMeals - accountedBalanceMeals;

  return {
    ...baseSummary,
    totalMeals,
    consumedMeals: balanceConsumedMeals,
    balanceConsumedMeals,
    receivedMeals,
    timelineReceivedMeals: receivedMeals,
    manualDeductedMeals,
    otherConsumedMeals,
    overAttributedMeals,
    unattributedConsumedMeals: otherConsumedMeals,
    remainingMeals,
    availableMeals,
    reservedMeals,
    forfeitedMeals,
    unconsumedMeals: Math.max(0, availableMeals + reservedMeals),
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
      attributedToTimeline: receivedMeals,
      manualDeductedMeals,
      attributedKnownTotal: attributedConsumedMeals,
      otherConsumedMeals,
      overAttributedMeals,
      difference: consumedAttributionDifference,
    },
    balanceIntegrity: {
      status: balanceEquationDifference === 0 ? "balanced" : "difference",
      totalMeals,
      remainingMeals,
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

  const summary = reconcileTrackingSummary({
    subscription,
    baseSummary: baseTracking.summary,
    manualDeductions,
  });

  return {
    ...baseTracking,
    contractVersion: "dashboard_subscription_tracking.v2",
    summary,
    adjustments: {
      manualDeductions,
      totals: {
        manualDeductedMeals: summary.manualDeductedMeals,
        otherConsumedMeals: summary.otherConsumedMeals,
        forfeitedMeals: summary.forfeitedMeals,
      },
    },
  };
}

module.exports = {
  buildSubscriptionDashboardTrackingReadModel,
  loadManualDeductions,
  reconcileTrackingSummary,
  serializeManualDeduction,
};
