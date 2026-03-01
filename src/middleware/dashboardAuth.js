const jwt = require("jsonwebtoken");
const { DASHBOARD_JWT_SECRET } = require("../services/dashboardTokenService");

function dashboardAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing dashboard token" } });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, DASHBOARD_JWT_SECRET);
    if (decoded.tokenType !== "dashboard_access") {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid dashboard token type" } });
    }
    if (!decoded.userId || !decoded.role) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid dashboard token payload" } });
    }

    req.dashboardUserId = String(decoded.userId);
    req.dashboardUserRole = String(decoded.role);

    // Backward-compatible aliases for existing controllers that expect req.userId/req.userRole.
    req.userId = req.dashboardUserId;
    req.userRole = req.dashboardUserRole;
    return next();
  } catch (_err) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid dashboard token" } });
  }
}

function dashboardRoleMiddleware(allowedRoles) {
  return (req, res, next) => {
    const role = req.dashboardUserRole;
    if (!role) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing dashboard role" } });
    }
    if (role === "superadmin") {
      return next();
    }
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Insufficient dashboard permissions" } });
    }
    return next();
  };
}

module.exports = { dashboardAuthMiddleware, dashboardRoleMiddleware };
