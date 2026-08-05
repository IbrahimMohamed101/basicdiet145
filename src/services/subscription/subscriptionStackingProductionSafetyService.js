"use strict";

function isEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function assertSubscriptionStackingProductionSafety(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
  const writeEnabled = isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED);

  if (nodeEnv === "production" && writeEnabled) {
    const err = new Error(
      "Subscription stacking writes are not production-ready and must remain disabled"
    );
    err.code = "SUBSCRIPTION_STACKING_PRODUCTION_WRITE_BLOCKED";
    err.details = {
      nodeEnv,
      writeEnabled,
      requiredValue: "SUBSCRIPTION_STACKING_WRITE_ENABLED=false",
    };
    throw err;
  }

  return {
    ok: true,
    nodeEnv,
    writeEnabled,
    productionWriteBlocked: true,
  };
}

module.exports = {
  assertSubscriptionStackingProductionSafety,
};
