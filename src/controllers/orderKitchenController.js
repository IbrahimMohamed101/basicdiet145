const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const { notifyOrderUser } = require("../services/orderNotificationService");
const { ORDER_STATUSES, canOrderTransition, normalizeLegacyOrderStatus } = require("../utils/orderState");
const { writeLog } = require("../utils/log");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const {
  getOrderFulfillmentMethod,
  shouldBlockOneTimeOrderDelivery,
} = require("../utils/oneTimeOrderDeliveryGate");

async function listOrdersByDate(req, res) {
  const { date } = req.params;
  const orders = await Order.find({
    $or: [{ fulfillmentDate: date }, { deliveryDate: date }],
    paymentStatus: "paid",
    status: { $in: [ORDER_STATUSES.CONFIRMED, ORDER_STATUSES.IN_PREPARATION, ORDER_STATUSES.READY_FOR_PICKUP] },
  }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({
    status: true,
    data: orders.filter((order) => !shouldBlockOneTimeOrderDelivery(order)),
  });
}

async function transitionOrder(req, res, toStatus) {
  const normalizedToStatus = normalizeLegacyOrderStatus(toStatus);
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
  if (shouldBlockOneTimeOrderDelivery(order)) {
    return errorResponse(res, 409, "ONE_TIME_ORDER_DELIVERY_DISABLED", "One-time order delivery is disabled");
  }

  const mode = getOrderFulfillmentMethod(order);

  const canDirectPickupFulfill =
    normalizedToStatus === ORDER_STATUSES.FULFILLED
    && mode === "pickup"
    && [ORDER_STATUSES.IN_PREPARATION, ORDER_STATUSES.READY_FOR_PICKUP, "preparing"].includes(order.status);

  if (!canDirectPickupFulfill && !canOrderTransition(order.status, normalizedToStatus)) {
    return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
  }

  if (normalizedToStatus === ORDER_STATUSES.OUT_FOR_DELIVERY && mode !== "delivery") {
    return errorResponse(res, 400, "INVALID", "Order is not delivery");
  }
  if (normalizedToStatus === ORDER_STATUSES.READY_FOR_PICKUP && mode !== "pickup") {
    return errorResponse(res, 400, "INVALID", "Order is not pickup");
  }
  if (normalizedToStatus === ORDER_STATUSES.FULFILLED && mode !== "pickup") {
    return errorResponse(res, 400, "INVALID", "Only pickup orders can be fulfilled by kitchen");
  }

  const fromStatus = order.status;
  order.status = normalizedToStatus;
  if (normalizedToStatus === ORDER_STATUSES.CONFIRMED && !order.confirmedAt) order.confirmedAt = new Date();
  if (normalizedToStatus === ORDER_STATUSES.FULFILLED && !order.fulfilledAt) order.fulfilledAt = new Date();
  if (normalizedToStatus === ORDER_STATUSES.CANCELLED && !order.cancelledAt) order.cancelledAt = new Date();
  let delivery = null;

  if (normalizedToStatus === ORDER_STATUSES.OUT_FOR_DELIVERY && mode === "delivery") {
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
    meta: { from: fromStatus, to: normalizedToStatus },
  });

  if ([ORDER_STATUSES.IN_PREPARATION, ORDER_STATUSES.OUT_FOR_DELIVERY, ORDER_STATUSES.READY_FOR_PICKUP].includes(normalizedToStatus)) {
    await notifyOrderUser({
      order,
      type: normalizedToStatus,
      deliveryId: delivery ? delivery._id : null,
      scheduledFor: new Date(),
    });
  }

  return res.status(200).json({ status: true, data: order });
}

module.exports = { listOrdersByDate, transitionOrder };
