const express = require("express");
const router = express.Router();
const healthCheckService = require("../services/catalogHealthService");
const { dashboardAuthMiddleware, dashboardRoleMiddleware } = require("../middleware/dashboardAuth");
const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");

router.use(dashboardAuthMiddleware, dashboardRoleMiddleware(["admin"]));

router.get("/catalog", async (req, res) => {
  try {
    const report = await healthCheckService.checkPlanCatalogHealth();
    return res.status(200).json({ status: true, data: report });
  } catch (err) {
    logger.error("Health check catalog failed", { error: err.message });
    return errorResponse(res, 500, "INTERNAL", "Health check failed");
  }
});

router.get("/subscriptions", async (req, res) => {
  try {
    const report = await healthCheckService.auditSubscriptionIntegrity();
    return res.status(200).json({ status: true, data: report });
  } catch (err) {
    logger.error("Health check subscriptions failed", { error: err.message });
    return errorResponse(res, 500, "INTERNAL", "Health check failed");
  }
});

module.exports = router;
