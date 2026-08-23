"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  assertSubscriptionStackingProductionSafety,
  isProductionStackingRolloutConfirmed,
} = require(
  "../src/services/subscription/subscriptionStackingProductionSafetyService"
);
const {
  assertExtraActivationCanaryConfiguration,
  assertExtraSelectionCanaryConfiguration,
  assertSubscriptionStackingRolloutConfiguration,
  isExtraActivationCanaryEnabledForUser,
  isExtraSelectionCanaryEnabledForUser,
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
} = require(
  "../src/services/subscription/subscriptionStackingRolloutPolicyService"
);

function productionGlobalEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "production",
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

function testDefaultProductionRemainsFailClosed() {
  const env = productionGlobalEnv({
    SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED: "false",
  });
  assert.throws(
    () => assertSubscriptionStackingProductionSafety(env),
    (err) => err && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED"
  );
  assert.strictEqual(isProductionStackingRolloutConfirmed(env), false);
  assert.strictEqual(isExtraActivationCanaryEnabledForUser("user-a", env), false);
  assert.strictEqual(isExtraSelectionCanaryEnabledForUser("user-a", env), false);
}

function testConfirmedProductionGlobalRolloutEnablesAllUsers() {
  const env = productionGlobalEnv();
  const safety = assertSubscriptionStackingProductionSafety(env);
  const base = assertSubscriptionStackingRolloutConfiguration(env);
  const activation = assertExtraActivationCanaryConfiguration(env);
  const selection = assertExtraSelectionCanaryConfiguration(env);

  assert.strictEqual(safety.productionRolloutEnabled, true);
  assert.strictEqual(base.allowAllUsers, true);
  assert.strictEqual(activation.mode, "production_global");
  assert.strictEqual(activation.databaseIsolationRequired, false);
  assert.strictEqual(activation.paymentSandboxRequired, false);
  assert.strictEqual(selection.mode, "production_global");
  for (const userId of ["user-a", "user-b"]) {
    assert.strictEqual(isReadStackingEnabledForUser(userId, env), true);
    assert.strictEqual(isWriteStackingEnabledForUser(userId, env), true);
    assert.strictEqual(isExtraActivationCanaryEnabledForUser(userId, env), true);
    assert.strictEqual(isExtraSelectionCanaryEnabledForUser(userId, env), true);
  }
}

function testPartialConfirmedProductionConfigurationFailsClosed() {
  const env = productionGlobalEnv({
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "false",
  });
  assert.throws(
    () => assertSubscriptionStackingProductionSafety(env),
    (err) => Boolean(
      err
      && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_GLOBAL_FLAGS_REQUIRED"
      && err.details.missingEnabledFlags.includes(
        "SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED"
      )
    )
  );
}

function run() {
  testDefaultProductionRemainsFailClosed();
  testConfirmedProductionGlobalRolloutEnablesAllUsers();
  testPartialConfirmedProductionConfigurationFailsClosed();
  console.log("subscription stacking production rollout enablement tests passed");
}

run();
