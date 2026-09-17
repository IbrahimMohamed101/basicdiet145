"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  buildMongoDeploymentIdentityHash,
} = require("../src/utils/mongoDeploymentIdentity");
const {
  assertRemoteDeploymentReadiness,
} = require("../scripts/assert-subscription-stacking-deployment-readiness");

const USER_ID = "507f1f77bcf86cd799439011";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MONGO_URI = "mongodb://localhost:27017/basicdiet_staging";
const MONGO_IDENTITY_HASH = buildMongoDeploymentIdentityHash(MONGO_URI);

function env(overrides = {}) {
  return {
    NODE_ENV: "staging",
    APP_ENV: "staging",
    STAGING_BASE_URL: "https://basicdiet-staging.example.com",
    STAGING_PAYMENT_MODE: "sandbox",
    STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "true",
    MONGODB_URI: MONGO_URI,
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    STAGING_CLIENT_TOKEN: "test-token",
    STAGING_EXPECTED_DEPLOYMENT_COMMIT_SHA: COMMIT,
    STAGING_CERTIFICATION_PHASE: "verify",
    STAGING_REQUEST_TIMEOUT_MS: "2000",
    ...overrides,
  };
}

function payload(overrides = {}) {
  const attestation = {
    databaseIsolationConfirmed: true,
    databaseIdentityAvailable: true,
    databaseIdentityHash: MONGO_IDENTITY_HASH,
    paymentSandboxConfirmed: true,
    paymentMode: "sandbox",
    safePaymentMode: true,
    readSafe: true,
    writeSafe: true,
    ...(overrides.attestation || {}),
  };
  return {
    status: true,
    data: {
      contractVersion: "subscription_stacking_remote_readiness.v1",
      environment: { production: Boolean(overrides.production), value: "staging" },
      deployment: { commitSha: overrides.commit || COMMIT, safetyAttestation: attestation },
      certification: {
        readProbeReady: overrides.readReady !== false,
        baseMealCanaryReady: overrides.writeReady !== false,
        extraEntitlementCanaryReady: overrides.extraReady !== false,
        extraEntitlementBlockedReasons: overrides.extraReady === false
          ? ["extra_activation_disabled"]
          : [],
        blockedReasons: [],
      },
    },
  };
}

function response(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "req-readiness" },
    text: async () => JSON.stringify(body),
  };
}

async function run() {
  const success = await assertRemoteDeploymentReadiness(env(), {
    fetchImpl: async () => response(payload()),
  });
  assert.strictEqual(success.ok, true);
  assert.strictEqual(success.databaseIsolationConfirmed, true);
  assert.strictEqual(success.databaseIdentityVerified, true);
  assert.strictEqual(success.paymentSandboxConfirmed, true);

  const extrasSuccess = await assertRemoteDeploymentReadiness(env({
    STAGING_CERTIFICATION_PHASE: "extras",
  }), {
    fetchImpl: async () => response(payload()),
  });
  assert.strictEqual(extrasSuccess.ok, true);
  assert.strictEqual(extrasSuccess.phase, "extras");

  await assert.rejects(
    () => assertRemoteDeploymentReadiness(env({
      STAGING_CERTIFICATION_PHASE: "extras",
    }), {
      fetchImpl: async () => response(payload({ extraReady: false })),
    }),
    (err) => err && err.code === "DEPLOYMENT_READINESS_EXTRA_CANARY_NOT_READY"
  );

  await assert.rejects(
    () => assertRemoteDeploymentReadiness(env(), {
      fetchImpl: async () => response(payload({ commit: "different" })),
    }),
    (err) => err && err.code === "DEPLOYMENT_READINESS_COMMIT_MISMATCH"
  );

  await assert.rejects(
    () => assertRemoteDeploymentReadiness(env(), {
      fetchImpl: async () => response(payload({
        attestation: { databaseIsolationConfirmed: false, readSafe: false },
      })),
    }),
    (err) => err && err.code === "DEPLOYMENT_READINESS_DATABASE_NOT_ISOLATED"
  );

  await assert.rejects(
    () => assertRemoteDeploymentReadiness(env(), {
      fetchImpl: async () => response(payload({
        attestation: { databaseIdentityHash: "sha256:different" },
      })),
    }),
    (err) => err && err.code === "DEPLOYMENT_READINESS_DATABASE_IDENTITY_MISMATCH"
  );

  await assert.rejects(
    () => assertRemoteDeploymentReadiness(env(), {
      fetchImpl: async () => response(payload({
        attestation: { paymentSandboxConfirmed: false, safePaymentMode: false, writeSafe: false },
        writeReady: false,
      })),
    }),
    (err) => err && err.code === "DEPLOYMENT_READINESS_PAYMENT_NOT_SANDBOXED"
  );

  console.log("subscription stacking deployment readiness tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
