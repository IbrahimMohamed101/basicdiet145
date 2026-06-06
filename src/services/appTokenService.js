const jwt = require("jsonwebtoken");

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "supersecret";
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_ACCESS_EXPIRES_IN || "15m";
const GUEST_TOKEN_EXPIRES_IN = process.env.GUEST_TOKEN_EXPIRES_IN || "30m";

function parseExpiresInSeconds(value) {
  const raw = String(value || "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+)([smhd])$/i);
  if (!match) return 15 * 60;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  if (unit === "d") return amount * 24 * 60 * 60;
  return 15 * 60;
}

const ACCESS_TOKEN_EXPIRES_SECONDS = parseExpiresInSeconds(ACCESS_TOKEN_EXPIRES_IN);
const GUEST_TOKEN_EXPIRES_SECONDS = parseExpiresInSeconds(GUEST_TOKEN_EXPIRES_IN);

function issueAppAccessToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      role: "client",
      tokenType: "app_access",
    },
    JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

function issueGuestAccessToken() {
  return jwt.sign(
    {
      role: "guest",
      isGuest: true,
      tokenType: "app_guest",
    },
    JWT_ACCESS_SECRET,
    { expiresIn: GUEST_TOKEN_EXPIRES_IN }
  );
}

module.exports = {
  issueAppAccessToken,
  issueGuestAccessToken,
  JWT_ACCESS_SECRET,
  ACCESS_TOKEN_EXPIRES_SECONDS,
  ACCESS_TOKEN_EXPIRES_IN,
  GUEST_TOKEN_EXPIRES_SECONDS,
  GUEST_TOKEN_EXPIRES_IN,
};
