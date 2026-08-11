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
    STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "true",
    MONGODB_URI: "mongodb://user:secret@staging.mongo.local:27017/basicdiet_staging",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
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
  assert.strictEqual(result.databaseIsolationConfirmed, true);
  assert.strictEqual(result.paymentSandboxConfirmed, true);
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

  const unknownProdHost = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    STAGING_BASE_URL: "https://api-production.example.com",
  })));
  assert(unknownProdHost.includes("PRODUCTION_HOST_FORBIDDEN"));
}

function testProductionEnvironmentAndPaymentModeAreRejected() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    NODE_ENV: "development",
    RAILWAY_ENVIRONMENT_NAME: "production",
    STAGING_PAYMENT_MODE: "live",
  })));
  assert(codes.includes("PRODUCTION_ENVIRONMENT_FORBIDDEN"));
  assert(codes.includes("UNSAFE_PAYMENT_MODE"));
}

function testExplicitIsolationConfirmationsAreRequired() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    STAGING_DATABASE_ISOLATION_CONFIRMED: "false",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "false",
  })));
  assert(codes.includes("DATABASE_ISOLATION_CONFIRMATION_REQUIRED"));
  assert(codes.includes("PAYMENT_SANDBOX_CONFIRMATION_REQUIRED"));
}

function testProductionLikeDatabaseNameIsRejected() {
  for (const databaseName of ["production", "prod", "basicdiet", "basicdiet145"]) {
    const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
      MONGODB_URI: `mongodb://host:27017/${databaseName}`,
    })));
    assert(codes.includes("PRODUCTION_LIKE_DATABASE_NAME_FORBIDDEN"));
  }
}

function testMissingDatabaseNameIsRejected() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    MONGODB_URI: "mongodb://user:super-secret@staging.mongo.local:27017",
  })));
  assert(codes.includes("STAGING_DATABASE_NAME_REQUIRED"));

  const identity = safeMongoIdentity(
    "mongodb://user:super-secret@staging.mongo.local:27017"
  );
  assert.strictEqual(identity.host, "staging.mongo.local:27017");
  assert.strictEqual(identity.databaseName, "");
  assert.strictEqual(JSON.stringify(identity).includes("super-secret"), false);
  assert.strictEqual(JSON.stringify(identity).includes("user"), false);
}

function testCredentialLikeDatabaseNameIsRejectedWithoutLeakingIt() {
  const leakedCredentialLikePath = "mongo:private-password@mongodb.railway.internal:27017";
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    MONGODB_URI: `mongodb://mongo:private-password@mongodb.railway.internal:27017/${leakedCredentialLikePath}`,
  })));
  assert(codes.includes("STAGING_DATABASE_NAME_INVALID"));

  const identity = safeMongoIdentity(
    `mongodb://mongo:private-password@mongodb.railway.internal:27017/${leakedCredentialLikePath}`
  );
  assert.deepStrictEqual(identity, {
    host: "mongodb.railway.internal:27017",
    databaseName: "",
    databaseNameValid: false,
    fingerprint: "mongodb.railway.internal:27017/<invalid>",
  });
  const serialized = JSON.stringify(identity);
  assert.strictEqual(serialized.includes("private-password"), false);
  assert.strictEqual(serialized.includes("mongo:"), false);
}

function testWriteRequiresShadowReadAndExactlyOneRuntimeUser() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "false",
    SUBSCRIPTION_STACKING_READ_ENABLED: "false",
    SUBSCRIPTION_STACKING_USER_IDS: "user-1,user-2",
  })));
  assert(codes.includes("WRITE_REQUIRES_READ"));
  assert(codes.includes("WRITE_REQUIRES_SHADOW"));
  assert(codes.includes("INITIAL_WRITE_REQUIRES_EXACTLY_ONE_USER"));
}

function testWildcardAndMissingShadowRelationshipAreRejected() {
  const wildcardCodes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "*",
    SUBSCRIPTION_STACKING_USER_IDS: "*",
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "true",
  })));
  assert(wildcardCodes.includes("WILDCARD_ROLLOUT_FORBIDDEN"));
  assert(wildcardCodes.includes("ALLOW_ALL_USERS_FORBIDDEN"));

  const relationCodes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "other-user",
  })));
  assert(relationCodes.includes("ROLLOUT_USER_MISSING_FROM_SHADOW_ALLOWLIST"));
}

function testUnusedLegacyVariablesAreRejected() {
  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_READ_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_WRITE_USER_IDS: "user-1",
    SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE: "false",
  })));
  assert(codes.includes("UNUSED_ROLLOUT_VARIABLES_CONFIGURED"));
}

function testReadOnlyModeStillRequiresRuntimeAllowlist() {
  const result = validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "false",
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.writeEnabled, false);
  assert.strictEqual(result.rolloutUserCount, 1);

  const codes = violationCodes(() => validateSubscriptionStackingStagingEnv(safeEnv({
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "false",
    SUBSCRIPTION_STACKING_USER_IDS: "",
  })));
  assert(codes.includes("ROLLOUT_ALLOWLIST_REQUIRED"));
}

function testHelpersNeverExposeCredentials() {
  assert.deepStrictEqual(parseCsv(" a, b, a ,, "), ["a", "b"]);
  const identity = safeMongoIdentity(
    "mongodb+srv://private-user:private-password@cluster.example.net/basicdiet_staging?retryWrites=true"
  );
  assert.deepStrictEqual(identity, {
    host: "cluster.example.net",
    databaseName: "basicdiet_staging",
    databaseNameValid: true,
    fingerprint: "cluster.example.net/basicdiet_staging",
  });
  assert.strictEqual(JSON.stringify(identity).includes("private-password"), false);
  assert.strictEqual(JSON.stringify(identity).includes("private-user"), false);
}

function run() {
  testSafeSingleUserSandboxConfigurationPasses();
  testProductionHostsAreRejected();
  testProductionEnvironmentAndPaymentModeAreRejected();
  testExplicitIsolationConfirmationsAreRequired();
  testProductionLikeDatabaseNameIsRejected();
  testMissingDatabaseNameIsRejected();
  testCredentialLikeDatabaseNameIsRejectedWithoutLeakingIt();
  testWriteRequiresShadowReadAndExactlyOneRuntimeUser();
  testWildcardAndMissingShadowRelationshipAreRejected();
  testUnusedLegacyVariablesAreRejected();
  testReadOnlyModeStillRequiresRuntimeAllowlist();
  testHelpersNeverExposeCredentials();
  console.log("subscription stacking staging environment tests passed");
}

run();
