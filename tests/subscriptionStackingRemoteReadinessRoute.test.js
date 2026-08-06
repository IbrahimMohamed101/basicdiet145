"use strict";

process.env.NODE_ENV = "test";
process.env.APP_ENV = "staging";
process.env.MONGODB_URI = "mongodb://staging-db.example.com:27017/basicdiet_staging";
process.env.DEV_AUTH_BYPASS = "true";
process.env.DEV_STATIC_TOKEN = "stacking-readiness-test-token";
process.env.DEV_STATIC_USER_ID = "507f1f77bcf86cd799439011";
process.env.DEV_STATIC_ROLE = "client";
process.env.STAGING_PAYMENT_MODE = "sandbox";
process.env.STAGING_DATABASE_ISOLATION_CONFIRMED = "true";
process.env.STAGING_PAYMENT_SANDBOX_CONFIRMED = "true";
process.env.RAILWAY_GIT_COMMIT_SHA = "route-test-commit";
process.env.SUBSCRIPTION_STACKING_SHADOW_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_SHADOW_USER_IDS = process.env.DEV_STATIC_USER_ID;
process.env.SUBSCRIPTION_STACKING_USER_IDS = process.env.DEV_STATIC_USER_ID;
process.env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS = "false";

const assert = require("node:assert");
const request = require("supertest");
const { createApp } = require("../src/app");
const {
  installSubscriptionStackingRemoteReadinessRoute,
} = require("../src/services/installSubscriptionStackingRemoteReadinessRoute");

async function run() {
  const firstInstall = installSubscriptionStackingRemoteReadinessRoute();
  const secondInstall = installSubscriptionStackingRemoteReadinessRoute();
  assert.strictEqual(firstInstall, secondInstall, "route installer must be idempotent");

  const app = createApp();

  const unauthenticated = await request(app)
    .get("/api/subscriptions/stacking/readiness")
    .expect(401);
  assert.strictEqual(unauthenticated.body.ok, false);
  assert.strictEqual(unauthenticated.body.error.code, "AUTH_REQUIRED");

  const authenticated = await request(app)
    .get("/api/subscriptions/stacking/readiness")
    .set("Authorization", `Bearer ${process.env.DEV_STATIC_TOKEN}`)
    .expect(200);

  assert.strictEqual(authenticated.body.status, true);
  assert.strictEqual(
    authenticated.body.data.contractVersion,
    "subscription_stacking_remote_readiness.v1"
  );
  assert.strictEqual(authenticated.body.data.environment.production, false);
  assert.strictEqual(authenticated.body.data.deployment.commitSha, "route-test-commit");
  assert.strictEqual(
    authenticated.body.data.deployment.safetyAttestation.databaseIsolationConfirmed,
    true
  );
  assert.strictEqual(
    authenticated.body.data.deployment.safetyAttestation.paymentSandboxConfirmed,
    true
  );
  assert.strictEqual(authenticated.body.data.rollout.writeEnabledForUser, true);
  assert.strictEqual(authenticated.body.data.certification.baseMealCanaryReady, true);
  assert.strictEqual(authenticated.body.data.runtime.skipRouterConnected, false);
  assert.strictEqual(authenticated.body.data.runtime.plannedPickupRouterConnected, false);

  console.log("subscription stacking remote readiness route tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
