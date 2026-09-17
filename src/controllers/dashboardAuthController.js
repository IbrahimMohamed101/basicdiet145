const DashboardUser = require("../models/DashboardUser");
const errorResponse = require("../utils/errorResponse");
const { issueDashboardSession } = require("../services/dashboardTokenService");
const {
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
  compareDashboardPassword,
  sanitizeDashboardUser,
} = require("../services/dashboardPasswordService");

const DASHBOARD_AUTH_MAX_FAILED_ATTEMPTS = Number(process.env.DASHBOARD_AUTH_MAX_FAILED_ATTEMPTS || 5);
const DASHBOARD_AUTH_LOCK_MINUTES = Number(process.env.DASHBOARD_AUTH_LOCK_MINUTES || 15);

function resolveLockoutSettings() {
  const maxAttempts = Number.isFinite(DASHBOARD_AUTH_MAX_FAILED_ATTEMPTS) && DASHBOARD_AUTH_MAX_FAILED_ATTEMPTS > 0
    ? Math.floor(DASHBOARD_AUTH_MAX_FAILED_ATTEMPTS)
    : 5;
  const lockMinutes = Number.isFinite(DASHBOARD_AUTH_LOCK_MINUTES) && DASHBOARD_AUTH_LOCK_MINUTES > 0
    ? Math.floor(DASHBOARD_AUTH_LOCK_MINUTES)
    : 15;
  return { maxAttempts, lockMinutes };
}

async function login(req, res) {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeDashboardEmail(email);
  if (!normalizedEmail || !password) {
    return errorResponse(res, 400, "INVALID", "Missing email or password");
  }
  if (!isValidEmailFormat(normalizedEmail)) {
    return errorResponse(res, 400, "INVALID", "Invalid email format");
  }

  const user = await DashboardUser.findOne(buildDashboardEmailQuery(normalizedEmail));
  if (!user) {
    return errorResponse(res, 401, "UNAUTHORIZED", "Invalid email or password");
  }
  if (!user.isActive) {
    return errorResponse(res, 403, "FORBIDDEN", "Dashboard user is inactive");
  }

  const now = new Date();
  if (user.lockUntil && user.lockUntil > now) {
    const seconds = Math.ceil((new Date(user.lockUntil).getTime() - now.getTime()) / 1000);
    return errorResponse(res, 423, "LOCKED", `Account temporarily locked. Retry in ${seconds}s`);
  }

  const passwordMatches = await compareDashboardPassword(password, user.passwordHash);
  if (!passwordMatches) {
    const { maxAttempts, lockMinutes } = resolveLockoutSettings();
    user.failedAttempts = Number(user.failedAttempts || 0) + 1;
    if (user.failedAttempts >= maxAttempts) {
      user.lockUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);
      user.failedAttempts = 0;
    }
    await user.save();
    return errorResponse(res, 401, "UNAUTHORIZED", "Invalid email or password");
  }

  user.failedAttempts = 0;
  user.lockUntil = null;
  user.lastLoginAt = now;
  await user.save();

  const session = issueDashboardSession(user);
  return res.status(200).json({
    status: true,
    ...session,
    user: sanitizeDashboardUser(user),
  });
}

async function me(req, res) {
  if (!req.dashboardUserId) {
    return res.status(200).json({
      status: false,
      data: { user: null },
      user: null,
    });
  }
  const user = await DashboardUser.findOne({
    _id: req.dashboardUserId,
    isActive: true,
  }).lean();
  if (!user) {
    return res.status(200).json({
      status: false,
      data: { user: null },
      user: null,
    });
  }
  const sanitizedUser = sanitizeDashboardUser(user);
  const session = issueDashboardSession(user);
  return res.status(200).json({
    status: true,
    ...session,
    data: { user: sanitizedUser },
    user: sanitizedUser,
  });
}

async function changePassword(req, res) {
  const currentPassword = String((req.body && req.body.currentPassword) || "");
  const newPassword = String((req.body && req.body.newPassword) || "");

  if (!currentPassword || !newPassword) {
    return errorResponse(res, 400, "INVALID", "Current password and new password are required");
  }

  const passwordValidation = validateDashboardPassword(newPassword);
  if (!passwordValidation.ok) {
    return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);
  }

  const user = await DashboardUser.findOne({
    _id: req.dashboardUserId,
    isActive: true,
  });
  if (!user) {
    return errorResponse(res, 404, "DASHBOARD_USER_NOT_FOUND", "Dashboard user not found");
  }

  const currentPasswordMatches = await compareDashboardPassword(currentPassword, user.passwordHash);
  if (!currentPasswordMatches) {
    return errorResponse(res, 401, "CURRENT_PASSWORD_INVALID", "Current password is incorrect");
  }

  const passwordUnchanged = await compareDashboardPassword(newPassword, user.passwordHash);
  if (passwordUnchanged) {
    return errorResponse(res, 409, "PASSWORD_UNCHANGED", "New password must be different from current password");
  }

  user.passwordHash = await hashDashboardPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.failedAttempts = 0;
  user.lockUntil = null;
  user.updatedBy = user._id;
  await user.save();

  const session = issueDashboardSession(user);
  return res.status(200).json({
    status: true,
    ...session,
    user: sanitizeDashboardUser(user),
  });
}

async function logout(_req, res) {
  // JWT is stateless. Server-side logout is a no-op unless token blacklist is introduced.
  return res.status(200).json({ status: true });
}

module.exports = { login, me, changePassword, logout };
