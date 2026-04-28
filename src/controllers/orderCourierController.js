const mongoose = require("mongoose");
const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { getTodayKSADate } = require("../utils/date");
const { writeLog } = require("../utils/log");
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

async function listTodayOrders(_req, res) {
  try {
    const today = getTodayKSADate();
    const orders = await Order.find({
      deliveryDate: today,
      deliveryMode: "delivery",
      status: { $in: ["out_for_delivery", "fulfilled", "canceled"] },
    }).sort({ createdAt: -1 }).lean();

    const orderIds = orders.map((order) => order._id);
    const deliveries = orderIds.length
      ? await Delivery.find({ orderId: { $in: orderIds } }).lean()
      : [];
    const deliveriesByOrderId = new Map(
      deliveries
        .filter((delivery) => delivery && delivery.orderId)
        .map((delivery) => [String(delivery.orderId), delivery])
    );

    const queue = orders
      .filter((order) => deliveriesByOrderId.has(String(order._id)))
      .map((order) => ({
        ...order,
        delivery: deliveriesByOrderId.get(String(order._id)),
      }));

    return res.status(200).json({ status: true, data: queue });
  } catch (err) {
    logger.error("orderCourierController.listTodayOrders failed", {
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Failed to list orders");
  }
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

    const existingDelivery = await Delivery.findOne({ orderId: order._id });
    if (!existingDelivery) {
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }
    if (
      !canSendArrivingSoonReminder(existingDelivery.status)
      || isDeliveryCanceledStatus(existingDelivery.status)
      || isDeliveryDeliveredStatus(existingDelivery.status)
    ) {
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }
    if (existingDelivery.arrivingSoonReminderSentAt) {
      return res.status(200).json({
        status: true,
        deduped: true,
        data: {
          orderId: String(order._id),
          deliveryId: String(existingDelivery._id),
          deliveryStatus: normalizeDeliveryStatus(existingDelivery.status),
          reminderSentAt: existingDelivery.arrivingSoonReminderSentAt,
        },
      });
    }

    const reminderSentAt = new Date();
    const delivery = await Delivery.findOneAndUpdate(
      {
        orderId: order._id,
        arrivingSoonReminderSentAt: null,
        status: { $nin: ["delivered", "canceled"] },
      },
      {
        $set: {
          arrivingSoonReminderSentAt: reminderSentAt,
        },
      },
      { new: true }
    );

    if (!delivery) {
      return res.status(200).json({
        status: true,
        deduped: true,
        data: {
          orderId: String(order._id),
          deliveryId: String(existingDelivery._id),
          deliveryStatus: normalizeDeliveryStatus(existingDelivery.status),
          reminderSentAt: existingDelivery.arrivingSoonReminderSentAt,
        },
      });
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

    return res.status(200).json({
      status: true,
      data: {
        orderId: String(order._id),
        deliveryId: String(delivery._id),
        deliveryStatus: normalizeDeliveryStatus(delivery.status),
        reminderSentAt: delivery.arrivingSoonReminderSentAt,
      },
    });
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

    const delivery = await Delivery.findOne({ orderId: order._id }).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }
    if (order.status === "fulfilled" || isDeliveryDeliveredStatus(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: {
          orderId: String(order._id),
          deliveryId: String(delivery._id),
          orderStatus: "fulfilled",
          deliveryStatus: "delivered",
          deliveredAt: order.fulfilledAt || delivery.deliveredAt || null,
        },
      });
    }
    if (order.status === "canceled" || isDeliveryCanceledStatus(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "ALREADY_CANCELED", "Cannot deliver a canceled order");
    }
    if (order.status !== "out_for_delivery") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    const deliveredAt = new Date();
    order.status = "fulfilled";
    order.fulfilledAt = deliveredAt;
    await order.save({ session });

    delivery.status = "delivered";
    delivery.deliveredAt = deliveredAt;
    await delivery.save({ session });

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
    return res.status(200).json({
      status: true,
      data: {
        orderId: String(order._id),
        deliveryId: String(delivery._id),
        orderStatus: "fulfilled",
        deliveryStatus: "delivered",
        deliveredAt: order.fulfilledAt,
      },
    });
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
    if (order.deliveryMode !== "delivery") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Order is not delivery");
    }

    const delivery = await Delivery.findOne({ orderId: order._id }).session(session);
    if (!delivery) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Delivery not found");
    }
    if (order.status === "canceled" || isDeliveryCanceledStatus(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: {
          orderId: String(order._id),
          deliveryId: String(delivery._id),
          orderStatus: "canceled",
          deliveryStatus: "canceled",
          canceledAt: order.canceledAt || delivery.canceledAt || null,
          cancellationReason: delivery.cancellationReason || null,
          cancellationCategory: delivery.cancellationCategory || null,
          cancellationNote: delivery.cancellationNote || null,
          canceledBy: delivery.canceledByUserId ? String(delivery.canceledByUserId) : null,
        },
      });
    }
    if (order.status === "fulfilled" || isDeliveryDeliveredStatus(delivery.status)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "ALREADY_DELIVERED", "Cannot cancel delivered order");
    }
    let cancellation;
    try {
      cancellation = parseDeliveryCancellationInput(req.body || {});
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, err.status, err.code, err.message);
    }
    if (order.status !== "out_for_delivery") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Only dispatched orders can be canceled");
    }

    const canceledAt = new Date();
    order.status = "canceled";
    order.canceledAt = canceledAt;
    await order.save({ session });

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

    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_canceled",
      byUserId: req.userId,
      byRole: req.userRole,
      meta: {
        deliveryId: String(delivery._id),
        reason: cancellation.reason,
        category: cancellation.category,
        note: cancellation.note,
        canceledAt,
        canceledBy: String(req.dashboardUserId || req.userId || ""),
      },
    });

    await notifyOrderUser({ order, type: "canceled" });
    return res.status(200).json({
      status: true,
      data: {
        orderId: String(order._id),
        deliveryId: String(delivery._id),
        orderStatus: "canceled",
        deliveryStatus: "canceled",
        canceledAt: order.canceledAt,
        cancellationReason: cancellation.reason,
        cancellationCategory: cancellation.category,
        cancellationNote: cancellation.note,
        canceledBy: String(req.dashboardUserId || req.userId || ""),
      },
    });
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
