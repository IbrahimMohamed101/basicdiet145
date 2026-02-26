const mongoose = require("mongoose");
const Delivery = require("../models/Delivery");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { getTodayKSADate } = require("../utils/date");
const { writeLog } = require("../utils/log");
const { notifyUser } = require("../utils/notify");
const { sendUserNotificationWithDedupe } = require("../services/notificationService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const { applySkipForDate } = require("../services/subscriptionService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function listTodayDeliveries(req, res) {
  try {
    const today = getTodayKSADate();
    const dayDocs = await SubscriptionDay.find({ date: today }).select("_id").lean();
    const dayIds = dayDocs.map((d) => d._id);
    // SECURITY FIX: Couriers can only view deliveries assigned to their own userId.
    const deliveries = await Delivery.find({ dayId: { $in: dayIds }, courierId: req.userId }).sort({ createdAt: -1 }).lean();
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
    // SECURITY FIX: Guard state transition to prevent reopening delivered/cancelled deliveries.
    if (!["scheduled", "out_for_delivery"].includes(delivery.status)) {
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    // MEDIUM AUDIT FIX: Deduplicate "arriving soon" push by atomically stamping reminder flag with the status update.
    if (delivery.arrivingSoonReminderSentAt) {
      return res.status(200).json({ ok: true, deduped: true });
    }
    const reminderSentAt = new Date();
    const updated = await Delivery.findOneAndUpdate(
      { _id: id, status: { $in: ["scheduled", "out_for_delivery"] }, arrivingSoonReminderSentAt: null },
      { $set: { status: "out_for_delivery", arrivingSoonReminderSentAt: reminderSentAt } },
      { new: true }
    );
    if (!updated) {
      return res.status(200).json({ ok: true, deduped: true });
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
    return res.status(200).json({ ok: true });
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

    if (delivery.status === "delivered") {
      return res.status(200).json({ ok: true });
    }

    const session = await mongoose.startSession();
    let result;
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
      delivery.deliveredAt = new Date();
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

    return res.status(200).json({ ok: true });
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

    if (delivery.status === "cancelled") {
      return res.status(200).json({ ok: true });
    }
    if (delivery.status === "delivered") {
      return errorResponse(res, 400, "ALREADY_DELIVERED", "Cannot cancel delivered order");
    }

    const session = await mongoose.startSession();
    let sub;
    let result;
    try {
      session.startTransaction();
      sub = await Subscription.findById(delivery.subscriptionId).populate("planId").session(session);
      if (!sub) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
      }

      const day = await SubscriptionDay.findById(delivery.dayId).session(session);
      if (!day) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 404, "NOT_FOUND", "Day not found");
      }

      // Rule 4: Delivery cancellation by courier must behave exactly like a skip
      result = await applySkipForDate({ sub, date: day.date, session, allowLocked: true });

      if (result.status === "fulfilled") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "ALREADY_FULFILLED", "Cannot cancel fulfilled order");
      }

      if (result.status === "insufficient_credits") {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INSUFFICIENT_CREDITS", "Not enough credits");
      }

      delivery.status = "cancelled";
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
        action: "cancelled",
        byUserId: req.userId,
        byRole: req.userRole,
        meta: { subscriptionId: delivery.subscriptionId, compensated: Boolean(result.compensatedDateAdded) },
      });
    } catch (err) {
      logger.error("Delivery cancellation log write failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    try {
      if (sub) {
        await notifyUser(sub.userId, {
          title: "تم إلغاء التوصيل",
          body: "تم إلغاء التوصيل لليوم وسيتم تعويضك إذا كان ضمن السماحية",
          data: { deliveryId: String(delivery._id) },
        });
      }
    } catch (err) {
      logger.error("Delivery cancellation notification failed", { error: err.message, stack: err.stack, deliveryId: String(delivery._id) });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    // MEDIUM AUDIT FIX: Express 4 does not catch async errors automatically; return controlled 500.
    logger.error("courierController.markCancelled failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery cancellation failed");
  }
}

module.exports = { listTodayDeliveries, markArrivingSoon, markDelivered, markCancelled };
