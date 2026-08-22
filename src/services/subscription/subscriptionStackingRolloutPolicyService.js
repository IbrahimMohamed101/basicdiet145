"use strict";

const {
  resolveProductionEnvironment,
} = require("./subscriptionStackingProductionSafetyService");

const SAFE_EXTRA_ACTIVATION_PAYMENT_MODES = new Set(["sandbox", "mock", "test"]);

function isEnabled(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === "true";
}

function parseIdAllowlist(rawValue) {
  return new Set(
    String(rawValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function policyError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.details = details;
  return err;
}

function resolveSubscriptionStackingRolloutState(env = process.env) {
  const shadowEnabled = isEnabled(env.SUBSCRIPTION_STACKING_SHADOW_ENABLED);
  const readEnabled = isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED);
  const writeEnabled = isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED);
  const shadowAllowlist = parseIdAllowlist(env.SUBSCRIPTION_STACKING_SHADOW_USER_IDS);
  const rolloutAllowlist = parseIdAllowlist(env.SUBSCRIPTION_STACKING_USER_IDS);
  const allowAllUsers = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS);

  return {
    shadowEnabled,
    readEnabled,
    writeEnabled,
    shadowAllowlist,
    rolloutAllowlist,
    allowAllUsers,
  };
}

function assertSubscriptionStackingRolloutConfiguration(env = process.env) {
  const state = resolveSubscriptionStackingRolloutState(env);

  if (state.writeEnabled && !state.readEnabled) {
    throw policyError(
      "SUBSCRIPTION_STACKING_WRITE_REQUIRES_READ",
      "SUBSCRIPTION_STACKING_WRITE_ENABLED requires SUBSCRIPTION_STACKING_READ_ENABLED",
      { writeEnabled: true, readEnabled: false }
    );
  }

  if (state.shadowEnabled && !state.allowAllUsers && state.shadowAllowlist.size === 0) {
    throw policyError(
      "SUBSCRIPTION_STACKING_SHADOW_ALLOWLIST_REQUIRED",
      "Shadow mode requires SUBSCRIPTION_STACKING_SHADOW_USER_IDS",
      { shadowEnabled: true }
    );
  }

  if (
    (state.readEnabled || state.writeEnabled)
    && !state.allowAllUsers
    && state.rolloutAllowlist.size === 0
  ) {
    throw policyError(
      "SUBSCRIPTION_STACKING_ALLOWLIST_REQUIRED",
      "Read/write stacking requires SUBSCRIPTION_STACKING_USER_IDS",
      { readEnabled: state.readEnabled, writeEnabled: state.writeEnabled }
    );
  }

  if (
    state.writeEnabled
    && state.rolloutAllowlist.has("*")
    && !state.allowAllUsers
  ) {
    throw policyError(
      "SUBSCRIPTION_STACKING_WRITE_WILDCARD_BLOCKED",
      "Wildcard write rollout requires SUBSCRIPTION_STACKING_ALLOW_ALL_USERS=true",
      { writeEnabled: true, wildcard: true }
    );
  }

  return {
    ok: true,
    shadowEnabled: state.shadowEnabled,
    readEnabled: state.readEnabled,
    writeEnabled: state.writeEnabled,
    shadowUserCount: state.shadowAllowlist.has("*") ? "all" : state.shadowAllowlist.size,
    rolloutUserCount: state.rolloutAllowlist.has("*") ? "all" : state.rolloutAllowlist.size,
    allowAllUsers: state.allowAllUsers,
  };
}

function isUserAllowedForStacking(userId, env = process.env) {
  const userIdValue = String(userId || "").trim();
  if (!userIdValue) return false;
  if (isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS)) return true;
  const allowlist = parseIdAllowlist(env.SUBSCRIPTION_STACKING_USER_IDS);
  return allowlist.has("*") || allowlist.has(userIdValue);
}

function isReadStackingEnabledForUser(userId, env = process.env) {
  return isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED)
    && isUserAllowedForStacking(userId, env);
}

function isWriteStackingEnabledForUser(userId, env = process.env) {
  return isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED)
    && isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED)
    && isUserAllowedForStacking(userId, env);
}

function resolveExtraSelectionCanaryState(env = process.env) {
  const enabled = isEnabled(env.SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED);
  const allowlist = parseIdAllowlist(
    env.SUBSCRIPTION_STACKING_EXTRA_SELECTION_USER_IDS
  );
  const wildcardPresent = allowlist.has("*");
  return { enabled, allowlist, wildcardPresent };
}

function resolveExtraActivationCanaryState(env = process.env) {
  const enabled = isEnabled(env.SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED);
  const allowlist = parseIdAllowlist(
    env.SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_USER_IDS
  );
  const wildcardPresent = allowlist.has("*");
  return { enabled, allowlist, wildcardPresent };
}

function extraActivationSafetyState(env = process.env) {
  const environment = resolveProductionEnvironment(env);
  const paymentMode = String(env.STAGING_PAYMENT_MODE || "").trim().toLowerCase();
  return {
    production: environment.production,
    databaseIsolationConfirmed: isEnabled(
      env.STAGING_DATABASE_ISOLATION_CONFIRMED
    ),
    paymentSandboxConfirmed: isEnabled(
      env.STAGING_PAYMENT_SANDBOX_CONFIRMED
    ),
    safePaymentMode: SAFE_EXTRA_ACTIVATION_PAYMENT_MODES.has(paymentMode),
    paymentMode,
  };
}

function assertExtraActivationCanaryConfiguration(env = process.env) {
  const state = resolveExtraActivationCanaryState(env);
  const globalRollout = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS);
  if (state.wildcardPresent && !globalRollout) {
    throw policyError(
      "STACKING_EXTRA_ACTIVATION_WILDCARD_BLOCKED",
      "Extra activation canary never accepts wildcard rollout",
      { wildcard: true }
    );
  }
  if (!state.enabled) {
    return {
      ok: true,
      enabled: false,
      userCount: state.allowlist.size,
      wildcardAllowed: false,
    };
  }
  if (!globalRollout && state.allowlist.size !== 1) {
    throw policyError(
      "STACKING_EXTRA_ACTIVATION_REQUIRES_EXACTLY_ONE_USER",
      "Extra activation canary requires exactly one explicit user",
      { count: state.allowlist.size }
    );
  }
  if (
    !isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED)
    || !isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED)
  ) {
    throw policyError(
      "STACKING_EXTRA_ACTIVATION_REQUIRES_STACKING_READ_WRITE",
      "Extra activation canary requires stacking read and write eligibility"
    );
  }
  if (!globalRollout) {
    const activationUserId = Array.from(state.allowlist)[0];
    const baseAllowlist = parseIdAllowlist(env.SUBSCRIPTION_STACKING_USER_IDS);
    if (baseAllowlist.has("*") || !baseAllowlist.has(activationUserId)) {
      throw policyError(
        "STACKING_EXTRA_ACTIVATION_BASE_ALLOWLIST_REQUIRED",
        "Extra activation canary user must be explicitly present in the base stacking allowlist"
      );
    }
  }

  const safety = extraActivationSafetyState(env);
  if (safety.production) {
    throw policyError(
      "STACKING_EXTRA_ACTIVATION_PRODUCTION_BLOCKED",
      "Extra activation canary cannot run in production"
    );
  }
  if (!safety.databaseIsolationConfirmed) {
    throw policyError(
      "STACKING_EXTRA_ACTIVATION_DATABASE_ISOLATION_REQUIRED",
      "Extra activation canary requires isolated staging database attestation"
    );
  }
  if (!safety.paymentSandboxConfirmed || !safety.safePaymentMode) {
    throw policyError(
      "STACKING_EXTRA_ACTIVATION_PAYMENT_SANDBOX_REQUIRED",
      "Extra activation canary requires an attested sandbox payment mode",
      { paymentMode: safety.paymentMode || null }
    );
  }

  return {
    ok: true,
    enabled: true,
    mode: globalRollout ? "global" : "canary",
    userCount: globalRollout ? "all" : 1,
    wildcardAllowed: globalRollout,
    databaseIsolationRequired: true,
    paymentSandboxRequired: true,
  };
}

function isExtraActivationCanaryEnabledForUser(userId, env = process.env) {
  const userIdValue = String(userId || "").trim();
  if (!userIdValue) return false;
  const state = resolveExtraActivationCanaryState(env);
  const safety = extraActivationSafetyState(env);
  const globalRollout = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS);
  if (
    !state.enabled
    || safety.production
    || !safety.databaseIsolationConfirmed
    || !safety.paymentSandboxConfirmed
    || !safety.safePaymentMode
  ) {
    return false;
  }
  if (globalRollout) {
    return isReadStackingEnabledForUser(userIdValue, env)
      && isWriteStackingEnabledForUser(userIdValue, env);
  }
  if (state.wildcardPresent || state.allowlist.size !== 1) return false;
  return isReadStackingEnabledForUser(userIdValue, env)
    && isWriteStackingEnabledForUser(userIdValue, env)
    && state.allowlist.has(userIdValue);
}

function assertExtraSelectionCanaryConfiguration(env = process.env) {
  const state = resolveExtraSelectionCanaryState(env);
  const globalRollout = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS);
  if (state.wildcardPresent && !globalRollout) {
    throw policyError(
      "STACKING_EXTRA_SELECTION_WILDCARD_BLOCKED",
      "Extra selection canary never accepts wildcard rollout",
      { wildcard: true }
    );
  }
  if (state.enabled && !globalRollout && state.allowlist.size === 0) {
    throw policyError(
      "STACKING_EXTRA_SELECTION_ALLOWLIST_REQUIRED",
      "Extra selection canary requires an explicit user allowlist"
    );
  }
  if (state.enabled && !globalRollout && state.allowlist.size !== 1) {
    throw policyError(
      "STACKING_EXTRA_SELECTION_REQUIRES_EXACTLY_ONE_USER",
      "Extra selection canary requires exactly one explicit user",
      { count: state.allowlist.size }
    );
  }
  if (
    state.enabled
    && (!isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED)
      || !isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED))
  ) {
    throw policyError(
      "STACKING_EXTRA_SELECTION_REQUIRES_STACKING_READ_WRITE",
      "Extra selection canary requires stacking read and write eligibility"
    );
  }
  if (state.enabled && !globalRollout) {
    const selectionUserId = Array.from(state.allowlist)[0];
    const baseAllowlist = parseIdAllowlist(env.SUBSCRIPTION_STACKING_USER_IDS);
    if (baseAllowlist.has("*") || !baseAllowlist.has(selectionUserId)) {
      throw policyError(
        "STACKING_EXTRA_SELECTION_BASE_ALLOWLIST_REQUIRED",
        "Extra selection canary user must be explicitly present in the base stacking allowlist"
      );
    }
  }
  if (state.enabled && globalRollout) {
    const safety = extraActivationSafetyState(env);
    if (safety.production) {
      throw policyError(
        "STACKING_EXTRA_SELECTION_PRODUCTION_BLOCKED",
        "Global extra selection cannot run before production certification"
      );
    }
    if (!safety.databaseIsolationConfirmed) {
      throw policyError(
        "STACKING_EXTRA_SELECTION_DATABASE_ISOLATION_REQUIRED",
        "Global extra selection requires isolated staging database attestation"
      );
    }
    if (!safety.paymentSandboxConfirmed || !safety.safePaymentMode) {
      throw policyError(
        "STACKING_EXTRA_SELECTION_PAYMENT_SANDBOX_REQUIRED",
        "Global extra selection requires an attested sandbox payment mode",
        { paymentMode: safety.paymentMode || null }
      );
    }
  }
  return {
    ok: true,
    enabled: state.enabled,
    mode: state.enabled ? (globalRollout ? "global" : "canary") : "disabled",
    userCount: globalRollout ? "all" : state.allowlist.size,
    wildcardAllowed: globalRollout,
  };
}

function isExtraSelectionCanaryEnabledForUser(userId, env = process.env) {
  const userIdValue = String(userId || "").trim();
  if (!userIdValue) return false;
  const state = resolveExtraSelectionCanaryState(env);
  const globalRollout = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS);
  if (
    !state.enabled
    || resolveProductionEnvironment(env).production
  ) return false;
  if (globalRollout) {
    const safety = extraActivationSafetyState(env);
    if (
      !safety.databaseIsolationConfirmed
      || !safety.paymentSandboxConfirmed
      || !safety.safePaymentMode
    ) return false;
    return isReadStackingEnabledForUser(userIdValue, env)
      && isWriteStackingEnabledForUser(userIdValue, env);
  }
  if (state.wildcardPresent || state.allowlist.size !== 1) return false;
  return isReadStackingEnabledForUser(userIdValue, env)
    && isWriteStackingEnabledForUser(userIdValue, env)
    && state.allowlist.has(userIdValue);
}

module.exports = {
  SAFE_EXTRA_ACTIVATION_PAYMENT_MODES,
  assertExtraActivationCanaryConfiguration,
  assertExtraSelectionCanaryConfiguration,
  assertSubscriptionStackingRolloutConfiguration,
  isExtraActivationCanaryEnabledForUser,
  isExtraSelectionCanaryEnabledForUser,
  isReadStackingEnabledForUser,
  isUserAllowedForStacking,
  isWriteStackingEnabledForUser,
  parseIdAllowlist,
  resolveExtraActivationCanaryState,
  resolveExtraSelectionCanaryState,
  resolveSubscriptionStackingRolloutState,
};
