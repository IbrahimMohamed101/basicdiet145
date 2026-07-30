"use strict";

const {
  buildSubscriptionDashboardTrackingReadModel,
} = require("./subscriptionDashboardTrackingReadService");
const {
  buildSubscriptionMealMovementProvenance,
} = require("./subscriptionMealMovementProvenanceService");
const {
  enrichSubscriptionMealMovementProvenance,
} = require("./subscriptionMealMovementProvenanceEnrichmentService");

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

  const rawProvenance = await buildSubscriptionMealMovementProvenance({
    subscription,
    tracking: base,
    manualDeductions: base.adjustments && base.adjustments.manualDeductions,
  });
  const provenance = await enrichSubscriptionMealMovementProvenance(rawProvenance);

  return {
    ...base,
    contractVersion: "dashboard_subscription_tracking.v3",
    provenance,
  };
}

module.exports = {
  buildSubscriptionDashboardTrackingReadModelV3,
};
