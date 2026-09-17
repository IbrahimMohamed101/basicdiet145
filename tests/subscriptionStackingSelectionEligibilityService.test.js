"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  isPersistedStackingSelectionEnabled,
} = require("../src/services/subscription/subscriptionStackingSelectionEligibilityService");

async function testEligibilityIsFailClosedBeforeDatabaseProbe() {
  let probes = 0;
  const runtime = {
    writeEnabledForUser: () => false,
    extraEnabledForUser: () => true,
    hasPersistedStackingBatch: async () => { probes += 1; return true; },
  };
  assert.strictEqual(await isPersistedStackingSelectionEnabled({
    userId: "user-1",
    subscriptionId: "sub-1",
    runtime,
  }), false);
  assert.strictEqual(probes, 0);
}

async function testExtraEligibilityRequiresFlagAndAppliedPurchaseBatch() {
  let probes = 0;
  const disabledExtraRuntime = {
    writeEnabledForUser: () => true,
    extraEnabledForUser: () => false,
    hasPersistedStackingBatch: async () => { probes += 1; return true; },
  };
  assert.strictEqual(await isPersistedStackingSelectionEnabled({
    userId: "user-1",
    subscriptionId: "sub-1",
    requireExtraSelection: true,
    runtime: disabledExtraRuntime,
  }), false);
  assert.strictEqual(probes, 0);

  const enabledRuntime = {
    ...disabledExtraRuntime,
    extraEnabledForUser: () => true,
    hasPersistedStackingBatch: async () => { probes += 1; return true; },
  };
  assert.strictEqual(await isPersistedStackingSelectionEnabled({
    userId: "user-1",
    subscriptionId: "sub-1",
    requireExtraSelection: true,
    runtime: enabledRuntime,
  }), true);
  assert.strictEqual(probes, 1);
}

async function run() {
  await testEligibilityIsFailClosedBeforeDatabaseProbe();
  await testExtraEligibilityRequiresFlagAndAppliedPurchaseBatch();
  console.log("subscription stacking selection eligibility tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
