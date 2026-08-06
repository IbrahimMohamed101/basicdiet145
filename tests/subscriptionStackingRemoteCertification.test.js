"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  assertBaseMealOnly,
  runRemoteCertification,
} = require("../scripts/run-subscription-stacking-remote-certification");

const USER_ID = "507f1f77bcf86cd799439011";

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
    STAGING_REQUEST_TIMEOUT_MS: "2000",
    ...overrides,
  };
}

function response(payload, status = 200, requestId = "req-test") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === "x-request-id" ? requestId : null },
    text: async () => JSON.stringify(payload),
  };
}

function readinessPayload() {
  return {
    status: true,
    data: {
      contractVersion: "subscription_stacking_remote_readiness.v1",
      environment: { production: false, value: "staging" },
      deployment: { commitSha: "abc123" },
      certification: {
        readProbeReady: true,
        baseMealCanaryReady: true,
        blockedReasons: [],
      },
    },
  };
}

function createFetchQueue(items) {
  const calls = [];
  const queue = [...items];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", headers: options.headers, body: options.body });
    if (!queue.length) throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
    return queue.shift();
  };
  return { fetchImpl, calls, remaining: () => queue.length };
}

async function testReadPhase() {
  const queue = createFetchQueue([
    response({ status: true }),
    response(readinessPayload()),
    response({ status: true, data: { subscriptionId: "sub-1", mealBalance: { remainingMeals: 20 } } }),
    response({ status: true, data: { days: [] } }),
  ]);
  const evidence = await runRemoteCertification(buildEnv({ STAGING_CERTIFICATION_PHASE: "read" }), {
    fetchImpl: queue.fetchImpl,
  });
  assert.strictEqual(evidence.passed, true);
  assert.strictEqual(evidence.phase, "read");
  assert.strictEqual(evidence.before.remainingMeals, 20);
  assert.strictEqual(queue.remaining(), 0);
  assert.strictEqual(queue.calls[0].headers.Authorization, "");
  assert.strictEqual(queue.calls[1].headers.Authorization, "Bearer test-token");
}

async function testInitiatePhaseIdempotency() {
  const queue = createFetchQueue([
    response({ status: true }),
    response(readinessPayload()),
    response({ status: true, data: { subscriptionId: "sub-1", remainingMeals: 20 } }),
    response({ status: true, data: { days: [] } }),
    response({ status: true, data: { breakdown: { totalHalala: 10000 } } }),
    response({ status: true, data: { draftId: "draft-1", payment_url: "https://sandbox.moyasar.com/pay/1" } }),
    response({ status: true, data: { draftId: "draft-1", payment_url: "https://sandbox.moyasar.com/pay/1" } }),
  ]);
  const env = buildEnv({
    STAGING_CERTIFICATION_PHASE: "initiate",
    STAGING_CHECKOUT_IDEMPOTENCY_KEY: "stacking-cert-fixed",
    STAGING_CHECKOUT_PAYLOAD_JSON: JSON.stringify({
      planId: "plan-1",
      grams: 150,
      mealsPerDay: 2,
      startDate: "2026-08-06",
      premiumItems: [],
      addons: [],
    }),
  });
  const evidence = await runRemoteCertification(env, { fetchImpl: queue.fetchImpl });
  assert.strictEqual(evidence.passed, true);
  assert.strictEqual(evidence.mutation.checkoutDraftId, "draft-1");
  assert.strictEqual(evidence.mutation.idempotencyVerified, true);
  const checkoutCalls = queue.calls.filter((call) => call.url.endsWith("/api/subscriptions/checkout"));
  assert.strictEqual(checkoutCalls.length, 2);
  assert.strictEqual(checkoutCalls[0].headers["Idempotency-Key"], "stacking-cert-fixed");
  assert.strictEqual(checkoutCalls[1].headers["Idempotency-Key"], "stacking-cert-fixed");
}

async function testVerifyPhaseBalanceAndTimeline() {
  const queue = createFetchQueue([
    response({ status: true }),
    response(readinessPayload()),
    response({ status: true, data: { subscriptionId: "sub-1", remainingMeals: 20 } }),
    response({ status: true, data: { days: [{ date: "2026-08-06", requiredMeals: 3 }] } }),
    response({ status: true, data: { status: "completed", draftId: "draft-1" } }),
    response({ status: true, data: { status: "completed", draftId: "draft-1" } }),
    response({ status: true, data: { subscriptionId: "sub-1", mealBalance: { remainingMeals: 72 } } }),
    response({ status: true, data: { days: [{ date: "2026-08-06", requiredMeals: 5 }] } }),
  ]);
  const env = buildEnv({
    STAGING_CERTIFICATION_PHASE: "verify",
    STAGING_CHECKOUT_DRAFT_ID: "draft-1",
    STAGING_EXPECTED_REMAINING_MEALS: "72",
    STAGING_TARGET_DATE: "2026-08-06",
    STAGING_EXPECTED_REQUIRED_MEALS: "5",
  });
  const evidence = await runRemoteCertification(env, { fetchImpl: queue.fetchImpl });
  assert.strictEqual(evidence.passed, true);
  assert.strictEqual(evidence.mutation.verifyIdempotencyVerified, true);
  assert.strictEqual(evidence.after.remainingMeals, 72);
  assert.strictEqual(evidence.after.requiredMeals, 5);
}

function testPremiumAndAddonPayloadsAreBlockedLocally() {
  assert.throws(
    () => assertBaseMealOnly({ premiumItems: [{ premiumKey: "shrimp", qty: 1 }] }),
    (err) => err && err.code === "CERTIFICATION_BASE_MEAL_ONLY_REQUIRED"
  );
  assert.throws(
    () => assertBaseMealOnly({ addons: [{ addonPlanId: "addon-1" }] }),
    (err) => err && err.code === "CERTIFICATION_BASE_MEAL_ONLY_REQUIRED"
  );
}

async function run() {
  await testReadPhase();
  await testInitiatePhaseIdempotency();
  await testVerifyPhaseBalanceAndTimeline();
  testPremiumAndAddonPayloadsAreBlockedLocally();
  console.log("subscription stacking remote certification tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
