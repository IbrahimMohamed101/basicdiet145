"use strict";

const { getRequestLang } = require("../utils/i18n");
const {
  projectDashboardStackingReadModel,
} = require("../services/dashboard/subscriptionDashboardStackingReadService");

const DASHBOARD_SUBSCRIPTION_STACKING_READ_PATH =
  /\/dashboard\/subscriptions(?:\/list|\/search|\/[a-f0-9]{24})?\/?$/i;

function isEligibleDashboardSubscriptionStackingRead(req = {}) {
  if (String(req.method || "").toUpperCase() !== "GET") return false;
  const path = String(req.originalUrl || req.url || "").split("?")[0];
  return DASHBOARD_SUBSCRIPTION_STACKING_READ_PATH.test(path);
}

function createDashboardSubscriptionStackingReadModel({
  projectResponse = projectDashboardStackingReadModel,
} = {}) {
  return function dashboardSubscriptionStackingReadModel(req, res, next) {
    if (!isEligibleDashboardSubscriptionStackingRead(req)) return next();
    if (!res || typeof res.json !== "function") return next();

    const originalJson = res.json;
    res.json = async function dashboardStackingJson(payload) {
      const projected = await projectResponse(payload, {
        lang: getRequestLang(req),
      });
      return originalJson.call(this, projected);
    };
    return next();
  };
}

const dashboardSubscriptionStackingReadModel =
  createDashboardSubscriptionStackingReadModel();

module.exports = {
  DASHBOARD_SUBSCRIPTION_STACKING_READ_PATH,
  createDashboardSubscriptionStackingReadModel,
  dashboardSubscriptionStackingReadModel,
  isEligibleDashboardSubscriptionStackingRead,
};
