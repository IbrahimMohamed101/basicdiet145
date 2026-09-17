"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboard-test-secret";

const assert = require("assert");
const {
  buildAllocationCounts,
  buildTrackingSummary,
  isConsumedDayStatus,
  resolveDayReceivedMeals,
} = require("../src/services/subscription/subscriptionDashboardTrackingService");

(function run() {
  const subscription = {
    entitlementVersion: 2,
    totalMeals: 14,
    remainingMeals: 8,
    reservedMeals: 2,
    consumedMeals: 4,
    forfeitedMeals: 0,
    baseMealAllocations: [
      { date: "2026-07-30", state: "consumed", quantity: 1 },
      { date: "2026-07-30", state: "consumed", quantity: 1 },
      { date: "2026-07-31", state: "reserved", quantity: 1 },
      { date: "2026-07-31", state: "reserved", quantity: 1 },
      { date: "2026-08-01", state: "released", quantity: 1 },
    ],
  };

  const allocationMap = buildAllocationCounts(subscription);
  assert.deepStrictEqual(allocationMap.get("2026-07-30"), {
    consumed: 2,
    reserved: 0,
    released: 0,
    forfeited: 0,
    total: 2,
    hasLedger: true,
  });
  assert.strictEqual(allocationMap.get("2026-07-31").reserved, 2);
  assert.strictEqual(allocationMap.get("2026-08-01").released, 1);

  assert.strictEqual(isConsumedDayStatus("fulfilled"), true);
  assert.strictEqual(isConsumedDayStatus("consumed_without_preparation"), true);
  assert.strictEqual(isConsumedDayStatus("in_preparation"), false);

  assert.strictEqual(
    resolveDayReceivedMeals({
      timelineDay: { meals: { selected: 2, required: 2 }, dayStatus: "fulfilled" },
      rawDay: { status: "fulfilled" },
      allocation: allocationMap.get("2026-07-30"),
    }),
    2,
    "the allocation ledger is the per-day consumption authority"
  );

  assert.strictEqual(
    resolveDayReceivedMeals({
      timelineDay: { meals: { selected: 2, required: 2 }, dayStatus: "fulfilled" },
      rawDay: { status: "fulfilled" },
      allocation: null,
    }),
    2,
    "legacy rows fall back to the consumed day status and selected meal count"
  );

  assert.strictEqual(
    resolveDayReceivedMeals({
      timelineDay: { meals: { selected: 2, required: 2 }, dayStatus: "in_preparation" },
      rawDay: { status: "in_preparation" },
      allocation: null,
    }),
    0,
    "planned or prepared meals are not counted as received"
  );

  const summary = buildTrackingSummary({
    subscription,
    timeline: {
      mealBalance: {
        totalMeals: 14,
        remainingMeals: 8,
        availableMeals: 8,
        reservedMeals: 2,
        consumedMeals: 4,
      },
    },
    dayRows: [
      { receivedMeals: 2, selectedMeals: 2 },
      { receivedMeals: 1, selectedMeals: 2 },
      { receivedMeals: 0, selectedMeals: 2 },
    ],
  });

  assert.strictEqual(summary.totalMeals, 14);
  assert.strictEqual(summary.receivedMeals, 4);
  assert.strictEqual(summary.remainingMeals, 8);
  assert.strictEqual(summary.reservedMeals, 2);
  assert.strictEqual(summary.timelineReceivedMeals, 3);
  assert.strictEqual(summary.unattributedConsumedMeals, 1);
  assert.strictEqual(summary.reconciliation.status, "difference");
  assert.strictEqual(summary.reconciliation.authoritativeSource, "base_meal_allocation_ledger");
  assert.strictEqual(summary.deliveredDays, 2);
  assert.strictEqual(summary.plannedMeals, 6);

  console.log("Subscription dashboard tracking service checks passed.");
})();
