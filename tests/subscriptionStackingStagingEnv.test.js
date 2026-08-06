"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  parseCsv,
  safeMongoIdentity,
  validateSubscriptionStackingStagingEnv,
} = require("../scripts/validate-subscription-stacking-staging-env");

function safeEnv(overrides = {}) {
  return {
    NODE_ENV: "staging",
    STAGING_BASE_URL: "https://basicdiet-staging.example.com",
    STAGING_PAYMENT_MODE: "sandbox",
    MONGODB_URI: "mongodb://user:secret@staging.mongo.local:27017/basicdiet_staging",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_READ_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_WRITE_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE: "false",
    ...overrides,
  };
}

function violationCodes(fn) {
  try {
    fn();
    return [];
  } catch (err) {
    assert.strictEqual(err.code, "SUBSCRIPTION_STACKING_STAGING_ENV_UNSAFE");
    return err.violations.map((row) => row.code);
  }
}

function testSafeSingleUserSandboxConfigurationPasses() {
  const result = validateSubscriptionStackingStagingEnv(safeEnv());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.nodeEnv, "staging");
  assert.strictEqual(result.paymentMode, "sandbox");
  assert.strictEqual(result.rolloutUserCount, 1);
  assert.strictEqual(result.rolloutUserId, "user-1");
  assert.strictEqual(result.database.databaseName, "basicdiet_staging");
  assert.strictEqual(result.database.host, "staging.mongo.local:27017");
  assert.strictEqual(JSON.stringify(result).includes("secret"), false);
}

function testProductionHostsAreRejected() {
  const backend = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    STAGING_BASE_URL: "https://basicdiet145-production-51e9.up.railway.app",
  })));
  assert(backend.includes("PRODUCTION_HOST_FORBIDDEN"));

  const dashboard = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    STAGING_BASE_URL: "https://clientdashbourd-production.up.railway.app",
  })));
  assert(dashboard.includes("PRODUCTION_HOST_FORBIDDEN"));
}

function testProductionNodeEnvAndPaymentModeAreRejected() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    NODE_ENV: "production",
    STAGING_PAYMENT_MODE: "live",
  })));
  assert(codes.includes("PRODUCTION_NODE_ENV_FORBIDDEN"));
  assert(codes.includes("UNSAFE_PAYMENT_MODE"));
}

function testProductionLikeDatabaseNameIsRejected() {
  for (const databaseName of ["production", "prod", "basicdiet", "basicdiet145"]) {
    const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
      MONGODB_URI: `mongodb://host:27017/${databaseName}`,
    })));
    assert(codes.includes("PRODUCTION_LIKE_DATABASE_NAME_FORBIDDEN"));
  }
}

function testWriteRequiresShadowReadAndExactlyOneUser() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "false",
    SUBSCRIPTION_STACKING_READ_ENABLED: "false",
    SUBSCRIPTION_STACKING_WRITE_USER_IDS: "user-1,user-2",
  })));
  assert(codes.includes("WRITE_REQUIRES_READ"));
  assert(codes.includes("WRITE_REQUIRES_SHADOW"));
  assert(codes.includes("INITIAL_WRITE_REQUIRES_EXACTLY_ONE_USER"));
}

function testWildcardAndMissingAllowlistRelationshipsAreRejected() {
  const wildcardCodes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "*",
    SUBSCRIPTION_STACKING_READ_USER_IDS: "*",
    SUBSCRIPTION_STACKING_WRITE_USER_IDS: "*",
    SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE: "true",
  })));
  assert(wildcardCodes.includes("WILDCARD_ROLLOUT_FORBIDDEN"));
  assert(wildcardCodes.includes("WILDCARD_WRITE_OVERRIDE_FORBIDDEN"));

  const relationCodes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "other-user",
    SUBSCRIPTION_STACKING_READ_USER_IDS: "other-user",
  })));
  assert(relationCodes.includes("WRITE_USER_MISSING_FROM_READ_ALLOWLIST"));
  assert(relationCodes.includes("WRITE_USER_MISSING_FROM_SHADOW_ALLOWLIST"));
}

function testReadOnlyModeAllowsEmptyWriteAllowlist() {
  const result = validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    SUBSCRIPTION_STACKING_WRITE_USER_IDS: "",
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.writeEnabled, false);
  assert.strictEqual(result.rolloutUserCount, 0);
}

function testHelpersNeverExposeCredentials() {
  assert.deepStrictEqual(parseCsv(" a, b, a ,, "), ["a", "b"]);
  const identity = safeMongoIdentity(
    "mongodb+srv://private-user:private-password@cluster.example.net/basicdiet_staging?retryWrites=true"
  );
  assert.deepStrictEqual(identity, {
    host: "cluster.example.net",
    databaseName: "basicdiet_staging",
    fingerprint: "cluster.example.net/basicdiet_staging",
  });
  assert.strictEqual(JSON.stringify(identity).includes("private-password"), false);
  assert.strictEqual(JSON.stringify(identity).includes("private-user"), false);
}

function run() {
  testSafeSingleUserSandboxConfigurationPasses();
  testProductionHostsAreRejected();
  testProductionNodeEnvAndPaymentModeAreRejected();
  testProductionLikeDatabaseNameIsRejected();
  testWriteRequiresShadowReadAndExactlyOneUser();
  testWildcardAndMissingAllowlistRelationshipsAreRejected();
  testReadOnlyModeAllowsEmptyWriteAllowlist();
  testHelpersNeverExposeCredentials();
  console.log("subscription stacking staging environment tests passed");
}

run();
