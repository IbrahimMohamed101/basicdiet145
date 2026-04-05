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
  if (err && err.code === 11000) {
    const key = Object.keys(err.keyValue || err.keyPattern || {})[0] || "field";
    return errorResponse(res, 409, "CONFLICT", `${key} already in use`);
  }
  if (isApiError(err)) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  return errorResponse(res, 500, "INTERNAL", "Unexpected error");
}

function applyPendingProfile(coreUser, appUser, pendingProfile) {
  if (!pendingProfile || typeof pendingProfile !== "object") {
    return false;
  }

  let changed = false;

  if (Object.prototype.hasOwnProperty.call(pendingProfile, "fullName")) {
    const fullName = String(pendingProfile.fullName || "").trim();
    coreUser.name = fullName || undefined;
    appUser.fullName = fullName || undefined;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(pendingProfile, "email")) {
    const email = pendingProfile.email ? String(pendingProfile.email).trim().toLowerCase() : undefined;
    coreUser.email = email;
    appUser.email = email;
    changed = true;
  }

  return changed;
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
    const { phone, context, pendingProfile } = await verifyOtpCode({ phoneE164, otp });

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
    if (coreUser.isActive === false) {
      return errorResponse(res, 403, "FORBIDDEN", "User account is inactive");
    }

    // SECURITY FIX: Only apply pendingProfile when the OTP flow was a
    // registration (context === "app_register").  This prevents profile
    // injection via the generic or login OTP flows.
    const hasPendingProfile = context === "app_register"
      ? applyPendingProfile(coreUser, appUser, pendingProfile)
      : false;
    if (hasPendingProfile) {
      await coreUser.save();
    }

    if (!appUser.coreUserId || String(appUser.coreUserId) !== String(coreUser._id)) {
      appUser.coreUserId = coreUser._id;
    }
    await appUser.save();
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

function normalizeDeviceToken(token) {
  const normalized = String(token || "").trim();
  return normalized || null;
}

async function updateDeviceToken(req, res) {
  const token = normalizeDeviceToken((req.body || {}).token);
  if (!token) {
    return errorResponse(res, 400, "INVALID", "Missing token");
  }
  await User.findByIdAndUpdate(req.userId, { $addToSet: { fcmTokens: token } });
  return res.status(200).json({ ok: true });
}

async function deleteDeviceToken(req, res) {
  const token = normalizeDeviceToken((req.body || {}).token);
  if (!token) {
    return errorResponse(res, 400, "INVALID", "Missing token");
  }

  await Promise.all([
    User.findByIdAndUpdate(req.userId, { $pull: { fcmTokens: token } }),
    AppUser.updateMany({ coreUserId: req.userId }, { $pull: { fcmTokens: token } }),
  ]);

  return res.status(200).json({ ok: true });
}

module.exports = { requestOtp, verifyOtp, updateDeviceToken, deleteDeviceToken };
