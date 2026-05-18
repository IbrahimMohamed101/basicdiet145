require("dotenv").config();

const { createServer } = require("http");
const { createApp } = require("./app");
const { connectDb } = require("./db");
const mongoose = require("mongoose");
const { startJobs } = require("./jobs");
const { validateEnv } = require("./utils/validateEnv");
const { logger } = require("./utils/logger");

process.on("unhandledRejection", (reason, promise) => {
  console.error("[railway-startup] Unhandled Rejection at Promise", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("[railway-startup] Uncaught Exception thrown", {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

console.log(`NODE_ENV: ${process.env.NODE_ENV}, PORT: ${process.env.PORT}`);

if (!process.env.PORT) {
  console.error('PORT environment variable is required');
  process.exit(1);
}

const PORT = process.env.PORT;

const app = createApp();
const server = createServer(app);

const envCheck = validateEnv();
if (!envCheck.ok) {
  console.error(envCheck); process.exit(1);
}

console.log(`Resolved PORT: ${PORT} (env.PORT: ${process.env.PORT || 'undefined'})`);

console.log("[railway-startup] Starting database connection");
connectDb()
  .then(async () => {
    console.log("[railway-startup] MongoDB connected");

    console.log("[railway-startup] Starting background jobs");
    startJobs();
    console.log("[railway-startup] Background jobs started");

    console.log(`[railway-startup] Starting HTTP server on port: ${PORT}`);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`[railway-startup] API listening on port: ${PORT}, host: 0.0.0.0`);
    });
  })
  .catch((err) => {
    console.error("[railway-startup] Failed to connect DB", { error: err.message, stack: err.stack });
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
