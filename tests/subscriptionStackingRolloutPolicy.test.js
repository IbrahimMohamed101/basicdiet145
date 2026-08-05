"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

const {
  assertSubscriptionStackingRolloutConfiguration,
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
  parseIdAllowlist,
  resolveSubscriptionStackingRolloutState,
} = require("../src/services/subscription/subscriptionStackingRolloutPolicyService");

function assertPolicyError(env, expectedCode) {
  assert.throws(
    () => assertSubscriptionStackingRolloutConfiguration(env),
    (err) => Boolean(err && err.code === expectedCode),
    `expected rollout policy error ${expectedCode}`
  );
}

function testAllFlagsClosedIsValid() {
  const result = assertSubscriptionStackingRolloutConfiguration({});
  assert.deepStrictEqual(result, {
    ok: true,
    shadowEnabled: false,
    readEnabled: false,
    writeEnabled: false,
    shadowUserCount: 0,
    rolloutUserCount: 0,
    allowAllUsers: false,
  });
}

function testShadowRequiresAllowlist() {
  assertPolicyError(
    { SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true" },
    "SUBSCRIPTION_STACKING_SHADOW_ALLOWLIST_REQUIRED"
  );

  const result = assertSubscriptionStackingRolloutConfiguration({
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "user-a",
  });
  assert.strictEqual(result.shadowEnabled, true);
  assert.strictEqual(result.shadowUserCount, 1);
}

function testWriteCannotRunWithoutRead() {
  assertPolicyError(
    {
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
      SUBSCRIPTION_STACKING_USER_IDS: "user-a",
    },
    "SUBSCRIPTION_STACKING_WRITE_REQUIRES_READ"
  );
}

function testReadAndWriteRequireAllowlist() {
  assertPolicyError(
    { SUBSCRIPTION_STACKING_READ_ENABLED: "true" },
    "SUBSCRIPTION_STACKING_ALLOWLIST_REQUIRED"
  );
  assertPolicyError(
    {
      SUBSCRIPTION_STACKING_READ_ENABLED: "true",
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    },
    "SUBSCRIPTION_STACKING_ALLOWLIST_REQUIRED"
  );
}

function testWildcardWriteRequiresExplicitOverride() {
  assertPolicyError(
    {
      SUBSCRIPTION_STACKING_READ_ENABLED: "true",
      SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
      SUBSCRIPTION_STACKING_USER_IDS: "*",
    },
    "SUBSCRIPTION_STACKING_WRITE_WILDCARD_BLOCKED"
  );

  const result = assertSubscriptionStackingRolloutConfiguration({
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_USER_IDS: "*",
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "true",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.rolloutUserCount, "all");
  assert.strictEqual(result.allowAllUsers, true);
}

function testPerUserReadAndWriteGates() {
  const env = {
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_USER_IDS: "user-a,user-b",
  };

  assert.strictEqual(isReadStackingEnabledForUser("user-a", env), true);
  assert.strictEqual(isReadStackingEnabledForUser("user-x", env), false);
  assert.strictEqual(isWriteStackingEnabledForUser("user-b", env), true);
  assert.strictEqual(isWriteStackingEnabledForUser("user-x", env), false);
  assert.strictEqual(
    isWriteStackingEnabledForUser("user-a", {
      ...env,
      SUBSCRIPTION_STACKING_READ_ENABLED: "false",
    }),
    false
  );
}

function testStateParsing() {
  const state = resolveSubscriptionStackingRolloutState({
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: " TRUE ",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: " user-a, user-b ",
    SUBSCRIPTION_STACKING_USER_IDS: "user-a",
  });

  assert.strictEqual(state.shadowEnabled, true);
  assert.strictEqual(state.readEnabled, true);
  assert.strictEqual(state.writeEnabled, false);
  assert.deepStrictEqual([...state.shadowAllowlist], ["user-a", "user-b"]);
  assert.deepStrictEqual([...parseIdAllowlist("a, b, a")], ["a", "b"]);
}

function run() {
  testAllFlagsClosedIsValid();
  testShadowRequiresAllowlist();
  testWriteCannotRunWithoutRead();
  testReadAndWriteRequireAllowlist();
  testWildcardWriteRequiresExplicitOverride();
  testPerUserReadAndWriteGates();
  testStateParsing();

  console.log("subscription stacking rollout policy tests passed");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
