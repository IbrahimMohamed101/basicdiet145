"use strict";

const User = require("../../models/User");
const AppUser = require("../../models/AppUser");
const validateObjectId = require("../../utils/validateObjectId");
const { writeLog } = require("../../utils/log");
const { validateAppPassword, hashAppPassword } = require("../appPasswordService");
const { generateTemporaryPassword } = require("../customerTemporaryPasswordService");
const { revokeAllUserSessions } = require("../refreshSessionService");

const GENERATED_PASSWORD_LENGTH = 12;
const MAX_REASON_LENGTH = 500;

function controlledError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeReason(reason) {
  const value = String(reason || "").trim();
  if (value.length < 3) {
    throw controlledError(400, "REASON_REQUIRED", "Password reset reason must be at least 3 characters");
  }
  if (value.length > MAX_REASON_LENGTH) {
    throw controlledError(400, "INVALID_REASON", `Password reset reason must be at most ${MAX_REASON_LENGTH} characters`);
  }
  return value;
}

async function findCoreCustomerByManagedId(id) {
  validateObjectId(id, "id");

  let coreUser = await User.findOne({ _id: id, role: "client" }).lean();
  if (coreUser) return coreUser;

  const appUser = await AppUser.findById(id).lean();
  if (!appUser) return null;

  if (appUser.coreUserId) {
    coreUser = await User.findOne({ _id: appUser.coreUserId, role: "client" }).lean();
  }
  if (!coreUser && appUser.phone) {
    coreUser = await User.findOne({
      role: "client",
      $or: [{ phone: appUser.phone }, { phoneE164: appUser.phone }],
    }).lean();
  }

  return coreUser || null;
}

async function auditPasswordReset({ user, actorId, actorRole, reason }) {
  try {
    await writeLog({
      entityType: "user",
      entityId: user._id,
      action: "dashboard_customer_password_reset_direct",
      byUserId: actorId || user._id,
      byRole: actorRole || "system",
      meta: {
        reason,
        authVersion: Number(user.authVersion || 0),
        sessionsRevoked: true,
        directLoginReady: true,
      },
    });
  } catch (_error) {
    // The credential change has already completed. Never expose a usable password
    // twice because audit persistence failed after the reset.
  }
}

async function resetCustomerPasswordDirect({ id, reason, actorId, actorRole }) {
  const normalizedReason = normalizeReason(reason);
  const currentUser = await findCoreCustomerByManagedId(id);

  if (!currentUser) {
    throw controlledError(404, "NOT_FOUND", "Customer not found");
  }
  if (currentUser.isActive === false) {
    throw controlledError(403, "INACTIVE_CUSTOMER", "Inactive customers must be reactivated before password reset");
  }

  const password = generateTemporaryPassword(GENERATED_PASSWORD_LENGTH);
  const validation = validateAppPassword(password);
  if (!validation.ok) {
    throw controlledError(500, "PASSWORD_GENERATION_FAILED", "Failed to generate a valid customer password");
  }
  const passwordHash = await hashAppPassword(password);
  const now = new Date();
  const authMethods = Array.from(
    new Set([...(Array.isArray(currentUser.authMethods) ? currentUser.authMethods : []), "password"])
  );

  // Revoke refresh sessions first. If the password write then fails, the only
  // side effect is a safe logout and staff can retry. This avoids ever returning
  // a new password while an old refresh session remains usable.
  await revokeAllUserSessions(currentUser._id, "admin_password_reset");

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: currentUser._id,
      role: "client",
      isActive: { $ne: false },
      authVersion: Number(currentUser.authVersion || 0),
    },
    {
      $set: {
        passwordHash,
        passwordSetAt: currentUser.passwordSetAt || now,
        passwordChangedAt: now,
        forcePasswordChange: false,
        temporaryPasswordReason: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        accountStatus: "active",
        resetRequestedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        authProvider: "password",
        authMethods,
        lastAdminPasswordResetAt: now,
        lastAdminPasswordResetBy: actorId || null,
      },
      $inc: {
        authVersion: 1,
        temporaryPasswordGeneration: 1,
      },
    },
    { new: true }
  ).lean();

  if (!updatedUser) {
    throw controlledError(
      409,
      "PASSWORD_RESET_CONFLICT",
      "Customer authentication state changed during password reset; retry the operation"
    );
  }

  await auditPasswordReset({
    user: updatedUser,
    actorId,
    actorRole,
    reason: normalizedReason,
  });

  return {
    userId: String(updatedUser._id),
    phoneE164: updatedUser.phoneE164 || updatedUser.phone,
    password,
    passwordChangedAt: updatedUser.passwordChangedAt,
    forcePasswordChange: false,
    sessionsRevoked: true,
    directLoginReady: true,
  };
}

module.exports = {
  resetCustomerPasswordDirect,
};
