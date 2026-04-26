const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { localizeErrorMessage } = require("../utils/errorLocalization");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
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
    return sendResponse(req, res, false, "errors.auth.missingToken", 401);
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
    return sendResponse(req, res, false, "errors.auth.invalidToken", 401);
  }

  if (decoded.tokenType !== "app_access" || decoded.role !== "client") {
    return sendResponse(req, res, false, "errors.auth.invalidTokenType", 401);
  }
  if (!decoded.userId || !decoded.role) {
    return sendResponse(req, res, false, "errors.auth.invalidTokenPayload", 401);
  }

  return User.findById(decoded.userId)
    .select("_id role isActive")
    .lean()
    .then((user) => {
      if (!user || user.role !== "client") {
        return sendResponse(req, res, false, "errors.auth.invalidTokenPayload", 401);
      }
      if (user.isActive === false) {
        return sendResponse(req, res, false, "errors.auth.inactiveUser", 403);
      }

      req.userId = String(user._id);
      req.userRole = user.role;
      return next();
    })
    .catch(() => sendResponse(req, res, false, "errors.common.unexpectedError", 500));
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
