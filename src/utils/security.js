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

const DEFAULT_MOBILE_REDIRECT_SCHEMES = ["basicdiet"];

function parseAllowedMobileRedirectSchemes() {
  const raw = String(process.env.MOBILE_REDIRECT_SCHEMES || "").trim();
  if (!raw) {
    return new Set(DEFAULT_MOBILE_REDIRECT_SCHEMES);
  }
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isLocalHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function isAllowedMobileRedirectScheme(protocol) {
  const scheme = String(protocol || "").trim().toLowerCase().replace(/:$/, "");
  if (!scheme) return false;
  return parseAllowedMobileRedirectSchemes().has(scheme);
}

function isValidClientRedirectUrl(parsedUrl) {
  if (!parsedUrl || typeof parsedUrl !== "object") return false;
  const protocol = String(parsedUrl.protocol || "").toLowerCase();
  if (protocol === "https:") {
    return true;
  }
  if (isAllowedMobileRedirectScheme(protocol)) {
    return true;
  }
  if (process.env.NODE_ENV !== "production" && protocol === "http:" && isLocalHostname(parsedUrl.hostname)) {
    return true;
  }
  return false;
}

function resolveSafeAppOrigin() {
  const raw = String(process.env.APP_URL || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (String(parsed.protocol || "").toLowerCase() !== "https:") {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

function buildSafeFallbackRedirect(fallback) {
  const fallbackValue = String(fallback || "").trim();
  if (!fallbackValue) {
    return "https://example.com/payments/success";
  }
  try {
    const parsedFallback = new URL(fallbackValue);
    if (isValidClientRedirectUrl(parsedFallback)) {
      return fallbackValue;
    }

    // Never return localhost/http fallback in production.
    const safeOrigin = resolveSafeAppOrigin();
    if (safeOrigin) {
      return `${safeOrigin}${parsedFallback.pathname || "/payments/success"}${parsedFallback.search || ""}`;
    }
  } catch {
    // Invalid fallback URL; continue to hard fallback.
  }
  return "https://example.com/payments/success";
}

/* ── OTP test mode ────────────────────────────────────────────────────── */

function isStagingTestAuthAllowed() {
  return process.env.ALLOW_STAGING_TEST_AUTH === "true";
}

function hasRequiredTestAuthFlags() {
  return (
    process.env.OTP_TEST_MODE === "true" &&
    process.env.ALLOW_TEST_AUTH === "true"
  );
}

function isTestAuthEnabled() {
  return (
    hasRequiredTestAuthFlags() &&
    (
      process.env.NODE_ENV !== "production" ||
      isStagingTestAuthAllowed()
    )
  );
}

function getTestOtpCode() {
  if (!isTestAuthEnabled()) return null;
  const code = String(process.env.OTP_TEST_CODE || "").trim();
  return /^\d{6}$/.test(code) ? code : "000000";
}

function getTestOtpPhone() {
  if (!isTestAuthEnabled()) return null;
  const phone = String(process.env.OTP_TEST_PHONE || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

/* ── production startup assertions ────────────────────────────────────── */

function assertNoTestFlagsInProduction() {
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const violations = [];
  const stagingAllowed = isStagingTestAuthAllowed();
  if (!stagingAllowed && process.env.OTP_TEST_MODE === "true") {
    violations.push("OTP_TEST_MODE must not be 'true' in production without ALLOW_STAGING_TEST_AUTH");
  }
  if (!stagingAllowed && process.env.ALLOW_TEST_AUTH === "true") {
    violations.push("ALLOW_TEST_AUTH must not be 'true' in production without ALLOW_STAGING_TEST_AUTH");
  }

  for (const flag of LEGACY_BYPASS_FLAGS) {
    if (process.env[flag]) {
      violations.push(`Legacy flag ${flag} must not be set in production`);
    }
  }

  if (isTestAuthEnabled()) {
    const testCode = String(process.env.OTP_TEST_CODE || "").trim();
    if (!/^\d{6}$/.test(testCode)) {
      violations.push("Staging test auth requires a valid 6-digit OTP_TEST_CODE");
    }

    const testPhone = String(process.env.OTP_TEST_PHONE || "").trim();
    if (!/^\+[1-9]\d{7,14}$/.test(testPhone)) {
      violations.push("Staging test auth requires a valid OTP_TEST_PHONE");
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

  const appUrl = String(process.env.APP_URL || "").trim();
  if (!appUrl) {
    violations.push("APP_URL must be set in production");
  } else {
    try {
      const parsedAppUrl = new URL(appUrl);
      if (String(parsedAppUrl.protocol || "").toLowerCase() !== "https:") {
        violations.push("APP_URL must use HTTPS in production");
      }
      if (isLocalHostname(parsedAppUrl.hostname)) {
        violations.push("APP_URL must not point to localhost in production");
      }
    } catch {
      violations.push("APP_URL must be a valid absolute URL in production");
    }
  }

  return violations.length > 0 ? { ok: false, violations } : { ok: true };
}

/* ── redirect URL validation ──────────────────────────────────────────── */

function validateRedirectUrl(url, fallback) {
  if (url && typeof url === "string") {
    try {
      const parsed = new URL(url);
      if (isValidClientRedirectUrl(parsed)) {
        return url;
      }
    } catch {
      // Invalid client-provided URL; fall back below.
    }
  }

  return buildSafeFallbackRedirect(fallback);
}

module.exports = {
  SENSITIVE_LOG_KEYS,
  REDACTED,
  WEAK_DEFAULT_PASSWORDS,
  LEGACY_BYPASS_FLAGS,
  isTestAuthEnabled,
  isStagingTestAuthAllowed,
  getTestOtpCode,
  getTestOtpPhone,
  assertNoTestFlagsInProduction,
  validateRedirectUrl,
  sanitizeLogData,
};
