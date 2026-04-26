require("dotenv").config();

const { createServer } = require("http");
const { createApp } = require("./app");
const { connectDb } = require("./db");
const { startJobs } = require("./jobs");
const { validateEnv } = require("./utils/validateEnv");
const { logger } = require("./utils/logger");

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

connectDb()
  .then(async () => {
    startJobs();
    server.listen(PORT, "0.0.0.0", () => {
      logger.info("API listening", { port: PORT, host: "0.0.0.0" });
    });
  })
  .catch((err) => {
    logger.error("Failed to connect DB", { error: err.message, stack: err.stack });
    process.exit(1);
  });
