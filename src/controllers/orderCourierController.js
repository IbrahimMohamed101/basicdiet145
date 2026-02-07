const Order = require("../models/Order");
const { getTodayKSADate } = require("../utils/date");
const { canOrderTransition } = require("../utils/orderState");
const { writeLog } = require("../utils/log");

async function listTodayOrders(_req, res) {
  const today = getTodayKSADate();
  const orders = await Order.find({ deliveryDate: today, deliveryMode: "delivery" }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: orders });
}

async function markDelivered(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Order not found" } });
  }
  if (order.deliveryMode !== "delivery") {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Order is not delivery" } });
  }
  if (!canOrderTransition(order.status, "fulfilled")) {
    return res.status(409).json({ ok: false, error: { code: "INVALID_TRANSITION", message: "Invalid state transition" } });
  }
  order.status = "fulfilled";
  order.fulfilledAt = new Date();
  await order.save();

  await writeLog({
    entityType: "order",
    entityId: order._id,
    action: "order_delivered",
    byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
    byRole: req.dashboardRole,
  });
  return res.status(200).json({ ok: true });
}

async function markCancelled(req, res) {
  const order = await Order.findById(req.params.id);
  if (!order) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Order not found" } });
  }
  if (!canOrderTransition(order.status, "canceled")) {
    return res.status(409).json({ ok: false, error: { code: "INVALID_TRANSITION", message: "Invalid state transition" } });
  }
  order.status = "canceled";
  order.canceledAt = new Date();
  await order.save();

  await writeLog({
    entityType: "order",
    entityId: order._id,
    action: "order_canceled",
    byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
    byRole: req.dashboardRole,
  });
  return res.status(200).json({ ok: true });
}

module.exports = { listTodayOrders, markDelivered, markCancelled };
