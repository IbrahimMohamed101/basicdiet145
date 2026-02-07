const mongoose = require("mongoose");
const Delivery = require("../models/Delivery");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { getTodayKSADate } = require("../utils/date");
const { writeLog } = require("../utils/log");
const { notifyUser } = require("../utils/notify");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const { applySkipForDate } = require("../services/subscriptionService");
const { logger } = require("../utils/logger");

async function listTodayDeliveries(_req, res) {
  const today = getTodayKSADate();
  const dayDocs = await SubscriptionDay.find({ date: today }).select("_id").lean();
  const dayIds = dayDocs.map((d) => d._id);
  const deliveries = await Delivery.find({ dayId: { $in: dayIds } }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ ok: true, data: deliveries });
}

async function markArrivingSoon(req, res) {
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Delivery not found" } });
  }
  const sub = await Subscription.findById(delivery.subscriptionId).lean();
  delivery.status = "out_for_delivery";
  await delivery.save();
  await writeLog({
    entityType: "delivery",
    entityId: delivery._id,
    action: "arriving_soon",
    byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
    byRole: req.dashboardRole,
    meta: { deliveryId: delivery._id },
  });
  if (sub) {
    await notifyUser(sub.userId, {
      title: "الطلب في الطريق",
      body: "طلبك سيصل خلال وقت قصير",
      data: { deliveryId: String(delivery._id) },
    });
  }
  return res.status(200).json({ ok: true });
}

async function markDelivered(req, res) {
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Delivery not found" } });
  }

  if (delivery.status === "delivered") {
    return res.status(200).json({ ok: true });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fulfillSubscriptionDay({ dayId: delivery.dayId, session });
    if (!result.ok) {
      await session.abortTransaction();
      session.endSession();
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "INSUFFICIENT_CREDITS" ? 400 :
            result.code === "INVALID_TRANSITION" ? 409 :
              400;
      return res.status(status).json({ ok: false, error: { code: result.code, message: result.message } });
    }

    delivery.status = "delivered";
    delivery.deliveredAt = new Date();
    await delivery.save({ session });

    await session.commitTransaction();
    session.endSession();
    await writeLog({
      entityType: "delivery",
      entityId: delivery._id,
      action: "delivered",
      byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
      byRole: req.dashboardRole,
      meta: { deductedCredits: result.deductedCredits, subscriptionId: delivery.subscriptionId },
    });
    const sub = await Subscription.findById(delivery.subscriptionId).lean();
    if (sub) {
      await notifyUser(sub.userId, {
        title: "تم التسليم",
        body: "تم تسليم طلبك بنجاح",
        data: { deliveryId: String(delivery._id) },
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Delivery confirmation failed" } });
  }
}

async function markCancelled(req, res) {
  const delivery = await Delivery.findById(req.params.id);
  if (!delivery) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Delivery not found" } });
  }

  if (delivery.status === "cancelled") {
    return res.status(200).json({ ok: true });
  }
  if (delivery.status === "delivered") {
    return res.status(400).json({ ok: false, error: { code: "ALREADY_DELIVERED", message: "Cannot cancel delivered order" } });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(delivery.subscriptionId).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Subscription not found" } });
    }

    const day = await SubscriptionDay.findById(delivery.dayId).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Day not found" } });
    }

    // Rule 4: Delivery cancellation by courier must behave exactly like a skip
    const result = await applySkipForDate({ sub, date: day.date, session, allowLocked: true });

    if (result.status === "fulfilled") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "ALREADY_FULFILLED", message: "Cannot cancel fulfilled order" } });
    }

    if (result.status === "insufficient_credits") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits" } });
    }

    delivery.status = "cancelled";
    await delivery.save({ session });

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "delivery",
      entityId: delivery._id,
      action: "cancelled",
      byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
      byRole: req.dashboardRole,
      meta: { subscriptionId: delivery.subscriptionId, compensated: Boolean(result.compensatedDateAdded) },
    });

    if (sub) {
      await notifyUser(sub.userId, {
        title: "تم إلغاء التوصيل",
        body: "تم إلغاء التوصيل لليوم وسيتم تعويضك إذا كان ضمن السماحية",
        data: { deliveryId: String(delivery._id) },
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Delivery cancellation failed", { error: err.message, stack: err.stack });
    return res.status(500).json({ ok: false, error: { code: "INTERNAL", message: "Delivery cancellation failed" } });
  }
}

module.exports = { listTodayDeliveries, markArrivingSoon, markDelivered, markCancelled };

