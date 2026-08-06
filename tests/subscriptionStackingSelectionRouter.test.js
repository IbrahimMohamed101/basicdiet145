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
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: () => false,
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
}

async function testAllowlistedUserRoutesSupportedPaths() {
  const calls = [];
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: (userId) => userId === "allowed",
    stackingUpdate: async (args) => ({ source: "stack:update", args }),
    stackingValidation: async (args) => ({ source: "stack:validation", args }),
    stackingConfirmation: async (args) => ({ source: "stack:confirmation", args }),
  });
  const args = { userId: "allowed", subscriptionId: "sub-1" };

  assert.strictEqual((await wrappers.performDaySelectionUpdate(args)).source, "stack:update");
  assert.strictEqual((await wrappers.performDaySelectionValidation(args)).source, "stack:validation");
  assert.strictEqual(
    (await wrappers.performDayPlanningConfirmation(args)).source,
    "stack:confirmation"
  );
  assert.strictEqual(calls.length, 0);
}

async function testAllowlistedBulkFailsClosed() {
  const wrappers = createStackingSelectionWrappers(originals([]), {
    writeEnabledForUser: () => true,
  });
  await assert.rejects(
    () => wrappers.performBulkDaySelectionPlanningBalanceValidation({ userId: "allowed" }),
    (err) => Boolean(err && err.code === "STACKING_BULK_PLANNING_NOT_READY" && err.status === 503)
  );
}

async function testNonAllowlistedUserStillUsesLegacy() {
  const calls = [];
  const wrappers = createStackingSelectionWrappers(originals(calls), {
    writeEnabledForUser: (userId) => userId === "allowed",
  });
  const result = await wrappers.performDaySelectionUpdate({ userId: "other" });
  assert.strictEqual(result.source, "legacy:update");
  assert.strictEqual(calls.length, 1);
}

async function run() {
  await testDisabledDelegatesAllOriginalPaths();
  await testAllowlistedUserRoutesSupportedPaths();
  await testAllowlistedBulkFailsClosed();
  await testNonAllowlistedUserStillUsesLegacy();
  console.log("subscription stacking selection router tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
