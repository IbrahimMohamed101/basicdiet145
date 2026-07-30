"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
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
      totalMeals: 7,
      remainingMeals: 6,
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
  assert.equal(summary.progressPercent, 0);
  assert.equal(summary.balanceUsagePercent, 14);
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
      totalMeals: 7,
      remainingMeals: 4,
      availableMeals: 4,
      reservedMeals: 1,
      consumedMeals: 2,
      forfeitedMeals: 0,
      timelineReceivedMeals: 1,
    },
    manualDeductions: [],
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
      totalMeals: 7,
      remainingMeals: 5,
      availableMeals: 5,
      reservedMeals: 0,
      consumedMeals: 1,
      forfeitedMeals: 0,
      timelineReceivedMeals: 1,
    },
    manualDeductions: [],
  });

  assert.equal(summary.balanceIntegrity.status, "difference");
  assert.equal(summary.balanceIntegrity.difference, 1);
}

console.log("dashboard subscription tracking read-model tests passed");
