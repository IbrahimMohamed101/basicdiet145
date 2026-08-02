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
  validateSubscriptionCanDeduct,
} = require("../src/services/dashboard/manualDeduction/manualDeductionPolicy");
const {
  reservedBaseMealsForDate,
} = require("../src/services/dashboard/manualDeduction/manualDeductionCommandService");

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
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-30T00:00:00.000Z"),
    baseMealAllocations: [],
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
  assert.doesNotThrow(
    () => validateSubscriptionCanDeduct(subscription, "2026-08-03")
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

  const inconsistentSubscription = modernSubscription({ reservedMeals: 5 });
  const inconsistent = serializeSubscription(inconsistentSubscription, null, "ar");
  assert.equal(inconsistent.balance.balanced, false);
  assert.equal(inconsistent.balance.projectionApplied, false);
  assert.equal(inconsistent.displayRemainingMeals, 24);
  assert.equal(inconsistent.balance.displaySemantics, "AVAILABLE_ONLY_FAIL_CLOSED");
  assert.throws(
    () => validateSubscriptionCanDeduct(inconsistentSubscription, "2026-08-03"),
    (error) => error && error.code === "BALANCE_INTEGRITY_ERROR"
  );

  const reservedToday = modernSubscription({
    baseMealAllocations: [
      {
        allocationKey: "2026-08-03:slot_1",
        date: "2026-08-03",
        slotKey: "slot_1",
        quantity: 1,
        state: "reserved",
      },
      {
        allocationKey: "2026-08-03:slot_2",
        date: "2026-08-03",
        slotKey: "slot_2",
        quantity: 1,
        state: "reserved",
      },
      {
        allocationKey: "2026-08-04:slot_1",
        date: "2026-08-04",
        slotKey: "slot_1",
        quantity: 1,
        state: "reserved",
      },
      {
        allocationKey: "2026-08-03:old",
        date: "2026-08-03",
        slotKey: "old",
        quantity: 1,
        state: "released",
      },
    ],
  });
  assert.equal(reservedBaseMealsForDate(reservedToday, "2026-08-03"), 2);
  assert.equal(reservedBaseMealsForDate(reservedToday, "2026-08-04"), 1);
  assert.equal(reservedBaseMealsForDate(reservedToday, "2026-08-05"), 0);

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
