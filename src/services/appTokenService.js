const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";

function issueAppAccessToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      role: "client",
      tokenType: "app_access",
    },
    JWT_SECRET,
    { expiresIn: process.env.APP_ACCESS_TOKEN_TTL || "30d" }
  );
}

module.exports = { issueAppAccessToken };
