"use strict";

const {
  isProjectionEnabled,
  projectDashboardSubscriptionResponse,
} = require("../services/subscription/subscriptionDashboardMealBalanceProjectionService");

const DASHBOARD_SUBSCRIPTION_READ_PATH =
  /\/dashboard\/subscriptions(?:\/(?:export|[a-f0-9]{24}))?\/?$/i;

function isEligibleDashboardSubscriptionRead(req = {}) {
  if (String(req.method || "").toUpperCase() !== "GET") return false;

  const originalUrl = String(req.originalUrl || req.url || "").split("?")[0];
  return DASHBOARD_SUBSCRIPTION_READ_PATH.test(originalUrl);
}

function dashboardSubscriptionMealBalanceProjection(req, res, next) {
  if (!isProjectionEnabled() || !isEligibleDashboardSubscriptionRead(req)) {
    return next();
  }

  if (!res || typeof res.json !== "function") {
    return next();
  }

  const originalJson = res.json;
  res.json = function projectedDashboardSubscriptionJson(payload) {
    return originalJson.call(
      this,
      projectDashboardSubscriptionResponse(payload, { enabled: true })
    );
  };

  return next();
}

module.exports = {
  DASHBOARD_SUBSCRIPTION_READ_PATH,
  dashboardSubscriptionMealBalanceProjection,
  isEligibleDashboardSubscriptionRead,
};
