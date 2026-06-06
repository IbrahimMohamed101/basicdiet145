const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { localizeErrorMessage } = require("../utils/errorLocalization");
const errorResponse = require("../utils/errorResponse");
const { JWT_ACCESS_SECRET } = require("../services/appTokenService");

const JWT_SECRET = JWT_ACCESS_SECRET;
const LEGACY_JWT_SECRET = process.env.JWT_SECRET;
const DEV_AUTH_BYPASS = process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true";
const DEV_STATIC_TOKEN = process.env.DEV_STATIC_TOKEN;
const DEV_STATIC_USER_ID = process.env.DEV_STATIC_USER_ID || "507f1f77bcf86cd799439011";
const DEV_STATIC_ROLE = process.env.DEV_STATIC_ROLE || "client";

function sendResponse(req, res, status, message, httpCode = 200) {
  return res.status(httpCode).json({ status, message: localizeErrorMessage(message, req) });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(res, 401, "AUTH_REQUIRED", "Authentication required");
  }

  const token = authHeader.split(" ")[1];
  if (DEV_AUTH_BYPASS && DEV_STATIC_TOKEN && token === DEV_STATIC_TOKEN) {
    req.userId = DEV_STATIC_USER_ID;
    req.userRole = DEV_STATIC_ROLE;
    return next();
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (LEGACY_JWT_SECRET && LEGACY_JWT_SECRET !== JWT_SECRET) {
      try {
        decoded = jwt.verify(token, LEGACY_JWT_SECRET);
      } catch (legacyErr) {
        if ((err && err.name === "TokenExpiredError") || (legacyErr && legacyErr.name === "TokenExpiredError")) {
          return errorResponse(res, 401, "TOKEN_EXPIRED", "Access token expired");
        }
        return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
      }
    } else {
      if (err && err.name === "TokenExpiredError") {
        return errorResponse(res, 401, "TOKEN_EXPIRED", "Access token expired");
      }
      return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
    }
  }

  if (decoded.tokenType === "app_guest" || decoded.role === "guest" || decoded.isGuest === true) {
    return errorResponse(res, 403, "GUEST_ACCESS_NOT_ALLOWED", "Please sign in to continue.");
  }

  if (decoded.tokenType !== "app_access" || decoded.role !== "client") {
    return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
  }
  if (!decoded.userId || !decoded.role) {
    return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
  }

  return User.findById(decoded.userId)
    .select("_id role isActive")
    .lean()
    .then((user) => {
      if (!user || user.role !== "client") {
        return errorResponse(res, 401, "TOKEN_INVALID", "Invalid access token");
      }
      if (user.isActive === false) {
        return errorResponse(res, 403, "SESSION_REVOKED", "Session has been revoked");
      }

      req.userId = String(user._id);
      req.userRole = user.role;
      return next();
    })
    .catch(() => errorResponse(res, 500, "INTERNAL", "Unexpected error"));
}

function roleMiddleware(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.userRole)) {
      return sendResponse(req, res, false, "errors.auth.insufficientPermissions", 403);
    }
    next();
  };
}

module.exports = { authMiddleware, roleMiddleware, JWT_SECRET };
