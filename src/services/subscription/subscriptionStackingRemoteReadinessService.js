"use strict";

const {
  buildMongoDeploymentIdentityHash,
} = require("../../utils/mongoDeploymentIdentity");
const {
  resolveProductionEnvironment,
} = require("./subscriptionStackingProductionSafetyService");
const {
  isExtraActivationCanaryEnabledForUser,
  isExtraSelectionCanaryEnabledForUser,
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
  resolveExtraActivationCanaryState,
  resolveExtraSelectionCanaryState,
  resolveSubscriptionStackingRolloutState,
} = require("./subscriptionStackingRolloutPolicyService");

const SKIP_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingSkipRouter.installed");
const PLANNED_PICKUP_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingPlannedPickupRouter.installed");
const WRITE_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingWriteRouter.installed");
const SELECTION_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingSelectionRouter.installed");
const ENTITLEMENT_INSTALL_KEY = Symbol.for("basicdiet.subscriptionStackingEntitlementRouter.installed");
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
  const extraActivation = resolveExtraActivationCanaryState(env);
  const extraSelection = resolveExtraSelectionCanaryState(env);
  const deploymentSafety = resolveDeploymentSafetyAttestation(env);
  const deploymentCommitSha = resolveDeploymentCommit(env);
  const shadowEnabledForUser = rollout.shadowEnabled
    && isAllowlisted(rollout.shadowAllowlist, subject);
  const readEnabledForUser = isReadStackingEnabledForUser(subject, env);
  const writeEnabledForUser = isWriteStackingEnabledForUser(subject, env);
  const extraActivationEnabledForUser = isExtraActivationCanaryEnabledForUser(
    subject,
    env
  );
  const extraSelectionEnabledForUser = isExtraSelectionCanaryEnabledForUser(
    subject,
    env
  );
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
  const writeRouterConnected = Boolean(globalObject && globalObject[WRITE_INSTALL_KEY]);
  const selectionRouterConnected = Boolean(
    globalObject && globalObject[SELECTION_INSTALL_KEY]
  );
  const entitlementRouterConnected = Boolean(
    globalObject && globalObject[ENTITLEMENT_INSTALL_KEY]
  );
  const extraWildcardConfigured = extraActivation.wildcardPresent
    || extraSelection.wildcardPresent;
  const singleExtraCanary = extraActivation.enabled
    && extraSelection.enabled
    && extraActivation.allowlist.size === 1
    && extraSelection.allowlist.size === 1
    && !extraWildcardConfigured
    && !rollout.allowAllUsers
    && extraActivation.allowlist.has(subject)
    && extraSelection.allowlist.has(subject);
  const requiredExtraRoutersConnected = writeRouterConnected
    && selectionRouterConnected
    && entitlementRouterConnected
    && plannedPickupRouterConnected;

  const readProbeReady = !environment.production
    && Boolean(deploymentCommitSha)
    && deploymentSafety.readSafe
    && shadowEnabledForUser;
  const baseMealCanaryReady = readProbeReady
    && deploymentSafety.writeSafe
    && readEnabledForUser
    && writeEnabledForUser
    && singleUserCanary;
  const extraEntitlementCanaryReady = baseMealCanaryReady
    && extraActivationEnabledForUser
    && extraSelectionEnabledForUser
    && singleExtraCanary
    && requiredExtraRoutersConnected;

  return {
    contractVersion: "subscription_stacking_remote_readiness.v1",
    capabilityContractVersion: "subscription_stacking_extra_canary_readiness.v2",
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
      extraActivationEnabledGlobally: extraActivation.enabled,
      extraSelectionEnabledGlobally: extraSelection.enabled,
      extraActivationEnabledForUser,
      extraSelectionEnabledForUser,
      singleExtraCanary,
      extraWildcardConfigured,
    },
    runtime: {
      skipRouterConnected,
      plannedPickupRouterConnected,
      writeRouterConnected,
      selectionRouterConnected,
      entitlementRouterConnected,
      baseMealCheckoutSupported: true,
      premiumStackingSupported: extraEntitlementCanaryReady,
      addonStackingSupported: extraEntitlementCanaryReady,
      bulkPlanningSupported: false,
      freezeSupported: false,
      cancellationSupported: false,
      directPickupSupported: false,
    },
    clientContract: {
      version: "subscription_stacking_flutter.v1",
      exactMealSlotProteinGrams: true,
      slotProteinGramsAuthority: "backend",
      entitlementGroups: true,
      entitlementPackages: true,
    },
    certification: {
      readProbeReady,
      baseMealCanaryReady,
      extraEntitlementCanaryReady,
      extraEntitlementBlockedReasons: [
        !baseMealCanaryReady ? "base_meal_canary_not_ready" : null,
        !extraActivation.enabled ? "extra_activation_disabled" : null,
        !extraSelection.enabled ? "extra_selection_disabled" : null,
        extraWildcardConfigured ? "extra_wildcard_configured" : null,
        rollout.allowAllUsers ? "allow_all_users_forbidden" : null,
        !singleExtraCanary ? "single_extra_canary_policy_not_satisfied" : null,
        !extraActivationEnabledForUser ? "extra_activation_not_enabled_for_user" : null,
        !extraSelectionEnabledForUser ? "extra_selection_not_enabled_for_user" : null,
        !requiredExtraRoutersConnected ? "required_extra_routers_not_connected" : null,
      ].filter(Boolean),
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
  ENTITLEMENT_INSTALL_KEY,
  PLANNED_PICKUP_INSTALL_KEY,
  SAFE_STAGING_PAYMENT_MODES,
  SELECTION_INSTALL_KEY,
  SKIP_INSTALL_KEY,
  WRITE_INSTALL_KEY,
  buildSubscriptionStackingRemoteReadiness,
  resolveDeploymentCommit,
  resolveDeploymentSafetyAttestation,
};
