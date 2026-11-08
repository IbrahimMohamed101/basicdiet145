"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeClosingPolicy, closingVersionForDate, closingVersionOf,
  calculationMode } = require("../src/services/pos/closingVersionService");
const { reasonCodesFor } = require("../src/services/dashboard/dailyCashClosingService");
test("D-093 default and versioned policy never reclassifies a recorded legacy closing", () => {
  assert.deepEqual(normalizeClosingPolicy(null), { baselineStartDate: null, changes: [] });
  assert.equal(closingVersionForDate("2026-11-08", null), "LEGACY_V1");
  const policy = { baselineStartDate: null, changes: [
    { effectiveFrom: "2026-11-08", startDate: "2026-11-08" },
  ] };
  assert.equal(closingVersionForDate("2026-11-07", policy), "LEGACY_V1");
  assert.equal(closingVersionForDate("2026-11-08", policy), "POS_V2");
  assert.equal(closingVersionOf({ status: "approved" }, "2026-11-08", policy), "LEGACY_V1");
  assert.equal(calculationMode("POS_V2"), "pos_expected_totals");
});
test("D-095 POS_V2 reason codes come only from authoritative allowed conditions", () => {
  const base = { subscriptionCountDifference: 0, unknownSubscriptionHalala: 0 };
  const auto = { reviewPaymentsCount: 0, refundsHalala: 0 };
  const diffs = { cashDifferenceHalala: 0, networkDifferenceHalala: 0, localDifferenceHalala: 0 };
  assert.deepEqual(reasonCodesFor("POS_V2", { ...base, localDifferenceHalala: 999,
    overallDifferenceHalala: -999 }, auto, diffs), []);
  const reasonCases = [
    [{ ...diffs, cashDifferenceHalala: -100 }, base, auto, "CASH_DIFFERENCE"],
    [{ ...diffs, networkDifferenceHalala: 100 }, base, auto, "NETWORK_DIFFERENCE"],
    [diffs, { ...base, subscriptionCountDifference: -1 }, auto, "SUBSCRIPTION_COUNT_DIFFERENCE"],
    [diffs, { ...base, unknownSubscriptionHalala: 1 }, auto, "UNKNOWN_SUBSCRIPTION_HALALA"],
    [diffs, base, { ...auto, reviewPaymentsCount: 1 }, "SUBSCRIPTION_PAYMENTS_REVIEW"],
    [diffs, base, { ...auto, refundsHalala: 1 }, "SUBSCRIPTION_REFUNDS"],
  ];
  for (const [recon, summary, automatic, expected] of reasonCases)
    assert.deepEqual(reasonCodesFor("POS_V2", summary, automatic, recon), [expected]);
});
