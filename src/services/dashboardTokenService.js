const jwt = require("jsonwebtoken");

const DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET;
const DASHBOARD_JWT_EXPIRES_IN = process.env.DASHBOARD_JWT_EXPIRES_IN || "7d";

function issueDashboardAccessToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      role: user.role,
      tokenType: "dashboard_access",
    },
    DASHBOARD_JWT_SECRET,
    { expiresIn: DASHBOARD_JWT_EXPIRES_IN }
  );
}

function getDashboardAccessTokenTtlSeconds(token) {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== "object") return null;
  const issuedAt = Number(decoded.iat);
  const expiresAt = Number(decoded.exp);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  return Math.max(0, expiresAt - issuedAt);
}

function issueDashboardSession(user) {
  const token = issueDashboardAccessToken(user);
  return {
    token,
    expiresIn: getDashboardAccessTokenTtlSeconds(token),
  };
}

module.exports = {
  DASHBOARD_JWT_SECRET,
  DASHBOARD_JWT_EXPIRES_IN,
  issueDashboardAccessToken,
  getDashboardAccessTokenTtlSeconds,
  issueDashboardSession,
};
