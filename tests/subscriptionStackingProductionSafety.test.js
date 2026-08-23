"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  assertSubscriptionStackingProductionSafety,
  resolveProductionEnvironment,
} = require("../src/services/subscription/subscriptionStackingProductionSafetyService");

function assertBlocked(env, expectedCode, expectedMode) {
  assert.throws(
    () => assertSubscriptionStackingProductionSafety(env),
    (err) => Boolean(
      err
      && err.code === expectedCode
      && Array.isArray(err.details && err.details.enabledModes)
      && err.details.enabledModes.includes(expectedMode)
      && err.details.requiredValues
      && err.details.requiredValues.SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED === "true"
    )
  );
}

function productionGlobalEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED: "true",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "true",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "true",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
    ...overrides,
  };
}

function testProductionWriteRequiresExplicitConfirmation() {
  assertBlocked(
    { NODE_ENV: "production", SUBSCRIPTION_STACKING_WRITE_ENABLED: "true" },
    "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED",
    "write"
  );
}

function testProductionConfirmationRequiresCompleteGlobalFlags() {
  assert.throws(
    () => assertSubscriptionStackingProductionSafety(productionGlobalEnv({
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "false",
    })),
    (err) => Boolean(
      err
      && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_GLOBAL_FLAGS_REQUIRED"
      && err.details.missingEnabledFlags.includes(
        "SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED"
      )
    )
  );
}

function testProductionReadAndShadowRequireConfirmation() {
  assertBlocked(
    { NODE_ENV: "prod", SUBSCRIPTION_STACKING_READ_ENABLED: "true" },
    "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED",
    "read"
  );
  assertBlocked(
    { NODE_ENV: "live", SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true" },
    "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED",
    "shadow"
  );
}

function testRailwayProductionNameCannotBypassKillSwitch() {
  assertBlocked(
    {
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "Production",
      SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    },
    "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED",
    "read"
  );
  const resolved = resolveProductionEnvironment({
    NODE_ENV: "development",
    RAILWAY_ENVIRONMENT_NAME: "production",
  });
  assert.strictEqual(resolved.production, true);
  assert.strictEqual(resolved.source, "RAILWAY_ENVIRONMENT_NAME");
}

function testConfirmedProductionGlobalRolloutIsAllowed() {
  const result = assertSubscriptionStackingProductionSafety(productionGlobalEnv());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.productionEnvironment, true);
  assert.strictEqual(result.productionRolloutConfirmed, true);
  assert.strictEqual(result.productionRolloutEnabled, true);
  assert.strictEqual(result.productionRolloutBlocked, false);
}

function testProductionAllModesDisabledIsAllowed() {
  const result = assertSubscriptionStackingProductionSafety({
    NODE_ENV: "production",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "false",
    SUBSCRIPTION_STACKING_READ_ENABLED: "false",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.productionEnvironment, true);
  assert.strictEqual(result.writeEnabled, false);
}

function testStagingAllowlistedModesCanBeExercised() {
  const result = assertSubscriptionStackingProductionSafety({
    NODE_ENV: "staging",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.nodeEnv, "staging");
  assert.strictEqual(result.writeEnabled, true);
}

function run() {
  testProductionWriteRequiresExplicitConfirmation();
  testProductionConfirmationRequiresCompleteGlobalFlags();
  testProductionReadAndShadowRequireConfirmation();
  testRailwayProductionNameCannotBypassKillSwitch();
  testProductionAllModesDisabledIsAllowed();
  testConfirmedProductionGlobalRolloutIsAllowed();
  testStagingAllowlistedModesCanBeExercised();
  console.log("subscription stacking production safety tests passed");
}

run();
