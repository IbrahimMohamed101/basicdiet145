const jwt = require("jsonwebtoken");
const { DASHBOARD_JWT_SECRET } = require("../services/dashboardTokenService");
const DashboardUser = require("../models/DashboardUser");
const errorResponse = require("../utils/errorResponse");

/**
 * Decodes and validates a dashboard JWT.
 * Returns { ok: true, userId, role, issuedAt } or { ok: false, error }.
 * Does NOT hit the DB — that is done in dashboardAuthMiddleware.
 */
function decodeDashboardToken(token) {
  try {
    const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
    if (decoded.tokenType !== "dashboard_access") {
      return { ok: false, error: { code: "UNAUTHORIZED", messageKey: "errors.dashboardAuth.invalidTokenType" } };
    }
    if (!decoded.userId || !decoded.role) {
      return { ok: false, error: { code: "UNAUTHORIZED", messageKey: "errors.dashboardAuth.invalidTokenPayload" } };
    }
    return { ok: true, userId: String(decoded.userId), role: String(decoded.role), issuedAt: decoded.iat || null };
  } catch (_err) {
    return { ok: false, error: { code: "UNAUTHORIZED", messageKey: "errors.dashboardAuth.invalidToken" } };
  }
}

/**
 * Protected dashboard auth middleware.
 *
 * SECURITY: Re-checks the current DashboardUser record from DB on every request
 * so that deactivated users or role changes take effect immediately.
 * Uses the DB role as source of truth — NOT the stale token role.
 */
async function dashboardAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(res, 401, "UNAUTHORIZED", { messageKey: "errors.dashboardAuth.missingToken" });
  }

  const token = authHeader.split(" ")[1];
  const decoded = decodeDashboardToken(token);
  if (!decoded.ok) {
    return errorResponse(res, 401, decoded.error.code, decoded.error);
  }

  // DB lookup — fresh state, not token cache
  let user;
  try {
    user = await DashboardUser.findById(decoded.userId)
      .select("_id role isActive passwordChangedAt")
      .lean();
  } catch (_err) {
    return errorResponse(res, 500, "INTERNAL", "Unexpected error during auth");
  }

  if (!user) {
    return errorResponse(res, 401, "UNAUTHORIZED", { messageKey: "errors.dashboardAuth.userNotFound" });
  }
  if (user.isActive === false) {
    return errorResponse(res, 403, "FORBIDDEN", { messageKey: "errors.dashboardAuth.userInactive" });
  }

  // If the user changed their password after this token was issued, invalidate it.
  if (user.passwordChangedAt && decoded.issuedAt) {
    const changedAtSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
    if (changedAtSec > decoded.issuedAt) {
      return errorResponse(res, 401, "TOKEN_REVOKED", { messageKey: "errors.dashboardAuth.tokenRevoked" });
    }
  }

  // Use current DB role — not the potentially stale token role
  req.dashboardUser = user;
  req.dashboardUserId = String(user._id);
  req.dashboardUserRole = String(user.role);

  // Backward-compatible aliases for existing controllers that expect req.userId/req.userRole.
  req.userId = req.dashboardUserId;
  req.userRole = req.dashboardUserRole;

  return next();
}

/**
 * Optional dashboard auth middleware — populates context if token present, but
 * does NOT reject if missing. Still re-checks DB if token is provided.
 */
async function dashboardOptionalAuthMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];
  const decoded = decodeDashboardToken(token);
  if (!decoded.ok) {
    return next(); // Ignore invalid token for optional middleware
  }

  try {
    const user = await DashboardUser.findById(decoded.userId)
      .select("_id role isActive passwordChangedAt")
      .lean();

    if (user && user.isActive !== false) {
      req.dashboardUser = user;
      req.dashboardUserId = String(user._id);
      req.dashboardUserRole = String(user.role);
      req.userId = req.dashboardUserId;
      req.userRole = req.dashboardUserRole;
    }
  } catch (_err) {
    // Silent failure for optional middleware
  }

  return next();
}

function dashboardRoleMiddleware(allowedRoles) {
  return (req, res, next) => {
    const role = req.dashboardUserRole;
    if (!role) {
      return errorResponse(res, 401, "UNAUTHORIZED", { messageKey: "errors.dashboardAuth.missingRole" });
    }
    if (role === "superadmin") {
      return next();
    }
    if (!allowedRoles.includes(role)) {
      return errorResponse(res, 403, "FORBIDDEN", { messageKey: "errors.dashboardAuth.insufficientPermissions" });
    }
    return next();
  };
}

module.exports = { dashboardAuthMiddleware, dashboardOptionalAuthMiddleware, dashboardRoleMiddleware };
