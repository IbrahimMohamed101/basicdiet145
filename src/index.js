require("dotenv").config();

const { createServer } = require("http");
const { createApp } = require("./app");
const { connectDb } = require("./db");
const { startJobs } = require("./jobs");
const { validateEnv } = require("./utils/validateEnv");
const { logger } = require("./utils/logger");

const PORT = process.env.PORT || 3000;

const app = createApp();
const server = createServer(app);

const envCheck = validateEnv();
if (!envCheck.ok) {
  process.exit(1);
}

connectDb()
  .then(() => {
    startJobs();
    server.listen(PORT, () => {
      logger.info("API listening", { port: PORT });
    });
  })
  .catch((err) => {
    logger.error("Failed to connect DB", { error: err.message, stack: err.stack });
    process.exit(1);
  });
