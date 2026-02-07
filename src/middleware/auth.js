const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const DEV_AUTH_BYPASS = process.env.DEV_AUTH_BYPASS === "true";
const DEV_STATIC_TOKEN = process.env.DEV_STATIC_TOKEN;
const DEV_STATIC_USER_ID = process.env.DEV_STATIC_USER_ID || "507f1f77bcf86cd799439011";
const DEV_STATIC_ROLE = process.env.DEV_STATIC_ROLE || "client";

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing token" } });
    }

    const token = authHeader.split(" ")[1];
    if (DEV_AUTH_BYPASS && DEV_STATIC_TOKEN && token === DEV_STATIC_TOKEN) {
        req.userId = DEV_STATIC_USER_ID;
        req.userRole = DEV_STATIC_ROLE;
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userRole = decoded.role;
        return next();
    } catch (err) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid token" } });
    }
}

function roleMiddleware(allowedRoles) {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.userRole)) {
            return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Insufficient permissions" } });
        }
        next();
    };
}

module.exports = { authMiddleware, roleMiddleware, JWT_SECRET };
