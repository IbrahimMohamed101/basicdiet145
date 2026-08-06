"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  assertRemoteParentIdentity,
} = require("../scripts/assert-subscription-stacking-parent-identity");

const USER_ID = "507f1f77bcf86cd799439011";
const SUBSCRIPTION_ID = "6a73ebf135b905cfeaf64d37";

function buildEnv(overrides = {}) {
  return {
    NODE_ENV: "staging",
    APP_ENV: "staging",
    STAGING_BASE_URL: "https://basicdiet-staging.example.com",
    STAGING_PAYMENT_MODE: "sandbox",
    STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "true",
    MONGODB_URI: "mongodb://localhost:27017/basicdiet_staging",
    SUBSCRIPTION_STACKING_SHADOW_ENABLED: "true",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_SHADOW_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    STAGING_CLIENT_TOKEN: "test-token",
    STAGING_SUBSCRIPTION_ID: SUBSCRIPTION_ID,
    STAGING_REQUEST_TIMEOUT_MS: "2000",
    ...overrides,
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "req-parent" },
    text: async () => JSON.stringify(payload),
  };
}

async function testMatchingParentPasses() {
  const calls = [];
  const result = await assertRemoteParentIdentity(buildEnv(), {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ status: true, data: { subscriptionId: SUBSCRIPTION_ID } });
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.subscriptionId, "***64d37");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.headers.Authorization, "Bearer test-token");
}

async function testChangedParentFails() {
  await assert.rejects(
    () => assertRemoteParentIdentity(buildEnv(), {
      fetchImpl: async () => response({
        status: true,
        data: { subscriptionId: "6a73ebf135b905cfeaf64d38" },
      }),
    }),
    (err) => err && err.code === "PARENT_IDENTITY_CHANGED"
  );
}

async function testMissingExpectedParentFailsBeforeNetwork() {
  let called = false;
  await assert.rejects(
    () => assertRemoteParentIdentity(buildEnv({ STAGING_SUBSCRIPTION_ID: "" }), {
      fetchImpl: async () => {
        called = true;
        return response({});
      },
    }),
    (err) => err && err.code === "PARENT_IDENTITY_EXPECTED_ID_REQUIRED"
  );
  assert.strictEqual(called, false);
}

async function run() {
  await testMatchingParentPasses();
  await testChangedParentFails();
  await testMissingExpectedParentFailsBeforeNetwork();
  console.log("subscription stacking parent identity tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
