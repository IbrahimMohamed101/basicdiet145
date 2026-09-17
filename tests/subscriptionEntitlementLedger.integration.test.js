"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementDayBlueprint = require("../src/models/SubscriptionEntitlementDayBlueprint");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const {
  materializeEntitlementDayBlueprint,
  reserveBlueprintAllocationsTransactional,
  transitionEntitlementAllocationTransactional,
} = require("../src/services/subscription/subscriptionEntitlementLedgerService");

let replSet;

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "subscription_stacking_ledger" },
  });
  await mongoose.connect(replSet.getUri("subscription_stacking_ledger"), {
    serverSelectionTimeoutMS: 10000,
  });
  await Promise.all([
    SubscriptionEntitlementBatch.syncIndexes(),
    SubscriptionEntitlementDayBlueprint.syncIndexes(),
    SubscriptionEntitlementAllocation.syncIndexes(),
  ]);
}

async function disconnect() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function seedBatches() {
  const userId = new mongoose.Types.ObjectId();
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const common = {
    userId,
    containerSubscriptionId,
    planId: new mongoose.Types.ObjectId(),
    sourceType: "checkout",
    requestedStartDate: new Date("2026-08-01T00:00:00+03:00"),
    effectiveStartDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    daysCount: 26,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    status: "active",
    applicationState: "applied",
    appliedAt: new Date(),
  };

  const oldBatch = await SubscriptionEntitlementBatch.create({
    ...common,
    sourceKey: `legacy:${containerSubscriptionId}`,
    mealsPerDay: 3,
    proteinGrams: 200,
    totalMeals: 78,
    remainingMeals: 20,
  });
  const newBatch = await SubscriptionEntitlementBatch.create({
    ...common,
    planId: new mongoose.Types.ObjectId(),
    sourceKey: `payment:${new mongoose.Types.ObjectId()}`,
    mealsPerDay: 2,
    proteinGrams: 150,
    totalMeals: 52,
    remainingMeals: 52,
  });

  return { userId, containerSubscriptionId, oldBatch, newBatch };
}

async function testMaterializeReserveAndTransitionLifecycle() {
  const { userId, containerSubscriptionId, oldBatch, newBatch } = await seedBatches();
  const materialized = await materializeEntitlementDayBlueprint({
    userId,
    containerSubscriptionId,
    date: "2026-08-06",
    batches: [newBatch.toObject(), oldBatch.toObject()],
  });

  assert.strictEqual(materialized.idempotent, false);
  assert.strictEqual(materialized.blueprint.requiredSlotCount, 5);
  assert.deepStrictEqual(
    materialized.blueprint.slots.map((slot) => Number(slot.proteinGrams)),
    [200, 200, 200, 150, 150]
  );

  const repeatedMaterialization = await materializeEntitlementDayBlueprint({
    userId,
    containerSubscriptionId,
    date: "2026-08-06",
    batches: [newBatch.toObject(), oldBatch.toObject()],
  });
  assert.strictEqual(repeatedMaterialization.idempotent, true);
  assert.strictEqual(
    String(repeatedMaterialization.blueprint._id),
    String(materialized.blueprint._id)
  );

  const reservation = await withTransaction((session) => (
    reserveBlueprintAllocationsTransactional({
      userId,
      containerSubscriptionId,
      blueprint: materialized.blueprint,
      subscriptionDayId: new mongoose.Types.ObjectId(),
      plannerRevisionHash: "revision-1",
      operationIdempotencyKeyPrefix: "reserve-test-1",
      session,
    })
  ));

  assert.strictEqual(reservation.allocationCount, 5);
  assert.strictEqual(reservation.newlyReservedCount, 5);

  let oldAfterReserve = await SubscriptionEntitlementBatch.findById(oldBatch._id).lean();
  let newAfterReserve = await SubscriptionEntitlementBatch.findById(newBatch._id).lean();
  assert.deepStrictEqual(
    {
      remaining: oldAfterReserve.remainingMeals,
      reserved: oldAfterReserve.reservedMeals,
    },
    { remaining: 17, reserved: 3 }
  );
  assert.deepStrictEqual(
    {
      remaining: newAfterReserve.remainingMeals,
      reserved: newAfterReserve.reservedMeals,
    },
    { remaining: 50, reserved: 2 }
  );

  const repeatedReservation = await withTransaction((session) => (
    reserveBlueprintAllocationsTransactional({
      userId,
      containerSubscriptionId,
      blueprint: materialized.blueprint,
      subscriptionDayId: new mongoose.Types.ObjectId(),
      plannerRevisionHash: "revision-1",
      operationIdempotencyKeyPrefix: "reserve-test-1",
      session,
    })
  ));
  assert.strictEqual(repeatedReservation.newlyReservedCount, 0);

  oldAfterReserve = await SubscriptionEntitlementBatch.findById(oldBatch._id).lean();
  newAfterReserve = await SubscriptionEntitlementBatch.findById(newBatch._id).lean();
  assert.strictEqual(oldAfterReserve.remainingMeals, 17);
  assert.strictEqual(oldAfterReserve.reservedMeals, 3);
  assert.strictEqual(newAfterReserve.remainingMeals, 50);
  assert.strictEqual(newAfterReserve.reservedMeals, 2);

  const allocations = await SubscriptionEntitlementAllocation.find({
    containerSubscriptionId,
    date: "2026-08-06",
  }).sort({ slotKey: 1 }).lean();
  assert.strictEqual(allocations.length, 5);

  const oldAllocation = allocations.find((row) => row.slotKey === "slot_1");
  const newAllocation = allocations.find((row) => row.slotKey === "slot_4");
  assert.strictEqual(String(oldAllocation.entitlementBatchId), String(oldBatch._id));
  assert.strictEqual(oldAllocation.proteinGrams, 200);
  assert.strictEqual(String(newAllocation.entitlementBatchId), String(newBatch._id));
  assert.strictEqual(newAllocation.proteinGrams, 150);

  const consumed = await withTransaction((session) => (
    transitionEntitlementAllocationTransactional({
      allocationId: oldAllocation._id,
      toState: "consumed",
      session,
    })
  ));
  assert.strictEqual(consumed.idempotent, false);

  const released = await withTransaction((session) => (
    transitionEntitlementAllocationTransactional({
      allocationId: newAllocation._id,
      toState: "released",
      session,
    })
  ));
  assert.strictEqual(released.idempotent, false);

  const repeatedConsumed = await withTransaction((session) => (
    transitionEntitlementAllocationTransactional({
      allocationId: oldAllocation._id,
      toState: "consumed",
      session,
    })
  ));
  assert.strictEqual(repeatedConsumed.idempotent, true);

  const oldFinal = await SubscriptionEntitlementBatch.findById(oldBatch._id).lean();
  const newFinal = await SubscriptionEntitlementBatch.findById(newBatch._id).lean();
  assert.deepStrictEqual(
    {
      remaining: oldFinal.remainingMeals,
      reserved: oldFinal.reservedMeals,
      consumed: oldFinal.consumedMeals,
    },
    { remaining: 17, reserved: 2, consumed: 1 }
  );
  assert.deepStrictEqual(
    {
      remaining: newFinal.remainingMeals,
      reserved: newFinal.reservedMeals,
      consumed: newFinal.consumedMeals,
    },
    { remaining: 51, reserved: 1, consumed: 0 }
  );
}

async function testMutationsRequireRealTransaction() {
  const { userId, containerSubscriptionId, oldBatch } = await seedBatches();
  const materialized = await materializeEntitlementDayBlueprint({
    userId,
    containerSubscriptionId,
    date: "2026-08-06",
    batches: [oldBatch.toObject()],
  });

  await assert.rejects(
    () => reserveBlueprintAllocationsTransactional({
      userId,
      containerSubscriptionId,
      blueprint: materialized.blueprint,
      session: null,
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
}

async function run() {
  try {
    await connect();
    await testMaterializeReserveAndTransitionLifecycle();
    await testMutationsRequireRealTransaction();
    console.log("subscription entitlement ledger integration tests passed");
  } finally {
    await disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
