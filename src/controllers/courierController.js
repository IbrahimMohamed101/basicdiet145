const mongoose = require("mongoose");
const Delivery = require("../models/Delivery");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { getTodayKSADate } = require("../utils/date");
const { writeLog } = require("../utils/log");
const { notifyUser } = require("../utils/notify");
const { sendUserNotificationWithDedupe } = require("../services/notificationService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const {
  canSendArrivingSoonReminder,
  isDeliveryCanceledStatus,
  isDeliveryDeliveredStatus,
  normalizeDeliveryStatus,
  parseDeliveryCancellationInput,
} = require("../services/deliveryWorkflowService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

function appendDeliveryCancellationAudit(day, actorId) {
  if (!day) return;
  if (!Array.isArray(day.operationAuditLog)) {
    day.operationAuditLog = [];
  }
  day.operationAuditLog.push({
    action: "delivery_canceled",
    by: String(actorId || ""),
    at: new Date(),
  });
}

async function listTodayDeliveries(req, res) {
  try {
    const today = getTodayKSADate();
    const dayDocs = await SubscriptionDay.find({ date: today }).select("_id").lean();
    const dayIds = dayDocs.map((d) => d._id);
    const deliveries = await Delivery.find({ dayId: { $in: dayIds } }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ ok: true, data: deliveries });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.listTodayDeliveries failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Failed to list deliveries");
  }
}

async function markArrivingSoon(req, res) {
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }
    if (!canSendArrivingSoonReminder(delivery.status) || isDeliveryCanceledStatus(delivery.status) || isDeliveryDeliveredStatus(delivery.status)) {
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    if (delivery.arrivingSoonReminderSentAt) {
      return res.status(200).json({
        ok: true,
        deduped: true,
        data: {
          deliveryId: String(delivery._id),
          status: normalizeDeliveryStatus(delivery.status),
          reminderSentAt: delivery.arrivingSoonReminderSentAt,
        },
      });
    }
    const reminderSentAt = new Date();
    const updated = await Delivery.findOneAndUpdate(
      {
        _id: id,
        arrivingSoonReminderSentAt: null,
        status: { $nin: ["delivered", "canceled"] },
      },
      { $set: { arrivingSoonReminderSentAt: reminderSentAt } },
      { new: true }
    );
    if (!updated) {
      return res.status(200).json({
        ok: true,
        deduped: true,
        data: {
          deliveryId: String(delivery._id),
          status: normalizeDeliveryStatus(delivery.status),
          reminderSentAt: delivery.arrivingSoonReminderSentAt,
        },
      });
    }

    const sub = await Subscription.findById(updated.subscriptionId).lean();
    await writeLog({
      entityType: "delivery",
      entityId: updated._id,
      action: "arriving_soon",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { deliveryId: updated._id },
    });
    if (sub) {
      await notifyUser(sub.userId, {
        title: "الطلب في الطريق",
        body: "طلبك سيصل خلال وقت قصير",
        data: { deliveryId: String(updated._id) },
      });
    }
    return res.status(200).json({
      ok: true,
      data: {
        deliveryId: String(updated._id),
        status: normalizeDeliveryStatus(updated.status),
        reminderSentAt: updated.arrivingSoonReminderSentAt,
      },
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markArrivingSoon failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Arriving soon update failed");
  }
}

async function markDelivered(req, res) {
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }

    if (isDeliveryDeliveredStatus(delivery.status)) {
      return res.status(200).json({
        ok: true,
        idempotent: true,
        data: {
          deliveryId: String(delivery._id),
          status: "delivered",
          deliveredAt: delivery.deliveredAt || null,
        },
      });
    }
    if (isDeliveryCanceledStatus(delivery.status)) {
      return errorResponse(res, 409, "ALREADY_CANCELED", "Cannot deliver a canceled delivery");
    }

    const session = await mongoose.startSession();
    let result;
    let deliveredAt = null;
    try {
      session.startTransaction();
      result = await fulfillSubscriptionDay({ dayId: delivery.dayId, session });
      if (!result.ok) {
        await session.abortTransaction();
        session.endSession();
        const status =
          result.code === "NOT_FOUND" ? 404 :
            result.code === "INSUFFICIENT_CREDITS" ? 400 :
              result.code === "INVALID_TRANSITION" ? 409 :
                400;
        return errorResponse(res, status, result.code, result.message);
      }

      delivery.status = "delivered";
      deliveredAt = new Date();
      delivery.deliveredAt = deliveredAt;
      await delivery.save({ session });

      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }

    // MEDIUM AUDIT FIX: Keep non-transactional side effects strictly after commit, never inside transaction rollback paths.
    try {
      await writeLog({
        entityType: "delivery",
        entityId: delivery._id,
        action: "delivered",
        byUserId: req.userId,
        byRole: req.userRole,
        meta: { deductedCredits: result.deductedCredits, subscriptionId: delivery.subscriptionId },
      });
    } catch (err) {
      logger.error("Delivery log write failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    try {
      const sub = await Subscription.findById(delivery.subscriptionId).lean();
      if (sub) {
        const dispatch = await sendUserNotificationWithDedupe({
          userId: sub.userId,
          title: "Delivery Update",
          body: "Your order has been delivered successfully.",
          data: { deliveryId: String(delivery._id) },
          type: "delivered",
          dedupeKey: `delivery:${delivery._id}:delivered`,
          entityType: "delivery",
          entityId: delivery._id,
          scheduledFor: new Date(),
        });

        if (dispatch.status === "sent" || dispatch.status === "no_tokens" || dispatch.status === "duplicate") {
          await Delivery.updateOne(
            { _id: delivery._id, status: "delivered", deliveredNotificationSentAt: null },
            { $set: { deliveredNotificationSentAt: new Date() } }
          );
        }
      }
    } catch (err) {
      logger.error("Delivery notification failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    return res.status(200).json({
      ok: true,
      data: {
        deliveryId: String(delivery._id),
        subscriptionDayId: String(delivery.dayId),
        deliveryStatus: "delivered",
        subscriptionDayStatus: result && result.day ? result.day.status : "fulfilled",
        deliveredAt,
      },
      alreadyFulfilled: Boolean(result && result.alreadyFulfilled),
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markDelivered failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery confirmation failed");
  }
}

async function markCancelled(req, res) {
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "id");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const delivery = await Delivery.findById(id);
    if (!delivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }

    if (isDeliveryCanceledStatus(delivery.status)) {
      return res.status(200).json({
        ok: true,
        idempotent: true,
        data: {
          deliveryId: String(delivery._id),
          deliveryStatus: "canceled",
          canceledAt: delivery.canceledAt || null,
          cancellationReason: delivery.cancellationReason || null,
          cancellationCategory: delivery.cancellationCategory || null,
          cancellationNote: delivery.cancellationNote || null,
          canceledBy: delivery.canceledByUserId ? String(delivery.canceledByUserId) : null,
        },
      });
    }
    if (isDeliveryDeliveredStatus(delivery.status)) {
      return errorResponse(res, 400, "ALREADY_DELIVERED", "Cannot cancel delivered order");
    }

    let cancellation;
    try {
      cancellation = parseDeliveryCancellationInput(req.body || {});
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const session = await mongoose.startSession();
    let sub;
    let day;
    let canceledAt = null;
    try {
      session.startTransaction();
      sub = await Subscription.findById(delivery.subscriptionId).session(session).lean();
      if (!sub) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
      }

      day = await SubscriptionDay.findById(delivery.dayId).session(session);
      if (!day) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "Day not found");
      }
      if (day.status === "fulfilled") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "ALREADY_FULFILLED", "Cannot cancel fulfilled order");
      }
      if (day.status === "delivery_canceled") {
        await session.commitTransaction();
        session.endSession();
        return res.status(200).json({
          ok: true,
          idempotent: true,
          data: {
            deliveryId: String(delivery._id),
            subscriptionDayId: String(day._id),
            deliveryStatus: "canceled",
            subscriptionDayStatus: "delivery_canceled",
            canceledAt: delivery.canceledAt || null,
            cancellationReason: delivery.cancellationReason || null,
            cancellationCategory: delivery.cancellationCategory || null,
            cancellationNote: delivery.cancellationNote || null,
            canceledBy: day.canceledBy || (delivery.canceledByUserId ? String(delivery.canceledByUserId) : null),
          },
        });
      }
      if (day.status !== "out_for_delivery") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "INVALID_TRANSITION", "Only dispatched deliveries can be canceled");
      }

      day.status = "delivery_canceled";
      day.pickupRequested = false;
      day.cancellationReason = cancellation.reason;
      day.cancellationCategory = cancellation.category;
      day.cancellationNote = cancellation.note;
      day.canceledAt = new Date();
      day.canceledBy = String(req.dashboardUserId || req.userId || "");
      appendDeliveryCancellationAudit(day, req.dashboardUserId || req.userId);
      await day.save({ session });

      canceledAt = day.canceledAt;
      delivery.status = "canceled";
      delivery.canceledAt = canceledAt;
      delivery.cancellationReason = cancellation.reason;
      delivery.cancellationCategory = cancellation.category;
      delivery.cancellationNote = cancellation.note;
      delivery.canceledByRole = req.userRole || null;
      delivery.canceledByUserId = req.dashboardUserId || req.userId || null;
      await delivery.save({ session });

      await session.commitTransaction();
      session.endSession();
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }

    // MEDIUM AUDIT FIX: Keep non-transactional side effects strictly after commit, never inside transaction rollback paths.
    try {
      await writeLog({
        entityType: "delivery",
        entityId: delivery._id,
        action: "canceled",
        byUserId: req.userId,
        byRole: req.userRole,
        meta: {
          subscriptionId: delivery.subscriptionId,
          subscriptionDayId: day ? String(day._id) : null,
          reason: cancellation.reason,
          category: cancellation.category,
          note: cancellation.note,
          canceledAt,
          canceledBy: day ? day.canceledBy : String(req.dashboardUserId || req.userId || ""),
        },
      });
    } catch (err) {
      logger.error("Delivery cancellation log write failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    try {
      if (sub) {
        await notifyUser(sub.userId, {
          title: "Delivery Update",
          body: "Your delivery has been canceled.",
          data: {
            deliveryId: String(delivery._id),
            type: "canceled",
          },
        });
      }
    } catch (err) {
      logger.error("Delivery cancellation notification failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    return res.status(200).json({
      ok: true,
      data: {
        deliveryId: String(delivery._id),
        subscriptionDayId: day ? String(day._id) : String(delivery.dayId),
        deliveryStatus: "canceled",
        subscriptionDayStatus: day ? day.status : "delivery_canceled",
        canceledAt,
        cancellationReason: cancellation.reason,
        cancellationCategory: cancellation.category,
        cancellationNote: cancellation.note,
        canceledBy: day ? day.canceledBy : String(req.dashboardUserId || req.userId || ""),
      },
    });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markCancelled failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery cancellation failed");
  }
}

module.exports = { listTodayDeliveries, markArrivingSoon, markDelivered, markCancelled };
