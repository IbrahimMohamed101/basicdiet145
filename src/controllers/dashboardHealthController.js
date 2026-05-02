const dashboardHealthService = require("../services/dashboardHealthService");
const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");

function wrapHealth(handler, label) {
  return async (_req, res) => {
    try {
      const data = await handler();
      return res.status(200).json({ status: true, data });
    } catch (err) {
      logger.error(`Dashboard health ${label} failed`, { error: err.message, stack: err.stack });
      return errorResponse(res, 500, "INTERNAL", "Dashboard health check failed");
    }
  };
}

module.exports = {
  getCatalogHealth: wrapHealth(dashboardHealthService.getCatalogHealthReport, "catalog"),
  getSubscriptionMenuHealth: wrapHealth(dashboardHealthService.getSubscriptionMenuHealthReport, "subscription-menu"),
  getMealPlannerHealth: wrapHealth(dashboardHealthService.getMealPlannerHealthReport, "meal-planner"),
  getIndexesHealth: wrapHealth(dashboardHealthService.getIndexesHealthReport, "indexes"),
};
