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

function assertSubscriptionStackingProductionSafety(env = process.env) {
  const environment = resolveProductionEnvironment(env);
  const shadowEnabled = isEnabled(env.SUBSCRIPTION_STACKING_SHADOW_ENABLED);
  const readEnabled = isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED);
  const writeEnabled = isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED);
  const extraSelectionEnabled = isEnabled(
    env.SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED
  );

  if (
    environment.production
    && (shadowEnabled || readEnabled || writeEnabled || extraSelectionEnabled)
  ) {
    const enabledModes = [
      shadowEnabled ? "shadow" : null,
      readEnabled ? "read" : null,
      writeEnabled ? "write" : null,
      extraSelectionEnabled ? "extra_selection" : null,
    ].filter(Boolean);
    const err = new Error(
      "Subscription stacking is not production-ready and all rollout modes must remain disabled"
    );
    err.code = extraSelectionEnabled
      ? "SUBSCRIPTION_STACKING_PRODUCTION_EXTRA_SELECTION_BLOCKED"
      : writeEnabled
      ? "SUBSCRIPTION_STACKING_PRODUCTION_WRITE_BLOCKED"
      : (readEnabled
        ? "SUBSCRIPTION_STACKING_PRODUCTION_READ_BLOCKED"
        : "SUBSCRIPTION_STACKING_PRODUCTION_SHADOW_BLOCKED");
    err.details = {
      environmentSource: environment.source,
      environmentValue: environment.value,
      enabledModes,
      requiredValues: {
        SUBSCRIPTION_STACKING_SHADOW_ENABLED: "false",
        SUBSCRIPTION_STACKING_READ_ENABLED: "false",
        SUBSCRIPTION_STACKING_WRITE_ENABLED: "false",
        SUBSCRIPTION_STACKING_EXTRA_SELECTION_ENABLED: "false",
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
    extraSelectionEnabled,
    productionRolloutBlocked: true,
  };
}

module.exports = {
  assertSubscriptionStackingProductionSafety,
  resolveProductionEnvironment,
};
