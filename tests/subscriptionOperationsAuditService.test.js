"use strict";

const assert = require("assert");

const {
  allocationCounters,
  balanceSummary,
  buildDayAudit,
  classifyAcquisitionSource,
  manualDeductionLedger,
  resolveRange,
} = require("../src/services/dashboard/subscriptionOperationsAuditService");

function run() {
  const range = resolveRange({
    now: new Date("2026-08-02T18:00:00Z"),
  });
  assert.strictEqual(range.from, "2026-07-31");
  assert.strictEqual(range.to, "2026-08-02");
  assert.strictEqual(range.days, 3);

  const branch = classifyAcquisitionSource(
    { contractSource: "admin_create" },
    [{
      _id: "507f191e810c19729de86001",
      type: "subscription_activation",
      status: "paid",
      provider: "cash",
      source: "dashboard_subscription_cash",
      amount: 70000,
    }]
  );
  assert.strictEqual(branch.code, "branch");
  assert.strictEqual(branch.payment.amountHalala, 70000);

  const app = classifyAcquisitionSource(
    { contractSource: "customer_checkout" },
    [{
      _id: "507f191e810c19729de86002",
      type: "subscription_activation",
      status: "paid",
      provider: "moyasar",
      amount: 70200,
    }]
  );
  assert.strictEqual(app.code, "app");

  const counters = allocationCounters([
    { allocationKey: "a", state: "reserved", quantity: 1 },
    { allocationKey: "b", state: "consumed", quantity: 1 },
    { allocationKey: "b", state: "consumed", quantity: 1 },
  ]);
  assert.strictEqual(counters.reserved, 1);
  assert.strictEqual(counters.consumed, 2);
  assert.strictEqual(counters.duplicateKeys, 1);

  const subscription = {
    deliveryMode: "delivery",
    selectedMealsPerDay: 2,
    entitlementVersion: 2,
    totalMeals: 30,
    remainingMeals: 25,
    reservedMeals: 2,
    consumedMeals: 3,
    forfeitedMeals: 0,
    baseMealAllocations: [
      { allocationKey: "d1:1", date: "2026-08-01", state: "consumed", quantity: 1 },
      { allocationKey: "d1:2", date: "2026-08-01", state: "consumed", quantity: 1 },
    ],
  };
  const balance = balanceSummary(subscription, [{ totalMeals: 1 }]);
  assert.strictEqual(balance.balanced, true);
  assert.strictEqual(balance.aggregateOnlyConsumedMeals, 1);
  assert.strictEqual(balance.unattributedAggregateConsumption, 0);

  const deductionLedger = manualDeductionLedger([
    {
      _id: "507f191e810c19729de86031",
      entityId: "507f191e810c19729de86030",
      action: "manual_subscription_meal_deduction",
      meta: { deductedTotalMeals: 6, deductedRegularMeals: 6, deductedPremiumMeals: 0 },
    },
    {
      _id: "507f191e810c19729de86032",
      entityId: "507f191e810c19729de86030",
      action: "manual_subscription_meal_deduction",
      meta: { deductedTotalMeals: 4, deductedRegularMeals: 3, deductedPremiumMeals: 1 },
    },
  ], [{
    _id: "507f191e810c19729de86033",
    entityId: "507f191e810c19729de86030",
    action: "subscription_manual_deduction_reversal",
    meta: {
      repairKey: "test-reversal",
      reversedActivityLogIds: ["507f191e810c19729de86031"],
      restoredRegularMeals: 6,
      restoredPremiumMeals: 0,
    },
  }]);
  assert.strictEqual(deductionLedger.grossManualDeductions, 10);
  assert.strictEqual(deductionLedger.reversedManualDeductions, 6);
  assert.strictEqual(deductionLedger.netManualDeductions, 4);
  assert.strictEqual(deductionLedger.breakdown.net.regular, 3);
  assert.strictEqual(deductionLedger.breakdown.net.premium, 1);
  assert.strictEqual(
    balanceSummary(subscription, deductionLedger).manualConsumedMeals,
    4,
    "reversed deductions must not remain actual consumption"
  );

  const riskyDay = buildDayAudit({
    subscription,
    date: "2026-08-01",
    day: {
      _id: "507f191e810c19729de86011",
      date: "2026-08-01",
      status: "fulfilled",
      mealSlots: [
        { slotIndex: 1, status: "complete" },
        { slotIndex: 2, status: "complete" },
      ],
    },
    delivery: {
      _id: "507f191e810c19729de86012",
      date: "2026-08-01",
      status: "delivered",
    },
    pickupRequests: [],
    allocations: [
      { allocationKey: "d1:1", state: "consumed", quantity: 1 },
      { allocationKey: "d1:2", state: "consumed", quantity: 1 },
    ],
    manualDeductions: [{ totalMeals: 2 }],
    range: {
      from: "2026-07-31",
      to: "2026-08-02",
      today: "2026-08-02",
    },
  });

  assert.strictEqual(riskyDay.risk, "critical");
  assert(riskyDay.issues.some((row) => row.code === "MANUAL_AND_LEDGER_DEDUCTION_SAME_DAY"));
  assert(riskyDay.issues.some((row) => row.code === "DAY_DEDUCTION_EXCEEDS_EXPECTED"));

  const missingConsumption = buildDayAudit({
    subscription,
    date: "2026-08-01",
    day: {
      _id: "507f191e810c19729de86021",
      date: "2026-08-01",
      status: "fulfilled",
      mealSlots: [{ slotIndex: 1, status: "complete" }],
    },
    delivery: { status: "delivered" },
    pickupRequests: [],
    allocations: [],
    manualDeductions: [],
    range: {
      from: "2026-07-31",
      to: "2026-08-02",
      today: "2026-08-02",
    },
  });
  assert(missingConsumption.issues.some((row) => row.code === "FULFILLED_WITHOUT_RECORDED_CONSUMPTION"));

  console.log("subscription operations audit service tests passed");
}

run();
