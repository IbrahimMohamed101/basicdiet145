"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  assertBaseMealOnly,
  assertExtraCertificationReady,
  exerciseExtraRuntime,
  hasExtraCheckoutPayload,
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

function readinessPayload({ extraReady = false } = {}) {
  return {
    status: true,
    data: {
      contractVersion: "subscription_stacking_remote_readiness.v1",
      environment: { production: false, value: "staging" },
      deployment: { commitSha: "abc123" },
      runtime: {
        premiumStackingSupported: extraReady,
        addonStackingSupported: extraReady,
      },
      clientContract: {
        version: "subscription_stacking_flutter.v1",
        exactMealSlotProteinGrams: true,
        slotProteinGramsAuthority: "backend",
        entitlementGroups: true,
        entitlementPackages: true,
      },
      certification: {
        readProbeReady: true,
        baseMealCanaryReady: true,
        extraEntitlementCanaryReady: extraReady,
        extraEntitlementBlockedReasons: extraReady ? [] : ["extra_activation_disabled"],
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

async function testPremiumAddonInitiateUsesFullCanaryReadiness() {
  const queue = createFetchQueue([
    response({ status: true }),
    response(readinessPayload({ extraReady: true })),
    response({ status: true, data: { subscriptionId: "sub-1", remainingMeals: 20 } }),
    response({ status: true, data: { days: [] } }),
    response({ status: true, data: { breakdown: { totalHalala: 12000 } } }),
    response({ status: true, data: { draftId: "draft-extra", payment_url: "https://sandbox.moyasar.com/pay/extra" } }),
    response({ status: true, data: { draftId: "draft-extra", payment_url: "https://sandbox.moyasar.com/pay/extra" } }),
  ]);
  const evidence = await runRemoteCertification(buildEnv({
    STAGING_CERTIFICATION_PHASE: "initiate",
    STAGING_CHECKOUT_PAYLOAD_JSON: JSON.stringify({
      planId: "plan-1",
      premiumItems: [{ premiumKey: "shrimp", qty: 1 }],
      addons: [{ addonPlanId: "addon-1", qty: 1 }],
    }),
  }), { fetchImpl: queue.fetchImpl });
  assert.strictEqual(evidence.passed, true);
  assert.strictEqual(evidence.mutation.extraEntitlements, true);
}

async function testExtraPublicRuntimeOrchestration() {
  const queue = createFetchQueue(Array.from({ length: 8 }, (_, index) => response({
    status: true,
    data: index === 4 || index === 5 ? { pickupRequestId: "pickup-1" } : {},
  }, 200, `req-extra-${index}`)));
  const result = await exerciseExtraRuntime({
    fetchImpl: queue.fetchImpl,
    baseUrl: "https://basicdiet-staging.example.com",
    token: "client-token",
    timeoutMs: 2000,
  }, {
    subscriptionId: "sub-1",
    config: {
      date: "2026-08-12",
      selectionBody: { mealSlots: [{ slotKey: "slot_1", premiumKey: "shrimp" }] },
      pickupBody: { selectedPickupItemIds: ["slot_1"], idempotencyKey: "pickup-fixed" },
    },
    dashboardToken: "dashboard-token",
  });
  assert.strictEqual(result.pickupRequestId, "***");
  assert.strictEqual(queue.remaining(), 0);
  assert.strictEqual(queue.calls[0].method, "PUT");
  assert(queue.calls[0].url.endsWith("/api/subscriptions/sub-1/days/2026-08-12/selection"));
  assert.strictEqual(queue.calls[6].headers.Authorization, "Bearer dashboard-token");
  assert(queue.calls[6].url.endsWith("/api/kitchen/subscriptions/sub-1/days/2026-08-12/fulfill-pickup"));
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
  assert.strictEqual(hasExtraCheckoutPayload({ premiumItems: [{ qty: 1 }] }), true);
  assert.strictEqual(hasExtraCheckoutPayload({ addons: [] }), false);
  assert.throws(
    () => assertExtraCertificationReady(readinessPayload().data),
    (err) => err && err.code === "CERTIFICATION_EXTRA_CANARY_NOT_READY"
  );
  assert.doesNotThrow(
    () => assertExtraCertificationReady(readinessPayload({ extraReady: true }).data)
  );
}

async function run() {
  await testReadPhase();
  await testInitiatePhaseIdempotency();
  await testVerifyPhaseBalanceAndTimeline();
  await testPremiumAddonInitiateUsesFullCanaryReadiness();
  await testExtraPublicRuntimeOrchestration();
  testPremiumAndAddonPayloadsAreBlockedLocally();
  console.log("subscription stacking remote certification tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
