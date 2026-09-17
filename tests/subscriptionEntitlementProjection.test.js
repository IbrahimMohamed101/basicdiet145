"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  projectSubscriptionEntitlements,
} = require("../src/services/subscription/subscriptionEntitlementProjectionService");

function batch({
  id = new mongoose.Types.ObjectId(),
  status = "active",
  startDate = "2026-08-01",
  endDate = "2026-08-26",
  validityEndDate = endDate,
  mealsPerDay = 1,
  proteinGrams = 200,
  totalMeals = 26,
  remainingMeals = totalMeals,
  reservedMeals = 0,
  consumedMeals = 0,
  forfeitedMeals = 0,
  deliverySnapshot = {
    mode: "delivery",
    zoneId: "zone-a",
    slot: { window: "13:00-15:00" },
    address: { city: "Riyadh", district: "Olaya", street: "A" },
  },
} = {}) {
  return {
    _id: id,
    status,
    effectiveStartDate: startDate,
    endDate,
    validityEndDate,
    mealsPerDay,
    proteinGrams,
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    deliverySnapshot,
  };
}

function testSameDayOverlapWithDifferentGrams() {
  const projection = projectSubscriptionEntitlements({
    businessDate: "2026-08-06",
    batches: [
      batch({
        mealsPerDay: 3,
        proteinGrams: 200,
        totalMeals: 78,
        remainingMeals: 20,
      }),
      batch({
        mealsPerDay: 2,
        proteinGrams: 150,
        totalMeals: 52,
        remainingMeals: 52,
      }),
    ],
  });

  assert.strictEqual(projection.batchCount, 2);
  assert.strictEqual(projection.mealBalance.totalMeals, 130);
  assert.strictEqual(projection.mealBalance.remainingMeals, 72);
  assert.strictEqual(projection.requiredMealsPerDay, 5);
  assert.strictEqual(projection.hasMixedProteinGrams, true);
  assert.deepStrictEqual(
    projection.grams.map(({ proteinGrams, mealsPerDay }) => ({ proteinGrams, mealsPerDay })),
    [
      { proteinGrams: 150, mealsPerDay: 2 },
      { proteinGrams: 200, mealsPerDay: 3 },
    ]
  );
}

function testFutureBatchIsHiddenUntilStartDate() {
  const current = batch({
    startDate: "2026-08-01",
    endDate: "2026-08-09",
    validityEndDate: "2026-08-09",
    mealsPerDay: 3,
    totalMeals: 27,
    remainingMeals: 20,
  });
  const future = batch({
    status: "paid_scheduled",
    startDate: "2026-08-10",
    endDate: "2026-09-04",
    validityEndDate: "2026-09-04",
    mealsPerDay: 2,
    totalMeals: 52,
    remainingMeals: 52,
  });

  const before = projectSubscriptionEntitlements({
    businessDate: "2026-08-09",
    batches: [current, future],
  });
  assert.strictEqual(before.batchCount, 1);
  assert.strictEqual(before.mealBalance.remainingMeals, 20);
  assert.strictEqual(before.requiredMealsPerDay, 3);

  const onStart = projectSubscriptionEntitlements({
    businessDate: "2026-08-10",
    batches: [current, future],
  });
  assert.strictEqual(onStart.batchCount, 1);
  assert.strictEqual(onStart.mealBalance.remainingMeals, 52);
  assert.strictEqual(onStart.requiredMealsPerDay, 2);
}

function testPartialOverlapChangesDailyRequirementByDate() {
  const first = batch({
    startDate: "2026-08-01",
    endDate: "2026-08-09",
    validityEndDate: "2026-08-09",
    mealsPerDay: 3,
    totalMeals: 27,
  });
  const second = batch({
    startDate: "2026-08-05",
    endDate: "2026-08-30",
    validityEndDate: "2026-08-30",
    mealsPerDay: 2,
    totalMeals: 52,
  });

  assert.strictEqual(
    projectSubscriptionEntitlements({ businessDate: "2026-08-04", batches: [first, second] })
      .requiredMealsPerDay,
    3
  );
  assert.strictEqual(
    projectSubscriptionEntitlements({ businessDate: "2026-08-05", batches: [first, second] })
      .requiredMealsPerDay,
    5
  );
  assert.strictEqual(
    projectSubscriptionEntitlements({ businessDate: "2026-08-10", batches: [first, second] })
      .requiredMealsPerDay,
    2
  );
}

function testFulfillmentConflictIsDetectedWithoutRejectingProjection() {
  const delivery = batch({
    mealsPerDay: 3,
    deliverySnapshot: {
      mode: "delivery",
      zoneId: "zone-a",
      slot: { window: "13:00-15:00" },
      address: { city: "Riyadh", district: "Olaya", street: "A" },
    },
  });
  const pickup = batch({
    mealsPerDay: 2,
    deliverySnapshot: {
      mode: "pickup",
      pickupLocationId: "main",
    },
  });

  const projection = projectSubscriptionEntitlements({
    businessDate: "2026-08-06",
    batches: [delivery, pickup],
  });

  assert.strictEqual(projection.requiredMealsPerDay, 5);
  assert.strictEqual(projection.hasFulfillmentConflict, true);
  assert.strictEqual(projection.fulfillmentProfiles.length, 2);
}

function testTerminalBatchesAreExcluded() {
  const projection = projectSubscriptionEntitlements({
    businessDate: "2026-08-06",
    batches: [
      batch({ status: "expired" }),
      batch({ status: "canceled" }),
      batch({ status: "exhausted", remainingMeals: 0 }),
    ],
  });

  assert.strictEqual(projection.batchCount, 0);
  assert.strictEqual(projection.mealBalance.remainingMeals, 0);
  assert.strictEqual(projection.requiredMealsPerDay, 0);
}

function run() {
  testSameDayOverlapWithDifferentGrams();
  testFutureBatchIsHiddenUntilStartDate();
  testPartialOverlapChangesDailyRequirementByDate();
  testFulfillmentConflictIsDetectedWithoutRejectingProjection();
  testTerminalBatchesAreExcluded();

  console.log("subscription entitlement shadow projection tests passed");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
