"use strict";

const { URL } = require("url");

const PRODUCTION_HOSTS = new Set([
  "basicdiet145-production-51e9.up.railway.app",
  "clientdashbourd-production.up.railway.app",
]);
const SAFE_PAYMENT_MODES = new Set(["sandbox", "mock", "test"]);

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
  try {
    const withoutQuery = raw.split("?")[0];
    const databaseName = withoutQuery.split("/").pop() || "";
    const atIndex = withoutQuery.lastIndexOf("@");
    const hostAndPath = atIndex >= 0
      ? withoutQuery.slice(atIndex + 1)
      : withoutQuery.replace(/^mongodb(?:\+srv)?:\/\//, "");
    const host = (hostAndPath.split("/")[0] || "").toLowerCase();
    return {
      host,
      databaseName,
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
  const wildcardWriteOverride = isEnabled(env.SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE);
  const readUsers = parseCsv(env.SUBSCRIPTION_STACKING_READ_USER_IDS);
  const writeUsers = parseCsv(env.SUBSCRIPTION_STACKING_WRITE_USER_IDS);
  const shadowUsers = parseCsv(env.SUBSCRIPTION_STACKING_SHADOW_USER_IDS);
  const mongoIdentity = safeMongoIdentity(env.MONGODB_URI || env.MONGO_URI);

  if (PRODUCTION_HOSTS.has(hostname)) {
    violations.push({
      code: "PRODUCTION_HOST_FORBIDDEN",
      field: "STAGING_BASE_URL",
      value: hostname,
    });
  }
  if (nodeEnv === "production") {
    violations.push({
      code: "PRODUCTION_NODE_ENV_FORBIDDEN",
      field: "NODE_ENV",
      value: nodeEnv,
    });
  }
  if (!SAFE_PAYMENT_MODES.has(paymentMode)) {
    violations.push({
      code: "UNSAFE_PAYMENT_MODE",
      field: "STAGING_PAYMENT_MODE",
      allowed: Array.from(SAFE_PAYMENT_MODES),
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
  if (writeEnabled && writeUsers.length !== 1) {
    violations.push({
      code: "INITIAL_WRITE_REQUIRES_EXACTLY_ONE_USER",
      field: "SUBSCRIPTION_STACKING_WRITE_USER_IDS",
      count: writeUsers.length,
    });
  }
  if (writeUsers.includes("*") || readUsers.includes("*") || shadowUsers.includes("*")) {
    violations.push({
      code: "WILDCARD_ROLLOUT_FORBIDDEN",
      fields: [
        "SUBSCRIPTION_STACKING_SHADOW_USER_IDS",
        "SUBSCRIPTION_STACKING_READ_USER_IDS",
        "SUBSCRIPTION_STACKING_WRITE_USER_IDS",
      ],
    });
  }
  if (wildcardWriteOverride) {
    violations.push({
      code: "WILDCARD_WRITE_OVERRIDE_FORBIDDEN",
      field: "SUBSCRIPTION_STACKING_ALLOW_WILDCARD_WRITE",
    });
  }
  if (writeEnabled) {
    const writeUser = writeUsers[0];
    if (!readUsers.includes(writeUser)) {
      violations.push({
        code: "WRITE_USER_MISSING_FROM_READ_ALLOWLIST",
        userId: writeUser,
      });
    }
    if (!shadowUsers.includes(writeUser)) {
      violations.push({
        code: "WRITE_USER_MISSING_FROM_SHADOW_ALLOWLIST",
        userId: writeUser,
      });
    }
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
    shadowEnabled,
    readEnabled,
    writeEnabled,
    rolloutUserCount: writeUsers.length,
    rolloutUserId: writeUsers[0] || null,
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
  parseCsv,
  safeMongoIdentity,
  validateSubscriptionStackingStagingEnv,
};
