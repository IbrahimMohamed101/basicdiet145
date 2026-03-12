const { sendUserNotificationWithDedupe } = require("./notificationService");
const { logger } = require("../utils/logger");

const ORDER_NOTIFICATION_CONFIG = {
  paid: {
    title: "Order Confirmed",
    body: "Your payment was received and your order is confirmed.",
  },
  preparing: {
    title: "Order Update",
    body: "Your order is now being prepared.",
  },
  out_for_delivery: {
    title: "Order Update",
    body: "Your order is out for delivery.",
  },
  ready_for_pickup: {
    title: "Order Update",
    body: "Your order is ready for pickup.",
  },
  arriving_soon: {
    title: "Delivery Update",
    body: "Your order will arrive soon.",
  },
  delivered: {
    title: "Delivery Update",
    body: "Your order has been delivered successfully.",
  },
  canceled: {
    title: "Order Update",
    body: "Your order has been canceled.",
  },
};

async function notifyOrderUser({
  order,
  type,
  deliveryId = null,
  paymentId = null,
  scheduledFor = null,
}) {
  if (!order || !order._id || !order.userId) {
    return { status: "skipped" };
  }

  const config = ORDER_NOTIFICATION_CONFIG[type];
  if (!config) {
    return { status: "skipped" };
  }

  try {
    return await sendUserNotificationWithDedupe({
      userId: order.userId,
      title: config.title,
      body: config.body,
      data: {
        orderId: String(order._id),
        ...(deliveryId ? { deliveryId: String(deliveryId) } : {}),
        ...(paymentId ? { paymentId: String(paymentId) } : {}),
        type,
      },
      type: `order_${type}`,
      dedupeKey: [
        "order",
        String(order._id),
        type,
        deliveryId ? String(deliveryId) : "",
        paymentId ? String(paymentId) : "",
      ].filter(Boolean).join(":"),
      entityType: "order",
      entityId: order._id,
      scheduledFor: scheduledFor || new Date(),
    });
  } catch (err) {
    logger.error("Order notification failed", {
      orderId: String(order._id),
      type,
      error: err.message,
      stack: err.stack,
    });
    return { status: "failed", error: err };
  }
}

module.exports = { notifyOrderUser };
