"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  applyStackingPickupWalletProjection,
  countUniqueReservedSlots,
  createStackingPickupAvailabilityReadWrapper,
} = require("../src/services/subscription/subscriptionStackingPickupAvailabilityReadService");

function baseAvailability(overrides = {}) {
  return {
    subscriptionId: "sub-1",
    subscriptionDayId: "day-1",
    date: "2026-08-11",
    wallet: {
      remainingMeals: 67,
      availableMeals: 67,
      reservedMeals: 0,
      consumedMeals: 0,
      totalEntitlement: 130,
    },
    canCreatePickupRequest: true,
    pickupItems: [{ itemId: "slot_1", isSelectable: true }],
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    globallyEnabled: () => true,
    readEnabledForUser: (userId) => userId === "user-1",
    hasAppliedBatch: async () => true,
    findUnclaimedReservedDayAllocations: async () => [
      { allocationKey: "a1", slotKey: "slot_1" },
      { allocationKey: "a2", slotKey: "slot_2" },
      { allocationKey: "a3", slotKey: "slot_3" },
      { allocationKey: "a4", slotKey: "slot_4" },
      { allocationKey: "a5", slotKey: "slot_5" },
    ],
    info: () => {},
    error: () => {},
    ...overrides,
  };
}

async function testProjectionAddsExternalConfirmedCredits() {
  const wrapper = createStackingPickupAvailabilityReadWrapper(
    async () => baseAvailability(),
    runtime()
  );
  const result = await wrapper({ userId: "user-1", subscriptionId: "sub-1", date: "2026-08-11" });
  assert.strictEqual(result.wallet.remainingMeals, 67);
  assert.strictEqual(result.wallet.availableMeals, 72);
  assert.strictEqual(result.canCreatePickupRequest, true);
}

async function testLegacyReservedRepresentationIsNotDoubleCounted() {
  const projected = applyStackingPickupWalletProjection(
    baseAvailability({
      wallet: {
        remainingMeals: 67,
        availableMeals: 70,
        reservedMeals: 0,
        consumedMeals: 0,
        totalEntitlement: 130,
      },
    }),
    5
  );
  assert.strictEqual(projected.wallet.availableMeals, 72);

  const sameRepresentation = applyStackingPickupWalletProjection(
    baseAvailability({
      wallet: {
        remainingMeals: 67,
        availableMeals: 72,
        reservedMeals: 0,
        consumedMeals: 0,
        totalEntitlement: 130,
      },
    }),
    5
  );
  assert.strictEqual(sameRepresentation.wallet.availableMeals, 72);
}

async function testFlagsAndAllowlistAreExactLegacyNoOp() {
  const original = baseAvailability();
  let batchLookups = 0;
  const disabled = createStackingPickupAvailabilityReadWrapper(
    async () => original,
    runtime({
      globallyEnabled: () => false,
      hasAppliedBatch: async () => {
        batchLookups += 1;
        return true;
      },
    })
  );
  assert.strictEqual(await disabled({ userId: "user-1" }), original);
  assert.strictEqual(batchLookups, 0);

  const notAllowed = createStackingPickupAvailabilityReadWrapper(
    async () => original,
    runtime({
      readEnabledForUser: () => false,
      hasAppliedBatch: async () => {
        batchLookups += 1;
        return true;
      },
    })
  );
  assert.strictEqual(await notAllowed({ userId: "user-1" }), original);
  assert.strictEqual(batchLookups, 0);
}

async function testNonStackedAndProjectionFailureFailOpen() {
  const original = baseAvailability();
  const nonStacked = createStackingPickupAvailabilityReadWrapper(
    async () => original,
    runtime({ hasAppliedBatch: async () => false })
  );
  assert.strictEqual(
    await nonStacked({ userId: "user-1", subscriptionId: "sub-1", date: "2026-08-11" }),
    original
  );

  let errors = 0;
  const failedRead = createStackingPickupAvailabilityReadWrapper(
    async () => original,
    runtime({
      findUnclaimedReservedDayAllocations: async () => {
        throw new Error("read failed");
      },
      error: () => {
        errors += 1;
      },
    })
  );
  assert.strictEqual(
    await failedRead({ userId: "user-1", subscriptionId: "sub-1", date: "2026-08-11" }),
    original
  );
  assert.strictEqual(errors, 1);
}

function testUniqueSlotCounting() {
  assert.strictEqual(countUniqueReservedSlots([
    { allocationKey: "a1", slotKey: "slot_1" },
    { allocationKey: "duplicate", slotKey: "slot_1" },
    { allocationKey: "a2", slotKey: "slot_2" },
    { allocationKey: "a3", slotKey: "" },
  ]), 3);
}

async function run() {
  await testProjectionAddsExternalConfirmedCredits();
  await testLegacyReservedRepresentationIsNotDoubleCounted();
  await testFlagsAndAllowlistAreExactLegacyNoOp();
  await testNonStackedAndProjectionFailureFailOpen();
  testUniqueSlotCounting();
  console.log("subscription stacking pickup availability read tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
