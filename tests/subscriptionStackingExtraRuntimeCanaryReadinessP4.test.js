"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  ENTITLEMENT_INSTALL_KEY,
  PLANNED_PICKUP_INSTALL_KEY,
  SELECTION_INSTALL_KEY,
  WRITE_INSTALL_KEY,
  buildSubscriptionStackingRemoteReadiness,
} = require(
  "../src/services/subscription/subscriptionStackingRemoteReadinessService"
);

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439012";
const MONGO_URI = ["mongodb", "://", "staging-db.example.com:27017/basicdiet_staging"].join("");

function env(overrides = {}) {
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
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "true",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: USER_ID,
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "true",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: USER_ID,
    RAILWAY_GIT_COMMIT_SHA: "p4-candidate",
    ...overrides,
  };
}

function installedRouters(overrides = {}) {
  return {
    [WRITE_INSTALL_KEY]: { installed: true },
    [SELECTION_INSTALL_KEY]: { installed: true },
    [ENTITLEMENT_INSTALL_KEY]: { installed: true },
    [PLANNED_PICKUP_INSTALL_KEY]: { installed: true },
    ...overrides,
  };
}

function readiness(overrides = {}, globalOverrides = {}) {
  return buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: env(overrides),
    globalObject: installedRouters(globalOverrides),
  });
}

function run() {
  const full = readiness();
  assert.strictEqual(full.contractVersion, "subscription_stacking_remote_readiness.v1");
  assert.strictEqual(
    full.capabilityContractVersion,
    "subscription_stacking_extra_canary_readiness.v2"
  );
  assert.strictEqual(full.certification.baseMealCanaryReady, true);
  assert.strictEqual(full.certification.extraEntitlementCanaryReady, true);
  assert.strictEqual(full.runtime.premiumStackingSupported, true);
  assert.strictEqual(full.runtime.addonStackingSupported, true);
  assert.strictEqual(full.rollout.singleExtraCanary, true);
  assert.deepStrictEqual(full.certification.extraEntitlementBlockedReasons, []);

  const activationOnly = readiness({
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "false",
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: "",
  });
  assert.strictEqual(activationOnly.rollout.extraActivationEnabledForUser, true);
  assert.strictEqual(activationOnly.certification.extraEntitlementCanaryReady, false);

  const selectionOnly = readiness({
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED: "false",
    SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS: "",
  });
  assert.strictEqual(selectionOnly.rollout.extraSelectionEnabledForUser, true);
  assert.strictEqual(selectionOnly.certification.extraEntitlementCanaryReady, false);

  const differentUsers = readiness({
    SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS: OTHER_USER_ID,
  });
  assert.strictEqual(differentUsers.certification.extraEntitlementCanaryReady, false);
  assert.strictEqual(differentUsers.rollout.singleExtraCanary, false);

  const noIsolation = readiness({ STAGING_DATABASE_ISOLATION_CONFIRMED: "false" });
  assert.strictEqual(noIsolation.rollout.extraActivationEnabledForUser, false);
  assert.strictEqual(noIsolation.certification.extraEntitlementCanaryReady, false);

  const noSandbox = readiness({ STAGING_PAYMENT_SANDBOX_CONFIRMED: "false" });
  assert.strictEqual(noSandbox.rollout.extraActivationEnabledForUser, false);
  assert.strictEqual(noSandbox.certification.extraEntitlementCanaryReady, false);

  const missingRouter = readiness({}, { [SELECTION_INSTALL_KEY]: undefined });
  assert.strictEqual(missingRouter.certification.extraEntitlementCanaryReady, false);
  assert(
    missingRouter.certification.extraEntitlementBlockedReasons.includes(
      "required_extra_routers_not_connected"
    )
  );

  const production = readiness({ NODE_ENV: "production", APP_ENV: "production" });
  assert.strictEqual(production.certification.extraEntitlementCanaryReady, false);
  assert.strictEqual(production.runtime.premiumStackingSupported, false);

  console.log("subscription stacking extra runtime canary P4 readiness tests passed");
}

run();
