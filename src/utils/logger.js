const fs = require("fs");
const path = require("path");
const winston = require("winston");
const { sanitizeLogData } = require("./security");

const logDir = process.env.LOG_DIR || "logs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Custom winston format that strips sensitive keys from log metadata
 * before the data reaches any transport (console, file, or remote).
 */
const sanitizeFormat = winston.format((info) => {
  // info may contain spread metadata keys — sanitise the whole object
  const sanitized = sanitizeLogData(info);
  // Preserve winston internals that must not be stripped
  sanitized.level = info.level;
  sanitized.message = info.message;
  if (info.timestamp) sanitized.timestamp = info.timestamp;
  if (info.stack) sanitized.stack = info.stack;
  return sanitized;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? "warn" : "info"),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    sanitizeFormat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024,  // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logDir, "app.log"),
      level: process.env.LOG_LEVEL || (isProduction ? "warn" : "info"),
      maxsize: 10 * 1024 * 1024,  // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

module.exports = { logger };
