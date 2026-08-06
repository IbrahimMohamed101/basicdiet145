"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  assertSubscriptionStackingProductionSafety,
} = require("../src/services/subscription/subscriptionStackingProductionSafetyService");
const {
  assertSubscriptionStackingRolloutConfiguration,
  isUserAllowedForStacking,
  parseIdAllowlist,
} = require("../src/services/subscription/subscriptionStackingRolloutPolicyService");
const {
  createStackingEntitlementWrappers,
  withTransactionIfNeeded,
} = require("../src/services/subscription/subscriptionStackingEntitlementRouterService");
const {
  INSTALL_KEY: PLANNED_PICKUP_INSTALL_KEY,
  installSubscriptionStackingPlannedPickupRouter,
} = require("../src/services/installSubscriptionStackingPlannedPickupRouter");

function makeOriginals(calls) {
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
    calls.push(name);
    return { legacy: true, name, args };
  }]));
}

function testProductionWriteAlwaysBlocked() {
  for (const nodeEnv of ["production", " Production ", "PRODUCTION"]) {
    assert.throws(
      () => assertSubscriptionStackingProductionSafety({
        NODE_ENV: nodeEnv,
        SUBSCRIPTION_STACKING_WRITE_ENABLED: " TrUe ",
      }),
      (err) => Boolean(
        err
        && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_WRITE_BLOCKED"
        && err.details
        && err.details.writeEnabled === true
      )
    );
  }
  assert.doesNotThrow(() => assertSubscriptionStackingProductionSafety({
    NODE_ENV: "production",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
  }));
}

function testRolloutPolicyFailsClosed() {
  assert.throws(
    () => assertSubscriptionStackingRolloutConfiguration({
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
      SUBSCRIPTION_STACKING_READ_ENABLED: "false",
      SUBSCRIPTION_STACKING_USER_IDS: "user-1",
    }),
    (err) => err && err.code === "SUBSCRIPTION_STACKING_WRITE_REQUIRES_READ"
  );
  assert.throws(
    () => assertSubscriptionStackingRolloutConfiguration({
      SUBSCRIPTION_STACKING_READ_ENABLED: "true",
      SUBSCRIPTION_STACKING_USER_IDS: "",
    }),
    (err) => err && err.code === "SUBSCRIPTION_STACKING_ALLOWLIST_REQUIRED"
  );
  assert.throws(
    () => assertSubscriptionStackingRolloutConfiguration({
      SUBSCRIPTION_STACKING_READ_ENABLED: "true",
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
      SUBSCRIPTION_STACKING_USER_IDS: "*",
      SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    }),
    (err) => err && err.code === "SUBSCRIPTION_STACKING_WRITE_WILDCARD_BLOCKED"
  );

  const parsed = parseIdAllowlist(" user-1, user-1 ,user-2 ");
  assert.deepStrictEqual([...parsed].sort(), ["user-1", "user-2"]);
  const env = { SUBSCRIPTION_STACKING_USER_IDS: "507f1f77bcf86cd799439011" };
  assert.strictEqual(isUserAllowedForStacking("507f1f77bcf86cd799439011", env), true);
  assert.strictEqual(isUserAllowedForStacking("507f1f77bcf86cd79943901", env), false);
  assert.strictEqual(isUserAllowedForStacking("507f1f77bcf86cd7994390110", env), false);
  assert.strictEqual(isUserAllowedForStacking("", env), false);
}

async function testDisabledWrappersPerformNoLookup() {
  const calls = [];
  let ownerLookups = 0;
  const wrappers = createStackingEntitlementWrappers(makeOriginals(calls), {
    globallyEnabled: () => false,
    writeEnabledForUser: () => true,
    findStackingOwner: async () => {
      ownerLookups += 1;
      throw new Error("must not query while disabled");
    },
  });

  const result = await wrappers.transitionAllocation({
    subscriptionId: "sub-1",
    allocationKey: "allocation-1",
    toState: "consumed",
  });
  assert.strictEqual(result.legacy, true);
  assert.deepStrictEqual(calls, ["transitionAllocation"]);
  assert.strictEqual(ownerLookups, 0);
}

async function testDirectPickupRemainsFailClosed() {
  const calls = [];
  const wrappers = createStackingEntitlementWrappers(makeOriginals(calls), {
    globallyEnabled: () => true,
    writeEnabledForUser: (userId) => userId === "allowed-user",
    findStackingOwner: async () => "allowed-user",
  });

  await assert.rejects(
    () => wrappers.reservePickupEntitlements({ subscriptionId: "stack-sub" }),
    (err) => Boolean(
      err
      && err.code === "STACKING_DIRECT_PICKUP_RESERVATION_NOT_READY"
      && err.status === 503
    )
  );
  assert.deepStrictEqual(calls, []);
}

async function testForeignAllocationCannotEnterStackingLedger() {
  const calls = [];
  let transitionCalls = 0;
  const wrappers = createStackingEntitlementWrappers(makeOriginals(calls), {
    globallyEnabled: () => true,
    writeEnabledForUser: () => true,
    findStackingOwner: async () => "allowed-user",
    findAllocationsByKeys: async () => [],
    transitionKeys: async () => {
      transitionCalls += 1;
      throw new Error("foreign allocation must not transition");
    },
  });

  const result = await wrappers.transitionAllocation({
    subscriptionId: "owner-subscription",
    allocationKey: "allocation-from-another-subscription",
    toState: "consumed",
  });
  assert.strictEqual(result.legacy, true);
  assert.deepStrictEqual(calls, ["transitionAllocation"]);
  assert.strictEqual(transitionCalls, 0);
}

async function testOwnedSessionAlwaysClosesOnFailure() {
  let ended = 0;
  const runtime = {
    startSession: async () => ({
      async withTransaction(work) {
        await work();
      },
      async endSession() {
        ended += 1;
      },
    }),
  };

  await assert.rejects(
    () => withTransactionIfNeeded(null, runtime, async () => {
      throw new Error("transaction failure");
    }),
    /transaction failure/
  );
  assert.strictEqual(ended, 1);
}

function testPlannedPickupInstallerIsInert() {
  delete globalThis[PLANNED_PICKUP_INSTALL_KEY];
  const state = installSubscriptionStackingPlannedPickupRouter();
  assert.strictEqual(state.installed, false);
  assert.strictEqual(state.defaultClosed, true);
  assert.strictEqual(state.securityApproved, false);
  assert.strictEqual(state.mode, "fail_closed");
}

async function run() {
  testProductionWriteAlwaysBlocked();
  testRolloutPolicyFailsClosed();
  await testDisabledWrappersPerformNoLookup();
  await testDirectPickupRemainsFailClosed();
  await testForeignAllocationCannotEnterStackingLedger();
  await testOwnedSessionAlwaysClosesOnFailure();
  testPlannedPickupInstallerIsInert();
  console.log("subscription stacking security matrix tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
