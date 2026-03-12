const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { canOrderTransition } = require("../utils/orderState");
const { writeLog } = require("../utils/log");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function listOrdersByDate(req, res) {
  const { date } = req.params;
  const orders = await Order.find({ deliveryDate: date }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: orders });
}

async function transitionOrder(req, res, toStatus) {
  const { id } = req.params;
  try {
    validateObjectId(id, "orderId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const order = await Order.findById(id);
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }

  const canDirectPickupFulfill =
    toStatus === "fulfilled"
    && order.deliveryMode === "pickup"
    && ["preparing", "ready_for_pickup"].includes(order.status);

  if (!canDirectPickupFulfill && !canOrderTransition(order.status, toStatus)) {
    return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
  }

  if (toStatus === "out_for_delivery" && order.deliveryMode !== "delivery") {
    return errorResponse(res, 400, "INVALID", "Order is not delivery");
  }
  if (toStatus === "ready_for_pickup" && order.deliveryMode !== "pickup") {
    return errorResponse(res, 400, "INVALID", "Order is not pickup");
  }
  if (toStatus === "fulfilled" && order.deliveryMode !== "pickup") {
    return errorResponse(res, 400, "INVALID", "Only pickup orders can be fulfilled by kitchen");
  }

  const fromStatus = order.status;
  order.status = toStatus;
  if (toStatus === "confirmed" && !order.confirmedAt) order.confirmedAt = new Date();
  if (toStatus === "fulfilled" && !order.fulfilledAt) order.fulfilledAt = new Date();
  if (toStatus === "canceled" && !order.canceledAt) order.canceledAt = new Date();
  let delivery = null;

  if (toStatus === "out_for_delivery" && order.deliveryMode === "delivery") {
    const etaAt = req.body && req.body.etaAt ? new Date(req.body.etaAt) : null;
    if (etaAt && Number.isNaN(etaAt.getTime())) {
      return errorResponse(res, 400, "INVALID", "Invalid etaAt");
    }

    delivery = await Delivery.findOneAndUpdate(
      { orderId: order._id },
      {
        $set: {
          address: order.deliveryAddress,
          window: order.deliveryWindow,
          status: "out_for_delivery",
          ...(etaAt ? { etaAt } : {}),
        },
        $setOnInsert: {
          orderId: order._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  await order.save();

  await writeLog({
    entityType: "order",
    entityId: order._id,
    action: "order_state_change",
    byUserId: req.userId,
    byRole: req.userRole,
    meta: { from: fromStatus, to: toStatus },
  });

  if (["preparing", "out_for_delivery", "ready_for_pickup"].includes(toStatus)) {
    await notifyOrderUser({
      order,
      type: toStatus,
      deliveryId: delivery ? delivery._id : null,
      scheduledFor: new Date(),
    });
  }

  return res.status(200).json({ ok: true, data: order });
}

module.exports = { listOrdersByDate, transitionOrder };
