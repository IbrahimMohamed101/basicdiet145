const jwt = require("jsonwebtoken");
const User = require("../models/User");
const errorResponse = require("../utils/errorResponse");
const { JWT_ACCESS_SECRET } = require("../services/appTokenService");
const {
  filterAddonChoicesAvailability,
} = require("./filterAddonChoicesAvailability");

const LEGACY_JWT_SECRET = process.env.JWT_SECRET;

function continueRequest(req, res, next) {
  if (String(req.originalUrl || req.url || "").includes("/subscriptions/addon-choices")) {
    return filterAddonChoicesAvailability(req, res, next);
  }
  return next();
}

async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return continueRequest(req, res, next);
  }
  if (!authHeader.startsWith("Bearer ")) {
    return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
  }

  const token = authHeader.split(" ")[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_ACCESS_SECRET);
  } catch (err) {
    if (LEGACY_JWT_SECRET && LEGACY_JWT_SECRET !== JWT_ACCESS_SECRET) {
      try {
        decoded = jwt.verify(token, LEGACY_JWT_SECRET);
      } catch {
        return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
      }
    } else {
      return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
    }
  }

  if (decoded.tokenType === "app_guest" || decoded.role === "guest" || decoded.isGuest === true) {
    req.auth = {
      tokenType: "app_guest",
      role: "guest",
      isGuest: true,
    };
    req.isGuest = true;
    req.userRole = "guest";
    return continueRequest(req, res, next);
  }

  if (decoded.tokenType !== "app_access" || decoded.role !== "client" || !decoded.userId) {
    return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
  }

  const user = await User.findById(decoded.userId).select("_id role isActive email phone phoneE164").lean();
  if (!user || user.role !== "client") {
    return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
  }
  if (user.isActive === false) {
    return errorResponse(res, 403, "SESSION_REVOKED", "Session has been revoked");
  }

  req.userId = String(user._id);
  req.userRole = user.role;
  req.authenticatedUser = user;
  req.auth = {
    tokenType: "app_access",
    role: user.role,
    userId: String(user._id),
    isGuest: false,
  };
  return continueRequest(req, res, next);
}

module.exports = optionalAuthMiddleware;
