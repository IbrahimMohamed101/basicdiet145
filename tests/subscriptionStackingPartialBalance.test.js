"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  projectSubscriptionEntitlements,
} = require("../src/services/subscription/subscriptionEntitlementProjectionService");
const {
  buildEntitlementSlotBlueprint,
} = require("../src/services/subscription/subscriptionEntitlementSlotBlueprintService");

function batch(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status: "active",
    effectiveStartDate: "2026-08-01",
    endDate: "2026-08-26",
    validityEndDate: "2026-08-26",
    mealsPerDay: 3,
    proteinGrams: 200,
    totalMeals: 78,
    remainingMeals: 1,
    reservedMeals: 0,
    consumedMeals: 77,
    forfeitedMeals: 0,
    deliverySnapshot: { mode: "delivery" },
    ...overrides,
  };
}

function testCurrentProjectionClampsToAvailableCredit() {
  const row = batch();
  const projection = projectSubscriptionEntitlements({
    batches: [row],
    businessDate: "2026-08-06",
  });
  assert.strictEqual(projection.mealBalance.remainingMeals, 1);
  assert.strictEqual(projection.requiredMealsPerDay, 1);
  assert.strictEqual(projection.dailyContributions[0].meals, 1);
  assert.deepStrictEqual(
    projection.grams.map((entry) => ({
      proteinGrams: entry.proteinGrams,
      mealsPerDay: entry.mealsPerDay,
    })),
    [{ proteinGrams: 200, mealsPerDay: 1 }]
  );
}

function testBlueprintCreatesOnlyReservableSlots() {
  const blueprint = buildEntitlementSlotBlueprint({
    batches: [batch()],
    businessDate: "2026-08-06",
  });
  assert.strictEqual(blueprint.requiredSlotCount, 1);
  assert.strictEqual(blueprint.slots.length, 1);
  assert.strictEqual(blueprint.slots[0].slotKey, "slot_1");
  assert.strictEqual(blueprint.slots[0].sourceMealsPerDay, 3);
  assert.strictEqual(blueprint.slots[0].proteinGrams, 200);
}

function testOverlapClampsOnlyDepletedBatch() {
  const first = batch({
    remainingMeals: 1,
    consumedMeals: 77,
    mealsPerDay: 3,
    proteinGrams: 200,
  });
  const second = batch({
    remainingMeals: 52,
    consumedMeals: 0,
    totalMeals: 52,
    mealsPerDay: 2,
    proteinGrams: 150,
  });
  const projection = projectSubscriptionEntitlements({
    batches: [first, second],
    businessDate: "2026-08-06",
  });
  const blueprint = buildEntitlementSlotBlueprint({
    batches: [first, second],
    businessDate: "2026-08-06",
  });

  assert.strictEqual(projection.requiredMealsPerDay, 3);
  assert.strictEqual(blueprint.requiredSlotCount, 3);
  const byGrams = blueprint.slots.reduce((map, slot) => {
    map.set(slot.proteinGrams, (map.get(slot.proteinGrams) || 0) + 1);
    return map;
  }, new Map());
  assert.strictEqual(byGrams.get(200), 1);
  assert.strictEqual(byGrams.get(150), 2);
}

function testHistoricalProjectionKeepsPurchasedDailyShape() {
  const row = batch({
    status: "expired",
    remainingMeals: 0,
    consumedMeals: 78,
  });
  const historical = projectSubscriptionEntitlements({
    batches: [row],
    businessDate: "2026-08-06",
    historicalLifecycle: true,
  });
  assert.strictEqual(historical.requiredMealsPerDay, 3);
  assert.strictEqual(historical.grams[0].mealsPerDay, 3);
}

function testZeroAvailableCreditsExposeNoNewSlots() {
  const row = batch({ remainingMeals: 0, consumedMeals: 78 });
  const projection = projectSubscriptionEntitlements({
    batches: [row],
    businessDate: "2026-08-06",
  });
  const blueprint = buildEntitlementSlotBlueprint({
    batches: [row],
    businessDate: "2026-08-06",
  });
  assert.strictEqual(projection.requiredMealsPerDay, 0);
  assert.strictEqual(blueprint.requiredSlotCount, 0);
}

function run() {
  testCurrentProjectionClampsToAvailableCredit();
  testBlueprintCreatesOnlyReservableSlots();
  testOverlapClampsOnlyDepletedBatch();
  testHistoricalProjectionKeepsPurchasedDailyShape();
  testZeroAvailableCreditsExposeNoNewSlots();
  console.log("subscription stacking partial balance tests passed");
}

run();
