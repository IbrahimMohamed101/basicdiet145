"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Delivery = require("../../models/Delivery");
const SubscriptionAuditLog = require("../../models/SubscriptionAuditLog");
const { fulfillSubscriptionDay } = require("../fulfillmentService");
const { resolveEffectiveFulfillmentMode } = require("../subscription/subscriptionFulfillmentPolicyService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { writeLog } = require("../../utils/log");
const { logger } = require("../../utils/logger");
const dateUtils = require("../../utils/date");

const HISTORICAL_DELIVERY_FULFILL_ROLES = new Set(["admin", "superadmin", "courier"]);
const HISTORICAL_DELIVERY_FULFILL_STATUSES = new Set(["ready_for_delivery", "out_for_delivery"]);

function createOperationalError(message, code, status = 409, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function resolveBusinessDate(day = {}) {
  return day.date
    || day.fulfillmentDate
    || day.deliveryDate
    || day.scheduledDate
    || day.pickupDate
    || day.serviceDate
    || null;
}

function evaluateHistoricalDeliveryFulfillmentEligibility({
  entityType,
  actionId,
  day,
  role,
  today = dateUtils.getTodayKSADate(),
} = {}) {
  const businessDate = resolveBusinessDate(day || {});
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedAction = String(actionId || "").trim().toLowerCase();
  const normalizedEntityType = entityType === "subscription_day" || entityType === "pickup_day"
    ? "subscription"
    : String(entityType || "").trim().toLowerCase();
  const status = String((day && day.status) || "").trim().toLowerCase();
  const isHistorical = Boolean(businessDate && today && businessDate < today);

  if (!isHistorical) {
    return { allowed: false, isHistorical: false, businessDate, reason: "NOT_HISTORICAL" };
  }
  if (normalizedEntityType !== "subscription") {
    return { allowed: false, isHistorical: true, businessDate, reason: "INVALID_ENTITY_TYPE" };
  }
  if (normalizedAction !== "fulfill") {
    return { allowed: false, isHistorical: true, businessDate, reason: "INVALID_ACTION" };
  }
  if (!HISTORICAL_DELIVERY_FULFILL_ROLES.has(normalizedRole)) {
    return { allowed: false, isHistorical: true, businessDate, reason: "INSUFFICIENT_PERMISSIONS" };
  }
  if (!HISTORICAL_DELIVERY_FULFILL_STATUSES.has(status)) {
    return { allowed: false, isHistorical: true, businessDate, reason: "INVALID_STATE_TRANSITION" };
  }

  return { allowed: true, isHistorical: true, businessDate, reason: null };
}

async function syncHistoricalDeliveryProjection({ day, subscription, session, now }) {
  const query = {
    $or: [
      { dayId: day._id },
      { subscriptionId: subscription._id, date: day.date },
    ],
  };

  const delivery = await Delivery.findOne(query).session(session);
  if (delivery) {
    delivery.dayId = day._id;
    delivery.subscriptionId = subscription._id;
    delivery.date = day.date;
    delivery.status = "delivered";
    delivery.deliveredAt = delivery.deliveredAt || now;
    await delivery.save({ session });
    return delivery;
  }

  const created = await Delivery.create([{
    subscriptionId: subscription._id,
    dayId: day._id,
    date: day.date,
    status: "delivered",
    deliveredAt: now,
    address: day.deliveryAddressOverride || subscription.deliveryAddress,
    window: day.deliveryWindowOverride || subscription.deliveryWindow,
  }], { session });
  return created[0];
}

async function fulfillHistoricalDeliveryDay({ dayId, userId = null, role }) {
  let activityLogPayload = null;

  const result = await runMongoTransactionWithRetry(async (session) => {
    const day = await SubscriptionDay.findById(dayId).session(session);
    if (!day) {
      throw createOperationalError("Subscription day not found", "NOT_FOUND", 404);
    }

    const businessDate = resolveBusinessDate(day);
    const today = dateUtils.getTodayKSADate();
    const normalizedRole = String(role || "").trim().toLowerCase();

    if (!businessDate || businessDate >= today) {
      throw createOperationalError(
        "Historical delivery recovery only applies to a previous business date",
        "HISTORICAL_RECOVERY_NOT_APPLICABLE",
        409
      );
    }
    if (!HISTORICAL_DELIVERY_FULFILL_ROLES.has(normalizedRole)) {
      throw createOperationalError("Dashboard role cannot recover historical delivery", "FORBIDDEN", 403);
    }

    const subscription = await Subscription.findById(day.subscriptionId).session(session);
    if (!subscription) {
      throw createOperationalError("Subscription not found", "NOT_FOUND", 404);
    }

    const mode = resolveEffectiveFulfillmentMode({
      subscription,
      day,
      date: day.date,
    });
    if (mode !== "delivery") {
      throw createOperationalError(
        "Historical recovery is restricted to delivery subscription days",
        "DELIVERY_MODE_REQUIRED",
        409
      );
    }

    const now = new Date();
    let fulfillmentResult;
    let fromStatus = day.status;

    if (day.status === "fulfilled" && day.creditsDeducted) {
      fulfillmentResult = {
        ok: true,
        alreadyFulfilled: true,
        day,
        deductedCredits: 0,
      };
    } else {
      const eligibility = evaluateHistoricalDeliveryFulfillmentEligibility({
        entityType: "subscription",
        actionId: "fulfill",
        day,
        role: normalizedRole,
        today,
      });
      if (!eligibility.allowed) {
        throw createOperationalError(
          "Historical delivery cannot be fulfilled from the current state",
          eligibility.reason || "HISTORICAL_MUTATION_FORBIDDEN",
          eligibility.reason === "INSUFFICIENT_PERMISSIONS" ? 403 : 409,
          { status: day.status, businessDate }
        );
      }

      fulfillmentResult = await fulfillSubscriptionDay({ dayId: day._id, session });
      if (!fulfillmentResult.ok) {
        const status = fulfillmentResult.code === "NOT_FOUND" ? 404 : 409;
        throw createOperationalError(
          fulfillmentResult.message || "Historical fulfillment failed",
          fulfillmentResult.code || "HISTORICAL_FULFILLMENT_FAILED",
          status
        );
      }
    }

    const fulfilledDay = fulfillmentResult.day || await SubscriptionDay.findById(day._id).session(session);
    await syncHistoricalDeliveryProjection({
      day: fulfilledDay || day,
      subscription,
      session,
      now,
    });

    if (!fulfillmentResult.alreadyFulfilled) {
      await SubscriptionAuditLog.create([{
        entityType: "subscription_day",
        entityId: day._id,
        action: "dashboard_historical_fulfill",
        fromStatus,
        toStatus: "fulfilled",
        actorType: normalizedRole || "admin",
        actorId: userId || undefined,
        meta: {
          subscriptionId: String(day.subscriptionId),
          businessDate,
          recovery: true,
          deductedCredits: Number(fulfillmentResult.deductedCredits || 0),
        },
      }], { session });

      activityLogPayload = {
        entityType: "subscription",
        entityId: day._id,
        action: "dashboard_historical_fulfill",
        byUserId: userId,
        byRole: normalizedRole,
        meta: {
          toStatus: "fulfilled",
          businessDate,
          recovery: true,
          deductedCredits: Number(fulfillmentResult.deductedCredits || 0),
        },
      };
    }

    return {
      day: fulfilledDay || day,
      alreadyFulfilled: Boolean(fulfillmentResult.alreadyFulfilled),
      deductedCredits: Number(fulfillmentResult.deductedCredits || 0),
      businessDate,
    };
  }, {
    label: "historical_delivery_fulfillment_recovery",
    context: { dayId: String(dayId), role: String(role || "") },
  });

  if (activityLogPayload) {
    try {
      await writeLog(activityLogPayload);
    } catch (err) {
      logger.error("Historical delivery fulfillment activity log failed", {
        dayId: String(dayId),
        error: err.message,
      });
    }
  }

  return result;
}

module.exports = {
  HISTORICAL_DELIVERY_FULFILL_ROLES,
  HISTORICAL_DELIVERY_FULFILL_STATUSES,
  evaluateHistoricalDeliveryFulfillmentEligibility,
  fulfillHistoricalDeliveryDay,
};
