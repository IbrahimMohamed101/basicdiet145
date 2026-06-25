const AppUser = require("../models/AppUser");
const User = require("../models/User");
const { isApiError } = require("../utils/apiError");
const { assertValidPhoneE164, requestOtpForPhone, verifyOtpCode } = require("../services/otpService");
const {
  issueAppAccessToken,
  issueGuestAccessToken,
  ACCESS_TOKEN_EXPIRES_SECONDS,
  GUEST_TOKEN_EXPIRES_SECONDS,
} = require("../services/appTokenService");
const { validateAppPassword, hashAppPassword, compareAppPassword } = require("../services/appPasswordService");
const { writeLog } = require("../utils/log");
const {
  createRefreshSession,
  findUsableRefreshSession,
  revokeRefreshToken,
  rotateRefreshSession,
  revokeAllUserSessions,
} = require("../services/refreshSessionService");
const errorResponse = require("../utils/errorResponse");

function serializeCoreUser(user) {
  return {
    id: String(user._id),
    fullName: user.name || null,
    phone: user.phoneE164 || user.phone,
    phoneE164: user.phoneE164 || user.phone,
    phoneVerified: Boolean(user.phoneVerified),
    email: user.email || null,
    forcePasswordChange: Boolean(user.forcePasswordChange),
    role: "client",
    createdAt: user.createdAt,
  };
}

function serializeAuthUser(user) {
  return {
    id: String(user._id),
    fullName: user.name || null,
    email: user.email || null,
    phoneE164: user.phoneE164 || user.phone,
    phoneVerified: Boolean(user.phoneVerified),
    forcePasswordChange: Boolean(user.forcePasswordChange),
  };
}

function mapAuthErrorCode(code) {
  if (code === "OTP_COOLDOWN") return "OTP_RATE_LIMITED";
  if (code === "TWILIO_VERIFY_SEND_FAILED") return "OTP_SEND_FAILED";
  if (code === "TWILIO_VERIFY_CHECK_FAILED") return "OTP_VERIFY_FAILED";
  if (["INVALID_OTP", "INVALID_OTP_FORMAT", "OTP_NOT_FOUND", "OTP_EXPIRED", "OTP_ATTEMPTS_EXCEEDED"].includes(code)) {
    return "OTP_EXPIRED_OR_INVALID";
  }
  return code;
}

function handleError(res, err) {
  if (err && err.code === 11000) {
    const key = Object.keys(err.keyValue || err.keyPattern || {})[0] || "field";
    return errorResponse(res, 409, "CONFLICT", `${key} already in use`);
  }
  if (isApiError(err)) {
    if (err.code === "OTP_AUTH_DISABLED") {
      return res.status(err.status).json({
        status: false,
        message: "OTP authentication is currently disabled",
        messageAr: "تسجيل الدخول برمز التحقق غير متاح حاليًا",
      });
    }
    const details = err.code === "OTP_COOLDOWN" && err.details
      ? { retryAfterSeconds: err.details.cooldownSecondsRemaining }
      : err.details;
    return errorResponse(res, err.status, mapAuthErrorCode(err.code), err.message, details);
  }
  if (err && err.status && err.code) {
    if (err.code === "OTP_AUTH_DISABLED") {
      return res.status(err.status).json({
        status: false,
        message: "OTP authentication is currently disabled",
        messageAr: "تسجيل الدخول برمز التحقق غير متاح حاليًا",
      });
    }
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  return errorResponse(res, 500, "INTERNAL", "Unexpected error");
}

function getRequestIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || null;
}

function findClientUserByPhone(phoneE164) {
  return User.findOne({
    role: "client",
    $or: [{ phoneE164 }, { phone: phoneE164 }],
  });
}

function getRequestPhone(body = {}) {
  return body.phoneE164 || body.phone;
}

function isPasswordAuthEnabled() {
  return String(process.env.AUTH_PASSWORD_LOGIN_ENABLED || "true").trim().toLowerCase() !== "false";
}

function passwordAuthDisabledResponse(res) {
  return res.status(403).json({
    status: false,
    message: "Password authentication is currently disabled",
    messageAr: "تسجيل الدخول بكلمة المرور غير متاح حاليًا",
  });
}

function assertPasswordConfirmation(password, confirmPassword) {
  if (confirmPassword === undefined || confirmPassword === null || String(confirmPassword) !== String(password || "")) {
    const err = new Error("confirmPassword must match password");
    err.status = 400;
    err.code = "PASSWORD_CONFIRMATION_MISMATCH";
    throw err;
  }
}

async function writeCustomerAuthActivityLog(user, action, meta = {}) {
  try {
    await writeLog({
      entityType: "user",
      entityId: user._id,
      action,
      byUserId: user._id,
      byRole: "client",
      meta,
    });
  } catch (_err) {
    // Auth should not fail because non-critical audit persistence failed.
  }
}

function normalizeOptionalFullName(fullName) {
  if (fullName === undefined) return undefined;
  if (fullName === null) return null;
  const normalized = String(fullName).trim();
  if (!normalized) return null;
  if (normalized.length > 120) {
    const err = new Error("fullName must be at most 120 characters");
    err.status = 422;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return normalized;
}

function normalizeOptionalEmail(email) {
  if (email === undefined) return undefined;
  if (email === null) return null;
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    const err = new Error("email must be a valid email address");
    err.status = 422;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return normalized;
}

async function ensureRegistrationEmailAvailable(email, phone, userId = null) {
  if (!email) return;

  const [existingUser, existingAppUser] = await Promise.all([
    User.findOne({ email }).lean(),
    AppUser.findOne({ email }).lean(),
  ]);
  const normalizedPhone = String(phone || "");
  const normalizedUserId = userId ? String(userId) : null;

  if (
    existingUser
    && String(existingUser.phoneE164 || existingUser.phone || "") !== normalizedPhone
    && (!normalizedUserId || String(existingUser._id) !== normalizedUserId)
  ) {
    const err = new Error("email is already in use");
    err.status = 409;
    err.code = "EMAIL_IN_USE";
    throw err;
  }

  if (
    existingAppUser
    && String(existingAppUser.phone || "") !== normalizedPhone
    && (!normalizedUserId || String(existingAppUser.coreUserId || "") !== normalizedUserId)
  ) {
    const err = new Error("email is already in use");
    err.status = 409;
    err.code = "EMAIL_IN_USE";
    throw err;
  }
}

async function ensureLinkedAppUser(coreUser) {
  const phone = coreUser.phoneE164 || coreUser.phone;
  let appUser = await AppUser.findOne({ phone });
  if (!appUser) {
    appUser = new AppUser({ phone, coreUserId: coreUser._id });
  }
  appUser.coreUserId = coreUser._id;
  if (coreUser.name) appUser.fullName = coreUser.name;
  if (coreUser.email) appUser.email = coreUser.email;
  await appUser.save();
  return appUser;
}

async function buildTokenResponse({ req, user, status, deviceId, deviceName }) {
  const { refreshToken, refreshExpiresIn } = await createRefreshSession({
    userId: user._id,
    req,
    deviceId,
    deviceName,
  });

  return {
    ok: true,
    status,
    accessToken: issueAppAccessToken(user),
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
    refreshExpiresIn,
    user: serializeAuthUser(user),
  };
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
    const result = await requestOtpForPhone(phoneE164, { ipAddress: getRequestIp(req) });
    return res.status(200).json({ status: "otp_sent", phoneE164: result.phone });
  } catch (err) {
    return handleError(res, err);
  }
}

async function register(req, res) {
  try {
    if (!isPasswordAuthEnabled()) {
      return passwordAuthDisabledResponse(res);
    }
    const { password, confirmPassword, deviceId, deviceName, fullName, email } = req.body || {};
    const phone = assertValidPhoneE164(getRequestPhone(req.body || {}));
    const passwordValidation = validateAppPassword(password);
    if (!passwordValidation.ok) {
      return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);
    }
    assertPasswordConfirmation(password, confirmPassword);
    const normalizedFullName = normalizeOptionalFullName(fullName);
    const normalizedEmail = normalizeOptionalEmail(email);

    const existingUser = await findClientUserByPhone(phone);
    if (existingUser && existingUser.passwordHash) {
      return errorResponse(res, 409, "USER_ALREADY_REGISTERED", "Phone number is already in use");
    }

    await ensureRegistrationEmailAvailable(normalizedEmail, phone, existingUser ? existingUser._id : null);

    const now = new Date();
    const coreUser = existingUser || new User({ phone, phoneE164: phone, role: "client" });
    if (coreUser.isActive === false) {
      return errorResponse(res, 403, "FORBIDDEN", "User account is inactive");
    }

    coreUser.phone = phone;
    coreUser.phoneE164 = phone;
    coreUser.phoneVerified = true;
    if (normalizedFullName !== undefined) {
      coreUser.name = normalizedFullName || undefined;
    }
    if (normalizedEmail !== undefined) {
      coreUser.email = normalizedEmail || undefined;
    }
    coreUser.passwordHash = await hashAppPassword(password);
    coreUser.passwordSetAt = now;
    coreUser.passwordChangedAt = now;
    coreUser.forcePasswordChange = false;
    coreUser.authProvider = "password";
    coreUser.authMethods = Array.from(new Set([...(Array.isArray(coreUser.authMethods) ? coreUser.authMethods : []), "password"]));
    coreUser.lastLoginAt = now;
    coreUser.failedLoginAttempts = 0;
    coreUser.lockedUntil = null;
    await coreUser.save();
    await ensureLinkedAppUser(coreUser);

    const payload = await buildTokenResponse({
      req,
      user: coreUser,
      status: "registered",
      deviceId,
      deviceName,
    });
    return res.status(201).json(payload);
  } catch (err) {
    return handleError(res, err);
  }
}

async function requestRegisterOtp(req, res) {
  try {
    const { phoneE164, fullName, email } = req.body || {};
    const phone = assertValidPhoneE164(phoneE164);
    const normalizedFullName = normalizeOptionalFullName(fullName);
    const normalizedEmail = normalizeOptionalEmail(email);
    const existingUser = await findClientUserByPhone(phone);

    if (existingUser && existingUser.phoneVerified === true && existingUser.passwordHash) {
      return errorResponse(
        res,
        409,
        "USER_ALREADY_REGISTERED",
        "User already registered. Please login with phone and password."
      );
    }
    await ensureRegistrationEmailAvailable(
      normalizedEmail,
      phone,
      existingUser ? existingUser._id : null
    );

    const result = await requestOtpForPhone(phone, {
      context: "app_register",
      ipAddress: getRequestIp(req),
      pendingProfile: {
        ...(normalizedFullName !== undefined ? { fullName: normalizedFullName } : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      },
    });

    return res.status(200).json({
      ok: true,
      status: "otp_sent",
      phoneE164: result.phone,
      cooldownSeconds: result.cooldownSeconds,
    });
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
      coreUser = await User.create({ phone, phoneE164: phone, phoneVerified: true, role: "client" });
    }
    if (coreUser.isActive === false) {
      return errorResponse(res, 403, "FORBIDDEN", "User account is inactive");
    }

    const hasPendingProfile = context === "app_register"
      ? applyPendingProfile(coreUser, appUser, pendingProfile)
      : false;
    if (hasPendingProfile || !coreUser.phoneE164 || coreUser.phoneVerified !== true) {
      coreUser.phone = phone;
      coreUser.phoneE164 = phone;
      coreUser.phoneVerified = true;
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
      status: "otp_verified",
      token: issueAppAccessToken(coreUser),
      user: serializeCoreUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function verifyRegister(req, res) {
  try {
    const { phoneE164, otp, password, deviceId, deviceName, fullName, email } = req.body || {};
    const passwordValidation = validateAppPassword(password);
    if (!passwordValidation.ok) {
      return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);
    }
    const requestFullName = normalizeOptionalFullName(fullName);
    const requestEmail = normalizeOptionalEmail(email);

    const { phone, context, pendingProfile } = await verifyOtpCode({ phoneE164, otp });
    let coreUser = await findClientUserByPhone(phone);
    if (coreUser && coreUser.phoneVerified === true && coreUser.passwordHash) {
      return errorResponse(
        res,
        409,
        "USER_ALREADY_REGISTERED",
        "User already registered. Please login with phone and password."
      );
    }

    if (!coreUser) {
      coreUser = new User({ phone, phoneE164: phone, role: "client" });
    }
    if (coreUser.isActive === false) {
      return errorResponse(res, 403, "FORBIDDEN", "User account is inactive");
    }

    const pendingFullName = context === "app_register" && pendingProfile
      ? normalizeOptionalFullName(pendingProfile.fullName)
      : undefined;
    const pendingEmail = context === "app_register" && pendingProfile
      ? normalizeOptionalEmail(pendingProfile.email)
      : undefined;
    const effectiveFullName = requestFullName !== undefined ? requestFullName : pendingFullName;
    const effectiveEmail = requestEmail !== undefined ? requestEmail : pendingEmail;

    await ensureRegistrationEmailAvailable(effectiveEmail, phone, coreUser._id);

    coreUser.phone = phone;
    coreUser.phoneE164 = phone;
    coreUser.phoneVerified = true;
    if (effectiveFullName !== undefined) {
      coreUser.name = effectiveFullName || undefined;
    }
    if (effectiveEmail !== undefined) {
      coreUser.email = effectiveEmail || undefined;
    }
    coreUser.passwordHash = await hashAppPassword(password);
    coreUser.lastLoginAt = new Date();
    await coreUser.save();
    await ensureLinkedAppUser(coreUser);

    const payload = await buildTokenResponse({
      req,
      user: coreUser,
      status: "registered",
      deviceId,
      deviceName,
    });
    return res.status(200).json(payload);
  } catch (err) {
    return handleError(res, err);
  }
}

async function login(req, res) {
  try {
    if (!isPasswordAuthEnabled()) {
      return passwordAuthDisabledResponse(res);
    }
    const { phoneE164, password, deviceId, deviceName } = req.body || {};
    const phone = assertValidPhoneE164(phoneE164 || req.body.phone);
    const coreUser = await findClientUserByPhone(phone);

    if (coreUser && coreUser.phoneVerified === true && !coreUser.passwordHash) {
      return errorResponse(res, 403, "PASSWORD_RESET_REQUIRED", "Password setup is required");
    }

    const passwordMatches = coreUser && coreUser.passwordHash
      ? await compareAppPassword(password, coreUser.passwordHash)
      : false;

    if (!coreUser || !passwordMatches) {
      return errorResponse(res, 401, "INVALID_CREDENTIALS", "Invalid phone or password", {
        messageAr: "رقم الجوال أو كلمة المرور غير صحيحة",
      });
    }
    if (coreUser.isActive === false) {
      return errorResponse(res, 403, "FORBIDDEN", "User account is inactive");
    }

    coreUser.lastLoginAt = new Date();
    coreUser.failedLoginAttempts = 0;
    coreUser.lockedUntil = null;
    await coreUser.save();

    const payload = await buildTokenResponse({
      req,
      user: coreUser,
      status: "logged_in",
      deviceId,
      deviceName,
    });
    return res.status(200).json(payload);
  } catch (err) {
    return handleError(res, err);
  }
}

async function changePassword(req, res) {
  try {
    if (!isPasswordAuthEnabled()) {
      return passwordAuthDisabledResponse(res);
    }
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    const user = await User.findOne({ _id: req.userId, role: "client" });
    if (!user) {
      return errorResponse(res, 401, "AUTH_REQUIRED", "Authentication required");
    }
    if (!user.passwordHash || !(await compareAppPassword(currentPassword, user.passwordHash))) {
      return errorResponse(res, 401, "INVALID_CREDENTIALS", "Invalid current password");
    }
    const passwordValidation = validateAppPassword(newPassword);
    if (!passwordValidation.ok) {
      return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);
    }
    assertPasswordConfirmation(newPassword, confirmPassword);

    const now = new Date();
    user.passwordHash = await hashAppPassword(newPassword);
    user.passwordChangedAt = now;
    user.passwordSetAt = user.passwordSetAt || now;
    user.forcePasswordChange = false;
    user.authProvider = "password";
    user.authMethods = Array.from(new Set([...(Array.isArray(user.authMethods) ? user.authMethods : []), "password"]));
    await user.save();
    await revokeAllUserSessions(user._id);
    await writeCustomerAuthActivityLog(user, "customer_password_changed", { source: "customer_auth" });

    return res.status(200).json({
      status: true,
      message: "Password changed successfully",
      messageAr: "تم تغيير كلمة المرور بنجاح",
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function guest(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      status: "guest",
      accessToken: issueGuestAccessToken(),
      expiresIn: GUEST_TOKEN_EXPIRES_SECONDS,
      user: {
        id: "guest",
        role: "guest",
        isGuest: true,
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function refresh(req, res) {
  try {
    const { refreshToken } = req.body || {};
    const { session, reason } = await findUsableRefreshSession(refreshToken);
    if (!session) {
      const code = reason === "expired"
        ? "REFRESH_TOKEN_EXPIRED"
        : reason === "revoked"
          ? "SESSION_REVOKED"
          : "REFRESH_TOKEN_INVALID";
      return errorResponse(res, 401, code, "Refresh token is invalid or expired");
    }

    const coreUser = await User.findOne({ _id: session.userId, role: "client" });
    if (!coreUser || coreUser.isActive === false) {
      return errorResponse(res, 401, "REFRESH_TOKEN_INVALID", "Refresh token is invalid");
    }

    const rotated = await rotateRefreshSession({ session, req });
    return res.status(200).json({
      ok: true,
      accessToken: issueAppAccessToken(coreUser),
      refreshToken: rotated.refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
      refreshExpiresIn: rotated.refreshExpiresIn,
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function me(req, res) {
  try {
    const coreUser = await User.findOne({ _id: req.userId, role: "client" });
    if (!coreUser) {
      return errorResponse(res, 401, "AUTH_REQUIRED", "Authentication required");
    }
    return res.status(200).json({
      ok: true,
      user: serializeAuthUser(coreUser),
    });
  } catch (err) {
    return handleError(res, err);
  }
}

async function logout(req, res) {
  try {
    const { refreshToken } = req.body || {};
    await revokeRefreshToken(refreshToken);
    return res.status(200).json({ ok: true, status: "logged_out" });
  } catch (err) {
    return handleError(res, err);
  }
}

async function logoutAll(req, res) {
  try {
    await revokeAllUserSessions(req.userId);
    return res.status(200).json({ ok: true, status: "logged_out_all_devices" });
  } catch (err) {
    return handleError(res, err);
  }
}

async function forgotPassword(req, res) {
  try {
    if (String(process.env.AUTH_OTP_ENABLED || "true").trim().toLowerCase() === "false") {
      return res.status(403).json({
        status: false,
        message: "OTP authentication is currently disabled",
        messageAr: "تسجيل الدخول برمز التحقق غير متاح حاليًا",
      });
    }
    const { phoneE164 } = req.body || {};
    const phone = assertValidPhoneE164(phoneE164);
    const coreUser = await findClientUserByPhone(phone);
    if (coreUser && coreUser.phoneVerified === true) {
      await requestOtpForPhone(phone, {
        context: "password_reset",
        ipAddress: getRequestIp(req),
      });
    }
    return res.status(200).json({ ok: true, status: "otp_sent_if_account_exists" });
  } catch (err) {
    return handleError(res, err);
  }
}

async function resetPassword(req, res) {
  try {
    if (String(process.env.AUTH_OTP_ENABLED || "true").trim().toLowerCase() === "false") {
      return res.status(403).json({
        status: false,
        message: "OTP authentication is currently disabled",
        messageAr: "تسجيل الدخول برمز التحقق غير متاح حاليًا",
      });
    }
    const { phoneE164, otp, newPassword } = req.body || {};
    const passwordValidation = validateAppPassword(newPassword);
    if (!passwordValidation.ok) {
      return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);
    }

    const { phone } = await verifyOtpCode({ phoneE164, otp });
    const coreUser = await findClientUserByPhone(phone);
    if (!coreUser) {
      return errorResponse(res, 401, "OTP_VERIFY_FAILED", "OTP verification failed");
    }

    coreUser.phone = phone;
    coreUser.phoneE164 = phone;
    coreUser.passwordHash = await hashAppPassword(newPassword);
    coreUser.passwordSetAt = new Date();
    coreUser.passwordChangedAt = new Date();
    coreUser.forcePasswordChange = false;
    coreUser.authProvider = "password";
    coreUser.authMethods = Array.from(new Set([...(Array.isArray(coreUser.authMethods) ? coreUser.authMethods : []), "password"]));
    coreUser.phoneVerified = true;
    await coreUser.save();
    await ensureLinkedAppUser(coreUser);
    await revokeAllUserSessions(coreUser._id);

    return res.status(200).json({ ok: true, status: "password_reset" });
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
  return res.status(200).json({ status: true });
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

  return res.status(200).json({ status: true });
}

module.exports = {
  requestOtp,
  requestRegisterOtp,
  verifyOtp,
  register,
  verifyRegister,
  login,
  guest,
  refresh,
  me,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  changePassword,
  updateDeviceToken,
  deleteDeviceToken,
};
