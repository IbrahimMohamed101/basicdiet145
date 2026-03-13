const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const DEV_AUTH_BYPASS = process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true";
const DEV_STATIC_TOKEN = process.env.DEV_STATIC_TOKEN;
const DEV_STATIC_USER_ID = process.env.DEV_STATIC_USER_ID || "507f1f77bcf86cd799439011";
const DEV_STATIC_ROLE = process.env.DEV_STATIC_ROLE || "client";

function sendResponse(res, status, message, httpCode = 200) {
  return res.status(httpCode).json({ status, message });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendResponse(res, false, "Missing token", 401);
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
    return sendResponse(res, false, "Invalid token", 401);
  }

  if (decoded.tokenType !== "app_access" || decoded.role !== "client") {
    return sendResponse(res, false, "Invalid token type", 401);
  }
  if (!decoded.userId || !decoded.role) {
    return sendResponse(res, false, "Invalid token payload", 401);
  }

  return User.findById(decoded.userId)
    .select("_id role isActive")
    .lean()
    .then((user) => {
      if (!user || user.role !== "client") {
        return sendResponse(res, false, "Invalid token payload", 401);
      }
      if (user.isActive === false) {
        return sendResponse(res, false, "User account is inactive", 403);
      }

      req.userId = String(user._id);
      req.userRole = user.role;
      return next();
    })
    .catch(() => sendResponse(res, false, "Unexpected error", 500));
}

function roleMiddleware(allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.userRole)) {
      return sendResponse(res, false, "Insufficient permissions", 403);
    }
    next();
  };
}

module.exports = { authMiddleware, roleMiddleware, JWT_SECRET };
