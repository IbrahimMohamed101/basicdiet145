const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const { canOrderTransition } = require("../utils/orderState");
const { writeLog } = require("../utils/log");

async function listOrdersByDate(req, res) {
  const { date } = req.params;
  const orders = await Order.find({ deliveryDate: date }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: orders });
}

async function transitionOrder(req, res, toStatus) {
  const { id } = req.params;
  const order = await Order.findById(id);
  if (!order) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Order not found" } });
  }

  if (!canOrderTransition(order.status, toStatus)) {
    return res.status(409).json({ ok: false, error: { code: "INVALID_TRANSITION", message: "Invalid state transition" } });
  }

  if (toStatus === "out_for_delivery" && order.deliveryMode !== "delivery") {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Order is not delivery" } });
  }
  if (toStatus === "ready_for_pickup" && order.deliveryMode !== "pickup") {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Order is not pickup" } });
  }

  const fromStatus = order.status;
  order.status = toStatus;
  if (toStatus === "confirmed" && !order.confirmedAt) order.confirmedAt = new Date();
  if (toStatus === "fulfilled" && !order.fulfilledAt) order.fulfilledAt = new Date();
  if (toStatus === "canceled" && !order.canceledAt) order.canceledAt = new Date();
  
  // CR-05 FIX: Create Delivery record for delivery orders going out_for_delivery
  if (toStatus === "out_for_delivery" && order.deliveryMode === "delivery") {
    await Delivery.findOneAndUpdate(
      { orderId: order._id },
      {
        $setOnInsert: {
          orderId: order._id,
          subscriptionId: null, // One-time orders have no subscription
          address: order.deliveryAddress,
          window: order.deliveryWindow,
          status: "out_for_delivery",
        }
      },
      { upsert: true }
    );
  }
  
  await order.save();

  await writeLog({
    entityType: "order",
    entityId: order._id,
    action: "order_state_change",
    byUserId: req.dashboardUser ? req.dashboardUser._id : undefined,
    byRole: req.dashboardRole,
    meta: { from: fromStatus, to: toStatus },
  });

  return res.status(200).json({ ok: true, data: order });
}

module.exports = { listOrdersByDate, transitionOrder };
