"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  buildDeductionResponse,
  serializeSubscription,
} = require("../src/services/dashboard/manualDeduction/manualDeductionPresenter");
const {
  validateBalances,
  validateCounts,
} = require("../src/services/dashboard/manualDeduction/manualDeductionPolicy");

function modernSubscription(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    deliveryMode: "pickup",
    entitlementVersion: 2,
    totalMeals: 30,
    remainingMeals: 24,
    reservedMeals: 6,
    consumedMeals: 0,
    forfeitedMeals: 0,
    premiumBalance: [],
    addonBalance: [],
    addonSubscriptions: [],
    ...overrides,
  };
}

function run() {
  const subscription = modernSubscription();
  const serialized = serializeSubscription(
    subscription,
    { name: { ar: "باقة شهرية", en: "Monthly plan" } },
    "ar"
  );

  assert.equal(serialized.remainingMeals, 24);
  assert.equal(serialized.availableMeals, 24);
  assert.equal(serialized.displayRemainingMeals, 30);
  assert.equal(serialized.reservedMeals, 6);
  assert.equal(serialized.balance.manualDeductionMaxMeals, 24);
  assert.equal(serialized.balance.displaySemantics, "UNCONSUMED_INCLUDING_RESERVED");
  assert.equal(serialized.balance.availableSemantics, "UNRESERVED_AVAILABLE_FOR_MANUAL_DEDUCTION");
  assert.equal(serialized.balance.balanced, true);

  assert.throws(
    () => validateBalances(subscription, validateCounts({ regularMeals: 25, premiumMeals: 0 })),
    (error) => error && error.code === "INSUFFICIENT_REMAINING_MEALS"
  );
  assert.doesNotThrow(
    () => validateBalances(subscription, validateCounts({ regularMeals: 24, premiumMeals: 0 }))
  );

  const updated = modernSubscription({
    remainingMeals: 22,
    reservedMeals: 6,
    consumedMeals: 2,
  });
  const response = buildDeductionResponse({
    subscription: updated,
    counts: { regularMeals: 2, premiumMeals: 0, total: 2, addons: [] },
    balances: {
      totalMeals: 30,
      remainingMeals: 22,
      remainingRegularMeals: 22,
      remainingPremiumMeals: 0,
      consumedMeals: 2,
    },
    addonBalances: [],
    businessDate: "2026-08-03",
  });

  assert.equal(response.remaining.totalMeals, 22);
  assert.equal(response.remaining.availableMeals, 22);
  assert.equal(response.remaining.displayRemainingMeals, 28);
  assert.equal(response.remaining.reservedMeals, 6);
  assert.equal(response.balance.manualDeductionMaxMeals, 22);

  const inconsistent = serializeSubscription(
    modernSubscription({ reservedMeals: 5 }),
    null,
    "ar"
  );
  assert.equal(inconsistent.balance.balanced, false);
  assert.equal(inconsistent.balance.projectionApplied, false);
  assert.equal(inconsistent.displayRemainingMeals, 24);
  assert.equal(inconsistent.balance.displaySemantics, "AVAILABLE_ONLY_FAIL_CLOSED");

  const legacy = serializeSubscription({
    ...modernSubscription(),
    entitlementVersion: 1,
    totalMeals: 30,
    remainingMeals: 18,
    reservedMeals: undefined,
    consumedMeals: undefined,
    forfeitedMeals: undefined,
  }, null, "ar");
  assert.equal(legacy.availableMeals, 18);
  assert.equal(legacy.displayRemainingMeals, 18);
  assert.equal(legacy.reservedMeals, 0);
  assert.equal(legacy.balance.balanced, true);

  console.log("manual deduction balance presentation tests passed");
}

run();
