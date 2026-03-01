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

module.exports = {
  DASHBOARD_JWT_SECRET,
  DASHBOARD_JWT_EXPIRES_IN,
  issueDashboardAccessToken,
};
