"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  createStackingSkipWrappers,
  resolveStackingSkipRoute,
} = require("../src/services/subscription/subscriptionStackingSkipRouterService");

function originals(calls) {
  return {
    performSkipDay: async (args) => {
      calls.push(["legacy:skip", args]);
      return { source: "legacy:skip" };
    },
    performUnskipDay: async (args) => {
      calls.push(["legacy:unskip", args]);
      return { source: "legacy:unskip" };
    },
  };
}

async function testGlobalDisableDelegatesWithoutBatchLookup() {
  const calls = [];
  let lookups = 0;
  const wrappers = createStackingSkipWrappers(originals(calls), {
    globallyEnabled: () => false,
    writeEnabledForUser: () => true,
    findBatchOwner: async () => {
      lookups += 1;
      throw new Error("must not query while disabled");
    },
  });

  assert.strictEqual(
    (await wrappers.performSkipDay({ subscriptionId: "sub-1", userId: "user-1" })).source,
    "legacy:skip"
  );
  assert.strictEqual(
    (await wrappers.performUnskipDay({ subscriptionId: "sub-1", userId: "user-1" })).source,
    "legacy:unskip"
  );
  assert.strictEqual(lookups, 0);
  assert.strictEqual(calls.length, 2);
}

async function testNonAllowlistedUserDelegatesWithoutBatchLookup() {
  let lookups = 0;
  const calls = [];
  const wrappers = createStackingSkipWrappers(originals(calls), {
    globallyEnabled: () => true,
    writeEnabledForUser: () => false,
    findBatchOwner: async () => {
      lookups += 1;
      return null;
    },
  });
  const result = await wrappers.performSkipDay({
    subscriptionId: "sub-1",
    userId: "other",
  });
  assert.strictEqual(result.source, "legacy:skip");
  assert.strictEqual(lookups, 0);
}

async function testAllowlistedNonStackedSubscriptionDelegatesToGuardedOriginal() {
  const calls = [];
  const wrappers = createStackingSkipWrappers(originals(calls), {
    globallyEnabled: () => true,
    writeEnabledForUser: () => true,
    findBatchOwner: async () => null,
  });
  const result = await wrappers.performSkipDay({
    subscriptionId: "standard-sub",
    userId: "allowed",
  });
  assert.strictEqual(result.source, "legacy:skip");
  assert.strictEqual(calls.length, 1);
}

async function testAllowlistedStackedSubscriptionUsesAtomicService() {
  const calls = [];
  const stackCalls = [];
  const runtime = {
    globallyEnabled: () => true,
    writeEnabledForUser: (userId) => userId === "allowed",
    findBatchOwner: async (subscriptionId) => ({
      userId: "allowed",
      containerSubscriptionId: subscriptionId,
    }),
    stackingSkip: async (args) => {
      stackCalls.push(["skip", args]);
      return { source: "stack:skip" };
    },
    stackingUnskip: async (args) => {
      stackCalls.push(["unskip", args]);
      return { source: "stack:unskip" };
    },
  };
  const wrappers = createStackingSkipWrappers(originals(calls), runtime);
  const args = { subscriptionId: "stack-sub", userId: "allowed", date: "2026-08-10" };

  assert.strictEqual((await wrappers.performSkipDay(args)).source, "stack:skip");
  assert.strictEqual((await wrappers.performUnskipDay(args)).source, "stack:unskip");
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(stackCalls.map((entry) => entry[0]), ["skip", "unskip"]);
}

async function testOwnerMismatchNeverUsesStackingService() {
  const calls = [];
  let stackCalled = false;
  const wrappers = createStackingSkipWrappers(originals(calls), {
    globallyEnabled: () => true,
    writeEnabledForUser: () => true,
    findBatchOwner: async () => ({
      userId: "different-owner",
      containerSubscriptionId: "stack-sub",
    }),
    stackingSkip: async () => {
      stackCalled = true;
      return {};
    },
  });
  const result = await wrappers.performSkipDay({
    subscriptionId: "stack-sub",
    userId: "allowed",
  });
  assert.strictEqual(result.source, "legacy:skip");
  assert.strictEqual(stackCalled, false);
}

async function testRouteDecisionIsExplicit() {
  const route = await resolveStackingSkipRoute({
    subscriptionId: "stack-sub",
    userId: "allowed",
    runtime: {
      globallyEnabled: () => true,
      writeEnabledForUser: (userId) => userId === "allowed",
      findBatchOwner: async () => ({
        userId: "allowed",
        containerSubscriptionId: "stack-sub",
      }),
    },
  });
  assert.strictEqual(route.enabled, true);
  assert.strictEqual(route.reason, "stacked_skip_ready");
  assert.strictEqual(route.containerSubscriptionId, "stack-sub");
}

async function run() {
  await testGlobalDisableDelegatesWithoutBatchLookup();
  await testNonAllowlistedUserDelegatesWithoutBatchLookup();
  await testAllowlistedNonStackedSubscriptionDelegatesToGuardedOriginal();
  await testAllowlistedStackedSubscriptionUsesAtomicService();
  await testOwnerMismatchNeverUsesStackingService();
  await testRouteDecisionIsExplicit();
  console.log("subscription stacking skip router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
