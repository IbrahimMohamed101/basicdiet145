"use strict";

const Subscription = require("../models/Subscription");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { getRequestLang } = require("../utils/i18n");
const { getRestaurantBusinessDate } = require("../services/restaurantHoursService");
const {
  buildSubscriptionTimeline,
} = require("../services/subscription/subscriptionService");
const {
  normalizeTrackingSubscriptionCounters,
} = require("../services/subscription/subscriptionDashboardTrackingCompatibilityService");
const {
  buildSubscriptionDashboardTrackingReadModelV3,
} = require("../services/subscription/subscriptionDashboardTrackingReadServiceV3");

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
  const [timeline, businessDate] = await Promise.all([
    buildSubscriptionTimeline(id, { lang }),
    getRestaurantBusinessDate(),
  ]);
  const tracking = await buildSubscriptionDashboardTrackingReadModelV3({
    subscription: normalizeTrackingSubscriptionCounters(subscription),
    timeline,
    lang,
    businessDate,
  });

  res.set("Cache-Control", "no-store");
  return res.status(200).json({
    status: true,
    data: tracking,
  });
}

module.exports = {
  getSubscriptionTrackingAdmin,
};
