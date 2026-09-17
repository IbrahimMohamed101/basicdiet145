"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  reacquireStackingAllocationTransactional,
  reopenStackingDayEntitlementsTransactional,
  transitionStackingAllocationsByKeysTransactional,
  transitionStackingDayEntitlementsTransactional,
} = require("../src/services/subscription/subscriptionStackingFulfillmentLedgerService");

function session() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function allocation(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    allocationKey: `allocation-${Math.random()}`,
    containerSubscriptionId: new mongoose.Types.ObjectId(),
    entitlementBatchId: new mongoose.Types.ObjectId(),
    subscriptionDayId: new mongoose.Types.ObjectId(),
    date: "2026-08-06",
    slotKey: "slot_1",
    state: "reserved",
    ...overrides,
  };
}

function runtimeFixture(rows) {
  const allocations = rows.map((row) => ({ ...row }));
  const calls = {
    transitions: [],
    dayUpdates: [],
    lifecycle: [],
    batchReservations: [],
    reacquires: [],
  };
  const runtime = {
    findDayAllocations: async () => allocations.map((row) => ({ ...row })),
    findAllocationsByKeys: async ({ allocationKeys }) => allocations
      .filter((row) => allocationKeys.includes(row.allocationKey))
      .map((row) => ({ ...row })),
    transitionAllocation: async ({ allocationId, toState }) => {
      const row = allocations.find((entry) => String(entry._id) === String(allocationId));
      assert(row);
      row.state = toState;
      calls.transitions.push({ allocationId: String(allocationId), toState });
      return { allocation: { ...row }, idempotent: false };
    },
    updateDayState: async (args) => {
      calls.dayUpdates.push(args);
      return { matchedCount: 1 };
    },
    reconcileLifecycle: async (args) => {
      calls.lifecycle.push(args);
      return { outcome: "reconciled", container: { _id: args.containerSubscriptionId } };
    },
    findAllocationByKey: async ({ allocationKey }) => {
      const row = allocations.find((entry) => entry.allocationKey === allocationKey);
      return row ? { ...row } : null;
    },
    reserveReleasedBatchCredit: async ({ allocation: row }) => {
      calls.batchReservations.push(row.allocationKey);
      return { _id: row.entitlementBatchId, remainingMeals: 0, reservedMeals: 1 };
    },
    reacquireAllocationDocument: async ({ allocation: row }) => {
      const stored = allocations.find((entry) => String(entry._id) === String(row._id));
      if (!stored || stored.state !== "released") return null;
      stored.state = "reserved";
      calls.reacquires.push(stored.allocationKey);
      return { ...stored };
    },
  };
  return { runtime, allocations, calls };
}

async function testDayConsumeTransitionsEveryReservedAllocation() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const rows = [1, 2, 3].map((index) => allocation({
    allocationKey: `day-${index}`,
    containerSubscriptionId,
    subscriptionDayId: dayId,
    slotKey: `slot_${index}`,
  }));
  const fixture = runtimeFixture(rows);

  const result = await transitionStackingDayEntitlementsTransactional({
    containerSubscriptionId,
    day: { _id: dayId, date: "2026-08-06" },
    toState: "consumed",
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });

  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.changedCount, 3);
  assert.strictEqual(fixture.calls.transitions.length, 3);
  assert(fixture.allocations.every((row) => row.state === "consumed"));
  assert.strictEqual(fixture.calls.dayUpdates[0].toState, "consumed");
  assert.strictEqual(fixture.calls.lifecycle.length, 1);
}

async function testRepeatedTerminalTransitionIsIdempotent() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const row = allocation({
    allocationKey: "already-consumed",
    containerSubscriptionId,
    state: "consumed",
  });
  const fixture = runtimeFixture([row]);
  const result = await transitionStackingDayEntitlementsTransactional({
    containerSubscriptionId,
    day: { _id: row.subscriptionDayId, date: row.date },
    toState: "consumed",
    businessDate: row.date,
    session: session(),
    runtime: fixture.runtime,
  });

  assert.strictEqual(result.changedCount, 0);
  assert.strictEqual(fixture.calls.transitions.length, 0);
  assert.strictEqual(fixture.calls.lifecycle.length, 1);
}

async function testIncompatibleTerminalStateFailsClosed() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const row = allocation({
    containerSubscriptionId,
    state: "consumed",
  });
  const fixture = runtimeFixture([row]);
  await assert.rejects(
    () => transitionStackingDayEntitlementsTransactional({
      containerSubscriptionId,
      day: { _id: row.subscriptionDayId, date: row.date },
      toState: "released",
      businessDate: row.date,
      session: session(),
      runtime: fixture.runtime,
    }),
    (err) => Boolean(err && err.code === "STACKING_FULFILLMENT_STATE_CONFLICT")
  );
}

async function testTransitionByKeysRequiresCompleteSet() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const row = allocation({ allocationKey: "key-1", containerSubscriptionId });
  const fixture = runtimeFixture([row]);
  await assert.rejects(
    () => transitionStackingAllocationsByKeysTransactional({
      containerSubscriptionId,
      allocationKeys: ["key-1", "missing"],
      toState: "released",
      businessDate: row.date,
      session: session(),
      runtime: fixture.runtime,
    }),
    (err) => Boolean(err && err.code === "STACKING_ALLOCATION_SET_INCOMPLETE")
  );
}

async function testReleasedAllocationReacquiresOriginalBatch() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const row = allocation({
    allocationKey: "released-1",
    containerSubscriptionId,
    state: "released",
  });
  const fixture = runtimeFixture([row]);
  const result = await reacquireStackingAllocationTransactional({
    containerSubscriptionId,
    allocationKey: row.allocationKey,
    businessDate: row.date,
    session: session(),
    runtime: fixture.runtime,
  });

  assert.strictEqual(result.idempotent, false);
  assert.strictEqual(result.allocation.state, "reserved");
  assert.deepStrictEqual(fixture.calls.batchReservations, [row.allocationKey]);
  assert.deepStrictEqual(fixture.calls.reacquires, [row.allocationKey]);
  assert.strictEqual(fixture.calls.lifecycle.length, 1);
}

async function testReopenDayReacquiresAllReleasedAllocations() {
  const containerSubscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const rows = [1, 2].map((index) => allocation({
    allocationKey: `released-${index}`,
    containerSubscriptionId,
    subscriptionDayId: dayId,
    slotKey: `slot_${index}`,
    state: "released",
  }));
  const fixture = runtimeFixture(rows);
  const result = await reopenStackingDayEntitlementsTransactional({
    containerSubscriptionId,
    day: { _id: dayId, date: "2026-08-06" },
    businessDate: "2026-08-06",
    session: session(),
    runtime: fixture.runtime,
  });

  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.changedCount, 2);
  assert.strictEqual(fixture.calls.reacquires.length, 2);
  assert.strictEqual(fixture.calls.dayUpdates[0].toState, "reserved");
}

async function testTransactionIsMandatory() {
  const row = allocation();
  const fixture = runtimeFixture([row]);
  await assert.rejects(
    () => transitionStackingDayEntitlementsTransactional({
      containerSubscriptionId: row.containerSubscriptionId,
      day: { _id: row.subscriptionDayId, date: row.date },
      toState: "consumed",
      businessDate: row.date,
      session: null,
      runtime: fixture.runtime,
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
}

async function run() {
  await testDayConsumeTransitionsEveryReservedAllocation();
  await testRepeatedTerminalTransitionIsIdempotent();
  await testIncompatibleTerminalStateFailsClosed();
  await testTransitionByKeysRequiresCompleteSet();
  await testReleasedAllocationReacquiresOriginalBatch();
  await testReopenDayReacquiresAllReleasedAllocations();
  await testTransactionIsMandatory();
  console.log("subscription stacking fulfillment ledger tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
