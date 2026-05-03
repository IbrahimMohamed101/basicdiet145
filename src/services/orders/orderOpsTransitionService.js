const crypto = require("node:crypto");
const mongoose = require("mongoose");

const ActivityLog = require("../../models/ActivityLog");
const Order = require("../../models/Order");
const { ORDER_STATUSES, canTransitionOrderStatus, isFinalOrderStatus } = require("../../utils/orderState");

const ACTIONS = Object.freeze({
  PREPARE: "prepare",
  READY_FOR_PICKUP: "ready_for_pickup",
  DISPATCH: "dispatch",
  NOTIFY_ARRIVAL: "notify_arrival",
  FULFILL: "fulfill",
  CANCEL: "cancel",
  REOPEN: "reopen",
});

const ACTION_LOGS = Object.freeze({
  prepare: "dashboard_order_prepare",
  ready_for_pickup: "dashboard_order_ready_for_pickup",
  dispatch: "dashboard_order_dispatch",
  notify_arrival: "dashboard_order_notify_arrival",
  fulfill: "dashboard_order_fulfill",
  cancel: "dashboard_order_cancel",
});

const ADMIN_ROLES = new Set(["superadmin", "admin"]);
const PAID_STATUSES = new Set(["paid"]);

function createServiceError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getOrderMode(order) {
  return String(order.fulfillmentMethod || order.deliveryMode || "").trim();
}

function isPaidOperationalOrder(order) {
  return order
    && order.status !== ORDER_STATUSES.PENDING_PAYMENT
    && PAID_STATUSES.has(String(order.paymentStatus || ""));
}

function actionRoles(action, fulfillmentMethod) {
  switch (action) {
    case ACTIONS.PREPARE:
    case ACTIONS.READY_FOR_PICKUP:
      return ["superadmin", "admin", "kitchen"];
    case ACTIONS.DISPATCH:
      return ["superadmin", "admin", "kitchen", "courier"];
    case ACTIONS.NOTIFY_ARRIVAL:
      return ["superadmin", "admin", "courier"];
    case ACTIONS.FULFILL:
      return fulfillmentMethod === "pickup"
        ? ["superadmin", "admin", "kitchen"]
        : ["superadmin", "admin", "courier"];
    case ACTIONS.CANCEL:
      return ["superadmin", "admin"];
    default:
      return [];
  }
}

function roleCan(action, order, actor) {
  const role = normalizeRole(actor && actor.role);
  return actionRoles(action, getOrderMode(order)).includes(role);
}

function getAllowedOrderActions(order, actor = {}) {
  if (!order || !order.status || isFinalOrderStatus(order.status) || !isPaidOperationalOrder(order)) {
    return [];
  }

  const mode = getOrderMode(order);
  const candidates = [];
  if (order.status === ORDER_STATUSES.CONFIRMED) {
    candidates.push(ACTIONS.PREPARE, ACTIONS.CANCEL);
  }
  if (order.status === ORDER_STATUSES.IN_PREPARATION && mode === "pickup") {
    candidates.push(ACTIONS.READY_FOR_PICKUP, ACTIONS.CANCEL);
  }
  if (order.status === ORDER_STATUSES.IN_PREPARATION && mode === "delivery") {
    candidates.push(ACTIONS.DISPATCH, ACTIONS.CANCEL);
  }
  if (order.status === ORDER_STATUSES.READY_FOR_PICKUP) {
    candidates.push(ACTIONS.FULFILL, ACTIONS.CANCEL);
  }
  if (order.status === ORDER_STATUSES.OUT_FOR_DELIVERY) {
    candidates.push(ACTIONS.NOTIFY_ARRIVAL, ACTIONS.FULFILL, ACTIONS.CANCEL);
  }

  return candidates.filter((action) => roleCan(action, order, actor));
}

function assertSupportedAction(action) {
  if (action === ACTIONS.REOPEN) {
    throw createServiceError(409, "REOPEN_NOT_SUPPORTED", "Reopen is not supported for one-time orders");
  }
  if (!Object.values(ACTIONS).includes(action) || !ACTION_LOGS[action]) {
    throw createServiceError(400, "UNKNOWN_ACTION", "Unknown dashboard order action");
  }
}

function assertActionAllowed(order, action, actor) {
  assertSupportedAction(action);
  if (!order) {
    throw createServiceError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  if (isFinalOrderStatus(order.status)) {
    throw createServiceError(409, "FINAL_STATUS", "Final order statuses do not accept dashboard actions");
  }
  if (!isPaidOperationalOrder(order)) {
    throw createServiceError(409, "PAYMENT_NOT_PAID", "Order must be paid before operational dashboard actions");
  }
  if (!roleCan(action, order, actor)) {
    throw createServiceError(403, "FORBIDDEN", "Role cannot perform this action");
  }
  if (!getAllowedOrderActions(order, actor).includes(action)) {
    throw createServiceError(409, "INVALID_TRANSITION", "Action is not allowed for the current order state");
  }
}

async function writeOrderActivity({ order, action, actor, fromStatus, toStatus, payload }) {
  await ActivityLog.create({
    entityType: "order",
    entityId: order._id,
    action: ACTION_LOGS[action],
    byUserId: actor && actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? actor.userId : undefined,
    byRole: actor && actor.role ? actor.role : "dashboard",
    meta: {
      source: "dashboard_orders",
      orderId: String(order._id),
      orderNumber: order.orderNumber || "",
      fromStatus,
      toStatus,
      reason: payload && payload.reason ? String(payload.reason) : null,
      notes: payload && (payload.notes || payload.note) ? String(payload.notes || payload.note) : null,
      etaAt: payload && payload.etaAt ? payload.etaAt : null,
    },
  });
}

async function executeOrderAction({ orderId, action, actor = {}, payload = {} }) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw createServiceError(400, "INVALID_ORDER_ID", "Invalid order id");
  }

  const normalizedAction = String(action || "").trim();
  assertSupportedAction(normalizedAction);

  const order = await Order.findById(orderId);
  assertActionAllowed(order, normalizedAction, actor);

  const fromStatus = order.status;
  const mode = getOrderMode(order);
  const now = new Date();
  let toStatus = fromStatus;

  if (normalizedAction === ACTIONS.PREPARE) {
    toStatus = ORDER_STATUSES.IN_PREPARATION;
    order.preparationStartedAt = order.preparationStartedAt || now;
  } else if (normalizedAction === ACTIONS.READY_FOR_PICKUP) {
    if (mode !== "pickup") throw createServiceError(409, "INVALID_FULFILLMENT_METHOD", "Action requires pickup order");
    toStatus = ORDER_STATUSES.READY_FOR_PICKUP;
    order.readyAt = order.readyAt || now;
    order.pickup = order.pickup || {};
    order.pickup.readyAt = order.pickup.readyAt || now;
    if (payload.pickupCode || !order.pickup.pickupCode) {
      order.pickup.pickupCode = payload.pickupCode
        ? String(payload.pickupCode).trim()
        : String(crypto.randomInt(100000, 999999));
    }
  } else if (normalizedAction === ACTIONS.DISPATCH) {
    if (mode !== "delivery") throw createServiceError(409, "INVALID_FULFILLMENT_METHOD", "Action requires delivery order");
    toStatus = ORDER_STATUSES.OUT_FOR_DELIVERY;
    order.dispatchedAt = order.dispatchedAt || now;
  } else if (normalizedAction === ACTIONS.NOTIFY_ARRIVAL) {
    if (mode !== "delivery") throw createServiceError(409, "INVALID_FULFILLMENT_METHOD", "Action requires delivery order");
    toStatus = ORDER_STATUSES.OUT_FOR_DELIVERY;
  } else if (normalizedAction === ACTIONS.FULFILL) {
    toStatus = ORDER_STATUSES.FULFILLED;
    order.fulfilledAt = order.fulfilledAt || now;
    if (mode === "pickup") {
      order.pickup = order.pickup || {};
      order.pickup.pickedUpAt = order.pickup.pickedUpAt || now;
    }
  } else if (normalizedAction === ACTIONS.CANCEL) {
    toStatus = ORDER_STATUSES.CANCELLED;
    order.cancelledAt = order.cancelledAt || now;
    order.canceledAt = order.cancelledAt;
    order.cancellationReason = payload.reason ? String(payload.reason) : order.cancellationReason || "";
    order.cancellationNote = payload.notes || payload.note || order.cancellationNote || "";
    order.cancelledBy = actor && actor.userId ? String(actor.userId) : order.cancelledBy || "";
    order.canceledBy = order.cancelledBy;
  }

  if (fromStatus !== toStatus && !canTransitionOrderStatus(fromStatus, toStatus, order)) {
    throw createServiceError(409, "INVALID_TRANSITION", "Action is not allowed for the current order state");
  }

  order.status = toStatus;
  await order.save();

  await writeOrderActivity({
    order,
    action: normalizedAction,
    actor,
    fromStatus,
    toStatus,
    payload,
  });

  return order;
}

module.exports = {
  ACTIONS,
  getAllowedOrderActions,
  executeOrderAction,
};
