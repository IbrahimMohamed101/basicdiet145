"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  resolveStackingPlanningContext,
} = require("../src/services/subscription/subscriptionStackingPlanningContextService");

function subscription() {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 78,
    remainingMeals: 20,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
  };
}

function deliverySnapshot({
  mode = "delivery",
  window = "13:00-15:00",
  pickupLocationId = "",
} = {}) {
  return {
    mode,
    zoneId: mode === "delivery" ? "zone-a" : "",
    pickupLocationId,
    slot: { window: mode === "delivery" ? window : "" },
    address: mode === "delivery"
      ? { city: "Riyadh", district: "Olaya", street: "A" }
      : null,
  };
}

function batch({
  status = "active",
  start = "2026-08-01",
  end = "2026-08-26",
  mealsPerDay = 3,
  grams = 200,
  totalMeals = 78,
  remainingMeals = 20,
  delivery = deliverySnapshot(),
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status,
    effectiveStartDate: start,
    endDate: end,
    validityEndDate: end,
    mealsPerDay,
    proteinGrams: grams,
    totalMeals,
    remainingMeals,
    reservedMeals: 0,
    consumedMeals: Math.max(0, totalMeals - remainingMeals),
    forfeitedMeals: 0,
    deliverySnapshot: delivery,
  };
}

function runtimeWithBatches(batches, overrides = {}) {
  return {
    findBatches: async () => batches,
    materializeBlueprint: async (args) => ({
      blueprint: {
        _id: new mongoose.Types.ObjectId(),
        date: args.date,
        requiredSlotCount: args.batches.reduce(
          (sum, row) => sum + Number(row.mealsPerDay || 0),
          0
        ),
        slots: [],
      },
    }),
    ...overrides,
  };
}

async function testMixedGramsProduceFiveAuthoritativeSlots() {
  const sub = subscription();
  const oldBatch = batch({ mealsPerDay: 3, grams: 200 });
  const newBatch = batch({
    mealsPerDay: 2,
    grams: 150,
    totalMeals: 52,
    remainingMeals: 52,
  });
  const incoming = [1, 2, 3, 4, 5].map((slotIndex) => ({
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    proteinId: new mongoose.Types.ObjectId(),
  }));

  const context = await resolveStackingPlanningContext({
    userId: sub.userId,
    subscription: sub,
    date: "2026-08-06",
    businessDate: "2026-08-06",
    incomingMealSlots: incoming,
    runtime: runtimeWithBatches([newBatch, oldBatch]),
  });

  assert.strictEqual(context.projection.requiredMealsPerDay, 5);
  assert.strictEqual(context.projection.mealBalance.remainingMeals, 72);
  assert.strictEqual(context.projection.hasMixedProteinGrams, true);
  assert.strictEqual(context.blueprint.requiredSlotCount, 5);
  assert.deepStrictEqual(
    context.blueprint.slots.map((slot) => slot.proteinGrams),
    [200, 200, 200, 150, 150]
  );
  assert.strictEqual(context.subscriptionView.selectedMealsPerDay, 5);
  assert.strictEqual(context.subscriptionView.remainingMeals, 72);
  assert.strictEqual(context.plannedMealSlots.length, 5);
  assert.strictEqual(context.plannedMealSlots[4].slotKey, "slot_5");
}

async function testExistingThreeSelectionsArePreservedWhenTwoSlotsAreAdded() {
  const sub = subscription();
  const existingMealSlots = [1, 2, 3].map((slotIndex) => ({
    slotIndex,
    slotKey: `slot_${slotIndex}`,
    status: "complete",
    proteinId: new mongoose.Types.ObjectId(),
  }));

  const context = await resolveStackingPlanningContext({
    userId: sub.userId,
    subscription: sub,
    date: "2026-08-06",
    businessDate: "2026-08-06",
    existingMealSlots,
    runtime: runtimeWithBatches([
      batch({ mealsPerDay: 3, grams: 200 }),
      batch({ mealsPerDay: 2, grams: 150, totalMeals: 52, remainingMeals: 52 }),
    ]),
  });

  assert.strictEqual(context.plannedMealSlots.length, 5);
  assert.strictEqual(context.plannedMealSlots[0].status, "complete");
  assert.strictEqual(context.plannedMealSlots[2].status, "complete");
  assert.strictEqual(context.plannedMealSlots[3].status, "empty");
  assert.strictEqual(context.plannedMealSlots[4].status, "empty");
}

async function testSlotOutsideEntitlementIsRejected() {
  const sub = subscription();
  await assert.rejects(
    () => resolveStackingPlanningContext({
      userId: sub.userId,
      subscription: sub,
      date: "2026-08-06",
      businessDate: "2026-08-06",
      incomingMealSlots: [{ slotIndex: 6, slotKey: "slot_6" }],
      runtime: runtimeWithBatches([
        batch({ mealsPerDay: 3 }),
        batch({ mealsPerDay: 2, grams: 150, totalMeals: 52, remainingMeals: 52 }),
      ]),
    }),
    (err) => Boolean(err && err.code === "STACKING_SLOT_OUTSIDE_ENTITLEMENT")
  );
}

async function testFutureScheduledBatchIsHiddenBeforeStartEvenForFutureTargetDate() {
  const sub = subscription();
  const futureBatch = batch({
    status: "paid_scheduled",
    start: "2026-08-10",
    end: "2026-09-04",
    mealsPerDay: 2,
    grams: 150,
    totalMeals: 52,
    remainingMeals: 52,
  });

  await assert.rejects(
    () => resolveStackingPlanningContext({
      userId: sub.userId,
      subscription: sub,
      date: "2026-08-10",
      businessDate: "2026-08-09",
      runtime: runtimeWithBatches([futureBatch]),
    }),
    (err) => Boolean(err && err.code === "STACKING_NO_ENTITLEMENT_FOR_DATE")
  );

  const onStart = await resolveStackingPlanningContext({
    userId: sub.userId,
    subscription: sub,
    date: "2026-08-10",
    businessDate: "2026-08-10",
    runtime: runtimeWithBatches([futureBatch]),
  });
  assert.strictEqual(onStart.projection.requiredMealsPerDay, 2);
  assert.strictEqual(onStart.projection.mealBalance.remainingMeals, 52);
}

async function testFulfillmentConflictFailsClosed() {
  const sub = subscription();
  await assert.rejects(
    () => resolveStackingPlanningContext({
      userId: sub.userId,
      subscription: sub,
      date: "2026-08-06",
      businessDate: "2026-08-06",
      runtime: runtimeWithBatches([
        batch({ delivery: deliverySnapshot({ mode: "delivery" }) }),
        batch({
          mealsPerDay: 2,
          totalMeals: 52,
          remainingMeals: 52,
          delivery: deliverySnapshot({ mode: "pickup", pickupLocationId: "main" }),
        }),
      ]),
    }),
    (err) => Boolean(err && err.code === "STACKING_FULFILLMENT_CONFLICT")
  );
}

async function testBlueprintMaterializationRequiresSessionAndUsesContributors() {
  const sub = subscription();
  const activeBatch = batch({ mealsPerDay: 3 });
  let materializeArgs = null;
  const runtime = runtimeWithBatches([activeBatch], {
    materializeBlueprint: async (args) => {
      materializeArgs = args;
      return {
        blueprint: {
          _id: new mongoose.Types.ObjectId(),
          date: args.date,
          requiredSlotCount: 3,
          slots: [],
        },
      };
    },
  });

  await assert.rejects(
    () => resolveStackingPlanningContext({
      userId: sub.userId,
      subscription: sub,
      date: "2026-08-06",
      businessDate: "2026-08-06",
      materialize: true,
      runtime,
    }),
    (err) => Boolean(err && err.code === "STACKING_PLANNING_TRANSACTION_REQUIRED")
  );

  const session = { inTransaction: () => true };
  const context = await resolveStackingPlanningContext({
    userId: sub.userId,
    subscription: sub,
    date: "2026-08-06",
    businessDate: "2026-08-06",
    materialize: true,
    session,
    runtime,
  });
  assert(materializeArgs);
  assert.strictEqual(materializeArgs.batches.length, 1);
  assert.strictEqual(String(materializeArgs.batches[0]._id), String(activeBatch._id));
  assert.strictEqual(context.blueprint.requiredSlotCount, 3);
}

async function testOwnershipIsEnforced() {
  const sub = subscription();
  await assert.rejects(
    () => resolveStackingPlanningContext({
      userId: new mongoose.Types.ObjectId(),
      subscription: sub,
      date: "2026-08-06",
      businessDate: "2026-08-06",
      runtime: runtimeWithBatches([batch()]),
    }),
    (err) => Boolean(err && err.code === "FORBIDDEN")
  );
}

async function run() {
  await testMixedGramsProduceFiveAuthoritativeSlots();
  await testExistingThreeSelectionsArePreservedWhenTwoSlotsAreAdded();
  await testSlotOutsideEntitlementIsRejected();
  await testFutureScheduledBatchIsHiddenBeforeStartEvenForFutureTargetDate();
  await testFulfillmentConflictFailsClosed();
  await testBlueprintMaterializationRequiresSessionAndUsesContributors();
  await testOwnershipIsEnforced();

  console.log("subscription stacking planning context tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
