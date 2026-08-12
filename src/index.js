require("dotenv").config();
const {
  assertSubscriptionStackingProductionSafety,
} = require("./services/subscription/subscriptionStackingProductionSafetyService");
assertSubscriptionStackingProductionSafety(process.env);
const {
  assertSubscriptionStackingRolloutConfiguration,
  assertExtraSelectionCanaryConfiguration,
} = require("./services/subscription/subscriptionStackingRolloutPolicyService");
assertSubscriptionStackingRolloutConfiguration(process.env);
assertExtraSelectionCanaryConfiguration(process.env);
// The legacy backend repair composition installs the canonical add-on pricing
// and client contract. It must complete before any stacking installer can load
// cancellation -> selection -> allocation services and capture stale exports.
require("./services/installSubscriptionBackendRepairComposition");
require("./services/installSubscriptionStackingUnsupportedActionGuards");
require("./services/installSubscriptionStackingShadowProjection");
require("./services/installSubscriptionStackingCheckoutPreflight");
require("./services/installSubscriptionStackingWriteRouter");
require("./services/installSubscriptionStackingSelectionRouter");
require("./services/installSubscriptionStackingEntitlementRouter");
// Install the planned Pickup adapter after the authenticated repair composition
// and stacking entitlement router. It reuses confirmed-day allocations only for
// the exact canary owner; global-off and non-allowlisted writes stay fail-closed.
require("./services/installSubscriptionStackingPlannedPickupRouter");
// The backend repair composition has already installed Pickup recovery and
// authenticated ownership wrappers. Add the stacking wallet projection after
// those wrappers and before createApp loads controllers/routes, so Flutter sees
// the final read surface while non-rollout users remain byte-for-byte legacy.
require("./services/installSubscriptionStackingPickupAvailabilityProjection");
require("./services/installUpcomingSubscriptionPlanningBalance");
require("./services/installOneTimeOrderItemTypeCompatibility");

const { createServer } = require("http");
const { createApp } = require("./app");
// `createApp` loads the full route/service composition first. Install this
// authenticated, read-only probe afterwards so it cannot capture pre-composition
// subscription services or alter existing Flutter routes.
require("./services/installSubscriptionStackingRemoteReadinessRoute");
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
