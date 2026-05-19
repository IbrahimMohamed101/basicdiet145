const mongoose = require("mongoose");

const Order = require("../../models/Order");
const { ORDER_STATUSES, normalizeLegacyOrderStatus } = require("../../utils/orderState");
const { serializeCancellationMetadata } = require("./orderSerializationService");

const PICKUP_TIMELINE_STEPS = Object.freeze([
  {
    key: "order_created",
    label_ar: "تم إنشاء الطلب",
    label_en: "Order Created",
    status: ORDER_STATUSES.PENDING_PAYMENT,
    timeField: "createdAt",
  },
  {
    key: "payment_confirmed",
    label_ar: "تم تأكيد الطلب",
    label_en: "Payment Confirmed",
    status: ORDER_STATUSES.CONFIRMED,
    timeField: "confirmedAt",
  },
  {
    key: "preparing",
    label_ar: "جاري تجهيز الطلب",
    label_en: "Preparing",
    status: ORDER_STATUSES.IN_PREPARATION,
    timeField: "preparationStartedAt",
  },
  {
    key: "ready_for_pickup",
    label_ar: "الطلب جاهز للاستلام",
    label_en: "Ready for Pickup",
    status: ORDER_STATUSES.READY_FOR_PICKUP,
    timeField: "readyAt",
  },
  {
    key: "fulfilled",
    label_ar: "تم استلام الطلب",
    label_en: "Picked Up",
    status: ORDER_STATUSES.FULFILLED,
    timeField: "fulfilledAt",
  },
]);

const STATUS_INDEX = Object.freeze({
  pending_payment: 0,
  confirmed: 1,
  in_preparation: 2,
  ready_for_pickup: 3,
  fulfilled: 4,
});

function createServiceError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function serializeTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getStepTime(order, step) {
  if (step.key === "ready_for_pickup") {
    return order.readyAt || (order.pickup && order.pickup.readyAt) || null;
  }
  return order[step.timeField] || null;
}

function buildNormalTimeline(order, currentStatus) {
  const currentIndex = STATUS_INDEX[currentStatus] ?? 0;
  return PICKUP_TIMELINE_STEPS.map((step, index) => {
    let state = "pending";
    if (currentStatus === ORDER_STATUSES.FULFILLED) state = "completed";
    else if (index < currentIndex) state = "completed";
    else if (index === currentIndex) state = "active";

    return {
      key: step.key,
      label_ar: step.label_ar,
      label_en: step.label_en,
      state,
      time: state === "pending" ? null : serializeTime(getStepTime(order, step) || order.updatedAt),
    };
  });
}

function buildCancelledTimeline(order, currentStatus) {
  const normalItems = PICKUP_TIMELINE_STEPS
    .map((step) => {
      const time = getStepTime(order, step);
      if (!time && step.key !== "order_created") return null;
      return {
        key: step.key,
        label_ar: step.label_ar,
        label_en: step.label_en,
        state: "completed",
        time: serializeTime(time || order.createdAt),
      };
    })
    .filter(Boolean);

  if (currentStatus === ORDER_STATUSES.EXPIRED) {
    return normalItems.concat({
      key: "expired",
      label_ar: "انتهت صلاحية الدفع",
      label_en: "Payment Expired",
      state: "cancelled",
      time: serializeTime(order.expiresAt || order.updatedAt),
    });
  }

  const cancellation = serializeCancellationMetadata(order);
  return normalItems.concat({
    key: "cancelled",
    label_ar: "تم إلغاء الطلب",
    label_en: "Order Cancelled",
    state: "cancelled",
    time: serializeTime(cancellation.cancelled_at || order.updatedAt),
    cancelled_by: cancellation.cancelled_by,
    cancellation_reason: cancellation.cancellation_reason,
    cancellation_source: cancellation.cancellation_source,
  });
}

function buildOrderTimeline(order) {
  const currentStatus = normalizeLegacyOrderStatus(order.status, { paymentStatus: order.paymentStatus });
  const timeline = currentStatus === ORDER_STATUSES.CANCELLED || currentStatus === ORDER_STATUSES.EXPIRED
    ? buildCancelledTimeline(order, currentStatus)
    : buildNormalTimeline(order, currentStatus);

  return {
    order_id: String(order._id),
    current_status: currentStatus,
    timeline,
  };
}

async function getOrderTimelineForCustomer({ orderId, userId }) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw createServiceError(400, "INVALID_ORDER_ID", "Invalid order id");
  }
  const order = await Order.findOne({ _id: orderId, userId }).lean();
  if (!order) {
    throw createServiceError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  return buildOrderTimeline(order);
}

async function getOrderTimelineForDashboard({ orderId }) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw createServiceError(400, "INVALID_ORDER_ID", "Invalid order id");
  }
  const order = await Order.findById(orderId).lean();
  if (!order) {
    throw createServiceError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  return buildOrderTimeline(order);
}

module.exports = {
  buildOrderTimeline,
  getOrderTimelineForCustomer,
  getOrderTimelineForDashboard,
};
