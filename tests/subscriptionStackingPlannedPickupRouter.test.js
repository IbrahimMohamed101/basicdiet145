"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  choosePickupAllocations,
  collectExplicitPickupSlotKeys,
  createStackingPlannedPickupWrapper,
  reservePlannedStackingPickupEntitlements,
  resolvePickupDate,
  resolveRequestedMealCount,
} = require("../src/services/subscription/subscriptionStackingPlannedPickupRouterService");

function transactionalSession() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function pickupRequest(overrides = {}) {
  return {
    _id: "pickup-1",
    subscriptionId: "stack-sub",
    subscriptionDayId: "day-1",
    userId: "allowed",
    date: "2026-08-10",
    mealCount: 2,
    selectionMode: "slot_ids",
    selectedMealSlotIds: ["slot_1", "slot_2"],
    snapshot: {
      mealSlots: [
        { slotKey: "slot_1", slotIndex: 1 },
        { slotKey: "slot_2", slotIndex: 2 },
      ],
    },
    ...overrides,
  };
}

function allocation(index, overrides = {}) {
  return {
    _id: `row-${index}`,
    allocationKey: `allocation-${index}`,
    containerSubscriptionId: "stack-sub",
    userId: "allowed",
    subscriptionDayId: "day-1",
    pickupRequestId: null,
    slotKey: `slot_${index}`,
    date: "2026-08-10",
    state: "reserved",
    ...overrides,
  };
}

function buildRuntime(overrides = {}) {
  return {
    globallyEnabled: () => true,
    writeEnabledForUser: (userId) => userId === "allowed",
    findBatchOwner: async () => ({
      userId: "allowed",
      containerSubscriptionId: "stack-sub",
    }),
    findConfirmedDay: async () => ({
      _id: "day-1",
      subscriptionId: "stack-sub",
      date: "2026-08-10",
      plannerState: "confirmed",
    }),
    findAllocations: async () => [allocation(1), allocation(2)],
    claimAllocation: async ({ allocationId, pickupRequestId }) => ({
      ...allocation(Number(String(allocationId).replace("row-", ""))),
      pickupRequestId,
    }),
    findAllocationById: async () => null,
    ...overrides,
  };
}

async function testNonStackedSubscriptionUsesLegacy() {
  let legacyCalls = 0;
  const wrapper = createStackingPlannedPickupWrapper(
    async () => {
      legacyCalls += 1;
      return { source: "legacy" };
    },
    buildRuntime({ findBatchOwner: async () => null })
  );

  const result = await wrapper({
    subscriptionId: "standard-sub",
    pickupRequest: pickupRequest({ subscriptionId: "standard-sub" }),
    session: transactionalSession(),
  });
  assert.strictEqual(result.source, "legacy");
  assert.strictEqual(legacyCalls, 1);
}

async function testExistingStackFailsClosedWhenWriteDisabled() {
  const wrapper = createStackingPlannedPickupWrapper(
    async () => ({ source: "legacy" }),
    buildRuntime({ globallyEnabled: () => false })
  );

  await assert.rejects(
    () => wrapper({
      subscriptionId: "stack-sub",
      pickupRequest: pickupRequest(),
      session: transactionalSession(),
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_WRITE_DISABLED" && err.status === 503)
  );
}

async function testOwnershipIsBoundToBatchOwner() {
  await assert.rejects(
    () => reservePlannedStackingPickupEntitlements({
      subscriptionId: "stack-sub",
      pickupRequest: pickupRequest({ userId: "attacker" }),
      session: transactionalSession(),
      runtime: buildRuntime(),
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_OWNER_MISMATCH" && err.status === 403)
  );
}

async function testConfirmedSelectedSlotsAreClaimedExactlyOnce() {
  const claimCalls = [];
  const runtime = buildRuntime({
    claimAllocation: async (args) => {
      claimCalls.push(args);
      const index = Number(String(args.allocationId).replace("row-", ""));
      return { ...allocation(index), pickupRequestId: args.pickupRequestId };
    },
  });

  const result = await reservePlannedStackingPickupEntitlements({
    subscriptionId: "stack-sub",
    pickupRequest: pickupRequest(),
    session: transactionalSession(),
    runtime,
  });

  assert.strictEqual(result.handled, true);
  assert.strictEqual(result.reservation.plannedStackingPickup, true);
  assert.deepStrictEqual(result.reservation.allocationKeys, ["allocation-1", "allocation-2"]);
  assert.deepStrictEqual(result.reservation.newlyClaimedKeys, ["allocation-1", "allocation-2"]);
  assert.deepStrictEqual(result.reservation.newlyReservedKeys, []);
  assert.strictEqual(claimCalls.length, 2);
  assert.ok(claimCalls.every((call) => call.pickupRequestId === "pickup-1"));
}

async function testReplayOfSamePickupRequestDoesNotClaimAgain() {
  let claimCalls = 0;
  const rows = [
    allocation(1, { pickupRequestId: "pickup-1" }),
    allocation(2, { pickupRequestId: "pickup-1" }),
  ];
  const result = await reservePlannedStackingPickupEntitlements({
    subscriptionId: "stack-sub",
    pickupRequest: pickupRequest(),
    session: transactionalSession(),
    runtime: buildRuntime({
      findAllocations: async () => rows,
      claimAllocation: async () => {
        claimCalls += 1;
        return null;
      },
    }),
  });

  assert.strictEqual(result.handled, true);
  assert.deepStrictEqual(result.reservation.allocationKeys, ["allocation-1", "allocation-2"]);
  assert.deepStrictEqual(result.reservation.newlyClaimedKeys, []);
  assert.strictEqual(claimCalls, 0);
}

async function testConcurrentClaimFailsClosed() {
  await assert.rejects(
    () => reservePlannedStackingPickupEntitlements({
      subscriptionId: "stack-sub",
      pickupRequest: pickupRequest({ mealCount: 1, selectedMealSlotIds: ["slot_1"], snapshot: { mealSlots: [{ slotKey: "slot_1" }] } }),
      session: transactionalSession(),
      runtime: buildRuntime({
        findAllocations: async () => [allocation(1)],
        claimAllocation: async () => null,
        findAllocationById: async () => allocation(1, { pickupRequestId: "pickup-2" }),
      }),
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_ALLOCATION_CLAIM_CONFLICT")
  );
}

async function testLegacyMealCountUsesOnlyUnclaimedSlots() {
  const request = pickupRequest({
    _id: "pickup-2",
    mealCount: 2,
    selectionMode: "legacy_meal_count",
    selectedMealSlotIds: [],
    snapshot: { mealSlots: [
      { slotKey: "slot_1" },
      { slotKey: "slot_2" },
      { slotKey: "slot_3" },
    ] },
  });
  const selected = choosePickupAllocations({
    allocations: [
      allocation(1, { pickupRequestId: "pickup-2" }),
      allocation(2),
      allocation(3),
    ],
    pickupRequest: request,
    mealCount: 2,
  });
  assert.deepStrictEqual(selected.map((row) => row.allocationKey), ["allocation-1", "allocation-2"]);
  assert.deepStrictEqual(collectExplicitPickupSlotKeys(request), []);
}

async function testConfirmedDayAndTransactionAreMandatory() {
  await assert.rejects(
    () => reservePlannedStackingPickupEntitlements({
      subscriptionId: "stack-sub",
      pickupRequest: pickupRequest(),
      session: transactionalSession(),
      runtime: buildRuntime({ findConfirmedDay: async () => null }),
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_REQUIRES_CONFIRMED_DAY" && err.status === 422)
  );

  await assert.rejects(
    () => reservePlannedStackingPickupEntitlements({
      subscriptionId: "stack-sub",
      pickupRequest: pickupRequest(),
      session: { supportsTransactions: true, inTransaction: () => false },
      runtime: buildRuntime(),
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED" && err.status === 503)
  );
}

async function testExplicitSelectionCannotSilentlyShrink() {
  await assert.rejects(
    () => reservePlannedStackingPickupEntitlements({
      subscriptionId: "stack-sub",
      pickupRequest: pickupRequest(),
      session: transactionalSession(),
      runtime: buildRuntime({ findAllocations: async () => [allocation(1)] }),
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_ALLOCATION_SET_INCOMPLETE")
  );
}

function testInputResolvers() {
  assert.strictEqual(resolveRequestedMealCount({ mealCount: 5 }), 5);
  assert.strictEqual(resolveRequestedMealCount({ pickupRequest: { mealCount: 3 } }), 3);
  assert.strictEqual(resolvePickupDate({ pickupRequest: { date: "2026-08-10" } }), "2026-08-10");
  assert.strictEqual(resolvePickupDate({ pickupDate: "bad" }), "");
  assert.deepStrictEqual(
    collectExplicitPickupSlotKeys(pickupRequest()),
    ["slot_1", "slot_2"]
  );
}

async function run() {
  await testNonStackedSubscriptionUsesLegacy();
  await testExistingStackFailsClosedWhenWriteDisabled();
  await testOwnershipIsBoundToBatchOwner();
  await testConfirmedSelectedSlotsAreClaimedExactlyOnce();
  await testReplayOfSamePickupRequestDoesNotClaimAgain();
  await testConcurrentClaimFailsClosed();
  await testLegacyMealCountUsesOnlyUnclaimedSlots();
  await testConfirmedDayAndTransactionAreMandatory();
  await testExplicitSelectionCannotSilentlyShrink();
  testInputResolvers();
  console.log("subscription stacking planned pickup router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
