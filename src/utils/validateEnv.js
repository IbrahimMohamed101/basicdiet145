const { logger } = require("./logger");

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
  const hasMongoUri = Boolean(process.env.MONGO_URI || process.env.MONGODB_URI);
  const isProduction = process.env.NODE_ENV === "production";
  const devAuthBypass = process.env.DEV_AUTH_BYPASS === "true";
  const shouldRequireOtpProvider = isProduction || !devAuthBypass;
  const missing = [];
  if (!hasMongoUri) missing.push("MONGO_URI or MONGODB_URI");
  addMissingIfEmpty(missing, "JWT_SECRET");
  addMissingIfEmpty(missing, "DASHBOARD_JWT_SECRET");
  addMissingBypassAware(missing, "TWILIO_ACCOUNT_SID", shouldRequireOtpProvider);
  addMissingBypassAware(missing, "TWILIO_AUTH_TOKEN", shouldRequireOtpProvider);
  addMissingBypassAware(missing, "TWILIO_WHATSAPP_FROM", shouldRequireOtpProvider);
  addMissingBypassAware(missing, "OTP_HASH_SECRET", shouldRequireOtpProvider);

  if (missing.length) {
    logger.error("Missing required environment variables", { missing });
    return { ok: false, missing };
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  const isValidMongoUri = typeof mongoUri === "string" && /^mongodb(\+srv)?:\/\//.test(mongoUri);
  if (!isValidMongoUri) {
    logger.error("Invalid MongoDB URI: must start with mongodb:// or mongodb+srv://");
    return { ok: false, invalid: ["MONGO_URI or MONGODB_URI"] };
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

  if (invalid.length) {
    logger.error("Invalid environment variable values", { invalid });
    return { ok: false, invalid };
  }

  return { ok: true };
}

module.exports = { validateEnv };
