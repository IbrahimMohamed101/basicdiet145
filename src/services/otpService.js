const crypto = require("crypto");
const Otp = require("../models/Otp");
const { sendWhatsappMessage } = require("./twilioWhatsappService");
const { ApiError } = require("../utils/apiError");
const { isTestAuthEnabled, getTestOtpCode, getTestOtpPhone } = require("../utils/security");
const { logger } = require("../utils/logger");

const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const OTP_CONTEXTS = new Set(["generic", "app_login", "app_register"]);

/* ── OTP configuration ────────────────────────────────────────────────── */

function getOtpConfig() {
  const ttlMinutes = Number(process.env.OTP_TTL_MINUTES) || 5;
  const cooldownSeconds = Number(process.env.OTP_COOLDOWN_SECONDS) || 30;
  const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
  return { ttlMinutes, cooldownSeconds, maxAttempts };
}

/* ── Unified OTP test mode ────────────────────────────────────────────── */

/**
 * Returns { code, phone } when the unified test auth mode is active
 * AND the target phone is allowed, or `null` otherwise.
 *
 * Test auth is only allowed when:
 *   OTP_TEST_MODE === "true" &&
 *   ALLOW_TEST_AUTH === "true" &&
 *   (NODE_ENV !== "production" || ALLOW_STAGING_TEST_AUTH === "true")
 * and only for the single configured OTP_TEST_PHONE.
 */
function resolveTestOtpForPhone(phoneE164) {
  if (!isTestAuthEnabled()) return null;

  const testCode = getTestOtpCode();
  if (!testCode) return null;

  const testPhone = getTestOtpPhone();
  if (!testPhone || testPhone !== phoneE164) return null;

  return { code: testCode };
}

function matchesConfiguredTestOtp(phoneE164, otp) {
  const testOtp = resolveTestOtpForPhone(phoneE164);
  if (!testOtp) return false;
  return testOtp.code === otp;
}

function logTestOtpUse(phoneE164, context) {
  logger.warn("⚠️ TEST OTP MODE ACTIVE (STAGING ONLY)", {
    phoneE164,
    context,
  });
}

/* ── normalisation helpers ────────────────────────────────────────────── */

function normalizePhoneE164(phoneE164) {
  return String(phoneE164 || "").trim();
}

function normalizeOtpContext(context) {
  const normalized = String(context || "").trim();
  return OTP_CONTEXTS.has(normalized) ? normalized : "generic";
}

function normalizePendingProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }

  const normalized = {};
  if (profile.fullName !== undefined) {
    const fullName = String(profile.fullName || "").trim();
    if (fullName) {
      normalized.fullName = fullName;
    }
  }

  if (profile.email !== undefined) {
    const email = profile.email === null ? null : String(profile.email || "").trim().toLowerCase();
    normalized.email = email || null;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function assertValidPhoneE164(phoneE164) {
  const normalized = normalizePhoneE164(phoneE164);
  if (!E164_REGEX.test(normalized)) {
    throw new ApiError({
      status: 400,
      code: "INVALID_PHONE",
      message: "phoneE164 must be a valid E.164 phone number",
    });
  }
  return normalized;
}

function assertValidOtpCode(otp) {
  const normalized = String(otp || "").trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new ApiError({
      status: 400,
      code: "INVALID_OTP_FORMAT",
      message: "OTP must be a 6 digit code",
    });
  }
  return normalized;
}

function generateOtpCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function hashOtp(phoneE164, otp) {
  const secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET || "otp-secret";
  return crypto.createHash("sha256").update(`${phoneE164}:${otp}:${secret}`).digest("hex");
}

/* ── core OTP operations ──────────────────────────────────────────────── */

async function requestOtpForPhone(phoneE164, options = {}) {
  const phone = assertValidPhoneE164(phoneE164);
  const { ttlMinutes, cooldownSeconds, maxAttempts } = getOtpConfig();
  const now = new Date();
  const testOtp = resolveTestOtpForPhone(phone);
  const useTestMode = Boolean(testOtp);
  const context = normalizeOtpContext(options.context);
  const pendingProfile = normalizePendingProfile(options.pendingProfile);

  const existing = await Otp.findOne({ phone });
  if (!useTestMode && existing && existing.lastSentAt) {
    const nextAllowedAt = existing.lastSentAt.getTime() + cooldownSeconds * 1000;
    if (nextAllowedAt > now.getTime()) {
      const secondsRemaining = Math.ceil((nextAllowedAt - now.getTime()) / 1000);
      throw new ApiError({
        status: 429,
        code: "OTP_COOLDOWN",
        message: `Please wait ${secondsRemaining}s before requesting a new OTP`,
        details: { cooldownSecondsRemaining: secondsRemaining },
      });
    }
  }

  const otp = useTestMode ? testOtp.code : generateOtpCode();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  if (useTestMode) {
    logTestOtpUse(phone, "request");
  }

  if (!useTestMode) {
    await sendWhatsappMessage({
      toPhoneE164: phone,
      body: `Your BasicDiet OTP is ${otp}. It expires in ${ttlMinutes} minutes.`,
    });
  }

  const setPayload = {
    phone,
    codeHash: hashOtp(phone, otp),
    expiresAt,
    attemptsLeft: maxAttempts,
    lastSentAt: now,
    context,
  };

  if (pendingProfile) {
    setPayload.pendingProfile = pendingProfile;
    await Otp.findOneAndUpdate(
      { phone },
      { $set: setPayload },
      { upsert: true, setDefaultsOnInsert: true }
    );
    return;
  }

  await Otp.findOneAndUpdate(
    { phone },
    { $set: setPayload, $unset: { pendingProfile: 1 } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function verifyOtpCode({ phoneE164, otp }) {
  const phone = assertValidPhoneE164(phoneE164);
  const code = assertValidOtpCode(otp);

  const otpRecord = await Otp.findOne({ phone });
  if (!otpRecord && matchesConfiguredTestOtp(phone, code)) {
    logTestOtpUse(phone, "verify");
    return { phone, context: "generic", pendingProfile: null };
  }
  if (!otpRecord) {
    throw new ApiError({
      status: 400,
      code: "OTP_NOT_FOUND",
      message: "No OTP request found for this phone number",
    });
  }

  const now = new Date();
  if (otpRecord.expiresAt.getTime() <= now.getTime()) {
    await Otp.deleteOne({ _id: otpRecord._id });
    throw new ApiError({
      status: 400,
      code: "OTP_EXPIRED",
      message: "OTP has expired. Please request a new one",
    });
  }

  if (otpRecord.attemptsLeft <= 0) {
    await Otp.deleteOne({ _id: otpRecord._id });
    throw new ApiError({
      status: 429,
      code: "OTP_ATTEMPTS_EXCEEDED",
      message: "OTP attempts exceeded. Please request a new OTP",
    });
  }

  const candidateHash = hashOtp(phone, code);
  if (candidateHash !== otpRecord.codeHash) {
    if (matchesConfiguredTestOtp(phone, code)) {
      logTestOtpUse(phone, "verify");
      const context = normalizeOtpContext(otpRecord.context);
      const pendingProfile = normalizePendingProfile(otpRecord.pendingProfile);
      await Otp.deleteOne({ _id: otpRecord._id });
      return { phone, context, pendingProfile };
    }

    const attemptsLeft = Math.max(otpRecord.attemptsLeft - 1, 0);
    if (attemptsLeft === 0) {
      await Otp.deleteOne({ _id: otpRecord._id });
    } else {
      otpRecord.attemptsLeft = attemptsLeft;
      await otpRecord.save();
    }

    throw new ApiError({
      status: 401,
      code: "INVALID_OTP",
      message: "Invalid OTP",
      details: { attemptsLeft },
    });
  }

  const context = normalizeOtpContext(otpRecord.context);
  const pendingProfile = normalizePendingProfile(otpRecord.pendingProfile);
  await Otp.deleteOne({ _id: otpRecord._id });
  return { phone, context, pendingProfile };
}

module.exports = {
  assertValidPhoneE164,
  normalizePhoneE164,
  requestOtpForPhone,
  verifyOtpCode,
};
