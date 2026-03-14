const express = require("express");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const routes = require("./routes");
const { logger } = require("./utils/logger");

function normalizeTopLevelOkField(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "ok")) {
    return payload;
  }

  const { ok, ...rest } = payload;
  return { status: ok, ...rest };
}

function createApp() {
  const app = express();

  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const value = trustProxy === "true" ? 1 : Number(trustProxy);
    if (!Number.isNaN(value)) {
      app.set("trust proxy", value);
    }
  }

  app.use(helmet());

  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(normalizeTopLevelOkField(payload));
    next();
  });

  /**
   * @openapi
   * /health:
   *   get:
   *     summary: Health check
   *     description: Returns API and database connectivity status.
   *     responses:
   *       200:
   *         description: OK
   *       503:
   *         description: Database unavailable
   */
  app.get("/health", async (_req, res) => {
    const state = mongoose.connection.readyState;
    if (state !== 1) {
      return res.status(503).json({ ok: false, db: { state } });
    }
    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
      }
      return res.status(200).json({ ok: true, db: { state: "up" } });
    } catch (err) {
      logger.error("Health check DB ping failed", { error: err.message });
      return res.status(503).json({ ok: false, db: { state: "down" } });
    }
  });

  // Keep a simple root health endpoint for deployment smoke tests.
  app.get("/", (_req, res) => {
    res.status(200).json({ ok: true, message: "basicdiet145 backend is running" });
  });

  const swaggerPath = path.join(__dirname, "..", "swagger.yaml");
  app.get("/api-docs/swagger.yaml", (_req, res) => {
    res.type("text/yaml");
    res.sendFile(swaggerPath);
  });

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(null, {
      swaggerOptions: {
        url: "/api-docs/swagger.yaml",
      },
    })
  );

  app.use("/api", routes);

  // Basic error handler to capture unhandled errors
  app.use((err, _req, res, _next) => {
    if (err && err.message === "Not allowed by CORS") {
      return res.status(403).json({ ok: false, error: { code: "CORS", message: err.message } });
    }
    logger.error("Unhandled error", { error: err.message, stack: err.stack });
    res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Unexpected error" } });
  });

  return app;
}

module.exports = { createApp };
