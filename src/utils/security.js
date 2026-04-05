/**
 * @file security.js
 * @description Centralised security helpers for auth bypass gating,
 *              redirect URL validation, and log data sanitisation.
 *
 * DESIGN DECISIONS
 * ────────────────
 *  • OTP test mode is controlled by **two** explicit flags so it cannot
 *    be activated by a single accidental env var leak.
 *  • Every helper is a pure function (except env reads) so it is fully
 *    unit-testable with stubbed process.env.
 *  • `sanitizeLogData` creates a *shallow clone* with redacted values so
 *    the original object is never mutated.
 */

/* ── constants ────────────────────────────────────────────────────────── */

const SENSITIVE_LOG_KEYS = new Set([
  'password', 'token', 'authorization', 'otp', 'secret',
  'accesstoken', 'refreshtoken', 'jwt', 'apikey', 'api_key',
  'x-api-key', 'cookie', 'session', 'paymenturl', 'payment_url', 
  'invoiceurl', 'idempotencykey', 'idempotency_key', 'successurl', 
  'backurl', 'jwtsecret', 'authtoken', 'privatekey'
]);

const REDACTED = '[REDACTED]';

function sanitizeLogData(value, depth = 0) {
  // Prevent infinite recursion on circular references
  if (depth > 10) return value;

  // Handle arrays — recurse into each element
  if (Array.isArray(value)) {
    return value.map(item => sanitizeLogData(item, depth + 1));
  }

  // Handle plain objects — recurse into each key
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        // Case-insensitive key check
        const isKeyMatch = SENSITIVE_LOG_KEYS.has(k.toLowerCase());
        return [k, isKeyMatch ? REDACTED : sanitizeLogData(v, depth + 1)];
      })
    );
  }

  // Primitives — scan string values for Bearer tokens
  if (typeof value === 'string') {
    if (/^Bearer\s+\S+$/i.test(value)) return REDACTED;
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(value)) {
      return REDACTED; // looks like a JWT
    }
  }

  return value;
}

const WEAK_DEFAULT_PASSWORDS = new Set([
  "StrongPass123",
  "change_me",
  "CHANGE_ME",
  "password",
  "Password123",
  "admin123",
  "123456",
]);

const LEGACY_BYPASS_FLAGS = [
  "DEV_OTP_BYPASS",
  "TEST_OTP_BYPASS",
  "DEV_OTP_CODE",
  "TEST_OTP_CODE",
  "DEV_AUTH_BYPASS",
];

/* ── OTP test mode ────────────────────────────────────────────────────── */

function isUnifiedTestAuthEnabled() {
  return (
    process.env.OTP_TEST_MODE === "true" &&
    process.env.ALLOW_TEST_AUTH === "true"
  );
}

function isLegacyTestAuthEnabled() {
  return process.env.TEST_OTP_BYPASS === "true";
}

function isTestAuthEnabled() {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  // Keep supporting the old TEST_OTP_* envs in non-production so older
  // local .env files continue to work after the unified flag migration.
  return isUnifiedTestAuthEnabled() || isLegacyTestAuthEnabled();
}

function getTestOtpCode() {
  if (!isTestAuthEnabled()) return null;
  const code = String(process.env.OTP_TEST_CODE || process.env.TEST_OTP_CODE || "000000").trim();
  return /^\d{6}$/.test(code) ? code : "000000";
}

function getTestOtpPhone() {
  if (!isTestAuthEnabled()) return null;
  const phone = String(process.env.OTP_TEST_PHONE || process.env.TEST_OTP_PHONE || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

/* ── production startup assertions ────────────────────────────────────── */

function assertNoTestFlagsInProduction() {
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const violations = [];
  if (process.env.OTP_TEST_MODE === "true") {
    violations.push("OTP_TEST_MODE must not be 'true' in production");
  }
  if (process.env.ALLOW_TEST_AUTH === "true") {
    violations.push("ALLOW_TEST_AUTH must not be 'true' in production");
  }
  for (const flag of LEGACY_BYPASS_FLAGS) {
    if (process.env[flag] === "true") {
      violations.push(`Legacy flag ${flag} must not be set in production`);
    }
  }

  const dashboardPasswordKeys = [
    "DASHBOARD_DEFAULT_SUPERADMIN_PASSWORD",
    "DASHBOARD_DEFAULT_ADMIN_PASSWORD",
    "DASHBOARD_DEFAULT_KITCHEN_PASSWORD",
    "DASHBOARD_DEFAULT_COURIER_PASSWORD",
  ];
  for (const key of dashboardPasswordKeys) {
    const value = process.env[key];
    if (value && WEAK_DEFAULT_PASSWORDS.has(value)) {
      violations.push(`${key} uses a weak/default password in production`);
    }
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true };
}

/* ── redirect URL validation ──────────────────────────────────────────── */

function validateRedirectUrl(url, fallback) {
  if (!url || typeof url !== "string") return fallback;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return url;
    }
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      try {
        const appParsed = new URL(appUrl);
        if (parsed.origin === appParsed.origin) {
          return url;
        }
      } catch {}
    }
  } catch {}

  return fallback;
}

module.exports = {
  SENSITIVE_LOG_KEYS,
  REDACTED,
  WEAK_DEFAULT_PASSWORDS,
  LEGACY_BYPASS_FLAGS,
  isTestAuthEnabled,
  getTestOtpCode,
  getTestOtpPhone,
  assertNoTestFlagsInProduction,
  validateRedirectUrl,
  sanitizeLogData,
};
