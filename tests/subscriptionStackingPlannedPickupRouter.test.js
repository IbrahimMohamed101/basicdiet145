"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  assertPlannedPickupAllocations,
  createStackingPlannedPickupWrapper,
  resolvePickupDate,
  resolveRequestedMealCount,
} = require("../src/services/subscription/subscriptionStackingPlannedPickupRouterService");

function allocation(index, overrides = {}) {
  return {
    allocationKey: `allocation-${index}`,
    slotKey: `slot_${index}`,
    date: "2026-08-10",
    state: "reserved",
    ...overrides,
  };
}

async function testDisabledIsExactLegacyNoOp() {
  let ownerLookups = 0;
  let originalCalls = 0;
  const wrapper = createStackingPlannedPickupWrapper(
    async (args) => {
      originalCalls += 1;
      return { source: "legacy", args };
    },
    {
      globallyEnabled: () => false,
      writeEnabledForUser: () => true,
      findBatchOwner: async () => {
        ownerLookups += 1;
        throw new Error("must not query while disabled");
      },
    }
  );

  const result = await wrapper({ subscriptionId: "sub-1", mealCount: 5 });
  assert.strictEqual(result.source, "legacy");
  assert.strictEqual(originalCalls, 1);
  assert.strictEqual(ownerLookups, 0);
}

async function testNonStackedSubscriptionUsesLegacy() {
  let originalCalls = 0;
  const wrapper = createStackingPlannedPickupWrapper(
    async () => {
      originalCalls += 1;
      return { source: "legacy" };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      findBatchOwner: async () => null,
    }
  );
  const result = await wrapper({ subscriptionId: "standard-sub" });
  assert.strictEqual(result.source, "legacy");
  assert.strictEqual(originalCalls, 1);
}

async function testConfirmedDayReturnsExistingAllocationKeys() {
  const rows = [1, 2, 3, 4, 5].map(allocation);
  let originalCalls = 0;
  const wrapper = createStackingPlannedPickupWrapper(
    async () => {
      originalCalls += 1;
      return { source: "legacy" };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: (userId) => userId === "allowed",
      findBatchOwner: async () => ({
        userId: "allowed",
        containerSubscriptionId: "stack-sub",
      }),
      findAllocations: async (args) => {
        assert.strictEqual(args.subscriptionId, "stack-sub");
        assert.strictEqual(args.date, "2026-08-10");
        return rows;
      },
    }
  );

  const result = await wrapper({
    subscriptionId: "stack-sub",
    date: "2026-08-10",
    mealCount: 5,
  });
  assert.strictEqual(result.plannedStackingPickup, true);
  assert.deepStrictEqual(result.allocationKeys, rows.map((row) => row.allocationKey));
  assert.deepStrictEqual(result.newlyReservedKeys, []);
  assert.strictEqual(originalCalls, 0);
}

async function testExplicitAllocationKeysMustBeComplete() {
  const wrapper = createStackingPlannedPickupWrapper(
    async () => ({ source: "legacy" }),
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      findBatchOwner: async () => ({ userId: "allowed" }),
      findAllocations: async () => [allocation(1)],
    }
  );
  await assert.rejects(
    () => wrapper({
      subscriptionId: "stack-sub",
      allocationKeys: ["allocation-1", "allocation-2"],
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_ALLOCATION_SET_INCOMPLETE")
  );
}

async function testMealCountMismatchFailsClosed() {
  const wrapper = createStackingPlannedPickupWrapper(
    async () => ({ source: "legacy" }),
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      findBatchOwner: async () => ({ userId: "allowed" }),
      findAllocations: async () => [allocation(1), allocation(2)],
    }
  );
  await assert.rejects(
    () => wrapper({
      subscriptionId: "stack-sub",
      date: "2026-08-10",
      mealCount: 5,
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_ALLOCATION_COUNT_MISMATCH")
  );
}

async function testUnconfirmedDayFailsBeforeCreatingCredits() {
  let originalCalls = 0;
  const wrapper = createStackingPlannedPickupWrapper(
    async () => {
      originalCalls += 1;
      return { source: "legacy" };
    },
    {
      globallyEnabled: () => true,
      writeEnabledForUser: () => true,
      findBatchOwner: async () => ({ userId: "allowed" }),
      findAllocations: async () => [],
    }
  );
  await assert.rejects(
    () => wrapper({
      subscriptionId: "stack-sub",
      date: "2026-08-10",
      mealCount: 5,
    }),
    (err) => Boolean(
      err
      && err.code === "STACKING_PICKUP_REQUIRES_CONFIRMED_DAY"
      && err.status === 503
    )
  );
  assert.strictEqual(originalCalls, 0);
}

function testAllocationValidationRules() {
  assert.throws(
    () => assertPlannedPickupAllocations({
      allocations: [allocation(1, { state: "consumed" })],
      requestedKeys: [],
      requestedMealCount: 1,
      subscriptionId: "sub-1",
      date: "2026-08-10",
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_ALLOCATION_STATE_CONFLICT")
  );
  assert.throws(
    () => assertPlannedPickupAllocations({
      allocations: [allocation(1, { date: "2026-08-11" })],
      requestedKeys: [],
      requestedMealCount: 1,
      subscriptionId: "sub-1",
      date: "2026-08-10",
    }),
    (err) => Boolean(err && err.code === "STACKING_PICKUP_DATE_MISMATCH")
  );
}

function testInputResolvers() {
  assert.strictEqual(resolveRequestedMealCount({ mealCount: 5 }), 5);
  assert.strictEqual(resolveRequestedMealCount({ pickupRequest: { mealCount: 3 } }), 3);
  assert.strictEqual(resolvePickupDate({ day: { date: "2026-08-10" } }), "2026-08-10");
  assert.strictEqual(resolvePickupDate({ pickupDate: "bad" }), "");
}

async function run() {
  await testDisabledIsExactLegacyNoOp();
  await testNonStackedSubscriptionUsesLegacy();
  await testConfirmedDayReturnsExistingAllocationKeys();
  await testExplicitAllocationKeysMustBeComplete();
  await testMealCountMismatchFailsClosed();
  await testUnconfirmedDayFailsBeforeCreatingCredits();
  testAllocationValidationRules();
  testInputResolvers();
  console.log("subscription stacking planned pickup router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
