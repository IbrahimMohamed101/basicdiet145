"use strict";

const { URL } = require("url");

const PRODUCTION_HOSTS = new Set([
  "basicdiet145-production-51e9.up.railway.app",
  "clientdashbourd-production.up.railway.app",
]);
const SAFE_PAYMENT_MODES = new Set(["sandbox", "mock", "test"]);
const PRODUCTION_ENVIRONMENT_NAMES = new Set(["production", "prod", "live"]);
const SAFE_STAGING_DATABASE_NAME = /^[A-Za-z0-9_-]+$/;
const UNUSED_ROLLOUT_VARIABLES = [
  "SUBSCRIPTION_STACKING_READ_USER_IDS",
  "SUBSCRIPTION_STACKING_WRITE_USER_IDS",
  "SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE",
];

function isEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function parseCsv(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function parseUrl(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) {
    const err = new Error(`${fieldName} is required`);
    err.code = "STACKING_STAGING_URL_REQUIRED";
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_err) {
    const err = new Error(`${fieldName} must be a valid URL`);
    err.code = "STACKING_STAGING_URL_INVALID";
    throw err;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    const err = new Error(`${fieldName} must use http or https`);
    err.code = "STACKING_STAGING_URL_PROTOCOL_INVALID";
    throw err;
  }
  return parsed;
}

function safeMongoIdentity(uri) {
  const raw = String(uri || "").trim();
  if (!raw) return null;

  const schemeMatch = raw.match(/^mongodb(?:\+srv)?:\/\/(.+)$/i);
  if (!schemeMatch) return null;

  try {
    const remainder = schemeMatch[1];
    const slashIndex = remainder.indexOf("/");
    const authority = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
    const pathAndQuery = slashIndex >= 0 ? remainder.slice(slashIndex + 1) : "";

    const atIndex = authority.lastIndexOf("@");
    const host = (atIndex >= 0 ? authority.slice(atIndex + 1) : authority)
      .trim()
      .toLowerCase();

    if (!host || /\s/.test(host)) return null;

    const encodedDatabaseName = pathAndQuery.split("?")[0].split("#")[0];
    let databaseName = "";
    try {
      databaseName = decodeURIComponent(encodedDatabaseName).trim();
    } catch (_err) {
      return null;
    }

    if (databaseName && !SAFE_STAGING_DATABASE_NAME.test(databaseName)) {
      return {
        host,
        databaseName: "",
        databaseNameValid: false,
        fingerprint: `${host}/<invalid>`,
      };
    }

    return {
      host,
      databaseName,
      databaseNameValid: true,
      fingerprint: `${host}/${databaseName}`,
    };
  } catch (_err) {
    return null;
  }
}

function createValidationError(violations, summary) {
  const err = new Error(summary || "Subscription stacking staging environment is unsafe");
  err.code = "SUBSCRIPTION_STACKING_STAGING_ENV_UNSAFE";
  err.violations = violations;
  return err;
}

function resolveProductionLikeEnvironment(env) {
  const candidates = [
    ["NODE_ENV", env.NODE_ENV],
    ["APP_ENV", env.APP_ENV],
    ["ENVIRONMENT", env.ENVIRONMENT],
    ["DEPLOY_ENV", env.DEPLOY_ENV],
    ["RAILWAY_ENVIRONMENT_NAME", env.RAILWAY_ENVIRONMENT_NAME],
  ];
  return candidates.find(([, value]) => (
    PRODUCTION_ENVIRONMENT_NAMES.has(String(value || "").trim().toLowerCase())
  )) || null;
}

function validateSubscriptionStackingStagingEnv(env = process.env) {
  const violations = [];
  const warnings = [];
  const baseUrl = parseUrl(env.STAGING_BASE_URL, "STAGING_BASE_URL");
  const hostname = baseUrl.hostname.toLowerCase();
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  const paymentMode = String(env.STAGING_PAYMENT_MODE || "").trim().toLowerCase();
  const readEnabled = isEnabled(env.SUBSCRIPTION_STACKING_READ_ENABLED);
  const writeEnabled = isEnabled(env.SUBSCRIPTION_STACKING_WRITE_ENABLED);
  const shadowEnabled = isEnabled(env.SUBSCRIPTION_STACKING_SHADOW_ENABLED);
  const allowAllUsers = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS);
  const rolloutUsers = parseCsv(env.SUBSCRIPTION_STACKING_USER_IDS);
  const shadowUsers = parseCsv(env.SUBSCRIPTION_STACKING_SHADOW_USER_IDS);
  const mongoIdentity = safeMongoIdentity(env.MONGODB_URI || env.MONGO_URI);
  const productionEnvironment = resolveProductionLikeEnvironment(env);
  const databaseIsolationConfirmed = isEnabled(env.STAGING_DATABASE_ISOLATION_CONFIRMED);
  const paymentSandboxConfirmed = isEnabled(env.STAGING_PAYMENT_SANDBOX_CONFIRMED);
  const unusedConfiguredVariables = UNUSED_ROLLOUT_VARIABLES.filter((name) => (
    String(env[name] || "").trim() !== ""
  ));

  if (
    PRODUCTION_HOSTS.has(hostname)
    || hostname.includes("production")
    || hostname.startsWith("prod.")
    || hostname.includes("-prod.")
  ) {
    violations.push({
      code: "PRODUCTION_HOST_FORBIDDEN",
      field: "STAGING_BASE_URL",
      value: hostname,
    });
  }
  if (productionEnvironment) {
    violations.push({
      code: "PRODUCTION_ENVIRONMENT_FORBIDDEN",
      field: productionEnvironment[0],
      value: String(productionEnvironment[1] || "").trim().toLowerCase(),
    });
  }
  if (!SAFE_PAYMENT_MODES.has(paymentMode)) {
    violations.push({
      code: "UNSAFE_PAYMENT_MODE",
      field: "STAGING_PAYMENT_MODE",
      allowed: Array.from(SAFE_PAYMENT_MODES),
    });
  }
  if (!databaseIsolationConfirmed) {
    violations.push({
      code: "DATABASE_ISOLATION_CONFIRMATION_REQUIRED",
      field: "STAGING_DATABASE_ISOLATION_CONFIRMED",
    });
  }
  if (writeEnabled && !paymentSandboxConfirmed) {
    violations.push({
      code: "PAYMENT_SANDBOX_CONFIRMATION_REQUIRED",
      field: "STAGING_PAYMENT_SANDBOX_CONFIRMED",
    });
  }
  if (!env.MONGODB_URI && !env.MONGO_URI) {
    violations.push({
      code: "STAGING_DATABASE_URI_REQUIRED",
      field: "MONGODB_URI",
    });
  }
  if (!mongoIdentity) {
    violations.push({
      code: "STAGING_DATABASE_URI_INVALID",
      field: "MONGODB_URI",
    });
  } else if (!mongoIdentity.databaseNameValid) {
    violations.push({
      code: "STAGING_DATABASE_NAME_INVALID",
      field: "MONGODB_URI",
    });
  } else {
    const databaseName = String(mongoIdentity.databaseName || "").toLowerCase();
    if (!databaseName) {
      violations.push({
        code: "STAGING_DATABASE_NAME_REQUIRED",
        field: "MONGODB_URI",
      });
    }
    if (["production", "prod", "basicdiet", "basicdiet145"].includes(databaseName)) {
      violations.push({
        code: "PRODUCTION_LIKE_DATABASE_NAME_FORBIDDEN",
        field: "MONGODB_URI",
        databaseName,
      });
    }
  }

  if (unusedConfiguredVariables.length > 0) {
    violations.push({
      code: "UNUSED_ROLLOUT_VARIABLES_CONFIGURED",
      fields: unusedConfiguredVariables,
      requiredRuntimeVariables: [
        "SUBSCRIPTION_STACKING_USER_IDS",
        "SUBSCRIPTION_STACKING_SHADOW_USER_IDS",
        "SUBSCRIPTION_STACKING_ALLOW_ALL_USERS",
      ],
    });
  }
  if (writeEnabled && !readEnabled) {
    violations.push({
      code: "WRITE_REQUIRES_READ",
      field: "SUBSCRIPTION_STACKING_READ_ENABLED",
    });
  }
  if (writeEnabled && !shadowEnabled) {
    violations.push({
      code: "WRITE_REQUIRES_SHADOW",
      field: "SUBSCRIPTION_STACKING_SHADOW_ENABLED",
    });
  }
  if ((readEnabled || writeEnabled) && !allowAllUsers && rolloutUsers.length === 0) {
    violations.push({
      code: "ROLLOUT_ALLOWLIST_REQUIRED",
      field: "SUBSCRIPTION_STACKING_USER_IDS",
    });
  }
  if (shadowEnabled && !allowAllUsers && shadowUsers.length === 0) {
    violations.push({
      code: "SHADOW_ALLOWLIST_REQUIRED",
      field: "SUBSCRIPTION_STACKING_SHADOW_USER_IDS",
    });
  }
  if (writeEnabled && !allowAllUsers && rolloutUsers.length !== 1) {
    violations.push({
      code: "INITIAL_WRITE_REQUIRES_EXACTLY_ONE_USER",
      field: "SUBSCRIPTION_STACKING_USER_IDS",
      count: rolloutUsers.length,
    });
  }
  if (!allowAllUsers && (rolloutUsers.includes("*") || shadowUsers.includes("*"))) {
    violations.push({
      code: "WILDCARD_ROLLOUT_FORBIDDEN",
      fields: [
        "SUBSCRIPTION_STACKING_SHADOW_USER_IDS",
        "SUBSCRIPTION_STACKING_USER_IDS",
      ],
    });
  }
  if (
    writeEnabled
    && !allowAllUsers
    && rolloutUsers.length === 1
    && !shadowUsers.includes(rolloutUsers[0])
  ) {
    violations.push({
      code: "ROLLOUT_USER_MISSING_FROM_SHADOW_ALLOWLIST",
      userId: rolloutUsers[0],
    });
  }

  if (baseUrl.protocol !== "https:") {
    warnings.push({
      code: "NON_HTTPS_STAGING_URL",
      field: "STAGING_BASE_URL",
    });
  }
  if (paymentMode === "test") {
    warnings.push({
      code: "VERIFY_TEST_MODE_IS_PROVIDER_SANDBOX",
      field: "STAGING_PAYMENT_MODE",
    });
  }

  if (violations.length > 0) {
    throw createValidationError(
      violations,
      `Unsafe subscription stacking staging environment (${violations.length} violation(s))`
    );
  }

  return {
    ok: true,
    nodeEnv,
    baseUrl: `${baseUrl.protocol}//${hostname}`,
    paymentMode,
    databaseIsolationConfirmed,
    paymentSandboxConfirmed,
    shadowEnabled,
    readEnabled,
    writeEnabled,
    rolloutMode: allowAllUsers ? "global" : "canary",
    allowAllUsers,
    rolloutUserCount: rolloutUsers.length,
    rolloutUserId: rolloutUsers.length === 1 ? rolloutUsers[0] : null,
    shadowUserCount: shadowUsers.length,
    database: mongoIdentity
      ? {
        host: mongoIdentity.host,
        databaseName: mongoIdentity.databaseName,
        fingerprint: mongoIdentity.fingerprint,
      }
      : null,
    warnings,
  };
}

function runCli() {
  try {
    const result = validateSubscriptionStackingStagingEnv(process.env);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    const safeOutput = {
      ok: false,
      code: err && err.code || "SUBSCRIPTION_STACKING_STAGING_ENV_UNSAFE",
      message: err && err.message || "Unsafe staging environment",
      violations: Array.isArray(err && err.violations) ? err.violations : [],
    };
    process.stderr.write(`${JSON.stringify(safeOutput, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  PRODUCTION_HOSTS,
  SAFE_PAYMENT_MODES,
  SAFE_STAGING_DATABASE_NAME,
  UNUSED_ROLLOUT_VARIABLES,
  parseCsv,
  resolveProductionLikeEnvironment,
  safeMongoIdentity,
  validateSubscriptionStackingStagingEnv,
};
