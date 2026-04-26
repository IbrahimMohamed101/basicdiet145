const jwt = require("jsonwebtoken");
const { DASHBOARD_JWT_SECRET } = require("../services/dashboardTokenService");
const errorResponse = require("../utils/errorResponse");

function assignDashboardAuthContext(req, token) {
  try {
    const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
    if (decoded.tokenType !== "dashboard_access") {
      return { ok: false, error: { code: "UNAUTHORIZED", messageKey: "errors.dashboardAuth.invalidTokenType" } };
    }
    if (!decoded.userId || !decoded.role) {
      return { ok: false, error: { code: "UNAUTHORIZED", messageKey: "errors.dashboardAuth.invalidTokenPayload" } };
    }

    req.dashboardUserId = String(decoded.userId);
    req.dashboardUserRole = String(decoded.role);

    // Backward-compatible aliases for existing controllers that expect req.userId/req.userRole.
    req.userId = req.dashboardUserId;
    req.userRole = req.dashboardUserRole;
    return { ok: true };
  } catch (_err) {
    return { ok: false, error: { code: "UNAUTHORIZED", messageKey: "errors.dashboardAuth.invalidToken" } };
  }
}

function dashboardAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(res, 401, "UNAUTHORIZED", { messageKey: "errors.dashboardAuth.missingToken" });
  }

  const token = authHeader.split(" ")[1];
  const result = assignDashboardAuthContext(req, token);
  if (!result.ok) {
    return errorResponse(res, 401, result.error.code, result.error);
  }
  return next();
}

function dashboardOptionalAuthMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];
  assignDashboardAuthContext(req, token);
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
