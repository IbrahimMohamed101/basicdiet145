"use strict";

const {
  buildSubscriptionDashboardTrackingReadModel,
} = require("./subscriptionDashboardTrackingReadService");
const {
  buildSubscriptionMealMovementProvenance,
} = require("./subscriptionMealMovementProvenanceService");

async function buildSubscriptionDashboardTrackingReadModelV3({
  subscription,
  timeline,
  lang = "ar",
  businessDate = null,
}) {
  const base = await buildSubscriptionDashboardTrackingReadModel({
    subscription,
    timeline,
    lang,
    businessDate,
  });

  const provenance = await buildSubscriptionMealMovementProvenance({
    subscription,
    tracking: base,
    manualDeductions: base.adjustments && base.adjustments.manualDeductions,
  });

  return {
    ...base,
    contractVersion: "dashboard_subscription_tracking.v3",
    provenance,
  };
}

module.exports = {
  buildSubscriptionDashboardTrackingReadModelV3,
};
