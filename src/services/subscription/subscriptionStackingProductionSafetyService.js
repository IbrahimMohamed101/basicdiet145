"use strict";

function isEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function normalizeEnvironmentName(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveProductionEnvironment(env = process.env) {
  const candidates = [
    ["NODE_ENV", env.NODE_ENV],
    ["APP_ENV", env.APP_ENV],
    ["ENVIRONMENT", env.ENVIRONMENT],
    ["DEPLOY_ENV", env.DEPLOY_ENV],
    ["RAILWAY_ENVIRONMENT_NAME", env.RAILWAY_ENVIRONMENT_NAME],
  ];
  const productionNames = new Set(["production", "prod", "live"]);
  const match = candidates.find(([, value]) => productionNames.has(normalizeEnvironmentName(value)));
  return {
    production: Boolean(match),
    source: match ? match[0] : "",
    value: match ? normalizeEnvironmentName(match[1]) : "",
    nodeEnv: normalizeEnvironmentName(env.NODE_ENV || "development"),
  };
}

const PRODUCTION_ROLLOUT_FLAG_NAMES = Object.freeze([
  "SUBSCRIPTION_STACKING_SHADOW_ENABLED",
  "SUBSCRIPTION_STACKING_READ_ENABLED",
  "SUBSCRIPTION_STACKING_WRITE_ENABLED",
  "SUBSCRIPTION_STACKING_ALLOW_ALL_USERS",
  "SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED",
  "SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED",
]);

function resolveProductionRolloutState(env = process.env) {
  const environment = resolveProductionEnvironment(env);
  const confirmationProvided = isEnabled(
    env.SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED
  );
  const missingEnabledFlags = PRODUCTION_ROLLOUT_FLAG_NAMES.filter(
    (name) => !isEnabled(env[name])
  );
  return {
    production: environment.production,
    confirmationProvided,
    missingEnabledFlags,
    enabled: environment.production
      && confirmationProvided
      && missingEnabledFlags.length === 0,
  };
}

function isProductionStackingRolloutConfirmed(env = process.env) {
  return resolveProductionRolloutState(env).enabled;
}

function assertSubscriptionStackingProductionSafety(env = process.env) {
  const environment = resolveProductionEnvironment(env);
  const productionRollout = resolveProductionRolloutState(env);
  const shadowEnabled = isEnabled(env.SUBSCRIPTION_STACKING_SHADOW_ENABLED);
  const readEnabled = isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED);
  const writeEnabled = isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED);
  const extraActivationEnabled = isEnabled(
    env.SUBSCRIPTION_STACKING_EXTRA_ACTIVATION_ENABLED
  );
  const extraSelectionEnabled = isEnabled(
    env.SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED
  );

  const enabledModes = [
    shadowEnabled ? "shadow" : null,
    readEnabled ? "read" : null,
    writeEnabled ? "write" : null,
    extraActivationEnabled ? "extra_activation" : null,
    extraSelectionEnabled ? "extra_selection" : null,
  ].filter(Boolean);

  if (
    environment.production
    && (enabledModes.length > 0 || productionRollout.confirmationProvided)
    && !productionRollout.enabled
  ) {
    const err = new Error(
      productionRollout.confirmationProvided
        ? "Production stacking confirmation requires the complete global rollout configuration"
        : "Production stacking rollout requires explicit production confirmation"
    );
    err.code = productionRollout.confirmationProvided
      ? "SUBSCRIPTION_STACKING_PRODUCTION_GLOBAL_FLAGS_REQUIRED"
      : "SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMATION_REQUIRED";
    err.details = {
      environmentSource: environment.source,
      environmentValue: environment.value,
      enabledModes,
      missingEnabledFlags: productionRollout.missingEnabledFlags,
      requiredValues: {
        SUBSCRIPTION_STACKING_PRODUCTION_CONFIRMED: "true",
        ...Object.fromEntries(
          PRODUCTION_ROLLOUT_FLAG_NAMES.map((name) => [name, "true"])
        ),
      },
    };
    throw err;
  }

  return {
    ok: true,
    nodeEnv: environment.nodeEnv,
    productionEnvironment: environment.production,
    shadowEnabled,
    readEnabled,
    writeEnabled,
    extraActivationEnabled,
    extraSelectionEnabled,
    productionRolloutConfirmed: productionRollout.confirmationProvided,
    productionRolloutEnabled: productionRollout.enabled,
    productionRolloutBlocked: environment.production && !productionRollout.enabled,
  };
}

module.exports = {
  assertSubscriptionStackingProductionSafety,
  isProductionStackingRolloutConfirmed,
  PRODUCTION_ROLLOUT_FLAG_NAMES,
  resolveProductionEnvironment,
  resolveProductionRolloutState,
};
