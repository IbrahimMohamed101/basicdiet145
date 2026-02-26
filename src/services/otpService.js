const crypto = require("crypto");
const Otp = require("../models/Otp");
const { sendWhatsappMessage } = require("./twilioWhatsappService");
const { ApiError } = require("../utils/apiError");

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function getOtpConfig() {
  const ttlMinutes = Number(process.env.OTP_TTL_MINUTES) || 5;
  const cooldownSeconds = Number(process.env.OTP_COOLDOWN_SECONDS) || 30;
  const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 5;
  return { ttlMinutes, cooldownSeconds, maxAttempts };
}

function normalizePhoneE164(phoneE164) {
  return String(phoneE164 || "").trim();
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

async function requestOtpForPhone(phoneE164) {
  const phone = assertValidPhoneE164(phoneE164);
  const { ttlMinutes, cooldownSeconds, maxAttempts } = getOtpConfig();
  const now = new Date();

  const existing = await Otp.findOne({ phone });
  if (existing && existing.lastSentAt) {
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

  const otp = generateOtpCode();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  await sendWhatsappMessage({
    toPhoneE164: phone,
    body: `Your BasicDiet OTP is ${otp}. It expires in ${ttlMinutes} minutes.`,
  });

  await Otp.findOneAndUpdate(
    { phone },
    {
      phone,
      codeHash: hashOtp(phone, otp),
      expiresAt,
      attemptsLeft: maxAttempts,
      lastSentAt: now,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function verifyOtpCode({ phoneE164, otp }) {
  const phone = assertValidPhoneE164(phoneE164);
  const code = assertValidOtpCode(otp);

  const otpRecord = await Otp.findOne({ phone });
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

  await Otp.deleteOne({ _id: otpRecord._id });
  return { phone };
}

module.exports = {
  assertValidPhoneE164,
  normalizePhoneE164,
  requestOtpForPhone,
  verifyOtpCode,
};
