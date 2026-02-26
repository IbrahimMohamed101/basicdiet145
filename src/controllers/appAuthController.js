const AppUser = require("../models/AppUser");
const User = require("../models/User");
const { isApiError, ApiError } = require("../utils/apiError");
const { assertValidPhoneE164, requestOtpForPhone } = require("../services/otpService");
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

async function login(req, res) {
  try {
    const { phoneE164 } = req.body || {};
    await requestOtpForPhone(phoneE164);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleError(res, err);
  }
}

async function register(req, res) {
  try {
    const { fullName, phoneE164, email } = req.body || {};
    if (!fullName || !String(fullName).trim()) {
      throw new ApiError({
        status: 400,
        code: "INVALID_FULL_NAME",
        message: "fullName is required",
      });
    }

    const coreUser = await User.findById(req.userId);
    if (!coreUser) {
      throw new ApiError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Invalid app access token",
      });
    }

    if (phoneE164) {
      const normalizedPhone = assertValidPhoneE164(phoneE164);
      if (normalizedPhone !== coreUser.phone) {
        throw new ApiError({
          status: 403,
          code: "PHONE_MISMATCH",
          message: "phoneE164 does not match authenticated app user",
        });
      }
    }

    let appUser = await AppUser.findOne({ phone: coreUser.phone });
    if (!appUser) {
      appUser = await AppUser.create({ phone: coreUser.phone, coreUserId: coreUser._id });
    } else if (!appUser.coreUserId || String(appUser.coreUserId) !== String(coreUser._id)) {
      appUser.coreUserId = coreUser._id;
      await appUser.save();
    }

    coreUser.name = String(fullName).trim();
    if (email === null || email === "") {
      coreUser.email = undefined;
    } else if (email !== undefined) {
      coreUser.email = String(email).trim().toLowerCase();
    }
    await coreUser.save();

    return res.status(200).json({
      ok: true,
      token: issueAppAccessToken(coreUser),
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = { login, register };
