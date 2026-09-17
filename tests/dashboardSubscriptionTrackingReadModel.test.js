"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  normalizeTrackingSubscriptionCounters,
} = require("../src/services/subscription/subscriptionDashboardTrackingCompatibilityService");
const {
  buildDayConsumptionBreakdown,
  normalizeTrackingDays,
  reconcileTrackingSummary,
} = require("../src/services/subscription/subscriptionDashboardTrackingReadService");

function buildSubscription(overrides = {}) {
  return {
    totalMeals: 7,
    remainingMeals: 6,
    consumedMeals: 1,
    reservedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    ...overrides,
  };
}

function manualDeduction(totalMeals) {
  return {
    deducted: {
      regularMeals: totalMeals,
      premiumMeals: 0,
      totalMeals,
      addons: [],
    },
  };
}

{
  const summary = reconcileTrackingSummary({
    subscription: buildSubscription(),
    baseSummary: {
      // Simulate an optional mobile projection. Dashboard accounting must still
      // use the persisted available balance from the Subscription document.
      totalMeals: 7,
      remainingMeals: 7,
      availableMeals: 6,
      reservedMeals: 0,
      consumedMeals: 1,
      forfeitedMeals: 0,
      timelineReceivedMeals: 0,
      deliveredDays: 0,
      timelineDays: 8,
      plannedMeals: 0,
      reconciliation: { authoritativeSource: "base_meal_allocation_ledger" },
    },
    manualDeductions: [manualDeduction(1)],
  });

  assert.equal(summary.receivedMeals, 0, "manual deduction must not be shown as customer receipt");
  assert.equal(summary.manualDeductedMeals, 1);
  assert.equal(summary.otherConsumedMeals, 0);
  assert.equal(summary.remainingMeals, 6);
  assert.equal(summary.availableMeals, 6);
  assert.equal(summary.progressPercent, 0);
  assert.equal(summary.balanceUsagePercent, 14);
  assert.equal(summary.reconciliation.status, "balanced");
  assert.equal(summary.balanceIntegrity.status, "balanced");
}

{
  const days = normalizeTrackingDays([
    {
      date: "2026-07-20",
      isPast: true,
      dayStatus: "fulfilled",
      status: "delivered",
      receivedMeals: 1,
      selectedMeals: 1,
    },
    {
      date: "2026-07-21",
      isPast: true,
      dayStatus: "consumed_without_preparation",
      status: "consumed_without_preparation",
      receivedMeals: 1,
      selectedMeals: 1,
    },
    {
      date: "2026-07-22",
      isPast: true,
      dayStatus: "locked",
      status: "locked",
      receivedMeals: 0,
      selectedMeals: 0,
    },
    {
      date: "2026-08-01",
      isPast: false,
      dayStatus: "locked",
      status: "locked",
      receivedMeals: 0,
      selectedMeals: 0,
    },
  ]);
  const breakdown = buildDayConsumptionBreakdown(days);

  assert.equal(days[0].receivedMeals, 1);
  assert.equal(days[0].trackingState, "received");
  assert.equal(days[0].statusLabel, "تم الاستلام");
  assert.equal(days[1].receivedMeals, 0, "non-prepared consumption is not physical receipt");
  assert.equal(days[1].consumedWithoutPreparationMeals, 1);
  assert.equal(days[1].trackingState, "consumed_without_preparation");
  assert.equal(days[2].trackingState, "missed_selection");
  assert.equal(days[2].statusLabel, "انتهى بدون اختيار");
  assert.equal(days[3].trackingState, "upcoming");
  assert.equal(days[3].statusLabel, "غير متاح للاختيار بعد");
  assert.deepEqual(breakdown, {
    receivedMeals: 1,
    consumedWithoutPreparationMeals: 1,
    otherDayConsumedMeals: 0,
    deliveredDays: 1,
  });

  const summary = reconcileTrackingSummary({
    subscription: buildSubscription({
      totalMeals: 7,
      remainingMeals: 5,
      consumedMeals: 2,
    }),
    baseSummary: {
      totalMeals: 7,
      timelineDays: 8,
      plannedMeals: 2,
      reconciliation: { authoritativeSource: "base_meal_allocation_ledger" },
    },
    manualDeductions: [],
    dayConsumption: breakdown,
  });

  assert.equal(summary.receivedMeals, 1);
  assert.equal(summary.timelineConsumedMeals, 2);
  assert.equal(summary.consumedWithoutPreparationMeals, 1);
  assert.equal(summary.otherConsumedMeals, 0);
  assert.equal(summary.deliveredDays, 1);
  assert.equal(summary.reconciliation.status, "balanced");
  assert.equal(summary.balanceIntegrity.status, "balanced");
}

{
  const summary = reconcileTrackingSummary({
    subscription: buildSubscription({
      totalMeals: 7,
      remainingMeals: 4,
      consumedMeals: 2,
      reservedMeals: 1,
    }),
    baseSummary: {
      timelineDays: 8,
      plannedMeals: 1,
      reconciliation: { authoritativeSource: "base_meal_allocation_ledger" },
    },
    manualDeductions: [],
    dayConsumption: {
      receivedMeals: 1,
      consumedWithoutPreparationMeals: 0,
      otherDayConsumedMeals: 0,
      deliveredDays: 1,
    },
  });

  assert.equal(summary.receivedMeals, 1);
  assert.equal(summary.otherConsumedMeals, 1);
  assert.equal(summary.reconciliation.status, "difference");
  assert.equal(summary.reconciliation.difference, 1);
  assert.equal(summary.balanceIntegrity.status, "balanced");
  assert.equal(summary.unconsumedMeals, 5);
}

{
  const summary = reconcileTrackingSummary({
    subscription: buildSubscription({
      totalMeals: 7,
      remainingMeals: 5,
      consumedMeals: 1,
      reservedMeals: 0,
    }),
    baseSummary: {
      timelineReceivedMeals: 1,
    },
    manualDeductions: [],
  });

  assert.equal(summary.balanceIntegrity.status, "difference");
  assert.equal(summary.balanceIntegrity.difference, 1);
}

{
  const legacy = normalizeTrackingSubscriptionCounters({
    totalMeals: 7,
    remainingMeals: 5,
    consumedMeals: 0,
    reservedMeals: 4,
    entitlementVersion: 1,
  });
  assert.equal(legacy.consumedMeals, undefined);
  assert.equal(legacy.reservedMeals, 0);

  const summary = reconcileTrackingSummary({
    subscription: legacy,
    baseSummary: {
      consumedMeals: 2,
      timelineReceivedMeals: 2,
      reconciliation: { authoritativeSource: "subscription_balance_legacy" },
    },
    manualDeductions: [],
  });
  assert.equal(summary.consumedMeals, 2);
  assert.equal(summary.receivedMeals, 2);
  assert.equal(summary.balanceIntegrity.status, "balanced");
}

console.log("dashboard subscription tracking read-model tests passed");
