"use strict";

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

  if (state.shadowEnabled && state.shadowAllowlist.size === 0) {
    throw policyError(
      "SUBSCRIPTION_STACKING_SHADOW_ALLOWLIST_REQUIRED",
      "Shadow mode requires SUBSCRIPTION_STACKING_SHADOW_USER_IDS",
      { shadowEnabled: true }
    );
  }

  if ((state.readEnabled || state.writeEnabled) && state.rolloutAllowlist.size === 0) {
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

function assertExtraSelectionCanaryConfiguration(env = process.env) {
  const state = resolveExtraSelectionCanaryState(env);
  if (state.wildcardPresent) {
    throw policyError(
      "STACKING_EXTRA_SELECTION_WILDCARD_BLOCKED",
      "Extra selection canary never accepts wildcard rollout",
      { wildcard: true }
    );
  }
  if (state.enabled && state.allowlist.size === 0) {
    throw policyError(
      "STACKING_EXTRA_SELECTION_ALLOWLIST_REQUIRED",
      "Extra selection canary requires an explicit user allowlist"
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
  return {
    ok: true,
    enabled: state.enabled,
    userCount: state.allowlist.size,
    wildcardAllowed: false,
  };
}

function isExtraSelectionCanaryEnabledForUser(userId, env = process.env) {
  const userIdValue = String(userId || "").trim();
  if (!userIdValue) return false;
  const state = resolveExtraSelectionCanaryState(env);
  if (!state.enabled || state.wildcardPresent) return false;
  return isReadStackingEnabledForUser(userIdValue, env)
    && isWriteStackingEnabledForUser(userIdValue, env)
    && state.allowlist.has(userIdValue);
}

module.exports = {
  assertExtraSelectionCanaryConfiguration,
  assertSubscriptionStackingRolloutConfiguration,
  isExtraSelectionCanaryEnabledForUser,
  isReadStackingEnabledForUser,
  isUserAllowedForStacking,
  isWriteStackingEnabledForUser,
  parseIdAllowlist,
  resolveExtraSelectionCanaryState,
  resolveSubscriptionStackingRolloutState,
};
