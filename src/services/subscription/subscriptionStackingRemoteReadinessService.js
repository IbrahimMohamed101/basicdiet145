"use strict";

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

  const baseMealCanaryReady = !environment.production
    && shadowEnabledForUser
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
      commitSha: resolveDeploymentCommit(env),
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
      readProbeReady: !environment.production && shadowEnabledForUser,
      baseMealCanaryReady,
      blockedReasons: [
        environment.production ? "production_environment" : null,
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
  SKIP_INSTALL_KEY,
  buildSubscriptionStackingRemoteReadiness,
  resolveDeploymentCommit,
};
