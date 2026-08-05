"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementDayBlueprint = require("../src/models/SubscriptionEntitlementDayBlueprint");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");

function buildBatch() {
  return new SubscriptionEntitlementBatch({
    userId: new mongoose.Types.ObjectId(),
    containerSubscriptionId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    sourceKey: `test:${new mongoose.Types.ObjectId()}`,
    sourceType: "checkout",
    requestedStartDate: new Date("2026-08-01T00:00:00+03:00"),
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    daysCount: 26,
    mealsPerDay: 2,
    proteinGrams: 150,
    totalMeals: 52,
    remainingMeals: 52,
    status: "active",
    applicationState: "pending",
  });
}

async function testBlueprintAcceptsMixedGramSlots() {
  const firstBatch = buildBatch();
  const secondBatch = buildBatch();
  const blueprint = new SubscriptionEntitlementDayBlueprint({
    userId: firstBatch.userId,
    containerSubscriptionId: firstBatch.containerSubscriptionId,
    date: "2026-08-06",
    sourceHash: "hash-1",
    requiredSlotCount: 5,
    slots: [
      ...[1, 2, 3].map((slotIndex) => ({
        slotIndex,
        slotKey: `slot_${slotIndex}`,
        entitlementBatchId: firstBatch._id,
        contributionIndex: slotIndex,
        sourceMealsPerDay: 3,
        proteinGrams: 200,
        effectiveStartDate: "2026-07-01",
        validityEndDate: "2026-08-09",
      })),
      ...[4, 5].map((slotIndex, index) => ({
        slotIndex,
        slotKey: `slot_${slotIndex}`,
        entitlementBatchId: secondBatch._id,
        contributionIndex: index + 1,
        sourceMealsPerDay: 2,
        proteinGrams: 150,
        effectiveStartDate: "2026-08-01",
        validityEndDate: "2026-08-26",
      })),
    ],
    fulfillmentProfiles: [],
    hasMixedProteinGrams: true,
  });

  await blueprint.validate();
  assert.strictEqual(blueprint.requiredSlotCount, 5);
  assert.strictEqual(blueprint.slots[0].proteinGrams, 200);
  assert.strictEqual(blueprint.slots[4].proteinGrams, 150);
}

async function testBlueprintRejectsNonContiguousSlots() {
  const batch = buildBatch();
  const blueprint = new SubscriptionEntitlementDayBlueprint({
    userId: batch.userId,
    containerSubscriptionId: batch.containerSubscriptionId,
    date: "2026-08-06",
    sourceHash: "hash-2",
    requiredSlotCount: 2,
    slots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        entitlementBatchId: batch._id,
        contributionIndex: 1,
        sourceMealsPerDay: 2,
        proteinGrams: 150,
        effectiveStartDate: "2026-08-01",
        validityEndDate: "2026-08-26",
      },
      {
        slotIndex: 3,
        slotKey: "slot_3",
        entitlementBatchId: batch._id,
        contributionIndex: 2,
        sourceMealsPerDay: 2,
        proteinGrams: 150,
        effectiveStartDate: "2026-08-01",
        validityEndDate: "2026-08-26",
      },
    ],
  });

  await assert.rejects(
    () => blueprint.validate(),
    (err) => Boolean(err && err.errors && err.errors.slots),
    "non-contiguous slots must be rejected"
  );
}

async function testAllocationCapturesExactBatchAndGrams() {
  const batch = buildBatch();
  const allocation = new SubscriptionEntitlementAllocation({
    allocationKey: `allocation:${new mongoose.Types.ObjectId()}`,
    userId: batch.userId,
    containerSubscriptionId: batch.containerSubscriptionId,
    entitlementBatchId: batch._id,
    subscriptionDayId: new mongoose.Types.ObjectId(),
    date: "2026-08-06",
    slotKey: "slot_4",
    quantity: 1,
    proteinGrams: 150,
    state: "reserved",
  });

  await allocation.validate();
  assert.strictEqual(String(allocation.entitlementBatchId), String(batch._id));
  assert.strictEqual(allocation.proteinGrams, 150);
  assert(allocation.reservedAt instanceof Date);
  assert.strictEqual(allocation.consumedAt, null);
}

async function testAllocationRejectsConflictingTerminalTimestamps() {
  const batch = buildBatch();
  const allocation = new SubscriptionEntitlementAllocation({
    allocationKey: `allocation:${new mongoose.Types.ObjectId()}`,
    userId: batch.userId,
    containerSubscriptionId: batch.containerSubscriptionId,
    entitlementBatchId: batch._id,
    date: "2026-08-06",
    slotKey: "slot_1",
    quantity: 1,
    proteinGrams: 200,
    state: "consumed",
    consumedAt: new Date(),
    releasedAt: new Date(),
  });

  await assert.rejects(
    () => allocation.validate(),
    (err) => Boolean(err && err.errors && err.errors.state),
    "allocation cannot be consumed and released"
  );
}

function testUniqueIndexesExist() {
  const blueprintIndexNames = SubscriptionEntitlementDayBlueprint.schema.indexes()
    .map(([, options]) => options && options.name)
    .filter(Boolean);
  const allocationIndexNames = SubscriptionEntitlementAllocation.schema.indexes()
    .map(([, options]) => options && options.name)
    .filter(Boolean);

  assert(blueprintIndexNames.includes("uniq_subscription_entitlement_day_blueprint"));
  assert(allocationIndexNames.includes("uniq_subscription_entitlement_allocation_key"));
  assert(allocationIndexNames.includes("uniq_subscription_entitlement_allocation_slot_revision"));
  assert(allocationIndexNames.includes("uniq_subscription_entitlement_allocation_operation"));
}

async function run() {
  await testBlueprintAcceptsMixedGramSlots();
  await testBlueprintRejectsNonContiguousSlots();
  await testAllocationCapturesExactBatchAndGrams();
  await testAllocationRejectsConflictingTerminalTimestamps();
  testUniqueIndexesExist();

  console.log("subscription entitlement persistence model tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
