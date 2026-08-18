"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  buildMongoDeploymentIdentityHash,
} = require("../src/utils/mongoDeploymentIdentity");
const {
  buildSubscriptionStackingRemoteReadiness,
  resolveDeploymentCommit,
  resolveDeploymentSafetyAttestation,
} = require("../src/services/subscription/subscriptionStackingRemoteReadinessService");

const USER_ID = "507f1f77bcf86cd799439011";
const MONGO_URI = "mongodb://staging-db.example.com:27017/basicdiet_staging";
const MONGO_IDENTITY_HASH = buildMongoDeploymentIdentityHash(MONGO_URI);

function buildEnv(overrides = {}) {
  return {
    NODE_ENV: "staging",
    APP_ENV: "staging",
    MONGODB_URI: MONGO_URI,
    STAGING_PAYMENT_MODE: "sandbox",
    STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "true",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    RAILWAY_GIT_COMMIT_SHA: "abc123def456",
    ...overrides,
  };
}

function run() {
  const safe = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv(),
    globalObject: {},
  });
  assert.strictEqual(safe.contractVersion, "subscription_stacking_remote_readiness.v1");
  assert.strictEqual(safe.environment.production, false);
  assert.strictEqual(safe.deployment.commitSha, "abc123def456");
  assert.strictEqual(safe.deployment.safetyAttestation.databaseIsolationConfirmed, true);
  assert.strictEqual(safe.deployment.safetyAttestation.databaseIdentityAvailable, true);
  assert.strictEqual(safe.deployment.safetyAttestation.databaseIdentityHash, MONGO_IDENTITY_HASH);
  assert.strictEqual(safe.deployment.safetyAttestation.paymentSandboxConfirmed, true);
  assert.strictEqual(safe.deployment.safetyAttestation.safePaymentMode, true);
  assert.strictEqual(safe.rollout.singleUserCanary, true);
  assert.strictEqual(safe.certification.readProbeReady, true);
  assert.strictEqual(safe.certification.baseMealCanaryReady, true);
  assert.deepStrictEqual(safe.clientContract, {
    version: "subscription_stacking_flutter.v1",
    exactMealSlotProteinGrams: true,
    entitlementGroups: true,
    entitlementPackages: true,
  });
  assert.deepStrictEqual(safe.certification.blockedReasons, []);

  const production = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({ NODE_ENV: "production", APP_ENV: "production" }),
    globalObject: {},
  });
  assert.strictEqual(production.certification.baseMealCanaryReady, false);
  assert(production.certification.blockedReasons.includes("production_environment"));

  const missingDatabaseAttestation = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({ STAGING_DATABASE_ISOLATION_CONFIRMED: "false" }),
    globalObject: {},
  });
  assert.strictEqual(missingDatabaseAttestation.certification.readProbeReady, false);
  assert.strictEqual(missingDatabaseAttestation.certification.baseMealCanaryReady, false);
  assert(missingDatabaseAttestation.certification.blockedReasons.includes("database_isolation_not_attested"));

  const missingDatabaseIdentity = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({ MONGODB_URI: "" }),
    globalObject: {},
  });
  assert.strictEqual(missingDatabaseIdentity.certification.readProbeReady, false);
  assert(missingDatabaseIdentity.certification.blockedReasons.includes("database_identity_unavailable"));

  const unsafePayment = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({ STAGING_PAYMENT_MODE: "live" }),
    globalObject: {},
  });
  assert.strictEqual(unsafePayment.certification.readProbeReady, true);
  assert.strictEqual(unsafePayment.certification.baseMealCanaryReady, false);
  assert(unsafePayment.certification.blockedReasons.includes("unsafe_or_missing_payment_mode"));

  const missingCommit = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({ RAILWAY_GIT_COMMIT_SHA: "" }),
    globalObject: {},
  });
  assert.strictEqual(missingCommit.certification.readProbeReady, false);
  assert(missingCommit.certification.blockedReasons.includes("deployment_commit_not_exposed"));

  const wildcard = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({
      SUBSCRIPTION_STACKING_SHADOW_USER_IDS: "*",
      SUBSCRIPTION_STACKING_USER_IDS: "*",
      SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "true",
    }),
    globalObject: {},
  });
  assert.strictEqual(wildcard.rollout.singleUserCanary, false);
  assert.strictEqual(wildcard.certification.baseMealCanaryReady, false);

  const differentUser = buildSubscriptionStackingRemoteReadiness({
    userId: "507f1f77bcf86cd799439012",
    env: buildEnv(),
    globalObject: {},
  });
  assert.strictEqual(differentUser.rollout.writeEnabledForUser, false);
  assert.strictEqual(differentUser.certification.baseMealCanaryReady, false);

  assert.throws(
    () => buildSubscriptionStackingRemoteReadiness({ userId: "", env: buildEnv() }),
    (err) => err && err.code === "AUTH_REQUIRED" && err.status === 401
  );
  assert.strictEqual(resolveDeploymentCommit({ SOURCE_VERSION: "source-sha" }), "source-sha");
  assert.strictEqual(resolveDeploymentCommit({}), null);
  assert.deepStrictEqual(
    resolveDeploymentSafetyAttestation({
      MONGODB_URI: MONGO_URI,
      STAGING_PAYMENT_MODE: "mock",
      STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
      STAGING_PAYMENT_SANDBOX_CONFIRMED: "true",
    }),
    {
      databaseIsolationConfirmed: true,
      databaseIdentityAvailable: true,
      databaseIdentityHash: MONGO_IDENTITY_HASH,
      paymentSandboxConfirmed: true,
      paymentMode: "mock",
      safePaymentMode: true,
      readSafe: true,
      writeSafe: true,
    }
  );

  console.log("subscription stacking remote readiness tests passed");
}

run();
