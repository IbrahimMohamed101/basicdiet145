"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Delivery = require("../../models/Delivery");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const { fulfillSubscriptionDay } = require("../fulfillmentService");
const { resolveEffectiveFulfillmentMode } = require("../subscription/subscriptionFulfillmentPolicyService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { logger } = require("../../utils/logger");
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
  const settlement = await runMongoTransactionWithRetry(async (session) => {
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

    return {
      day: fulfillment.day || day,
      subscriptionId: subscription._id,
      deliveryAddress: day.deliveryAddressOverride || subscription.deliveryAddress,
      deliveryWindow: day.deliveryWindowOverride || subscription.deliveryWindow,
      fromStatus,
      businessDate,
      alreadyFulfilled: Boolean(fulfillment.alreadyFulfilled),
      deductedCredits: Number(fulfillment.deductedCredits || 0),
    };
  }, {
    label: "historical_delivery_fulfillment_recovery",
    context: { dayId: String(dayId), role: String(role || "") },
  });

  // Financial settlement + SubscriptionDay are authoritative. Railway can run
  // without transactional rollback, so projection/audit failures after a valid
  // debit must never turn a successful settlement into a retryable HTTP error.
  // Reconcile these secondary records best-effort after the canonical settlement.
  const now = new Date();
  try {
    await Delivery.updateOne(
      {
        $or: [
          { dayId },
          { subscriptionId: settlement.subscriptionId, date: settlement.businessDate },
        ],
      },
      {
        $set: {
          dayId,
          subscriptionId: settlement.subscriptionId,
          date: settlement.businessDate,
          status: "delivered",
          deliveredAt: now,
          address: settlement.deliveryAddress,
          window: settlement.deliveryWindow,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    logger.error("Historical delivery projection reconciliation failed", {
      dayId: String(dayId),
      businessDate: settlement.businessDate,
      error: err.message,
      code: err.code || null,
    });
  }

  if (!settlement.alreadyFulfilled) {
    try {
      await SubscriptionAuditLog.create({
        entityType: "subscription_day",
        entityId: dayId,
        action: "dashboard_historical_fulfill",
        fromStatus: settlement.fromStatus,
        toStatus: "fulfilled",
        actorType: String(role || "admin"),
        actorId: userId || undefined,
        meta: {
          subscriptionId: String(settlement.subscriptionId),
          businessDate: settlement.businessDate,
          recovery: true,
          deductedCredits: settlement.deductedCredits,
        },
      });
    } catch (err) {
      logger.error("Historical delivery fulfillment audit write failed", {
        dayId: String(dayId),
        businessDate: settlement.businessDate,
        error: err.message,
        code: err.code || null,
      });
    }
  }

  return {
    day: settlement.day,
    businessDate: settlement.businessDate,
    alreadyFulfilled: settlement.alreadyFulfilled,
    deductedCredits: settlement.deductedCredits,
  };
}

module.exports = {
  fulfillHistoricalDeliveryDay,
};
