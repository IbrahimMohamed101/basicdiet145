const { logger } = require("./logger");
const { assertNoTestFlagsInProduction, isTestAuthEnabled } = require("./security");

function addMissingIfEmpty(missing, key) {
  if (!process.env[key]) {
    missing.push(key);
  }
}

function addMissingBypassAware(missing, key, shouldRequire) {
  if (shouldRequire && !process.env[key]) {
    missing.push(key);
  }
}

function validateEnv() {
  const isTest = process.env.NODE_ENV === "test";
  const hasMongoUri = Boolean(process.env.MONGO_URI || process.env.MONGODB_URI);
  const hasTestMongoUri = Boolean(process.env.MONGO_URI_TEST);
  const isProduction = process.env.NODE_ENV === "production";

  /* ── PRODUCTION HARD FAIL: reject any test/bypass flags ───────────── */
  const securityCheck = assertNoTestFlagsInProduction();
  if (!securityCheck.ok) {
    for (const v of securityCheck.violations) {
      logger.error(`SECURITY: ${v}`);
    }
    return { ok: false, securityViolations: securityCheck.violations };
  }

  /* ── OTP provider requirement ─────────────────────────────────────── */
  const testAuthActive = isTestAuthEnabled();
  const shouldRequireOtpProvider = !testAuthActive;

  const cloudinaryKeys = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const providedCloudinaryKeys = cloudinaryKeys.filter((key) => Boolean(process.env[key]));

  const missing = [];
  if (isTest) {
    if (!hasTestMongoUri) missing.push("MONGO_URI_TEST");
  } else {
    if (!hasMongoUri) missing.push("MONGO_URI or MONGODB_URI");
  }
  addMissingIfEmpty(missing, "JWT_SECRET");
  addMissingIfEmpty(missing, "DASHBOARD_JWT_SECRET");
  addMissingIfEmpty(missing, "MOYASAR_SECRET_KEY");
  addMissingBypassAware(missing, "TWILIO_ACCOUNT_SID", shouldRequireOtpProvider);
  addMissingBypassAware(missing, "TWILIO_AUTH_TOKEN", shouldRequireOtpProvider);
  addMissingBypassAware(missing, "TWILIO_VERIFY_SERVICE_SID", shouldRequireOtpProvider);
  addMissingBypassAware(missing, "OTP_HASH_SECRET", shouldRequireOtpProvider);
  // Production: webhook secret is required so the webhook fails closed.
  addMissingBypassAware(missing, "MOYASAR_WEBHOOK_SECRET", isProduction);
  // Production: require at least one configured browser origin in addition to defaults.
  if (isProduction) {
    const corsOrigins = [
      ...(process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
      process.env.FRONTEND_URL,
      process.env.DASHBOARD_URL,
    ].filter(Boolean);
    if (corsOrigins.length === 0) missing.push("CORS_ORIGINS or FRONTEND_URL or DASHBOARD_URL");
  }
  if (providedCloudinaryKeys.length > 0 && providedCloudinaryKeys.length < cloudinaryKeys.length) {
    cloudinaryKeys
      .filter((key) => !process.env[key])
      .forEach((key) => missing.push(key));
  }

  if (missing.length) {
    logger.error("Missing required environment variables", { missing });
    return { ok: false, missing };
  }

  const mongoUri = isTest ? process.env.MONGO_URI_TEST : (process.env.MONGO_URI || process.env.MONGODB_URI);
  const isValidMongoUri = typeof mongoUri === "string" && /^mongodb(\+srv)?:\/\//.test(mongoUri);
  if (!isValidMongoUri) {
    logger.error("Invalid MongoDB URI: must start with mongodb:// or mongodb+srv://");
    const fieldName = isTest ? "MONGO_URI_TEST" : "MONGO_URI or MONGODB_URI";
    return { ok: false, invalid: [fieldName] };
  }

  const invalid = [];
  const otpTtlMinutes = Number(process.env.OTP_TTL_MINUTES || 5);
  if (!Number.isFinite(otpTtlMinutes) || otpTtlMinutes <= 0) invalid.push("OTP_TTL_MINUTES");
  const otpCooldownSeconds = Number(process.env.OTP_COOLDOWN_SECONDS || 30);
  if (!Number.isFinite(otpCooldownSeconds) || otpCooldownSeconds <= 0) invalid.push("OTP_COOLDOWN_SECONDS");
  const otpMaxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);
  if (!Number.isFinite(otpMaxAttempts) || otpMaxAttempts <= 0) invalid.push("OTP_MAX_ATTEMPTS");

  const otpWindowMs = Number(process.env.RATE_LIMIT_OTP_WINDOW_MS || 60 * 1000);
  if (!Number.isFinite(otpWindowMs) || otpWindowMs <= 0) invalid.push("RATE_LIMIT_OTP_WINDOW_MS");
  const otpMax = Number(process.env.RATE_LIMIT_OTP_MAX || 5);
  if (!Number.isFinite(otpMax) || otpMax <= 0) invalid.push("RATE_LIMIT_OTP_MAX");
  const otpVerifyWindowMs = Number(process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS || 60 * 1000);
  if (!Number.isFinite(otpVerifyWindowMs) || otpVerifyWindowMs <= 0) invalid.push("RATE_LIMIT_OTP_VERIFY_WINDOW_MS");
  const otpVerifyMax = Number(process.env.RATE_LIMIT_OTP_VERIFY_MAX || 10);
  if (!Number.isFinite(otpVerifyMax) || otpVerifyMax <= 0) invalid.push("RATE_LIMIT_OTP_VERIFY_MAX");
  const twilioVerifyServiceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();
  if (shouldRequireOtpProvider && !/^VA[a-f0-9]{32}$/i.test(twilioVerifyServiceSid)) {
    invalid.push("TWILIO_VERIFY_SERVICE_SID");
  }

  // Validate unified test OTP code if test mode is active
  if (testAuthActive) {
    const testOtpCode = String(process.env.OTP_TEST_CODE || "000000").trim();
    if (!/^\d{6}$/.test(testOtpCode)) invalid.push("OTP_TEST_CODE");

    const testOtpPhone = String(process.env.OTP_TEST_PHONE || "").trim();
    if (!testOtpPhone) invalid.push("OTP_TEST_PHONE");
    if (testOtpPhone && !/^\+[1-9]\d{7,14}$/.test(testOtpPhone)) invalid.push("OTP_TEST_PHONE");
  }

  const checkoutWindowMs = Number(process.env.RATE_LIMIT_CHECKOUT_WINDOW_MS || 5 * 60 * 1000);
  if (!Number.isFinite(checkoutWindowMs) || checkoutWindowMs <= 0) invalid.push("RATE_LIMIT_CHECKOUT_WINDOW_MS");
  const checkoutMax = Number(process.env.RATE_LIMIT_CHECKOUT_MAX || 20);
  if (!Number.isFinite(checkoutMax) || checkoutMax <= 0) invalid.push("RATE_LIMIT_CHECKOUT_MAX");

  const appAccessTokenTtl = process.env.APP_ACCESS_TOKEN_TTL;
  if (appAccessTokenTtl !== undefined && !String(appAccessTokenTtl).trim()) {
    invalid.push("APP_ACCESS_TOKEN_TTL");
  }
  const dashboardAccessTokenTtl = process.env.DASHBOARD_JWT_EXPIRES_IN;
  if (dashboardAccessTokenTtl !== undefined && !String(dashboardAccessTokenTtl).trim()) {
    invalid.push("DASHBOARD_JWT_EXPIRES_IN");
  }

  const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 10);
  if (!Number.isFinite(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 15) {
    invalid.push("BCRYPT_ROUNDS");
  }

  const dashboardLoginWindowMs = Number(process.env.RATE_LIMIT_DASHBOARD_LOGIN_WINDOW_MS || 15 * 60 * 1000);
  if (!Number.isFinite(dashboardLoginWindowMs) || dashboardLoginWindowMs <= 0) {
    invalid.push("RATE_LIMIT_DASHBOARD_LOGIN_WINDOW_MS");
  }
  const dashboardLoginMax = Number(process.env.RATE_LIMIT_DASHBOARD_LOGIN_MAX || 20);
  if (!Number.isFinite(dashboardLoginMax) || dashboardLoginMax <= 0) {
    invalid.push("RATE_LIMIT_DASHBOARD_LOGIN_MAX");
  }
  const accountDeletionWindowMs = Number(process.env.RATE_LIMIT_ACCOUNT_DELETION_WINDOW_MS || 15 * 60 * 1000);
  if (!Number.isFinite(accountDeletionWindowMs) || accountDeletionWindowMs <= 0) {
    invalid.push("RATE_LIMIT_ACCOUNT_DELETION_WINDOW_MS");
  }
  const accountDeletionMax = Number(process.env.RATE_LIMIT_ACCOUNT_DELETION_MAX || 5);
  if (!Number.isFinite(accountDeletionMax) || accountDeletionMax <= 0) {
    invalid.push("RATE_LIMIT_ACCOUNT_DELETION_MAX");
  }

  if (invalid.length) {
    logger.error("Invalid environment variable values", { invalid });
    return { ok: false, invalid };
  }

  return { ok: true };
}

module.exports = { validateEnv };
