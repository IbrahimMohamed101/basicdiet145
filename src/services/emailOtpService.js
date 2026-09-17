const crypto = require("crypto");
const EmailOtpChallenge = require("../models/EmailOtpChallenge");
const { sendEmailOtp, getGmailConfig } = require("./gmailEmailService");
const { ApiError } = require("../utils/apiError");
const { logger } = require("../utils/logger");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PURPOSES = new Set(["registration", "verify_existing_email", "password_reset"]);

function isEmailOtpEnabled() {
  return String(process.env.AUTH_EMAIL_OTP_ENABLED || "false").trim().toLowerCase() === "true";
}

function assertEmailOtpEnabled() {
  if (!isEmailOtpEnabled()) {
    throw new ApiError({
      status: 503,
      code: "EMAIL_OTP_DISABLED",
      message: "Email OTP is not enabled",
    });
  }
}

function getEmailOtpConfig() {
  const ttlMinutes = Math.max(1, Number(process.env.EMAIL_OTP_TTL_MINUTES) || 5);
  const cooldownSeconds = Math.max(10, Number(process.env.EMAIL_OTP_RESEND_SECONDS) || 60);
  const maxAttempts = Math.max(1, Number(process.env.EMAIL_OTP_MAX_ATTEMPTS) || 5);
  const resetTokenTtlMinutes = Math.max(1, Number(process.env.EMAIL_RESET_TOKEN_TTL_MINUTES) || 10);
  return { ttlMinutes, cooldownSeconds, maxAttempts, resetTokenTtlMinutes };
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !EMAIL_REGEX.test(normalized)) {
    throw new ApiError({
      status: 422,
      code: "INVALID_EMAIL",
      message: "email must be a valid email address",
    });
  }
  return normalized;
}

function normalizePurpose(purpose) {
  const normalized = String(purpose || "").trim();
  if (!PURPOSES.has(normalized)) {
    throw new ApiError({ status: 400, code: "INVALID_EMAIL_OTP_PURPOSE", message: "Invalid email OTP purpose" });
  }
  return normalized;
}

function assertOtpFormat(otp) {
  const code = String(otp || "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new ApiError({
      status: 400,
      code: "EMAIL_OTP_INVALID",
      message: "Verification code is invalid or expired",
    });
  }
  return code;
}

function getHashSecret() {
  return process.env.EMAIL_OTP_HASH_SECRET
    || process.env.OTP_HASH_SECRET
    || process.env.JWT_ACCESS_SECRET
    || process.env.JWT_SECRET
    || "email-otp-secret";
}

function hashOtp(challengeId, otp) {
  return crypto
    .createHmac("sha256", getHashSecret())
    .update(`${challengeId}:${otp}`)
    .digest("hex");
}

function hashResetToken(token) {
  return crypto.createHmac("sha256", getHashSecret()).update(String(token || "")).digest("hex");
}

function buildLookupKey(email, purpose) {
  return `${purpose}:${email}`;
}

function generateChallengeId() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function isEmailOtpTestModeAllowed() {
  const requested = String(process.env.EMAIL_OTP_TEST_MODE || "false").trim().toLowerCase() === "true";
  const allowed = String(process.env.ALLOW_TEST_AUTH || "false").trim().toLowerCase() === "true";
  if (!requested || !allowed) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return String(process.env.ALLOW_STAGING_TEST_AUTH || "false").trim().toLowerCase() === "true";
}

function getTestOtpForEmail(email) {
  if (!isEmailOtpTestModeAllowed()) return null;
  const allowedEmail = String(process.env.EMAIL_OTP_TEST_EMAIL || "").trim().toLowerCase();
  const code = String(process.env.EMAIL_OTP_TEST_CODE || "").trim();
  if (allowedEmail !== email || !/^\d{6}$/.test(code)) return null;
  return code;
}

function assertEmailDeliveryReady() {
  assertEmailOtpEnabled();
  if (!isEmailOtpTestModeAllowed()) {
    getGmailConfig();
  }
}

async function requestEmailOtp({
  email,
  purpose,
  userId = null,
  pendingRegistration = null,
  suppressDelivery = false,
}) {
  assertEmailDeliveryReady();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPurpose = normalizePurpose(purpose);
  if (suppressDelivery && (normalizedPurpose !== "password_reset" || userId)) {
    throw new ApiError({
      status: 500,
      code: "INVALID_EMAIL_OTP_DELIVERY_MODE",
      message: "Suppressed delivery is only valid for password-reset decoys",
    });
  }
  const config = getEmailOtpConfig();
  const lookupKey = buildLookupKey(normalizedEmail, normalizedPurpose);
  const now = new Date();
  const existing = await EmailOtpChallenge.findOne({ lookupKey }).select("+codeHash +pendingRegistration.passwordHash");

  if (existing && !existing.consumedAt && existing.lastSentAt) {
    const nextAllowedAt = existing.lastSentAt.getTime() + config.cooldownSeconds * 1000;
    if (nextAllowedAt > now.getTime()) {
      throw new ApiError({
        status: 429,
        code: "EMAIL_OTP_COOLDOWN",
        message: "Please wait before requesting another verification code",
        details: {
          retryAfterSeconds: Math.max(1, Math.ceil((nextAllowedAt - now.getTime()) / 1000)),
          challengeId: existing.challengeId,
        },
      });
    }
  }

  const challengeId = generateChallengeId();
  const testOtp = getTestOtpForEmail(normalizedEmail);
  const otp = testOtp || generateOtpCode();
  const expiresAt = new Date(now.getTime() + config.ttlMinutes * 60 * 1000);
  const payload = {
    challengeId,
    lookupKey,
    purpose: normalizedPurpose,
    email: normalizedEmail,
    userId,
    codeHash: hashOtp(challengeId, otp),
    expiresAt,
    cleanupAt: expiresAt,
    attemptsLeft: config.maxAttempts,
    lastSentAt: now,
    consumedAt: null,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    resetTokenUsedAt: null,
    pendingRegistration: pendingRegistration || undefined,
  };

  await EmailOtpChallenge.findOneAndUpdate(
    { lookupKey },
    { $set: payload },
    { upsert: true, setDefaultsOnInsert: true, new: true }
  );

  try {
    if (!suppressDelivery) {
      if (testOtp) {
        logger.warn("Email OTP test mode active", { email: normalizedEmail, purpose: normalizedPurpose });
      } else {
        await sendEmailOtp({
          toEmail: normalizedEmail,
          otp,
          purpose: normalizedPurpose,
          expiresInMinutes: config.ttlMinutes,
        });
      }
    }
  } catch (err) {
    await EmailOtpChallenge.deleteOne({ challengeId });
    throw err;
  }

  return {
    challengeId,
    email: normalizedEmail,
    expiresIn: config.ttlMinutes * 60,
    resendAfter: config.cooldownSeconds,
  };
}

async function findActiveChallenge({ challengeId, otp, purpose, session = null }) {
  assertEmailOtpEnabled();
  const code = assertOtpFormat(otp);
  const normalizedPurpose = normalizePurpose(purpose);
  const now = new Date();
  const query = EmailOtpChallenge.findOne({
    challengeId: String(challengeId || ""),
    purpose: normalizedPurpose,
    consumedAt: null,
  }).select("+codeHash +pendingRegistration.passwordHash");
  if (session) query.session(session);
  const challenge = await query;

  if (!challenge || challenge.expiresAt.getTime() <= now.getTime() || challenge.attemptsLeft <= 0) {
    throw new ApiError({
      status: 400,
      code: "EMAIL_OTP_INVALID",
      message: "Verification code is invalid or expired",
    });
  }

  const candidateHash = hashOtp(challenge.challengeId, code);
  const expected = Buffer.from(challenge.codeHash, "hex");
  const candidate = Buffer.from(candidateHash, "hex");
  const matches = expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
  if (!matches) {
    await EmailOtpChallenge.updateOne(
      { _id: challenge._id, consumedAt: null, attemptsLeft: { $gt: 0 } },
      { $inc: { attemptsLeft: -1 } },
      session ? { session } : undefined
    );
    throw new ApiError({
      status: 400,
      code: "EMAIL_OTP_INVALID",
      message: "Verification code is invalid or expired",
    });
  }

  return challenge;
}

async function consumeChallenge(challenge, session = null) {
  const result = await EmailOtpChallenge.updateOne(
    { _id: challenge._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    session ? { session } : undefined
  );
  if (result.modifiedCount !== 1) {
    throw new ApiError({
      status: 409,
      code: "EMAIL_OTP_ALREADY_USED",
      message: "Verification code has already been used",
    });
  }
}

async function createPasswordResetToken(challenge, session = null) {
  const config = getEmailOtpConfig();
  const token = crypto.randomBytes(48).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.resetTokenTtlMinutes * 60 * 1000);
  const result = await EmailOtpChallenge.updateOne(
    { _id: challenge._id, consumedAt: null },
    {
      $set: {
        consumedAt: now,
        resetTokenHash: hashResetToken(token),
        resetTokenExpiresAt: expiresAt,
        cleanupAt: expiresAt,
      },
    },
    session ? { session } : undefined
  );
  if (result.modifiedCount !== 1) {
    throw new ApiError({ status: 409, code: "EMAIL_OTP_ALREADY_USED", message: "Verification code has already been used" });
  }
  return { token, expiresIn: config.resetTokenTtlMinutes * 60 };
}

async function findUsablePasswordResetChallenge(token, session = null) {
  assertEmailOtpEnabled();
  const now = new Date();
  const query = EmailOtpChallenge.findOne({
    purpose: "password_reset",
    resetTokenHash: hashResetToken(token),
    resetTokenUsedAt: null,
    resetTokenExpiresAt: { $gt: now },
  }).select("+resetTokenHash");
  if (session) query.session(session);
  const challenge = await query;
  if (!challenge) {
    throw new ApiError({
      status: 401,
      code: "PASSWORD_RESET_TOKEN_INVALID",
      message: "Password reset token is invalid or expired",
    });
  }
  return challenge;
}

async function consumePasswordResetToken(challenge, session = null) {
  const result = await EmailOtpChallenge.updateOne(
    { _id: challenge._id, resetTokenUsedAt: null },
    { $set: { resetTokenUsedAt: new Date() } },
    session ? { session } : undefined
  );
  if (result.modifiedCount !== 1) {
    throw new ApiError({
      status: 401,
      code: "PASSWORD_RESET_TOKEN_INVALID",
      message: "Password reset token is invalid or expired",
    });
  }
}

module.exports = {
  assertEmailDeliveryReady,
  assertEmailOtpEnabled,
  consumeChallenge,
  consumePasswordResetToken,
  createPasswordResetToken,
  findActiveChallenge,
  findUsablePasswordResetChallenge,
  generateChallengeId,
  getEmailOtpConfig,
  hashOtp,
  hashResetToken,
  isEmailOtpEnabled,
  normalizeEmail,
  requestEmailOtp,
};
