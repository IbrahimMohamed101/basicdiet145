const express = require("express");
const fs = require("fs");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");
const routes = require("./routes");
const paymentRoutes = require("./routes/payments");
const { getAccountDeletionPage } = require("./controllers/accountDeletionController");
const requestLanguageMiddleware = require("./middleware/requestLanguage");
const errorResponse = require("./utils/errorResponse");
const { logger } = require("./utils/logger");
const { validateAndFixResponse } = require("./utils/encoding");
const swaggerSpec = require("./docs/swagger");

function normalizeTopLevelStatusField(payload, responseStatusCode, reqPath = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const isHttpSuccess = Number(responseStatusCode) < 400;
  if (
    isHttpSuccess
    && payload.ok === true
    && (
      reqPath.startsWith("/api/auth")
      || reqPath.startsWith("/api/account-deletion")
      || reqPath.startsWith("/api/app/account-deletion")
    )
  ) {
    return payload;
  }
  const isErrorPayload = payload.ok === false || Object.prototype.hasOwnProperty.call(payload, "error");
  if (!isHttpSuccess || isErrorPayload) {
    return payload;
  }

  if (
    (payload.status === true || payload.status === false)
    && !Object.prototype.hasOwnProperty.call(payload, "ok")
  ) {
    return payload;
  }

  const normalized = { ...payload, status: true };
  if (Object.prototype.hasOwnProperty.call(normalized, "ok")) {
    delete normalized.ok;
  }
  return normalized;
}

function mountSwaggerUi(app, { uiPath, rawPath, spec }) {
  app.get(rawPath, (_req, res) => {
    res.json(spec);
  });

  app.use(
    uiPath,
    swaggerUi.serve,
    swaggerUi.setup(spec)
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownAsSimpleHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;

  function closeList() {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(trimmed.slice(2))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  closeList();
  return html.join("\n");
}

function renderPrivacyPolicyPage() {
  const markdownPath = path.join(__dirname, "../PRIVACY_POLICY.md");
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const content = renderMarkdownAsSimpleHtml(markdown);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>basicdite Privacy Policy</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; color: #18212f; background: #f7f8fa; }
    main { max-width: 820px; margin: 0 auto; padding: 40px 20px 64px; background: #fff; min-height: 100vh; }
    h1, h2, h3 { line-height: 1.25; color: #111827; }
    h1 { margin-top: 0; }
    h2 { margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 24px; }
    ul { padding-left: 22px; }
    li { margin: 8px 0; }
    p { margin: 12px 0; }
  </style>
</head>
<body>
  <main>
${content}
  </main>
</body>
</html>`;
}

function resolveTrustProxySetting() {
  const raw = String(process.env.TRUST_PROXY || "").trim();
  if (raw) {
    if (raw === "true") return 1;
    if (raw === "false") return false;
    const numeric = Number(raw);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }

  const isRender = process.env.RENDER === "true" || Boolean(process.env.RENDER_EXTERNAL_URL);
  if (isRender) {
    return 1;
  }

  return null;
}

function parseConfiguredCorsOrigins() {
  const listOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://basicdiet145.onrender.com",
    process.env.FRONTEND_URL,
    process.env.DASHBOARD_URL,
    ...listOrigins,
  ].filter(Boolean)));
}

function createApp() {
  const app = express();

  const trustProxySetting = resolveTrustProxySetting();
  if (trustProxySetting !== null) {
    app.set("trust proxy", trustProxySetting);
  }

  app.use(helmet());

  const allowedOrigins = parseConfiguredCorsOrigins();
  const corsOptions = {
    origin: (origin, callback) => {
      // Allow same-origin requests (no Origin header) in all envs.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"],
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const normalized = normalizeTopLevelStatusField(payload, res.statusCode, req.originalUrl || req.path);
      const sanitized = validateAndFixResponse(normalized);
      try {
        JSON.stringify(sanitized);
        return originalJson(sanitized);
      } catch (e) {
        logger.error("JSON serialization error after sanitization", { error: e.message });
        return originalJson({ ok: false, error: "DATA_ERROR" });
      }
    };
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));

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
      return res.status(200).json({ status: true, db: { state: "up" } });
    } catch (err) {
      logger.error("Health check DB ping failed", { error: err.message });
      return res.status(503).json({ ok: false, db: { state: "down" } });
    }
  });

  // Keep a simple root health endpoint for deployment smoke tests.
  app.get("/", (_req, res) => {
    res.status(200).json({ status: true, message: "basicdiet145 backend is running" });
  });
  app.get("/account-deletion", getAccountDeletionPage);
  app.get("/privacy-policy", (_req, res) => {
    res.type("html").send(renderPrivacyPolicyPage());
  });
  app.get("/PRIVACY_POLICY.md", (_req, res) => {
    res.sendFile(path.join(__dirname, "../PRIVACY_POLICY.md"));
  });

  mountSwaggerUi(app, {
    uiPath: "/api-docs",
    rawPath: "/api-docs/swagger.json",
    spec: swaggerSpec,
  });
  mountSwaggerUi(app, {
    uiPath: "/subscriptions-api-docs",
    rawPath: "/subscriptions-api-docs/swagger.json",
    spec: swaggerSpec,
  });

  app.use("/", paymentRoutes.publicRouter);
  app.use("/api", requestLanguageMiddleware, routes);

  // JSON 404 handler for unknown /api/* routes.
  // Must be after all route registrations and before the global error handler.
  app.use("/api/*", (_req, res) => {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  // Basic error handler to capture unhandled errors
  app.use((err, _req, res, _next) => {
    if (err && /^CORS blocked for origin: /.test(err.message)) {
      return errorResponse(res, 403, "CORS", err.message);
    }
    if (
      err instanceof SyntaxError
      && err.status === 400
      && Object.prototype.hasOwnProperty.call(err, "body")
    ) {
      return errorResponse(res, 400, "VALIDATION_ERROR", "errors.validation.invalidJsonBody");
    }
    logger.error("Unhandled error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "errors.common.unexpectedError");
  });

  return app;
}

module.exports = { createApp };
