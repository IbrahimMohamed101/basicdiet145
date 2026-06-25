const mongoose = require("mongoose");
const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const User = require("../models/User");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { getTodayKSADate } = require("../utils/date");
const { writeLog } = require("../utils/log");
const { mapOneTimeOrderDelivery } = require("../mappers/deliveryMapper");
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
const { ORDER_STATUSES } = require("../utils/orderState");
const { getOrderFulfillmentMethod, shouldBlockOneTimeOrderDelivery } = require("../utils/oneTimeOrderDeliveryGate");
const { resolveOptionalPagination, buildPaginationMeta } = require("../utils/optionalPagination");
const { ACTION_REGISTRY } = require("../services/dashboard/opsActionPolicy");
const { runMongoTransactionWithRetry } = require("../services/mongoTransactionRetryService");

async function listTodayOrders(req, res) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  try {
    const today = getTodayKSADate();
    const orders = await Order.find({
      $and: [
        { $or: [{ fulfillmentDate: today }, { deliveryDate: today }] },
        { $or: [{ fulfillmentMethod: "delivery" }, { deliveryMode: "delivery" }] },
      ],
      paymentStatus: "paid",
      status: { $in: [ORDER_STATUSES.OUT_FOR_DELIVERY, ORDER_STATUSES.FULFILLED, ORDER_STATUSES.CANCELLED, "canceled"] },
    }).sort({ createdAt: -1 }).lean();
    const visibleOrders = orders.filter((order) => !shouldBlockOneTimeOrderDelivery(order));

    const orderIds = visibleOrders.map((order) => order._id);
    const deliveries = orderIds.length
      ? await Delivery.find({ orderId: { $in: orderIds } }).lean()
      : [];
    const deliveriesByOrderId = new Map(
      deliveries
        .filter((delivery) => delivery && delivery.orderId)
        .map((delivery) => [String(delivery.orderId), delivery])
    );

    const userIds = [...new Set(visibleOrders.map((o) => String(o.userId)).filter(Boolean))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select("name phone").lean() : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const queue = visibleOrders
      .filter((order) => deliveriesByOrderId.has(String(order._id)))
      .map((order) => {
        const user = userMap.get(String(order.userId));
        return mapOneTimeOrderDelivery(order, user, deliveriesByOrderId.get(String(order._id)));
      });

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
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  const allowedRoles = (ACTION_REGISTRY["notify_arrival"] && ACTION_REGISTRY["notify_arrival"].roles) || ["superadmin", "admin", "courier"];
  if (!allowedRoles.includes(req.userRole)) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
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
    const targetBusinessDate = order.fulfillmentDate || order.deliveryDate || order.scheduledDate || order.date;
    if (targetBusinessDate && targetBusinessDate < getTodayKSADate()) {
      return errorResponse(res, 409, "HISTORICAL_MUTATION_FORBIDDEN", "Historical operational records cannot be modified");
    }
    if (shouldBlockOneTimeOrderDelivery(order)) {
      return errorResponse(res, 409, "DELIVERY_NOT_SUPPORTED", "One-time order delivery is disabled");
    }
    if (getOrderFulfillmentMethod(order) !== "delivery") {
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
    let user = null;
    if (order.userId) {
      user = await User.findById(order.userId).select("name phone").lean();
    }
    
    if (existingDelivery.arrivingSoonReminderSentAt) {
      return res.status(200).json({
        status: true,
        deduped: true,
        data: mapOneTimeOrderDelivery(order, user, existingDelivery),
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

    const targetDelivery = delivery || existingDelivery;

    if (!delivery) {
      return res.status(200).json({
        status: true,
        deduped: true,
        data: mapOneTimeOrderDelivery(order, user, targetDelivery),
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
      data: mapOneTimeOrderDelivery(order, user, targetDelivery),
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
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  const allowedRoles = (ACTION_REGISTRY["fulfill"] && ACTION_REGISTRY["fulfill"].roles) || ["superadmin", "admin", "courier"];
  if (!allowedRoles.includes(req.userRole)) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  try {
    validateObjectId(req.params.id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const gateOrder = await Order.findById(req.params.id).lean();
  if (!gateOrder) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }
  const targetBusinessDate = gateOrder.fulfillmentDate || gateOrder.deliveryDate || gateOrder.scheduledDate || gateOrder.date;
  if (targetBusinessDate && targetBusinessDate < getTodayKSADate()) {
    if (gateOrder.status !== "fulfilled") {
      return errorResponse(res, 409, "HISTORICAL_MUTATION_FORBIDDEN", "Historical operational records cannot be modified");
    }
  }
  if (shouldBlockOneTimeOrderDelivery(gateOrder)) {
    return errorResponse(res, 409, "DELIVERY_NOT_SUPPORTED", "One-time order delivery is disabled");
  }
  try {
    const result = await runMongoTransactionWithRetry(async (session, { attempt }) => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) {
        return { error: true, status: 404, code: "NOT_FOUND", message: "Order not found" };
      }
      if (shouldBlockOneTimeOrderDelivery(order)) {
        return { error: true, status: 409, code: "DELIVERY_NOT_SUPPORTED", message: "One-time order delivery is disabled" };
      }
      if (getOrderFulfillmentMethod(order) !== "delivery") {
        return { error: true, status: 400, code: "INVALID", message: "Order is not delivery" };
      }

      const delivery = await Delivery.findOne({ orderId: order._id }).session(session);
      if (!delivery) {
        return { error: true, status: 404, code: "NOT_FOUND", message: "Delivery not found" };
      }
      if (order.status === "fulfilled" || isDeliveryDeliveredStatus(delivery.status)) {
        let user = null;
        if (order.userId) {
          user = await User.findById(order.userId).select("name phone").lean();
        }
        return { idempotent: true, data: mapOneTimeOrderDelivery(order, user, delivery) };
      }
      if (order.status === ORDER_STATUSES.CANCELLED || order.status === "canceled" || isDeliveryCanceledStatus(delivery.status)) {
        return { error: true, status: 409, code: "ALREADY_CANCELED", message: "Cannot deliver a canceled order" };
      }
      if (order.status !== "out_for_delivery") {
        return { error: true, status: 409, code: "INVALID_TRANSITION", message: "Invalid state transition" };
      }

      const deliveredAt = new Date();
      order.status = "fulfilled";
      order.fulfilledAt = deliveredAt;
      await order.save({ session });

      delivery.status = "delivered";
      delivery.deliveredAt = deliveredAt;
      await delivery.save({ session });

      return { success: true, order, delivery };
    }, {
      label: "order_courier_mark_delivered",
      context: { orderId: req.params.id, role: req.userRole },
    });

    if (result.error) {
      return errorResponse(res, result.status, result.code, result.message);
    }
    if (result.idempotent) {
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: result.data,
      });
    }

    const { order, delivery } = result;
    await writeLog({
      entityType: "order",
      entityId: order._id,
      action: "order_delivered",
      byUserId: req.userId,
      byRole: req.userRole,
    });

    await notifyOrderUser({ order, type: "delivered" });
    let user = null;
    if (order.userId) {
      user = await User.findById(order.userId).select("name phone").lean();
    }
    return res.status(200).json({
      status: true,
      data: mapOneTimeOrderDelivery(order, user, delivery),
    });
  } catch (err) {
    logger.error("orderCourierController.markDelivered failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order delivery update failed");
  }
}

async function markCancelled(req, res) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  const allowedRoles = (ACTION_REGISTRY["cancel"] && ACTION_REGISTRY["cancel"].roles) || ["superadmin", "admin", "courier"];
  if (!allowedRoles.includes(req.userRole)) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" }
    });
  }
  try {
    validateObjectId(req.params.id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const gateOrder = await Order.findById(req.params.id).lean();
  if (!gateOrder) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }
  const targetBusinessDate = gateOrder.fulfillmentDate || gateOrder.deliveryDate || gateOrder.scheduledDate || gateOrder.date;
  if (targetBusinessDate && targetBusinessDate < getTodayKSADate()) {
    if (gateOrder.status !== ORDER_STATUSES.CANCELLED && gateOrder.status !== "canceled") {
      return errorResponse(res, 409, "HISTORICAL_MUTATION_FORBIDDEN", "Historical operational records cannot be modified");
    }
  }
  if (shouldBlockOneTimeOrderDelivery(gateOrder)) {
    return errorResponse(res, 409, "DELIVERY_NOT_SUPPORTED", "One-time order delivery is disabled");
  }
  try {
    const result = await runMongoTransactionWithRetry(async (session, { attempt }) => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order) {
        return { error: true, status: 404, code: "NOT_FOUND", message: "Order not found" };
      }
      if (shouldBlockOneTimeOrderDelivery(order)) {
        return { error: true, status: 409, code: "DELIVERY_NOT_SUPPORTED", message: "One-time order delivery is disabled" };
      }
      if (getOrderFulfillmentMethod(order) !== "delivery") {
        return { error: true, status: 400, code: "INVALID", message: "Order is not delivery" };
      }

      const delivery = await Delivery.findOne({ orderId: order._id }).session(session);
      if (!delivery) {
        return { error: true, status: 404, code: "NOT_FOUND", message: "Delivery not found" };
      }
      if (order.status === ORDER_STATUSES.CANCELLED || order.status === "canceled" || isDeliveryCanceledStatus(delivery.status)) {
        let user = null;
        if (order.userId) {
          user = await User.findById(order.userId).select("name phone").lean();
        }
        return { idempotent: true, data: mapOneTimeOrderDelivery(order, user, delivery) };
      }
      if (order.status === "fulfilled" || isDeliveryDeliveredStatus(delivery.status)) {
        return { error: true, status: 409, code: "ALREADY_DELIVERED", message: "Cannot cancel delivered order" };
      }
      let cancellation;
      try {
        cancellation = parseDeliveryCancellationInput(req.body || {});
      } catch (err) {
        return { error: true, status: err.status, code: err.code, message: err.message };
      }
      if (order.status !== "out_for_delivery") {
        return { error: true, status: 409, code: "INVALID_TRANSITION", message: "Only dispatched orders can be canceled" };
      }

      const canceledAt = new Date();
      order.status = ORDER_STATUSES.CANCELLED;
      order.cancelledAt = canceledAt;
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

      return { success: true, order, delivery, cancellation, canceledAt };
    }, {
      label: "order_courier_mark_cancelled",
      context: { orderId: req.params.id, role: req.userRole },
    });

    if (result.error) {
      return errorResponse(res, result.status, result.code, result.message);
    }
    if (result.idempotent) {
      return res.status(200).json({
        status: true,
        idempotent: true,
        data: result.data,
      });
    }

    const { order, delivery, cancellation, canceledAt } = result;
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
    let user = null;
    if (order.userId) {
      user = await User.findById(order.userId).select("name phone").lean();
    }
    return res.status(200).json({
      status: true,
      data: mapOneTimeOrderDelivery(order, user, delivery),
    });
  } catch (err) {
    logger.error("orderCourierController.markCancelled failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Order cancellation failed");
  }
}

module.exports = { listTodayOrders, markArrivingSoon, markDelivered, markCancelled };
