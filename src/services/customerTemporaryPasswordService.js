const crypto = require("crypto");
const { validateAppPassword, hashAppPassword } = require("./appPasswordService");
const { revokeAllUserSessions } = require("./refreshSessionService");
const { writeLog } = require("../utils/log");

const DEFAULT_TEMP_PASSWORD_TTL_HOURS = 24 * 30;
const MIN_TEMP_PASSWORD_TTL_HOURS = 24 * 30;
const MAX_TEMP_PASSWORD_TTL_HOURS = 24 * 365;
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

function resolveTemporaryPasswordTtlHours() {
  const rawValue = process.env.ADMIN_TEMP_PASSWORD_TTL_HOURS;
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return DEFAULT_TEMP_PASSWORD_TTL_HOURS;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TEMP_PASSWORD_TTL_HOURS;
  }

  return Math.min(MAX_TEMP_PASSWORD_TTL_HOURS, Math.max(MIN_TEMP_PASSWORD_TTL_HOURS, value));
}

function shuffleSecure(chars) {
  const copy = chars.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.join("");
}

function randomChar(alphabet) {
  return alphabet[crypto.randomInt(0, alphabet.length)];
}

function generateTemporaryPassword(length = 10) {
  const size = Math.max(8, Number(length) || 10);
  const chars = [
    randomChar(UPPER),
    randomChar(LOWER),
    randomChar(DIGITS),
  ];
  while (chars.length < size) {
    chars.push(randomChar(TEMP_PASSWORD_ALPHABET));
  }
  return shuffleSecure(chars);
}

function validateTemporaryPassword(password) {
  const value = String(password || "");
  const appValidation = validateAppPassword(value);
  if (!appValidation.ok) {
    return appValidation;
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value)) {
    return {
      ok: false,
      message: "Temporary password must include uppercase, lowercase, and a digit",
    };
  }
  return { ok: true };
}

function getTemporaryPasswordExpiresAt(now = new Date()) {
  return new Date(now.getTime() + resolveTemporaryPasswordTtlHours() * 60 * 60 * 1000);
}

function clearTemporaryPasswordState(user) {
  user.forcePasswordChange = false;
  user.temporaryPasswordReason = null;
  user.temporaryPasswordIssuedAt = null;
  user.temporaryPasswordExpiresAt = null;
}

async function writeTemporaryPasswordAudit({ user, action, actorId, actorRole, reason, expiresAt }) {
  try {
    await writeLog({
      entityType: "user",
      entityId: user._id,
      action,
      byUserId: actorId || user._id,
      byRole: actorRole || "system",
      meta: {
        reason: reason ? String(reason).slice(0, 500) : null,
        expiresAt,
        temporaryPasswordGeneration: Number(user.temporaryPasswordGeneration || 0),
        authVersion: Number(user.authVersion || 0),
      },
    });
  } catch (_err) {
    // Authentication state changes must not fail because audit persistence failed.
  }
}

async function issueCustomerTemporaryPassword({
  user,
  temporaryPassword,
  reason,
  actorId = null,
  actorRole = null,
  resetReason = null,
  revokeSessions = false,
  invalidateAccessTokens = false,
  saveOptions = undefined,
}) {
  const plaintextTemporaryPassword = temporaryPassword
    ? String(temporaryPassword)
    : generateTemporaryPassword();
  const validation = validateTemporaryPassword(plaintextTemporaryPassword);
  if (!validation.ok) {
    const err = new Error(validation.message);
    err.status = 400;
    err.code = "WEAK_PASSWORD";
    throw err;
  }

  const now = new Date();
  const expiresAt = getTemporaryPasswordExpiresAt(now);
  user.passwordHash = await hashAppPassword(plaintextTemporaryPassword);
  user.forcePasswordChange = true;
  user.temporaryPasswordReason = reason;
  user.temporaryPasswordIssuedAt = now;
  user.temporaryPasswordExpiresAt = expiresAt;
  user.temporaryPasswordGeneration = Number(user.temporaryPasswordGeneration || 0) + 1;
  user.accountStatus = "active";
  user.resetRequestedAt = null;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.authProvider = "password";
  user.authMethods = Array.from(new Set([...(Array.isArray(user.authMethods) ? user.authMethods : []), "password"]));
  if (reason === "admin_reset") {
    user.lastAdminPasswordResetAt = now;
    user.lastAdminPasswordResetBy = actorId || null;
  }
  if (invalidateAccessTokens) {
    user.authVersion = Number(user.authVersion || 0) + 1;
  }

  await user.save(saveOptions);

  if (revokeSessions) {
    await revokeAllUserSessions(user._id);
  }

  await writeTemporaryPasswordAudit({
    user,
    action: reason === "admin_reset" ? "admin_reset_customer_password" : "admin_created_app_user",
    actorId,
    actorRole,
    reason: resetReason,
    expiresAt,
  });

  return {
    temporaryPassword: plaintextTemporaryPassword,
    expiresAt,
    generation: Number(user.temporaryPasswordGeneration || 0),
  };
}

module.exports = {
  generateTemporaryPassword,
  validateTemporaryPassword,
  getTemporaryPasswordExpiresAt,
  clearTemporaryPasswordState,
  issueCustomerTemporaryPassword,
  resolveTemporaryPasswordTtlHours,
};