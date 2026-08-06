"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  createStackingEntitlementWrappers,
} = require("../src/services/subscription/subscriptionStackingEntitlementRouterService");

function originalFunctions(calls) {
  const names = [
    "reserveDayEntitlements",
    "transitionDayEntitlements",
    "reopenDayEntitlements",
    "transitionAllocation",
    "reacquireAllocation",
    "reservePickupEntitlements",
    "transitionPickupEntitlements",
  ];
  return Object.fromEntries(names.map((name) => [name, async (args) => {
    calls.push([name, args]);
    return { source: `legacy:${name}` };
  }]));
}

function ownedSession(events = []) {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
    withTransaction: async (fn) => {
      events.push("transaction:start");
      await fn();
      events.push("transaction:commit");
    },
    endSession: async () => events.push("session:end"),
  };
}

async function testDisabledRoutesEverythingToLegacy() {
  const calls = [];
  const wrappers = createStackingEntitlementWrappers(originalFunctions(calls), {
    findStackingOwner: async () => "user-1",
    writeEnabledForUser: () => false,
  });
  const args = { subscriptionId: "sub-1" };

  for (const name of Object.keys(wrappers)) {
    const result = await wrappers[name](args);
    assert.strictEqual(result.source, `legacy:${name}`);
  }
  assert.strictEqual(calls.length, 7);
}

async function testReserveDayReturnsExistingStackingAllocations() {
  const wrappers = createStackingEntitlementWrappers(originalFunctions([]), {
    findStackingOwner: async () => "allowed",
    writeEnabledForUser: () => true,
    findDayAllocations: async () => [
      { allocationKey: "a-1", state: "reserved" },
      { allocationKey: "a-2", state: "consumed" },
    ],
  });
  const result = await wrappers.reserveDayEntitlements({
    subscriptionId: "sub-1",
    day: { _id: "day-1", date: "2026-08-06" },
  });
  assert.deepStrictEqual(result.allocationKeys, ["a-1", "a-2"]);
  assert.deepStrictEqual(result.newlyReservedKeys, []);
}

async function testMissingStackingReservationFailsClosed() {
  const wrappers = createStackingEntitlementWrappers(originalFunctions([]), {
    findStackingOwner: async () => "allowed",
    writeEnabledForUser: () => true,
    findDayAllocations: async () => [],
  });
  await assert.rejects(
    () => wrappers.reserveDayEntitlements({
      subscriptionId: "sub-1",
      day: { _id: "day-1" },
    }),
    (err) => Boolean(err && err.code === "STACKING_DAY_RESERVATION_MISSING")
  );
}

async function testDayTransitionOwnsTransaction() {
  const events = [];
  const session = ownedSession(events);
  const wrappers = createStackingEntitlementWrappers(originalFunctions([]), {
    findStackingOwner: async () => "allowed",
    writeEnabledForUser: () => true,
    startSession: async () => session,
    getBusinessDate: async () => "2026-08-06",
    transitionDay: async (args) => {
      events.push("transition:day");
      assert.strictEqual(args.session, session);
      assert.strictEqual(args.toState, "consumed");
      return { handled: true, changedCount: 5 };
    },
  });
  const result = await wrappers.transitionDayEntitlements({
    subscriptionId: "sub-1",
    day: { _id: "day-1", date: "2026-08-06" },
    toState: "consumed",
    session: null,
  });

  assert.strictEqual(result.changedCount, 5);
  assert.deepStrictEqual(events, [
    "transaction:start",
    "transition:day",
    "transaction:commit",
    "session:end",
  ]);
}

async function testSingleAllocationRoutesOnlyWhenNewKeyExists() {
  const calls = [];
  const originals = originalFunctions(calls);
  const wrappers = createStackingEntitlementWrappers(originals, {
    findStackingOwner: async () => "allowed",
    writeEnabledForUser: () => true,
    findAllocationsByKeys: async (_subscriptionId, keys) => (
      keys.includes("new-key") ? [{ allocationKey: "new-key" }] : []
    ),
    getBusinessDate: async () => "2026-08-06",
    transitionKeys: async () => ({ handled: true, changedCount: 1 }),
    reacquireAllocation: async () => ({ idempotent: false }),
  });

  const newResult = await wrappers.transitionAllocation({
    subscriptionId: "sub-1",
    allocationKey: "new-key",
    toState: "released",
    session: ownedSession(),
  });
  assert.strictEqual(newResult.changed, true);

  const legacyResult = await wrappers.transitionAllocation({
    subscriptionId: "sub-1",
    allocationKey: "legacy-key",
    toState: "released",
    session: ownedSession(),
  });
  assert.strictEqual(legacyResult.source, "legacy:transitionAllocation");
  assert.strictEqual(calls.length, 1);
}

async function testDirectPickupReservationFailsClosedForStacking() {
  const wrappers = createStackingEntitlementWrappers(originalFunctions([]), {
    findStackingOwner: async () => "allowed",
    writeEnabledForUser: () => true,
  });
  await assert.rejects(
    () => wrappers.reservePickupEntitlements({ subscriptionId: "sub-1" }),
    (err) => Boolean(
      err
      && err.code === "STACKING_DIRECT_PICKUP_RESERVATION_NOT_READY"
      && err.status === 503
    )
  );
}

async function testNoBatchOwnerUsesLegacyEvenIfFlagCallbackWouldAllow() {
  const calls = [];
  const wrappers = createStackingEntitlementWrappers(originalFunctions(calls), {
    findStackingOwner: async () => "",
    writeEnabledForUser: () => true,
  });
  const result = await wrappers.reopenDayEntitlements({ subscriptionId: "sub-1" });
  assert.strictEqual(result.source, "legacy:reopenDayEntitlements");
  assert.strictEqual(calls.length, 1);
}

async function run() {
  await testDisabledRoutesEverythingToLegacy();
  await testReserveDayReturnsExistingStackingAllocations();
  await testMissingStackingReservationFailsClosed();
  await testDayTransitionOwnsTransaction();
  await testSingleAllocationRoutesOnlyWhenNewKeyExists();
  await testDirectPickupReservationFailsClosedForStacking();
  await testNoBatchOwnerUsesLegacyEvenIfFlagCallbackWouldAllow();
  console.log("subscription stacking entitlement router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
