const Order = require("../models/Order");
const { ORDER_STATUSES, normalizeLegacyOrderStatus } = require("../utils/orderState");
const opsTransitionService = require("../services/dashboard/opsTransitionService");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const {
  getOrderFulfillmentMethod,
  shouldBlockOneTimeOrderDelivery,
} = require("../utils/oneTimeOrderDeliveryGate");
const { resolveOptionalPagination, buildPaginationMeta } = require("../utils/optionalPagination");

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
  const order = await Order.findById(id).lean();
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }
  if (shouldBlockOneTimeOrderDelivery(order)) {
    return errorResponse(res, 409, "DELIVERY_NOT_SUPPORTED", "One-time order delivery is disabled");
  }

  const mode = getOrderFulfillmentMethod(order);

  if (normalizedToStatus === ORDER_STATUSES.OUT_FOR_DELIVERY && mode !== "delivery") {
    return errorResponse(res, 400, "INVALID", "Order is not delivery");
  }
  if (normalizedToStatus === ORDER_STATUSES.READY_FOR_PICKUP && mode !== "pickup") {
    return errorResponse(res, 400, "INVALID", "Order is not pickup");
  }
  if (normalizedToStatus === ORDER_STATUSES.FULFILLED && mode !== "pickup") {
    return errorResponse(res, 400, "INVALID", "Only pickup orders can be fulfilled by kitchen");
  }
  const actionByStatus = {
    [ORDER_STATUSES.IN_PREPARATION]: "prepare",
    [ORDER_STATUSES.OUT_FOR_DELIVERY]: "dispatch",
    [ORDER_STATUSES.READY_FOR_PICKUP]: "ready_for_pickup",
    [ORDER_STATUSES.FULFILLED]: "fulfill",
    [ORDER_STATUSES.CANCELLED]: "cancel",
  };
  const action = actionByStatus[normalizedToStatus];
  if (!action) return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");

  try {
    const updated = await opsTransitionService.executeAction(action, {
      entityId: id,
      entityType: "order",
      userId: req.dashboardUserId || req.userId,
      role: req.userRole || "kitchen",
      payload: req.body || {},
    });
    return res.status(200).json({ status: true, data: updated });
  } catch (err) {
    return errorResponse(res, err.status || 409, err.code || "INVALID_TRANSITION", err.message || "Invalid state transition");
  }
}

module.exports = { listOrdersByDate, transitionOrder };
