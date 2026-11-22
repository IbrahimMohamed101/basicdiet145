"use strict";

const assert = require("node:assert/strict");
const {
  reconcileSubscriptionMealLedger,
} = require("../src/services/subscription/subscriptionMealLedgerReconciliationService");

const NOW = new Date("2026-11-22T12:00:00Z");
const SUB = "0000000000000000000000a1";

function subscription(overrides = {}) {
  return {
    _id: SUB,
    status: "active",
    entitlementVersion: 2,
    selectedMealsPerDay: 3,
    totalMeals: 30,
    remainingMeals: 24,
    reservedMeals: 0,
    consumedMeals: 6,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    ...overrides,
  };
}

function legacyDay(date, id, meals = 3) {
  return {
    _id: id,
    date,
    status: "fulfilled",
    creditsDeducted: true,
    fulfilledSnapshot: { deductedCredits: meals },
  };
}

function manualLog(id, date, meals, extraMeta = {}) {
  return {
    _id: id,
    entityId: SUB,
    action: "manual_subscription_meal_deduction",
    createdAt: new Date(`${date}T08:00:00Z`),
    meta: { status: "committed", businessDate: date, deductedTotalMeals: meals, ...extraMeta },
  };
}

const codes = (report) => report.findings.map((finding) => finding.code).sort();

// 1. Legacy day snapshots explain the consumed counter.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription(),
    days: [legacyDay("2026-11-21", "d1"), legacyDay("2026-11-22", "d2")],
    now: NOW,
  });
  assert.equal(report.evidence.consumedMeals, 6);
  assert.deepEqual(codes(report), []);
  assert.equal(report.verdict, "ok");
}

// 2. Stacking allocations and the delivery journal are accepted as evidence,
//    and the same movement in both is counted once.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({
      consumedMeals: 6,
      baseMealAllocations: [{ allocationKey: "k1", state: "consumed", quantity: 1, date: "2026-11-21" }],
    }),
    days: [
      { _id: "d1", date: "2026-11-21", status: "fulfilled" },
      { _id: "d2", date: "2026-11-22", status: "fulfilled" },
    ],
    stackedAllocations: [
      { allocationKey: "k1", state: "consumed", quantity: 1, date: "2026-11-21" },
      { allocationKey: "k2", state: "consumed", quantity: 1, date: "2026-11-21" },
      { allocationKey: "k3", state: "consumed", quantity: 1, date: "2026-11-21" },
    ],
    batches: [{ metadata: { chefChoiceDeliveryDeductions: [{ idempotencyKey: "d2", quantity: 3 }] } }],
    now: NOW,
  });
  assert.equal(report.evidence.automaticMeals, 6);
  assert.deepEqual(codes(report), []);
}

// 3. Counter higher than evidence: customer charged without proof.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription(),
    days: [legacyDay("2026-11-21", "d1")],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["CONSUMED_EXCEEDS_EVIDENCE"]);
  assert.equal(report.consumedGap, 3);
  assert.equal(report.verdict, "review");
}

// 4. Evidence higher than counter: customer not charged for a delivered day.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: 30, consumedMeals: 0 }),
    days: [legacyDay("2026-11-21", "d1")],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["EVIDENCE_EXCEEDS_CONSUMED"]);
  assert.equal(report.consumedGap, -3);
  assert.equal(report.verdict, "critical");
}

// 5. Balance equation mismatch; pre-v2 subscriptions are not judged by it.
{
  const mismatch = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: 20 }),
    days: [legacyDay("2026-11-21", "d1"), legacyDay("2026-11-22", "d2")],
    now: NOW,
  });
  assert.deepEqual(codes(mismatch), ["EQUATION_MISMATCH"]);
  assert.equal(mismatch.equationDifference, 4);

  // Legacy subscription: consumedMeals is not maintained, remaining is.
  const legacyVersion = reconcileSubscriptionMealLedger({
    subscription: subscription({ entitlementVersion: 0, remainingMeals: 24, consumedMeals: undefined }),
    days: [legacyDay("2026-11-21", "d1"), legacyDay("2026-11-22", "d2")],
    now: NOW,
  });
  assert.deepEqual(codes(legacyVersion), []);
  assert.equal(legacyVersion.counterBasis, "total-remaining");
  assert.equal(legacyVersion.counterConsumed, 6);

  const legacyWrong = reconcileSubscriptionMealLedger({
    subscription: subscription({ entitlementVersion: 0, remainingMeals: 20, consumedMeals: undefined }),
    days: [legacyDay("2026-11-21", "d1"), legacyDay("2026-11-22", "d2")],
    now: NOW,
  });
  assert.deepEqual(codes(legacyWrong), ["CONSUMED_EXCEEDS_EVIDENCE"]);
  assert.equal(legacyWrong.consumedGap, 4);
}

// 6. A staff deduction that consumed a reserved allocation is one movement.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: 28, consumedMeals: 2 }),
    days: [{ _id: "d1", date: "2026-11-21", status: "open" }],
    stackedAllocations: [
      { allocationKey: "s1", state: "consumed", quantity: 1, date: "2026-11-21" },
      { allocationKey: "s2", state: "consumed", quantity: 1, date: "2026-11-21" },
    ],
    batches: [{ metadata: { manualDeductions: [{ allocationKeys: ["s1", "s2"] }] } }],
    deductionLogs: [manualLog("l1", "2026-11-21", 2)],
    now: NOW,
  });
  assert.equal(report.evidence.automaticMeals, 0);
  assert.equal(report.evidence.manualMeals, 2);
  assert.deepEqual(codes(report), []);
}

// 7. A single day deducted above its expected meals is flagged.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: 25, consumedMeals: 5 }),
    days: [legacyDay("2026-11-21", "d1")],
    deductionLogs: [manualLog("l1", "2026-11-21", 2)],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["DAY_OVER_DEDUCTED"]);
}

// 7b. A staff bulk deduction (several days at once) is not a double deduction.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: 15, consumedMeals: 15 }),
    days: [{ _id: "d1", date: "2026-11-21", status: "open" }],
    deductionLogs: [manualLog("l1", "2026-11-21", 15, { source: "pickup_quick_deduction", days: 5, mealsPerDay: 3 })],
    now: NOW,
  });
  assert.deepEqual(codes(report), []);
}

// 8. Reservation left on a day that already ended.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({
      remainingMeals: 27, reservedMeals: 3, consumedMeals: 0,
      baseMealAllocations: [{ allocationKey: "r1", state: "reserved", quantity: 3, date: "2026-11-20" }],
    }),
    days: [{ _id: "d1", date: "2026-11-20", status: "open" }],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["STALE_RESERVATION"]);
}

// 9. Negative or impossible counters never pass silently.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: -2, consumedMeals: 0, totalMeals: 30 }),
    now: NOW,
  });
  assert(codes(report).includes("INVALID_COUNTER"));
  assert.equal(report.verdict, "critical");
}

// 10. A delivered day with no evidence anywhere is reported.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ remainingMeals: 30, consumedMeals: 0 }),
    days: [{ _id: "d1", date: "2026-11-22", status: "fulfilled", creditsDeducted: false }],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["FULFILLED_DAY_WITHOUT_EVIDENCE"]);
}

function batch(overrides = {}) {
  return {
    status: "exhausted",
    applicationState: "applied",
    totalMeals: 7,
    remainingMeals: 0,
    reservedMeals: 0,
    consumedMeals: 7,
    forfeitedMeals: 0,
    ...overrides,
  };
}

// 11. Production shape: counters belong to ACTIVE batches only. A subscription
//     whose batches are exhausted/expired has zero counters while the staff
//     deductions of its whole life match the batches' lifetime consumption.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ totalMeals: 0, remainingMeals: 0, consumedMeals: 0 }),
    batches: [
      batch({ status: "expired", remainingMeals: 0, consumedMeals: 5, forfeitedMeals: 2 }),
      batch(),
    ],
    deductionLogs: [
      manualLog("l1", "2026-10-31", 3),
      manualLog("l2", "2026-11-07", 2),
      manualLog("l3", "2026-11-17", 7),
    ],
    now: NOW,
  });
  assert.equal(report.counterBasis, "batches");
  assert.equal(report.counterConsumed, 12);
  assert.equal(report.evidence.consumedMeals, 12);
  assert.deepEqual(codes(report), []);
  assert.equal(report.verdict, "ok");
}

// 12. Evidence above the batches' lifetime consumption is still caught.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ totalMeals: 0, remainingMeals: 0, consumedMeals: 0 }),
    batches: [batch()],
    deductionLogs: [manualLog("l1", "2026-11-17", 9)],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["EVIDENCE_EXCEEDS_CONSUMED"]);
  assert.equal(report.consumedGap, -2);
}

// 13. Batches consumed more than any evidence: reported the other way.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ totalMeals: 0, remainingMeals: 0, consumedMeals: 0 }),
    batches: [batch()],
    deductionLogs: [manualLog("l1", "2026-11-17", 5)],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["CONSUMED_EXCEEDS_EVIDENCE"]);
  assert.equal(report.consumedGap, 2);
}

// 14. Subscription counters must equal the sum of the active batches.
{
  const active = batch({ status: "active", totalMeals: 78, remainingMeals: 4, consumedMeals: 74 });
  const matching = reconcileSubscriptionMealLedger({
    subscription: subscription({ totalMeals: 78, remainingMeals: 4, consumedMeals: 74 }),
    batches: [batch({ totalMeals: 78, consumedMeals: 78 }), active],
    deductionLogs: [manualLog("l1", "2026-11-17", 152)],
    now: NOW,
  });
  assert.deepEqual(codes(matching), []);

  const drifted = reconcileSubscriptionMealLedger({
    subscription: subscription({ totalMeals: 78, remainingMeals: 9, consumedMeals: 69 }),
    batches: [batch({ totalMeals: 78, consumedMeals: 78 }), active],
    deductionLogs: [manualLog("l1", "2026-11-17", 152)],
    now: NOW,
  });
  assert.deepEqual(codes(drifted), ["COUNTERS_DIFFER_FROM_ACTIVE_BATCHES"]);
  assert.deepEqual(Object.keys(drifted.findings[0].details.differences).sort(), ["available", "consumed"]);
}

// 15. A batch whose meals are not fully accounted for is reported.
{
  const report = reconcileSubscriptionMealLedger({
    subscription: subscription({ totalMeals: 0, remainingMeals: 0, consumedMeals: 0 }),
    batches: [batch({ status: "expired", consumedMeals: 5, forfeitedMeals: 0 })],
    deductionLogs: [manualLog("l1", "2026-10-31", 5)],
    now: NOW,
  });
  assert.deepEqual(codes(report), ["BATCH_UNACCOUNTED_MEALS"]);
  assert.equal(report.findings[0].details.batches[0].unaccountedMeals, 2);
}

console.log("subscriptionMealLedgerReconciliationService tests passed");
