"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  assertSubscriptionStackingProductionSafety,
} = require("../src/services/subscription/subscriptionStackingProductionSafetyService");

function testProductionWriteIsHardBlocked() {
  assert.throws(
    () => assertSubscriptionStackingProductionSafety({
      NODE_ENV: "production",
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    }),
    (err) => Boolean(
      err
      && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_WRITE_BLOCKED"
      && err.details.requiredValue === "SUBSCRIPTION_STACKING_WRITE_ENABLED=false"
    )
  );
}

function testProductionReadOnlyIsAllowed() {
  const result = assertSubscriptionStackingProductionSafety({
    NODE_ENV: "production",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.writeEnabled, false);
}

function testStagingAllowlistedWriteCanBeExercised() {
  const result = assertSubscriptionStackingProductionSafety({
    NODE_ENV: "staging",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.nodeEnv, "staging");
  assert.strictEqual(result.writeEnabled, true);
}

function run() {
  testProductionWriteIsHardBlocked();
  testProductionReadOnlyIsAllowed();
  testStagingAllowlistedWriteCanBeExercised();
  console.log("subscription stacking production safety tests passed");
}

run();
