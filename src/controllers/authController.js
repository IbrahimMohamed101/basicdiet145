const AppUser = require("../models/AppUser");
const User = require("../models/User");
const { isApiError } = require("../utils/apiError");
const { requestOtpForPhone, verifyOtpCode } = require("../services/otpService");
const { issueAppAccessToken } = require("../services/appTokenService");
const errorResponse = require("../utils/errorResponse");

function serializeCoreUser(user) {
  return {
    id: String(user._id),
    fullName: user.name || null,
    phone: user.phone,
    email: user.email || null,
    role: "client",
    createdAt: user.createdAt,
  };
}

function handleError(res, err) {
  if (isApiError(err)) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  return errorResponse(res, 500, "INTERNAL", "Unexpected error");
}

async function requestOtp(req, res) {
  try {
    const { phoneE164 } = req.body || {};
    await requestOtpForPhone(phoneE164);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleError(res, err);
  }
}

async function verifyOtp(req, res) {
  try {
    const { phoneE164, otp } = req.body || {};
    const { phone } = await verifyOtpCode({ phoneE164, otp });

    let appUser = await AppUser.findOne({ phone });
    if (!appUser) {
      appUser = await AppUser.create({ phone });
    }

    let coreUser = null;
    if (appUser.coreUserId) {
      coreUser = await User.findById(appUser.coreUserId);
    }
    if (!coreUser) {
      coreUser = await User.findOne({ phone });
    }
    if (!coreUser) {
      coreUser = await User.create({ phone, role: "client" });
    }
    if (!appUser.coreUserId || String(appUser.coreUserId) !== String(coreUser._id)) {
      appUser.coreUserId = coreUser._id;
      await appUser.save();
    }
    if (Array.isArray(appUser.fcmTokens) && appUser.fcmTokens.length > 0) {
      await User.findByIdAndUpdate(coreUser._id, { $addToSet: { fcmTokens: { $each: appUser.fcmTokens } } });
      appUser.fcmTokens = [];
      await appUser.save();
    }

    return res.status(200).json({
      ok: true,
      token: issueAppAccessToken(coreUser),
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateDeviceToken(req, res) {
  const { token } = req.body || {};
  if (!token) {
    return errorResponse(res, 400, "INVALID", "Missing token");
  }
  await User.findByIdAndUpdate(req.userId, { $addToSet: { fcmTokens: token } });
  return res.status(200).json({ ok: true });
}

module.exports = { requestOtp, verifyOtp, updateDeviceToken };
