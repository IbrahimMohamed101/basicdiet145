const express = require("express");
const router = express.Router();
const healthCheckService = require("../services/catalogHealthService");
const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");

// Middleware to ensure admin/internal access (placeholder - assuming standard middleware exists)
// For now, I'll just implement the controller logic directly or use a controller file.

router.get("/catalog", async (req, res) => {
  try {
    const report = await healthCheckService.checkPlanCatalogHealth();
    return res.status(200).json({ ok: true, data: report });
  } catch (err) {
    logger.error("Health check catalog failed", { error: err.message });
    return errorResponse(res, 500, "INTERNAL", "Health check failed");
  }
});

router.get("/subscriptions", async (req, res) => {
  try {
    const report = await healthCheckService.auditSubscriptionIntegrity();
    return res.status(200).json({ ok: true, data: report });
  } catch (err) {
    logger.error("Health check subscriptions failed", { error: err.message });
    return errorResponse(res, 500, "INTERNAL", "Health check failed");
  }
});

module.exports = router;
