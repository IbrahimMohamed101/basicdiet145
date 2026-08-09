"use strict";

const Delivery = require("../models/Delivery");
const Subscription = require("../models/Subscription");
const User = require("../models/User");
const { mapSubscriptionDelivery } = require("../mappers/deliveryMapper");
const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const opsTransitionService = require("../services/dashboard/opsTransitionService");
const {
  fulfillHistoricalDeliveryDay,
} = require("../services/dashboard/historicalDeliveryFulfillmentService");

async function loadDeliveryResponse(deliveryId) {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) return { delivery: null, user: null };

  const subscription = delivery.subscriptionId
    ? await Subscription.findById(delivery.subscriptionId).lean()
    : null;
  const user = subscription && subscription.userId
    ? await User.findById(subscription.userId).select("name phone").lean()
    : null;

  return { delivery, user };
}

async function markDelivered(req, res) {
  const role = req.userRole;
  if (!role) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) {
    return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
  }
  if (!delivery.dayId) {
    return errorResponse(
      res,
      409,
      "DATA_INTEGRITY_ERROR",
      "Subscription delivery is missing its subscription day link"
    );
  }

  let fulfillment;
  try {
    try {
      fulfillment = await opsTransitionService.executeAction("fulfill", {
        entityId: delivery.dayId,
        entityType: "subscription",
        userId: req.dashboardUserId || req.userId,
        role,
        payload: {},
      });
    } catch (err) {
      if (err && err.code === "HISTORICAL_MUTATION_FORBIDDEN") {
        fulfillment = await fulfillHistoricalDeliveryDay({
          dayId: delivery.dayId,
          userId: req.dashboardUserId || req.userId,
          role,
        });
      } else {
        throw err;
      }
    }

    const { delivery: updatedDelivery, user } = await loadDeliveryResponse(delivery._id);
    return res.status(200).json({
      status: true,
      data: mapSubscriptionDelivery(updatedDelivery || delivery, user),
      fulfillment: {
        subscriptionDayId: String(delivery.dayId),
        status: "fulfilled",
        alreadyFulfilled: Boolean(fulfillment && fulfillment.alreadyFulfilled),
        deductedCredits: Number(fulfillment && fulfillment.deductedCredits || 0),
      },
    });
  } catch (err) {
    logger.error("courierDeliveryFulfillmentController.markDelivered failed", {
      deliveryId: String(delivery._id),
      dayId: String(delivery.dayId),
      role: String(role || ""),
      error: err.message,
      code: err.code || null,
      stack: err.stack,
    });
    return errorResponse(
      res,
      err.status || 409,
      err.code || "INVALID_TRANSITION",
      err.message || "Delivery confirmation failed",
      err.details
    );
  }
}

module.exports = {
  markDelivered,
};
