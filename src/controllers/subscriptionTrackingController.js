"use strict";

const Subscription = require("../models/Subscription");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { getRequestLang } = require("../utils/i18n");
const {
  buildSubscriptionTimeline,
} = require("../services/subscription/subscriptionTimelineService");
const {
  buildSubscriptionDashboardTracking,
} = require("../services/subscription/subscriptionDashboardTrackingService");

async function getSubscriptionTrackingAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const subscription = await Subscription.findById(id).lean();
  if (!subscription) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }

  const lang = getRequestLang(req);
  const timeline = await buildSubscriptionTimeline(id, { lang });
  const tracking = await buildSubscriptionDashboardTracking({
    subscription,
    timeline,
    lang,
  });

  return res.status(200).json({
    status: true,
    data: tracking,
  });
}

module.exports = {
  getSubscriptionTrackingAdmin,
};
