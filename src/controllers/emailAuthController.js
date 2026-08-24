const AppUser = require("../models/AppUser");
const User = require("../models/User");
const { ApiError, isApiError } = require("../utils/apiError");
const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const { writeLog } = require("../utils/log");
const { assertValidPhoneE164 } = require("../services/otpService");
const { validateAppPassword, hashAppPassword } = require("../services/appPasswordService");
const { clearTemporaryPasswordState } = require("../services/customerTemporaryPasswordService");
const { startSafeSession } = require("../utils/mongoTransactionSupport");
const {
  createRefreshSession,
  revokeAllUserSessions,
} = require("../services/refreshSessionService");
const {
  issueAppAccessToken,
  ACCESS_TOKEN_EXPIRES_SECONDS,
} = require("../services/appTokenService");
const {
  assertEmailDeliveryReady,
  consumeChallenge,
  consumePasswordResetToken,
  createPasswordResetToken,
  findActiveChallenge,
  findUsablePasswordResetChallenge,
  generateChallengeId,
  getEmailOtpConfig,
  normalizeEmail,
  requestEmailOtp,
} = require("../services/emailOtpService");

function handleEmailAuthError(res, err) {
  if (err && err.code === 11000) {
    return errorResponse(res, 409, "EMAIL_OR_PHONE_IN_USE", "Email or phone number is already in use");
  }
  if (isApiError(err)) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  logger.error("Email authentication request failed", {
    error: { message: err && err.message, name: err && err.name },
  });
  return errorResponse(res, 500, "INTERNAL", "Unexpected error");
}

function normalizeFullName(value) {
  const fullName = String(value || "").trim();
  if (!fullName || fullName.length > 120) {
    throw new ApiError({
      status: 422,
      code: "INVALID_FULL_NAME",
      message: "fullName is required and must be at most 120 characters",
    });
  }
  return fullName;
}

function assertPasswordConfirmation(password, confirmPassword) {
  if (String(password || "") !== String(confirmPassword || "") || confirmPassword === undefined) {
    throw new ApiError({
      status: 400,
      code: "PASSWORD_CONFIRMATION_MISMATCH",
      message: "confirmPassword must match password",
    });
  }
}

function assertStrongPassword(password) {
  const validation = validateAppPassword(password);
  if (!validation.ok) {
    throw new ApiError({ status: 400, code: "WEAK_PASSWORD", message: validation.message });
  }
}

async function ensureEmailAndPhoneAvailable({ email, phoneE164 = null, userId = null, session = null }) {
  const queries = [
    User.findOne({ role: "client", email }).lean(),
    AppUser.findOne({ email }).lean(),
  ];
  if (phoneE164) {
    queries.push(
      User.findOne({ role: "client", $or: [{ phone: phoneE164 }, { phoneE164 }] }).lean(),
      AppUser.findOne({ phone: phoneE164 }).lean()
    );
  }
  if (session) queries.forEach((query) => query.session(session));
  const matches = session ? [] : await Promise.all(queries);
  if (session) {
    for (const query of queries) matches.push(await query);
  }

  const normalizedUserId = userId ? String(userId) : null;
  const hasConflict = matches.filter(Boolean).some((match) => {
    if (match.role === "client") {
      return !normalizedUserId || String(match._id) !== normalizedUserId;
    }
    const linkedToUser = normalizedUserId && String(match.coreUserId || "") === normalizedUserId;
    const legacySamePhone = normalizedUserId && phoneE164 && String(match.phone || "") === phoneE164;
    return !linkedToUser && !legacySamePhone;
  });

  if (hasConflict) {
    throw new ApiError({
      status: 409,
      code: "EMAIL_OR_PHONE_IN_USE",
      message: "Email or phone number is already in use",
    });
  }
}

async function syncAppUser(coreUser, session = null) {
  const phone = coreUser.phoneE164 || coreUser.phone;
  const query = AppUser.findOne({ phone });
  if (session) query.session(session);
  let appUser = await query;
  if (!appUser) appUser = new AppUser({ phone });
  appUser.coreUserId = coreUser._id;
  appUser.fullName = coreUser.name || undefined;
  appUser.email = coreUser.email || undefined;
  await appUser.save(session ? { session } : undefined);
}

function serializeEmailAuthUser(user) {
  return {
    id: String(user._id),
    fullName: user.name || null,
    phoneE164: user.phoneE164 || user.phone,
    phoneVerified: Boolean(user.phoneVerified),
    email: user.email || null,
    emailVerified: Boolean(user.emailVerified),
    emailVerifiedAt: user.emailVerifiedAt || null,
    emailVerificationRequired: Boolean(user.emailVerificationRequired),
    forcePasswordChange: Boolean(user.forcePasswordChange),
  };
}

async function buildSessionResponse({ req, user, status, deviceId, deviceName, session = null }) {
  const refresh = await createRefreshSession({ userId: user._id, req, deviceId, deviceName, session });
  return {
    ok: true,
    status,
    accessToken: issueAppAccessToken(user),
    refreshToken: refresh.refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_SECONDS,
    refreshExpiresIn: refresh.refreshExpiresIn,
    user: serializeEmailAuthUser(user),
  };
}

async function startEmailRegistration(req, res) {
  try {
    const { fullName, phoneE164, email, password, confirmPassword } = req.body || {};
    const normalizedFullName = normalizeFullName(fullName);
    const normalizedPhone = assertValidPhoneE164(phoneE164);
    const normalizedEmail = normalizeEmail(email);
    assertStrongPassword(password);
    assertPasswordConfirmation(password, confirmPassword);
    await ensureEmailAndPhoneAvailable({ email: normalizedEmail, phoneE164: normalizedPhone });

    const passwordHash = await hashAppPassword(password);
    const challenge = await requestEmailOtp({
      email: normalizedEmail,
      purpose: "registration",
      pendingRegistration: {
        fullName: normalizedFullName,
        phoneE164: normalizedPhone,
        passwordHash,
      },
    });

    return res.status(200).json({
      ok: true,
      status: "email_otp_sent",
      challengeId: challenge.challengeId,
      expiresIn: challenge.expiresIn,
      resendAfter: challenge.resendAfter,
    });
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

async function verifyEmailRegistration(req, res) {
  try {
    const { challengeId, otp, deviceId, deviceName } = req.body || {};
    await findActiveChallenge({ challengeId, otp, purpose: "registration" });

    let createdUser = null;
    let sessionPayload = null;
    // Railway's managed MongoDB service can run as a standalone server. Use
    // the shared capability-aware session wrapper so this workflow keeps its
    // transaction boundary on replica sets and executes once (without an
    // unsupported transaction command) on standalone MongoDB.
    const session = await startSafeSession();
    try {
      await session.withTransaction(async () => {
        const challenge = await findActiveChallenge({
          challengeId,
          otp,
          purpose: "registration",
          session,
        });
        const pending = challenge.pendingRegistration || {};
        if (!pending.phoneE164 || !pending.fullName || !pending.passwordHash) {
          throw new ApiError({ status: 409, code: "REGISTRATION_CHALLENGE_INVALID", message: "Registration challenge is incomplete" });
        }

        await ensureEmailAndPhoneAvailable({
          email: challenge.email,
          phoneE164: pending.phoneE164,
          session,
        });

        const now = new Date();
        createdUser = new User({
          name: pending.fullName,
          phone: pending.phoneE164,
          phoneE164: pending.phoneE164,
          // This flow proves control of the email address only. Keep the phone
          // unverified until a phone-specific verification flow succeeds.
          phoneVerified: false,
          email: challenge.email,
          emailVerified: true,
          emailVerifiedAt: now,
          emailVerificationRequired: false,
          passwordHash: pending.passwordHash,
          passwordSetAt: now,
          passwordChangedAt: now,
          authVersion: 1,
          authProvider: "password",
          authMethods: ["password", "email_otp"],
          accountStatus: "active",
          role: "client",
          lastLoginAt: now,
        });
        await createdUser.save({ session });
        await syncAppUser(createdUser, session);
        await consumeChallenge(challenge, session);
        sessionPayload = await buildSessionResponse({
          req,
          user: createdUser,
          status: "registered",
          deviceId,
          deviceName,
          session,
        });
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json(sessionPayload);
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

async function requestExistingEmailVerification(req, res) {
  try {
    const normalizedEmail = normalizeEmail((req.body || {}).email);
    const user = await User.findOne({ _id: req.userId, role: "client", isActive: { $ne: false } });
    if (!user) throw new ApiError({ status: 401, code: "AUTH_REQUIRED", message: "Authentication required" });

    if (user.emailVerified === true && String(user.email || "").toLowerCase() === normalizedEmail) {
      return res.status(200).json({ ok: true, status: "email_already_verified" });
    }
    await ensureEmailAndPhoneAvailable({
      email: normalizedEmail,
      phoneE164: user.phoneE164 || user.phone,
      userId: user._id,
    });
    const challenge = await requestEmailOtp({
      email: normalizedEmail,
      purpose: "verify_existing_email",
      userId: user._id,
    });
    return res.status(200).json({
      ok: true,
      status: "email_otp_sent",
      challengeId: challenge.challengeId,
      expiresIn: challenge.expiresIn,
      resendAfter: challenge.resendAfter,
    });
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

async function confirmExistingEmailVerification(req, res) {
  try {
    const { challengeId, otp } = req.body || {};
    const checked = await findActiveChallenge({ challengeId, otp, purpose: "verify_existing_email" });
    if (String(checked.userId || "") !== String(req.userId)) {
      throw new ApiError({ status: 403, code: "EMAIL_OTP_FORBIDDEN", message: "Verification challenge does not belong to this user" });
    }

    let updatedUser = null;
    const session = await startSafeSession();
    try {
      await session.withTransaction(async () => {
        const challenge = await findActiveChallenge({
          challengeId,
          otp,
          purpose: "verify_existing_email",
          session,
        });
        if (String(challenge.userId || "") !== String(req.userId)) {
          throw new ApiError({ status: 403, code: "EMAIL_OTP_FORBIDDEN", message: "Verification challenge does not belong to this user" });
        }
        updatedUser = await User.findOne({ _id: req.userId, role: "client", isActive: { $ne: false } }).session(session);
        if (!updatedUser) throw new ApiError({ status: 401, code: "AUTH_REQUIRED", message: "Authentication required" });
        await ensureEmailAndPhoneAvailable({
          email: challenge.email,
          phoneE164: updatedUser.phoneE164 || updatedUser.phone,
          userId: req.userId,
          session,
        });
        updatedUser.email = challenge.email;
        updatedUser.emailVerified = true;
        updatedUser.emailVerifiedAt = new Date();
        updatedUser.emailVerificationRequired = false;
        updatedUser.authMethods = Array.from(new Set([...(updatedUser.authMethods || []), "email_otp"]));
        await updatedUser.save({ session });
        await syncAppUser(updatedUser, session);
        await consumeChallenge(challenge, session);
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({ ok: true, status: "email_verified", user: serializeEmailAuthUser(updatedUser) });
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

async function requestEmailPasswordReset(req, res) {
  try {
    assertEmailDeliveryReady();
    const email = normalizeEmail((req.body || {}).email);
    const config = getEmailOtpConfig();
    let challengeId = generateChallengeId();
    const user = await User.findOne({
      email,
      emailVerified: true,
      role: "client",
      isActive: { $ne: false },
    }).lean();

    try {
      const challenge = await requestEmailOtp({
        email,
        purpose: "password_reset",
        userId: user ? user._id : null,
        suppressDelivery: !user,
      });
      challengeId = challenge.challengeId;
    } catch (err) {
      if (isApiError(err) && err.code === "EMAIL_OTP_COOLDOWN" && err.details && err.details.challengeId) {
        challengeId = err.details.challengeId;
      } else {
        logger.error("Password reset email request was not delivered", {
          email,
          error: { code: err && err.code, message: err && err.message },
        });
      }
    }

    return res.status(200).json({
      ok: true,
      status: "otp_sent_if_account_exists",
      challengeId,
      expiresIn: config.ttlMinutes * 60,
      resendAfter: config.cooldownSeconds,
    });
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

async function verifyEmailPasswordReset(req, res) {
  try {
    const { challengeId, otp } = req.body || {};
    await findActiveChallenge({ challengeId, otp, purpose: "password_reset" });

    let resetToken = null;
    const session = await startSafeSession();
    try {
      await session.withTransaction(async () => {
        const challenge = await findActiveChallenge({
          challengeId,
          otp,
          purpose: "password_reset",
          session,
        });
        const user = await User.findOne({
          _id: challenge.userId,
          email: challenge.email,
          emailVerified: true,
          role: "client",
          isActive: { $ne: false },
        }).session(session);
        if (!user) throw new ApiError({ status: 400, code: "EMAIL_OTP_INVALID", message: "Verification code is invalid or expired" });
        resetToken = await createPasswordResetToken(challenge, session);
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      ok: true,
      status: "email_otp_verified",
      passwordResetToken: resetToken.token,
      expiresIn: resetToken.expiresIn,
    });
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

async function resetPasswordWithEmail(req, res) {
  try {
    const { passwordResetToken, newPassword, confirmPassword } = req.body || {};
    assertStrongPassword(newPassword);
    assertPasswordConfirmation(newPassword, confirmPassword);
    const passwordHash = await hashAppPassword(newPassword);

    let updatedUser = null;
    const session = await startSafeSession();
    try {
      await session.withTransaction(async () => {
        const challenge = await findUsablePasswordResetChallenge(passwordResetToken, session);
        updatedUser = await User.findOne({
          _id: challenge.userId,
          email: challenge.email,
          emailVerified: true,
          role: "client",
          isActive: { $ne: false },
        }).session(session);
        if (!updatedUser) {
          throw new ApiError({ status: 401, code: "PASSWORD_RESET_TOKEN_INVALID", message: "Password reset token is invalid or expired" });
        }

        const now = new Date();
        updatedUser.passwordHash = passwordHash;
        updatedUser.passwordSetAt = updatedUser.passwordSetAt || now;
        updatedUser.passwordChangedAt = now;
        updatedUser.authVersion = Number(updatedUser.authVersion || 0) + 1;
        updatedUser.forcePasswordChange = false;
        clearTemporaryPasswordState(updatedUser);
        updatedUser.accountStatus = "active";
        updatedUser.resetRequestedAt = null;
        updatedUser.failedLoginAttempts = 0;
        updatedUser.lockedUntil = null;
        updatedUser.authProvider = "password";
        updatedUser.authMethods = Array.from(new Set([...(updatedUser.authMethods || []), "password", "email_otp"]));
        await updatedUser.save({ session });
        await consumePasswordResetToken(challenge, session);
        await revokeAllUserSessions(updatedUser._id, "security", session);
      });
    } finally {
      await session.endSession();
    }

    try {
      await writeLog({
        entityType: "user",
        entityId: updatedUser._id,
        action: "customer_password_reset_by_email",
        byUserId: updatedUser._id,
        byRole: "client",
        meta: { authVersion: Number(updatedUser.authVersion || 0) },
      });
    } catch (_err) {
      // Password reset must not fail because a non-critical audit write failed.
    }

    return res.status(200).json({ ok: true, status: "password_reset" });
  } catch (err) {
    return handleEmailAuthError(res, err);
  }
}

module.exports = {
  confirmExistingEmailVerification,
  requestEmailPasswordReset,
  requestExistingEmailVerification,
  resetPasswordWithEmail,
  startEmailRegistration,
  verifyEmailPasswordReset,
  verifyEmailRegistration,
};
