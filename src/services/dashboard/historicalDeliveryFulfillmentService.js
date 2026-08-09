"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Delivery = require("../../models/Delivery");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const { fulfillSubscriptionDay } = require("../fulfillmentService");
const { resolveEffectiveFulfillmentMode } = require("../subscription/subscriptionFulfillmentPolicyService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const {
  resolveBusinessDate,
  canRecoverHistoricalDeliveryFulfillment,
} = require("./historicalMutationPolicy");

function operationalError(message, code, status = 409, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

async function fulfillHistoricalDeliveryDay({ dayId, userId = null, role }) {
  return runMongoTransactionWithRetry(async (session) => {
    const day = await SubscriptionDay.findById(dayId).session(session);
    if (!day) throw operationalError("Subscription day not found", "NOT_FOUND", 404);

    const subscription = await Subscription.findById(day.subscriptionId).session(session);
    if (!subscription) throw operationalError("Subscription not found", "NOT_FOUND", 404);

    const mode = resolveEffectiveFulfillmentMode({
      subscription,
      day,
      date: day.date,
    });
    const businessDate = resolveBusinessDate(day);
    const allowed = canRecoverHistoricalDeliveryFulfillment({
      entityType: "subscription",
      actionId: "fulfill",
      status: day.status,
      role,
      mode,
      businessDate,
    });

    if (!allowed) {
      throw operationalError(
        "Historical delivery fulfillment is not allowed for this record",
        "HISTORICAL_MUTATION_FORBIDDEN",
        409,
        { status: day.status, mode, businessDate }
      );
    }

    const fromStatus = day.status;
    const fulfillment = await fulfillSubscriptionDay({ dayId: day._id, session });
    if (!fulfillment.ok) {
      throw operationalError(
        fulfillment.message || "Historical fulfillment failed",
        fulfillment.code || "HISTORICAL_FULFILLMENT_FAILED",
        fulfillment.code === "NOT_FOUND" ? 404 : 409
      );
    }

    const now = new Date();
    const fulfilledDay = fulfillment.day || await SubscriptionDay.findById(day._id).session(session);

    // Historical recovery intentionally does not trigger customer notifications.
    // It reconciles the operational projection and balance only.
    await Delivery.updateOne(
      {
        $or: [
          { dayId: day._id },
          { subscriptionId: subscription._id, date: day.date },
        ],
      },
      {
        $set: {
          dayId: day._id,
          subscriptionId: subscription._id,
          date: day.date,
          status: "delivered",
          deliveredAt: now,
          address: day.deliveryAddressOverride || subscription.deliveryAddress,
          window: day.deliveryWindowOverride || subscription.deliveryWindow,
        },
      },
      { upsert: true, session }
    );

    await SubscriptionAuditLog.create([{
      entityType: "subscription_day",
      entityId: day._id,
      action: "dashboard_historical_fulfill",
      fromStatus,
      toStatus: "fulfilled",
      actorType: String(role || "admin"),
      actorId: userId || undefined,
      meta: {
        subscriptionId: String(day.subscriptionId),
        businessDate,
        recovery: true,
        deductedCredits: Number(fulfillment.deductedCredits || 0),
      },
    }], { session });

    return {
      day: fulfilledDay || day,
      deductedCredits: Number(fulfillment.deductedCredits || 0),
      businessDate,
    };
  }, {
    label: "historical_delivery_fulfillment_recovery",
    context: { dayId: String(dayId), role: String(role || "") },
  });
}

module.exports = {
  fulfillHistoricalDeliveryDay,
};
