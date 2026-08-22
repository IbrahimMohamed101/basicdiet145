"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  assertExtraActivationCanaryConfiguration,
  assertExtraSelectionCanaryConfiguration,
  isExtraActivationCanaryEnabledForUser,
} = require(
  "../src/services/subscription/subscriptionStackingRolloutPolicyService"
);
const {
  assertSubscriptionStackingProductionSafety,
} = require(
  "../src/services/subscription/subscriptionStackingProductionSafetyService"
);
const {
  applyPaidDraftToSubscriptionStackTransactional,
} = require(
  "../src/services/subscription/subscriptionStackingPaidDraftOrchestratorService"
);

const USER_ID = "507f1f77bcf86cd799439011";

function env(overrides = {}) {
  return {
    NODE_ENV: "staging",
    APP_ENV: "staging",
    STAGING_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_PAYMENT_SANDBOX_CONFIRMED: "true",
    STAGING_PAYMENT_MODE: "sandbox",
    SUBSCRIPTION_STACKING_READ_ENABLED: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
    SUBSCRIPTION_STACKING_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "false",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "true",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: USER_ID,
    ...overrides,
  };
}

function session() {
  return { supportsTransactions: true, inTransaction: () => true };
}

function orchestrationFixture() {
  const userId = new mongoose.Types.ObjectId();
  return {
    userId,
    draft: { _id: new mongoose.Types.ObjectId(), userId },
    payment: { _id: new mongoose.Types.ObjectId(), userId, status: "paid" },
    container: { _id: new mongoose.Types.ObjectId(), userId },
    purchaseBatch: { _id: new mongoose.Types.ObjectId() },
  };
}

async function routePurchase({ eligible, extras }) {
  const source = orchestrationFixture();
  const calls = [];
  const result = await applyPaidDraftToSubscriptionStackTransactional({
    draft: source.draft,
    payment: source.payment,
    businessDate: "2026-08-12",
    session: session(),
    runtime: {
      buildActivationPayload: async () => ({
        subscriptionPayload: extras
          ? { premiumBalance: [{ premiumKey: "shrimp", purchasedQty: 1 }] }
          : { premiumBalance: [], addonSubscriptions: [] },
      }),
      extraActivationEnabledForUser: () => eligible,
      activateIntoContainer: async () => {
        calls.push("guarded");
        if (extras) {
          const err = new Error("Premium and add-on stacking writes are not enabled yet");
          err.code = "STACKING_PREMIUM_ADDON_WRITE_NOT_READY";
          err.status = 503;
          throw err;
        }
        return {
          outcome: "stacked_into_existing_container",
          container: source.container,
          purchaseBatch: source.purchaseBatch,
        };
      },
      activatePinnedExtrasIntoContainer: async () => {
        calls.push("pinned");
        return {
          outcome: "stacked_into_existing_container",
          container: source.container,
          purchaseBatch: source.purchaseBatch,
        };
      },
      materializeDays: async () => ({ requestedCount: 1, idempotent: false }),
    },
  });
  return { calls, result };
}

async function run() {
  assert.strictEqual(assertExtraActivationCanaryConfiguration(env()).userCount, 1);
  assert.strictEqual(isExtraActivationCanaryEnabledForUser(USER_ID, env()), true);
  assert.strictEqual(
    isExtraActivationCanaryEnabledForUser("507f1f77bcf86cd799439012", env()),
    false
  );
  const globalEnv = env({
    SUBSCRIPTION_STACKING_ALLOW_ALL_USERS: "true",
    SUBSCRIPTION_STACKING_USER_IDS: "",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: "",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: "",
  });
  assert.strictEqual(assertExtraActivationCanaryConfiguration(globalEnv).mode, "global");
  assert.strictEqual(assertExtraSelectionCanaryConfiguration(globalEnv).mode, "global");
  assert.strictEqual(isExtraActivationCanaryEnabledForUser(USER_ID, globalEnv), true);
  assert.strictEqual(
    isExtraActivationCanaryEnabledForUser("507f1f77bcf86cd799439012", globalEnv),
    true
  );
  assert.throws(
    () => assertExtraSelectionCanaryConfiguration({
      ...globalEnv,
      STAGING_DATABASE_ISOLATION_CONFIRMED: "false",
    }),
    (err) => err && err.code === "STACKING_EXTRA_SELECTION_DATABASE_ISOLATION_REQUIRED"
  );
  assert.strictEqual(
    isExtraActivationCanaryEnabledForUser(
      USER_ID,
      env({ SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "false" })
    ),
    false
  );
  assert.strictEqual(
    isExtraActivationCanaryEnabledForUser(
      USER_ID,
      env({ STAGING_DATABASE_ISOLATION_CONFIRMED: "false" })
    ),
    false
  );
  assert.strictEqual(
    isExtraActivationCanaryEnabledForUser(
      USER_ID,
      env({ STAGING_PAYMENT_SANDBOX_CONFIRMED: "false" })
    ),
    false
  );
  assert.strictEqual(
    isExtraActivationCanaryEnabledForUser(
      USER_ID,
      env({ STAGING_PAYMENT_MODE: "live" })
    ),
    false
  );

  const rejected = [
    [
      { SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: "*" },
      "STACKING_EXTRA_ACTIVATION_WILDCARD_BLOCKED",
    ],
    [
      { SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: `${USER_ID},507f1f77bcf86cd799439012` },
      "STACKING_EXTRA_ACTIVATION_REQUIRES_EXACTLY_ONE_USER",
    ],
    [
      { SUBSCRIPTION_STACKING_USER_IDS: "507f1f77bcf86cd799439012" },
      "STACKING_EXTRA_ACTIVATION_BASE_ALLOWLIST_REQUIRED",
    ],
    [
      { STAGING_DATABASE_ISOLATION_CONFIRMED: "false" },
      "STACKING_EXTRA_ACTIVATION_DATABASE_ISOLATION_REQUIRED",
    ],
    [
      { STAGING_PAYMENT_SANDBOX_CONFIRMED: "false" },
      "STACKING_EXTRA_ACTIVATION_PAYMENT_SANDBOX_REQUIRED",
    ],
  ];
  for (const [overrides, code] of rejected) {
    assert.throws(
      () => assertExtraActivationCanaryConfiguration(env(overrides)),
      (err) => Boolean(err && err.code === code)
    );
  }

  assert.throws(
    () => assertSubscriptionStackingProductionSafety({
      NODE_ENV: "production",
      SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "true",
    }),
    (err) => err && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_EXTRA_ACTIVATION_BLOCKED"
  );
  assert.throws(
    () => assertExtraSelectionCanaryConfiguration(env({
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: `${USER_ID},507f1f77bcf86cd799439012`,
    })),
    (err) => err && err.code === "STACKING_EXTRA_SELECTION_REQUIRES_EXACTLY_ONE_USER"
  );
  assert.throws(
    () => assertSubscriptionStackingProductionSafety({
      RAILWAY_ENVIRONMENT_NAME: "production",
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
    }),
    (err) => err && err.code === "SUBSCRIPTION_STACKING_PRODUCTION_EXTRA_SELECTION_BLOCKED"
  );
  assert.strictEqual(
    assertSubscriptionStackingProductionSafety({
      NODE_ENV: "production",
      SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "false",
      SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "false",
    }).ok,
    true
  );

  const canary = await routePurchase({ eligible: true, extras: true });
  assert.deepStrictEqual(canary.calls, ["pinned"]);
  assert.strictEqual(canary.result.applied, true);

  await assert.rejects(
    () => routePurchase({ eligible: false, extras: true }),
    (err) => err && err.code === "STACKING_PREMIUM_ADDON_WRITE_NOT_READY" && err.status === 503
  );

  const baseOnly = await routePurchase({ eligible: true, extras: false });
  assert.deepStrictEqual(baseOnly.calls, ["guarded"]);

  console.log("subscription stacking extra runtime canary P4 tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
