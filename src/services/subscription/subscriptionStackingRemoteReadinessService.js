"use strict";

const {
  buildMongoDeploymentIdentityHash,
} = require("../../utils/mongoDeploymentIdentity");
const {
  resolveProductionEnvironment,
} = require("./subscriptionStackingProductionSafetyService");
const {
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
  resolveSubscriptionStackingRolloutState,
} = require("./subscriptionStackingRolloutPolicyService");

const SKIP_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingSkipRouter.installed");
const PLANNED_PICKUP_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.installed");
const SAFE_STAGING_PAYMENT_MODES = new Set(["sandbox", "mock", "test"]);

function isEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function isAllowlisted(allowlist, userId) {
  const value = String(userId || "").trim();
  if (!value || !(allowlist instanceof Set)) return false;
  return allowlist.has(value) || allowlist.has("*");
}

function resolveDeploymentCommit(env = process.env) {
  const candidates = [
    env.RAILWAY_GIT_COMMIT_SHA,
    env.GIT_COMMIT_SHA,
    env.SOURCE_VERSION,
    env.VERCEL_GIT_COMMIT_SHA,
  ];
  const commit = candidates
    .map((value) => String(value || "").trim())
    .find(Boolean);
  return commit || null;
}

function resolveDeploymentSafetyAttestation(env = process.env) {
  const paymentMode = String(env.STAGING_PAYMENT_MODE || "").trim().toLowerCase();
  const databaseIsolationConfirmed = isEnabled(env.STAGING_DATABASE_ISOLATION_CONFIRMED);
  const paymentSandboxConfirmed = isEnabled(env.STAGING_PAYMENT_SANDBOX_CONFIRMED);
  const safePaymentMode = SAFE_STAGING_PAYMENT_MODES.has(paymentMode);
  const mongoUri = env.MONGO_URI || env.MONGODB_URI || env.MONGO_URL || "";
  const databaseIdentityHash = buildMongoDeploymentIdentityHash(mongoUri);
  const databaseIdentityAvailable = Boolean(databaseIdentityHash);

  return {
    databaseIsolationConfirmed,
    databaseIdentityAvailable,
    databaseIdentityHash,
    paymentSandboxConfirmed,
    paymentMode: paymentMode || null,
    safePaymentMode,
    readSafe: databaseIsolationConfirmed && databaseIdentityAvailable,
    writeSafe:
      databaseIsolationConfirmed
      && databaseIdentityAvailable
      && paymentSandboxConfirmed
      && safePaymentMode,
  };
}

function buildSubscriptionStackingRemoteReadiness({
  userId,
  env = process.env,
  globalObject = globalThis,
} = {}) {
  const subject = String(userId || "").trim();
  if (!subject) {
    const err = new Error("Authenticated user id is required");
    err.code = "AUTH_REQUIRED";
    err.status = 401;
    throw err;
  }

  const environment = resolveProductionEnvironment(env);
  const rollout = resolveSubscriptionStackingRolloutState(env);
  const deploymentSafety = resolveDeploymentSafetyAttestation(env);
  const deploymentCommitSha = resolveDeploymentCommit(env);
  const shadowEnabledForUser = rollout.shadowEnabled
    && isAllowlisted(rollout.shadowAllowlist, subject);
  const readEnabledForUser = isReadStackingEnabledForUser(subject, env);
  const writeEnabledForUser = isWriteStackingEnabledForUser(subject, env);
  const hasWildcard = rollout.shadowAllowlist.has("*")
    || rollout.rolloutAllowlist.has("*");
  const singleUserCanary = rollout.rolloutAllowlist.size === 1
    && rollout.shadowAllowlist.size === 1
    && !hasWildcard
    && !rollout.allowAllUsers
    && rollout.rolloutAllowlist.has(subject)
    && rollout.shadowAllowlist.has(subject);
  const skipRouterConnected = Boolean(globalObject && globalObject[SKIP_INSTALL_KEY]);
  const plannedPickupRouterConnected = Boolean(
    globalObject && globalObject[PLANNED_PICKUP_INSTALL_KEY]
  );

  const readProbeReady = !environment.production
    && Boolean(deploymentCommitSha)
    && deploymentSafety.readSafe
    && shadowEnabledForUser;
  const baseMealCanaryReady = readProbeReady
    && deploymentSafety.writeSafe
    && readEnabledForUser
    && writeEnabledForUser
    && singleUserCanary;

  return {
    contractVersion: "subscription_stacking_remote_readiness.v1",
    environment: {
      production: environment.production,
      source: environment.source || null,
      value: environment.value || environment.nodeEnv || null,
    },
    deployment: {
      commitSha: deploymentCommitSha,
      safetyAttestation: deploymentSafety,
    },
    rollout: {
      shadowEnabledGlobally: rollout.shadowEnabled,
      readEnabledGlobally: rollout.readEnabled,
      writeEnabledGlobally: rollout.writeEnabled,
      shadowEnabledForUser,
      readEnabledForUser,
      writeEnabledForUser,
      singleUserCanary,
      wildcardConfigured: hasWildcard,
      allowAllUsers: rollout.allowAllUsers,
    },
    runtime: {
      skipRouterConnected,
      plannedPickupRouterConnected,
      baseMealCheckoutSupported: true,
      premiumStackingSupported: false,
      addonStackingSupported: false,
      bulkPlanningSupported: false,
      freezeSupported: false,
      cancellationSupported: false,
      directPickupSupported: false,
    },
    certification: {
      readProbeReady,
      baseMealCanaryReady,
      blockedReasons: [
        environment.production ? "production_environment" : null,
        !deploymentCommitSha ? "deployment_commit_not_exposed" : null,
        !deploymentSafety.databaseIsolationConfirmed ? "database_isolation_not_attested" : null,
        !deploymentSafety.databaseIdentityAvailable ? "database_identity_unavailable" : null,
        !deploymentSafety.paymentSandboxConfirmed ? "payment_sandbox_not_attested" : null,
        !deploymentSafety.safePaymentMode ? "unsafe_or_missing_payment_mode" : null,
        !shadowEnabledForUser ? "shadow_not_enabled_for_user" : null,
        !readEnabledForUser ? "read_not_enabled_for_user" : null,
        !writeEnabledForUser ? "write_not_enabled_for_user" : null,
        !singleUserCanary ? "single_user_canary_policy_not_satisfied" : null,
      ].filter(Boolean),
    },
  };
}

module.exports = {
  PLANNED_PICKUP_INSTALL_KEY,
  SAFE_STAGING_PAYMENT_MODES,
  SKIP_INSTALL_KEY,
  buildSubscriptionStackingRemoteReadiness,
  resolveDeploymentCommit,
  resolveDeploymentSafetyAttestation,
};
