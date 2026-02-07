const DashboardUser = require("../models/DashboardUser");
const { auth } = require("../auth/betterAuth");
const { fromNodeHeaders } = require("better-auth/node");

const DEV_AUTH_BYPASS = process.env.DEV_AUTH_BYPASS === "true";
const DASHBOARD_DEV_TOKEN = process.env.DASHBOARD_DEV_TOKEN;
const DASHBOARD_DEV_ROLE = process.env.DASHBOARD_DEV_ROLE || "admin";
const DASHBOARD_DEV_EMAIL = process.env.DASHBOARD_DEV_EMAIL || "dev-admin@example.com";

async function dashboardAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (DEV_AUTH_BYPASS && DASHBOARD_DEV_TOKEN && authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token === DASHBOARD_DEV_TOKEN) {
        req.dashboardUser = {
          email: DASHBOARD_DEV_EMAIL,
          role: DASHBOARD_DEV_ROLE,
          isActive: true,
        };
        req.dashboardRole = DASHBOARD_DEV_ROLE;
        return next();
      }
    }

    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session || !session.user || !session.user.email) {
      return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing session" } });
    }

    const dashboardUser = await DashboardUser.findOne({ email: session.user.email, isActive: true }).lean();
    if (!dashboardUser) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "No dashboard access" } });
    }

    req.dashboardUser = dashboardUser;
    req.dashboardRole = dashboardUser.role;
    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid session" } });
  }
}

function dashboardRoleMiddleware(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.dashboardRole)) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Insufficient permissions" } });
    }
    return next();
  };
}

module.exports = { dashboardAuthMiddleware, dashboardRoleMiddleware };
