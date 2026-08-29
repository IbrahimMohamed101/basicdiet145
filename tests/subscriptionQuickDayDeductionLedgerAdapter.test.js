process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildQuickDeductionBlueprint,
  buildRevisionHash,
  consumeBatchThroughAllocationLedgerTransactional,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionLedgerAdapter");

const batchId = new mongoose.Types.ObjectId();
const batch = {
  _id: batchId,
  proteinGrams: 150,
};

const firstHash = buildRevisionHash("pickup-quick-test-key");
const secondHash = buildRevisionHash("pickup-quick-test-key");
const otherHash = buildRevisionHash("pickup-quick-other-key");
assert.strictEqual(firstHash, secondHash, "same idempotency key must produce stable revision hash");
assert.notStrictEqual(firstHash, otherHash, "different idempotency keys must isolate allocation revisions");
assert.match(firstHash, /^[a-f0-9]{64}$/);

const blueprint = buildQuickDeductionBlueprint({
  batch,
  businessDate: "2026-08-27",
  mealsToDeduct: 6,
});

assert.strictEqual(blueprint.date, "2026-08-27");
assert.strictEqual(blueprint.slots.length, 6);
assert.strictEqual(new Set(blueprint.slots.map((slot) => slot.slotKey)).size, 6);
assert.ok(blueprint.slots.every((slot) => String(slot.entitlementBatchId) === String(batchId)));
assert.ok(blueprint.slots.every((slot) => slot.proteinGrams === 150));
assert.deepStrictEqual(
  blueprint.slots.map((slot) => slot.slotKey),
  [
    "pickup_quick_1",
    "pickup_quick_2",
    "pickup_quick_3",
    "pickup_quick_4",
    "pickup_quick_5",
    "pickup_quick_6",
  ]
);

async function testConsumesExistingReservationsBeforeCreatingNewOnes() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const targetBatch = {
    _id: new mongoose.Types.ObjectId(),
    proteinGrams: 150,
    paymentId: null,
  };
  const reservedRows = Array.from({ length: 6 }, (_, index) => ({
    allocationKey: `reserved-${index + 1}`,
    date: `2026-08-${String(20 + index).padStart(2, "0")}`,
  }));
  const transitions = [];
  let reserveCalls = 0;

  const result = await consumeBatchThroughAllocationLedgerTransactional({
    subscription: { _id: subscriptionId, userId },
    batch: targetBatch,
    businessDate: "2026-08-27",
    mealsToDeduct: 6,
    idempotencyKey: "reserved-only-quick-test",
    session: {},
    runtime: {
      async findReservedAllocations() { return reservedRows; },
      async reserveBlueprint() {
        reserveCalls += 1;
        throw new Error("must not reserve a second credit when an existing reservation can be consumed");
      },
      async transitionAllocations(args) {
        transitions.push(args);
        return { handled: true, changedCount: args.allocationKeys.length };
      },
      async findBatch() {
        return {
          ...targetBatch,
          remainingMeals: 0,
          reservedMeals: 4,
          consumedMeals: 26,
        };
      },
    },
  });

  assert.strictEqual(reserveCalls, 0);
  assert.strictEqual(transitions.length, 1);
  assert.deepStrictEqual(transitions[0].allocationKeys, reservedRows.map((row) => row.allocationKey));
  assert.strictEqual(transitions[0].toState, "consumed");
  assert.deepStrictEqual(result.allocationKeys, reservedRows.map((row) => row.allocationKey));
  assert.strictEqual(result.consumedReservedMeals, 6);
  assert.strictEqual(result.consumedAvailableMeals, 0);
  assert.strictEqual(result.updatedBatch.remainingMeals, 0);
  assert.strictEqual(result.updatedBatch.reservedMeals, 4);
}

async function testUsesAvailableCreditsOnlyForReservationDeficit() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const targetBatch = {
    _id: new mongoose.Types.ObjectId(),
    proteinGrams: 200,
    paymentId: null,
  };
  const transitions = [];
  let reservedBlueprint = null;

  const result = await consumeBatchThroughAllocationLedgerTransactional({
    subscription: { _id: subscriptionId, userId },
    batch: targetBatch,
    businessDate: "2026-08-27",
    mealsToDeduct: 5,
    idempotencyKey: "mixed-reserved-available-test",
    session: {},
    runtime: {
      async findReservedAllocations() {
        return [
          { allocationKey: "existing-1" },
          { allocationKey: "existing-2" },
        ];
      },
      async reserveBlueprint(args) {
        reservedBlueprint = args.blueprint;
        return {
          results: ["fresh-1", "fresh-2", "fresh-3"].map((allocationKey) => ({
            allocation: { allocationKey },
          })),
        };
      },
      async transitionAllocations(args) {
        transitions.push(args);
        return { handled: true, changedCount: args.allocationKeys.length };
      },
      async findBatch() {
        return {
          ...targetBatch,
          remainingMeals: 0,
          reservedMeals: 0,
          consumedMeals: 5,
        };
      },
    },
  });

  assert.ok(reservedBlueprint);
  assert.strictEqual(reservedBlueprint.slots.length, 3, "only the unreserved deficit may allocate fresh credits");
  assert.strictEqual(transitions.length, 2);
  assert.deepStrictEqual(transitions[0].allocationKeys, ["existing-1", "existing-2"]);
  assert.deepStrictEqual(transitions[1].allocationKeys, ["fresh-1", "fresh-2", "fresh-3"]);
  assert.strictEqual(result.consumedReservedMeals, 2);
  assert.strictEqual(result.consumedAvailableMeals, 3);
  assert.deepStrictEqual(result.allocationKeys, [
    "existing-1",
    "existing-2",
    "fresh-1",
    "fresh-2",
    "fresh-3",
  ]);
}

async function run() {
  await testConsumesExistingReservationsBeforeCreatingNewOnes();
  await testUsesAvailableCreditsOnlyForReservationDeficit();
  console.log("subscriptionQuickDayDeductionLedgerAdapter.test.js: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
