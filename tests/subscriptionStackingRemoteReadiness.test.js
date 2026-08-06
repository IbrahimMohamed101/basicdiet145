"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  buildSubscriptionStackingRemoteReadiness,
  resolveDeploymentCommit,
} = require("../src/services/subscription/subscriptionStackingRemoteReadinessService");

const USER_ID = "507f1f77bcf86cd799439011";

function buildEnv(overrides = {}) {
  return {
    NODE_ENV: "staging",
    APP_ENV: "staging",
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
  assert.strictEqual(safe.rollout.singleUserCanary, true);
  assert.strictEqual(safe.certification.baseMealCanaryReady, true);
  assert.deepStrictEqual(safe.certification.blockedReasons, []);

  const production = buildSubscriptionStackingRemoteReadiness({
    userId: USER_ID,
    env: buildEnv({ NODE_ENV: "production", APP_ENV: "production" }),
    globalObject: {},
  });
  assert.strictEqual(production.certification.baseMealCanaryReady, false);
  assert(production.certification.blockedReasons.includes("production_environment"));

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

  console.log("subscription stacking remote readiness tests passed");
}

run();
