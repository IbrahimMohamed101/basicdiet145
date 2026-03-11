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

function normalizeOptionalEmail(email) {
  if (email === undefined) {
    return undefined;
  }
  if (email === null || email === "") {
    return null;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ApiError({
      status: 400,
      code: "INVALID_EMAIL",
      message: "email must be a valid email address",
    });
  }
  return normalizedEmail;
}

async function getAuthenticatedCoreUserOrThrow(userId) {
  const coreUser = await User.findById(userId);
  if (!coreUser) {
    throw new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Invalid app access token",
    });
  }
  return coreUser;
}

async function ensureLinkedAppUser(coreUser) {
  let appUser = await AppUser.findOne({ phone: coreUser.phone });
  if (!appUser) {
    appUser = await AppUser.create({ phone: coreUser.phone, coreUserId: coreUser._id });
  } else if (!appUser.coreUserId || String(appUser.coreUserId) !== String(coreUser._id)) {
    appUser.coreUserId = coreUser._id;
    await appUser.save();
  }
  return appUser;
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

    const coreUser = await getAuthenticatedCoreUserOrThrow(req.userId);

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

    coreUser.name = String(fullName).trim();
    const normalizedEmail = normalizeOptionalEmail(email);
    if (normalizedEmail === null) {
      coreUser.email = undefined;
    } else if (normalizedEmail !== undefined) {
      coreUser.email = normalizedEmail;
    }
    await coreUser.save();
    await ensureLinkedAppUser(coreUser);

    return res.status(200).json({
      ok: true,
      token: issueAppAccessToken(coreUser),
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function getProfile(req, res) {
  try {
    const coreUser = await getAuthenticatedCoreUserOrThrow(req.userId);
    return res.status(200).json({
      ok: true,
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function updateProfile(req, res) {
  try {
    const { fullName, email } = req.body || {};
    const hasFullName = Object.prototype.hasOwnProperty.call(req.body || {}, "fullName");
    const hasEmail = Object.prototype.hasOwnProperty.call(req.body || {}, "email");

    if (!hasFullName && !hasEmail) {
      throw new ApiError({
        status: 400,
        code: "INVALID",
        message: "At least one of fullName or email is required",
      });
    }

    const coreUser = await getAuthenticatedCoreUserOrThrow(req.userId);

    if (hasFullName) {
      if (!String(fullName || "").trim()) {
        throw new ApiError({
          status: 400,
          code: "INVALID_FULL_NAME",
          message: "fullName cannot be empty",
        });
      }
      coreUser.name = String(fullName).trim();
    }

    if (hasEmail) {
      const normalizedEmail = normalizeOptionalEmail(email);
      if (normalizedEmail === null) {
        coreUser.email = undefined;
      } else {
        coreUser.email = normalizedEmail;
      }
    }

    await coreUser.save();
    await ensureLinkedAppUser(coreUser);

    return res.status(200).json({
      ok: true,
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = { login, register, getProfile, updateProfile };
