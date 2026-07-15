require("dotenv").config();

const { createServer } = require("http");
const { createApp } = require("./app");
const { connectDb } = require("./db");
const mongoose = require("mongoose");
const { startJobs } = require("./jobs");
const { validateEnv } = require("./utils/validateEnv");
const { logger } = require("./utils/logger");

process.on("unhandledRejection", (reason) => {
  logger.error("[startup] Unhandled rejection", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.error("[startup] Uncaught exception", {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

if (!process.env.PORT) {
  logger.error("PORT environment variable is required");
  process.exit(1);
}

const PORT = process.env.PORT;

const app = createApp();
const server = createServer(app);

const envCheck = validateEnv();
if (!envCheck.ok) {
  logger.error("Environment validation failed", {
    missing: envCheck.missing,
    invalid: envCheck.invalid,
    securityViolations: envCheck.securityViolations,
    message: envCheck.message,
  });
  process.exit(1);
}

logger.info("[startup] Runtime configuration resolved", {
  nodeEnv: process.env.NODE_ENV || "development",
  port: PORT,
});

logger.info("[startup] Starting database connection");
connectDb()
  .then(async () => {
    logger.info("[startup] MongoDB connected");

    logger.info("[startup] Starting background jobs");
    startJobs();
    logger.info("[startup] Background jobs started");

    logger.info("[startup] Starting HTTP server", { port: PORT, host: "0.0.0.0" });
    server.listen(PORT, "0.0.0.0", () => {
      logger.info("[startup] API listening", { port: PORT, host: "0.0.0.0" });
    });
  })
  .catch((err) => {
    logger.error("[startup] Failed to connect DB", { error: err.message, stack: err.stack });
    process.exit(1);
  });

function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Graceful shutdown start...`);
  server.close(() => {
    logger.info("HTTP server closed.");
    mongoose.connection.close(false).then(() => {
      logger.info("MongoDB connection closed.");
      process.exit(0);
    }).catch((err) => {
      logger.error("Error during MongoDB connection closure", { error: err.message });
      process.exit(1);
    });
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error("Could not close connections in time, forcefully shutting down");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
