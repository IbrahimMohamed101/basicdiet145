"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  createStackingSelectionWrappers,
} = require("../src/services/subscription/subscriptionStackingSelectionRouterService");

function originals(calls) {
  return {
    performDaySelectionUpdate: async (args) => {
      calls.push(["legacy:update", args]);
      return { source: "legacy:update" };
    },
    performDaySelectionValidation: async (args) => {
      calls.push(["legacy:validation", args]);
      return { source: "legacy:validation" };
    },
    performBulkDaySelectionPlanningBalanceValidation: async (args) => {
      calls.push(["legacy:bulk", args]);
      return { source: "legacy:bulk" };
    },
    performDayPlanningConfirmation: async (args) => {
      calls.push(["legacy:confirmation", args]);
      return { source: "legacy:confirmation" };
    },
  };
}

async function testDisabledDelegatesAllOriginalPaths() {
  const calls = [];
  let batchLookups = 0;
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: () => false,
    hasPersistedStackingBatch: async () => {
      batchLookups += 1;
      throw new Error("must not query while write rollout is disabled");
    },
    stackingUpdate: async () => { throw new Error("must not run"); },
    stackingValidation: async () => { throw new Error("must not run"); },
    stackingConfirmation: async () => { throw new Error("must not run"); },
  });
  const args = { userId: "user-1", subscriptionId: "sub-1" };

  assert.strictEqual((await wrappers.performDaySelectionUpdate(args)).source, "legacy:update");
  assert.strictEqual((await wrappers.performDaySelectionValidation(args)).source, "legacy:validation");
  assert.strictEqual(
    (await wrappers.performBulkDaySelectionPlanningBalanceValidation(args)).source,
    "legacy:bulk"
  );
  assert.strictEqual(
    (await wrappers.performDayPlanningConfirmation(args)).source,
    "legacy:confirmation"
  );
  assert.deepStrictEqual(
    calls.map((entry) => entry[0]),
    ["legacy:update", "legacy:validation", "legacy:bulk", "legacy:confirmation"]
  );
  assert.strictEqual(batchLookups, 0);
}

async function testAllowlistedPersistedSubscriptionRoutesSupportedPaths() {
  const calls = [];
  let batchLookups = 0;
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: (userId) => userId === "allowed",
    hasPersistedStackingBatch: async (subscriptionId) => {
      batchLookups += 1;
      return subscriptionId === "stack-sub";
    },
    stackingUpdate: async (args) => ({ source: "stack:update", args }),
    stackingValidation: async (args) => ({ source: "stack:validation", args }),
    stackingConfirmation: async (args) => ({ source: "stack:confirmation", args }),
  });
  const args = { userId: "allowed", subscriptionId: "stack-sub" };

  assert.strictEqual((await wrappers.performDaySelectionUpdate(args)).source, "stack:update");
  assert.strictEqual((await wrappers.performDaySelectionValidation(args)).source, "stack:validation");
  assert.strictEqual(
    (await wrappers.performDayPlanningConfirmation(args)).source,
    "stack:confirmation"
  );
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(batchLookups, 3);
}

async function testAllowlistedLegacySubscriptionStillUsesLegacy() {
  const calls = [];
  let batchLookups = 0;
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: () => true,
    hasPersistedStackingBatch: async () => {
      batchLookups += 1;
      return false;
    },
    stackingUpdate: async () => { throw new Error("legacy subscription must not stack"); },
    stackingValidation: async () => { throw new Error("legacy subscription must not stack"); },
    stackingConfirmation: async () => { throw new Error("legacy subscription must not stack"); },
  });
  const args = { userId: "allowed", subscriptionId: "legacy-sub" };

  assert.strictEqual((await wrappers.performDaySelectionUpdate(args)).source, "legacy:update");
  assert.strictEqual((await wrappers.performDaySelectionValidation(args)).source, "legacy:validation");
  assert.strictEqual(
    (await wrappers.performBulkDaySelectionPlanningBalanceValidation(args)).source,
    "legacy:bulk"
  );
  assert.strictEqual(
    (await wrappers.performDayPlanningConfirmation(args)).source,
    "legacy:confirmation"
  );
  assert.strictEqual(batchLookups, 4);
}

async function testAllowlistedPersistedBulkFailsClosed() {
  const wrappers = createStackingSelectionWrappers(originals([]), {
    writeEnabledForUser: () => true,
    hasPersistedStackingBatch: async () => true,
  });
  await assert.rejects(
    () => wrappers.performBulkDaySelectionPlanningBalanceValidation({
      userId: "allowed",
      subscriptionId: "stack-sub",
    }),
    (err) => Boolean(err && err.code === "STACKING_BULK_PLANNING_NOT_READY" && err.status === 503)
  );
}

async function testNonAllowlistedUserStillUsesLegacy() {
  const calls = [];
  let batchLookups = 0;
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: (userId) => userId === "allowed",
    hasPersistedStackingBatch: async () => {
      batchLookups += 1;
      return true;
    },
  });
  const result = await wrappers.performDaySelectionUpdate({
    userId: "other",
    subscriptionId: "stack-sub",
  });
  assert.strictEqual(result.source, "legacy:update");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(batchLookups, 0);
}

async function run() {
  await testDisabledDelegatesAllOriginalPaths();
  await testAllowlistedPersistedSubscriptionRoutesSupportedPaths();
  await testAllowlistedLegacySubscriptionStillUsesLegacy();
  await testAllowlistedPersistedBulkFailsClosed();
  await testNonAllowlistedUserStillUsesLegacy();
  console.log("subscription stacking selection router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
