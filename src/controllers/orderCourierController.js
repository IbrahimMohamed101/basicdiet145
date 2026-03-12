const mongoose = require("mongoose");
const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { getTodayKSADate } = require("../utils/date");
const { canOrderTransition } = require("../utils/orderState");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function listTodayOrders(_req, res) {
  const today = getTodayKSADate();
  const orders = await Order.find({ deliveryDate: today, deliveryMode: "delivery" }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: orders });
}

async function markArrivingSoon(req, res) {
  try {
    validateObjectId(req.params.id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }
    if (order.deliveryMode !== "delivery") {
      return errorResponse(res, 400, "INVALID", "Order is not delivery");
    }

    const reminderSentAt = new Date();
    const delivery = await Delivery.findOneAndUpdate(
      {
        orderId: order._id,
        status: { $in: ["scheduled", "out_for_delivery"] },
        arrivingSoonReminderSentAt: null,
      },
      {
        $set: {
          status: "out_for_delivery",
          arrivingSoonReminderSentAt: reminderSentAt,
        },
      },
      { new: true }
    );

    if (!delivery) {
      return res.status(200).json({ ok: true, deduped: true });
    }

    await writeLog({
      entityType: "delivery",
      entityId: delivery._id,
      action: "arriving_soon",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: { orderId: String(order._id), deliveryId: String(delivery._id) },
    });

    await notifyOrderUser({
      order,
      type: "arriving_soon",
      deliveryId: delivery._id,
      scheduledFor: delivery.etaAt || reminderSentAt,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.error("orderCourierController.markArrivingSoon failed", {
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Arriving soon update failed");
  }
}

async function markDelivered(req, res) {
  try {
    validateObjectId(req.params.id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }
    if (order.deliveryMode !== "delivery") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Order is not delivery");
    }
    if (!canOrderTransition(order.status, "fulfilled")) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    order.status = "fulfilled";
    order.fulfilledAt = new Date();
    await order.save({ session });

    // SECURITY FIX: Keep Order and Delivery states consistent in one transaction.
    await Delivery.updateOne(
      { orderId: order._id },
      { $set: { status: "delivered", deliveredAt: new Date() } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_delivered",
      byUserId: req.userId,
      byRole: req.userRole,
    });

    await notifyOrderUser({ order, type: "delivered" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("orderCourierController.markDelivered failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order delivery update failed");
  }
}

async function markCancelled(req, res) {
  try {
    validateObjectId(req.params.id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    }
    if (!canOrderTransition(order.status, "canceled")) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    order.status = "canceled";
    order.canceledAt = new Date();
    await order.save({ session });

    // SECURITY FIX: Keep Order and Delivery states consistent in one transaction.
    await Delivery.updateOne(
      { orderId: order._id },
      { $set: { status: "canceled" } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_canceled",
      byUserId: req.userId,
      byRole: req.userRole,
    });

    await notifyOrderUser({ order, type: "canceled" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("orderCourierController.markCancelled failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order cancellation failed");
  }
}

module.exports = { listTodayOrders, markArrivingSoon, markDelivered, markCancelled };
