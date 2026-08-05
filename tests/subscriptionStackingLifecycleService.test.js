"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const dateUtils = require("../src/utils/date");

const {
  reconcileSubscriptionStackingLifecycleTransactional,
  resolveBatchLifecycleState,
  resolveContainerLifecycleStatus,
} = require("../src/services/subscription/subscriptionStackingLifecycleService");

function transactionSession() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function container(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-08-01T00:00:00+03:00"),
    endDate: new Date("2026-08-26T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-26T00:00:00+03:00"),
    totalMeals: 78,
    remainingMeals: 20,
    reservedMeals: 0,
    consumedMeals: 58,
    forfeitedMeals: 0,
    selectedMealsPerDay: 3,
    ...overrides,
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
  reservedMeals = 0,
  consumedMeals = Math.max(0, totalMeals - remainingMeals - reservedMeals),
  forfeitedMeals = 0,
  stackVersion = 1,
  activatedAt = null,
  exhaustedAt = null,
  expiredAt = null,
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status,
    effectiveStartDate: new Date(`${start}T00:00:00+03:00`),
    endDate: new Date(`${end}T00:00:00+03:00`),
    validityEndDate: new Date(`${end}T00:00:00+03:00`),
    mealsPerDay,
    proteinGrams: grams,
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    stackVersion,
    activatedAt,
    exhaustedAt,
    expiredAt,
    deliverySnapshot: {
      mode: "delivery",
      zoneId: "zone-a",
      slot: { window: "13:00-15:00" },
      address: { city: "Riyadh", district: "Olaya", street: "A" },
    },
  };
}

function createRuntime({ sourceContainer, sourceBatches, transitionConflict = false } = {}) {
  let currentContainer = { ...sourceContainer };
  let currentBatches = sourceBatches.map((row) => ({ ...row }));
  const calls = {
    batchTransitions: [],
    containerUpdates: [],
  };

  return {
    calls,
    getContainer: () => currentContainer,
    getBatches: () => currentBatches,
    runtime: {
      findContainer: async () => currentContainer,
      findBatches: async () => currentBatches.map((row) => ({ ...row })),
      transitionBatch: async ({ batch: source, transition }) => {
        calls.batchTransitions.push({ source, transition });
        if (transitionConflict) return null;
        const index = currentBatches.findIndex(
          (row) => String(row._id) === String(source._id)
        );
        const updated = {
          ...currentBatches[index],
          ...transition.set,
          stackVersion: Number(currentBatches[index].stackVersion || 1) + 1,
        };
        currentBatches[index] = updated;
        return { ...updated };
      },
      updateContainer: async ({ update }) => {
        calls.containerUpdates.push(update);
        currentContainer = { ...currentContainer, ...update };
        return { ...currentContainer };
      },
    },
  };
}

function testScheduledBatchActivatesOnStartDate() {
  const row = batch({
    status: "paid_scheduled",
    start: "2026-08-10",
    end: "2026-09-04",
    mealsPerDay: 2,
    grams: 150,
    totalMeals: 52,
    remainingMeals: 52,
    consumedMeals: 0,
  });
  const now = new Date("2026-08-10T01:00:00Z");
  const transition = resolveBatchLifecycleState(row, "2026-08-10", now);

  assert.strictEqual(transition.changed, true);
  assert.strictEqual(transition.status, "active");
  assert.strictEqual(transition.set.status, "active");
  assert.strictEqual(transition.set.activatedAt, now);
  assert.strictEqual(transition.reason, "inside_active_window");
}

function testScheduledBatchStaysHiddenBeforeStart() {
  const row = batch({
    status: "paid_scheduled",
    start: "2026-08-10",
    end: "2026-09-04",
    totalMeals: 52,
    remainingMeals: 52,
    consumedMeals: 0,
  });
  const transition = resolveBatchLifecycleState(row, "2026-08-09");

  assert.strictEqual(transition.changed, false);
  assert.strictEqual(transition.status, "paid_scheduled");
  assert.strictEqual(transition.reason, "before_effective_start");
}

function testZeroBalanceWaitsForReservationsBeforeExhaustion() {
  const reserved = batch({
    status: "active",
    totalMeals: 3,
    remainingMeals: 0,
    reservedMeals: 1,
    consumedMeals: 2,
  });
  const reservedTransition = resolveBatchLifecycleState(
    reserved,
    "2026-08-06"
  );
  assert.strictEqual(reservedTransition.status, "active");
  assert.strictEqual(reservedTransition.changed, true);
  assert(reservedTransition.set.activatedAt instanceof Date);

  const fullyConsumed = batch({
    status: "active",
    totalMeals: 3,
    remainingMeals: 0,
    reservedMeals: 0,
    consumedMeals: 3,
    activatedAt: new Date("2026-08-01T01:00:00Z"),
  });
  const exhaustedTransition = resolveBatchLifecycleState(
    fullyConsumed,
    "2026-08-06",
    new Date("2026-08-06T02:00:00Z")
  );
  assert.strictEqual(exhaustedTransition.status, "exhausted");
  assert.strictEqual(exhaustedTransition.set.status, "exhausted");
  assert(exhaustedTransition.set.exhaustedAt instanceof Date);
}

function testExpiredBatchTransitionsAfterValidityEnd() {
  const row = batch({
    status: "active",
    start: "2026-08-01",
    end: "2026-08-09",
  });
  const transition = resolveBatchLifecycleState(
    row,
    "2026-08-10",
    new Date("2026-08-10T01:00:00Z")
  );

  assert.strictEqual(transition.status, "expired");
  assert.strictEqual(transition.set.status, "expired");
  assert(transition.set.expiredAt instanceof Date);
  assert.strictEqual(transition.reason, "validity_ended");
}

function testReleasedCreditCanReactivateExhaustedBatch() {
  const row = batch({
    status: "exhausted",
    totalMeals: 3,
    remainingMeals: 1,
    reservedMeals: 0,
    consumedMeals: 2,
    activatedAt: new Date("2026-08-01T01:00:00Z"),
    exhaustedAt: new Date("2026-08-05T01:00:00Z"),
  });
  const transition = resolveBatchLifecycleState(row, "2026-08-06");

  assert.strictEqual(transition.status, "active");
  assert.strictEqual(transition.set.status, "active");
  assert.strictEqual(transition.set.exhaustedAt, null);
  assert.strictEqual(transition.reason, "released_credit_reactivated");
}

function testContainerRemainsActiveForFutureScheduledBatch() {
  const sub = container({
    endDate: new Date("2026-08-09T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-04T00:00:00+03:00"),
  });
  const rows = [
    batch({
      status: "expired",
      start: "2026-08-01",
      end: "2026-08-09",
      remainingMeals: 0,
      consumedMeals: 27,
      totalMeals: 27,
    }),
    batch({
      status: "paid_scheduled",
      start: "2026-08-10",
      end: "2026-09-04",
      mealsPerDay: 2,
      totalMeals: 52,
      remainingMeals: 52,
      consumedMeals: 0,
    }),
  ];

  assert.strictEqual(
    resolveContainerLifecycleStatus({
      container: sub,
      batches: rows,
      businessDate: "2026-08-09",
    }),
    "active"
  );
}

function testContainerExpiresWhenNoLiveOrFutureBatchRemains() {
  const sub = container();
  const rows = [
    batch({
      status: "expired",
      start: "2026-08-01",
      end: "2026-08-09",
      totalMeals: 27,
      remainingMeals: 0,
      consumedMeals: 27,
    }),
  ];

  assert.strictEqual(
    resolveContainerLifecycleStatus({
      container: sub,
      batches: rows,
      businessDate: "2026-08-10",
    }),
    "expired"
  );
}

async function testReconcileActivatesScheduledBatchAndUpdatesMirror() {
  const sub = container({
    endDate: new Date("2026-08-09T00:00:00+03:00"),
    validityEndDate: new Date("2026-09-04T00:00:00+03:00"),
    totalMeals: 27,
    remainingMeals: 20,
    consumedMeals: 7,
    selectedMealsPerDay: 3,
  });
  const oldBatch = batch({
    status: "expired",
    start: "2026-08-01",
    end: "2026-08-09",
    totalMeals: 27,
    remainingMeals: 20,
    consumedMeals: 7,
  });
  const futureBatch = batch({
    status: "paid_scheduled",
    start: "2026-08-10",
    end: "2026-09-04",
    mealsPerDay: 2,
    grams: 150,
    totalMeals: 52,
    remainingMeals: 52,
    consumedMeals: 0,
  });
  const state = createRuntime({
    sourceContainer: sub,
    sourceBatches: [oldBatch, futureBatch],
  });

  const result = await reconcileSubscriptionStackingLifecycleTransactional({
    containerSubscriptionId: sub._id,
    businessDate: "2026-08-10",
    now: new Date("2026-08-10T01:00:00Z"),
    session: transactionSession(),
    runtime: state.runtime,
  });

  assert.strictEqual(result.outcome, "reconciled");
  assert.strictEqual(result.transitions.length, 1);
  assert.strictEqual(result.transitions[0].fromStatus, "paid_scheduled");
  assert.strictEqual(result.transitions[0].toStatus, "active");
  assert.strictEqual(state.calls.batchTransitions.length, 1);
  assert.strictEqual(state.calls.containerUpdates.length, 1);

  const updated = state.getContainer();
  assert.strictEqual(updated.status, "active");
  assert.strictEqual(updated.totalMeals, 52);
  assert.strictEqual(updated.remainingMeals, 52);
  assert.strictEqual(updated.consumedMeals, 0);
  assert.strictEqual(updated.selectedMealsPerDay, 2);
  assert.strictEqual(dateUtils.toKSADateString(updated.endDate), "2026-09-04");
  assert.strictEqual(
    dateUtils.toKSADateString(updated.validityEndDate),
    "2026-09-04"
  );
}

async function testReconcileExpiresFinalBatchAndContainer() {
  const sub = container({
    endDate: new Date("2026-08-09T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-09T00:00:00+03:00"),
    totalMeals: 27,
    remainingMeals: 5,
    consumedMeals: 22,
  });
  const activeBatch = batch({
    status: "active",
    start: "2026-08-01",
    end: "2026-08-09",
    totalMeals: 27,
    remainingMeals: 5,
    consumedMeals: 22,
  });
  const state = createRuntime({
    sourceContainer: sub,
    sourceBatches: [activeBatch],
  });

  const result = await reconcileSubscriptionStackingLifecycleTransactional({
    containerSubscriptionId: sub._id,
    businessDate: "2026-08-10",
    session: transactionSession(),
    runtime: state.runtime,
  });

  assert.strictEqual(result.transitions.length, 1);
  assert.strictEqual(result.transitions[0].toStatus, "expired");
  assert.strictEqual(state.getContainer().status, "expired");
  assert.strictEqual(state.getContainer().remainingMeals, 0);
  assert.strictEqual(state.getContainer().totalMeals, 0);
}

async function testUnchangedReconcileIsIdempotent() {
  const sub = container({
    totalMeals: 78,
    remainingMeals: 20,
    reservedMeals: 0,
    consumedMeals: 58,
    selectedMealsPerDay: 3,
  });
  const activeBatch = batch({
    status: "active",
    activatedAt: new Date("2026-08-01T01:00:00Z"),
  });
  const state = createRuntime({
    sourceContainer: sub,
    sourceBatches: [activeBatch],
  });

  const result = await reconcileSubscriptionStackingLifecycleTransactional({
    containerSubscriptionId: sub._id,
    businessDate: "2026-08-06",
    session: transactionSession(),
    runtime: state.runtime,
  });

  assert.strictEqual(result.outcome, "unchanged");
  assert.strictEqual(result.idempotent, true);
  assert.strictEqual(result.transitions.length, 0);
  assert.strictEqual(state.calls.containerUpdates.length, 0);
}

async function testBatchConflictAbortsReconcile() {
  const sub = container();
  const scheduled = batch({
    status: "paid_scheduled",
    start: "2026-08-06",
    end: "2026-08-31",
    totalMeals: 52,
    remainingMeals: 52,
    consumedMeals: 0,
  });
  const state = createRuntime({
    sourceContainer: sub,
    sourceBatches: [scheduled],
    transitionConflict: true,
  });

  await assert.rejects(
    () => reconcileSubscriptionStackingLifecycleTransactional({
      containerSubscriptionId: sub._id,
      businessDate: "2026-08-06",
      session: transactionSession(),
      runtime: state.runtime,
    }),
    (err) => Boolean(
      err && err.code === "STACKING_BATCH_LIFECYCLE_CONFLICT"
    )
  );
  assert.strictEqual(state.calls.containerUpdates.length, 0);
}

async function testTransactionIsMandatory() {
  const sub = container();
  const state = createRuntime({
    sourceContainer: sub,
    sourceBatches: [batch()],
  });

  await assert.rejects(
    () => reconcileSubscriptionStackingLifecycleTransactional({
      containerSubscriptionId: sub._id,
      businessDate: "2026-08-06",
      session: null,
      runtime: state.runtime,
    }),
    (err) => Boolean(
      err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED"
    )
  );
}

async function run() {
  testScheduledBatchActivatesOnStartDate();
  testScheduledBatchStaysHiddenBeforeStart();
  testZeroBalanceWaitsForReservationsBeforeExhaustion();
  testExpiredBatchTransitionsAfterValidityEnd();
  testReleasedCreditCanReactivateExhaustedBatch();
  testContainerRemainsActiveForFutureScheduledBatch();
  testContainerExpiresWhenNoLiveOrFutureBatchRemains();
  await testReconcileActivatesScheduledBatchAndUpdatesMirror();
  await testReconcileExpiresFinalBatchAndContainer();
  await testUnchangedReconcileIsIdempotent();
  await testBatchConflictAbortsReconcile();
  await testTransactionIsMandatory();

  console.log("subscription stacking lifecycle service tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
