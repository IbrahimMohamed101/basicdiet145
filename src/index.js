require("dotenv").config();

const { createServer } = require("http");
const { createApp } = require("./app");
const { connectDb } = require("./db");
const { startJobs } = require("./jobs");
const { validateEnv } = require("./utils/validateEnv");
const { logger } = require("./utils/logger");

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at Promise", {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception thrown", {
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

logger.info("[startup] Starting database connection");
connectDb()
  .then(async () => {
    logger.info("[startup] Database startup complete");

    logger.info("[startup] Starting background jobs");
    startJobs();
    logger.info("[startup] Background jobs started");

    logger.info("[startup] Starting HTTP server", { port: PORT, host: "0.0.0.0" });
    server.listen(PORT, "0.0.0.0", () => {
      logger.info("API listening", { port: PORT, host: "0.0.0.0" });
    });
  })
  .catch((err) => {
    logger.error("Failed to connect DB", { error: err.message, stack: err.stack });
    process.exit(1);
  });
