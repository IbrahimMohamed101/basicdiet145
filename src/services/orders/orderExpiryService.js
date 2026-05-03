const Payment = require("../../models/Payment");
const { writeLog } = require("../../utils/log");

async function expireOrderIfNeeded(order, { session = null, byUserId = null } = {}) {
  if (!order) return { order, expired: false, payment: null };
  if (String(order.status || "") !== "pending_payment") {
    return { order, expired: false, payment: null };
  }
  if (!order.expiresAt || new Date(order.expiresAt).getTime() > Date.now()) {
    return { order, expired: false, payment: null };
  }

  const paymentQuery = order.paymentId
    ? Payment.findById(order.paymentId)
    : Payment.findOne({ orderId: order._id }).sort({ createdAt: -1 });
  const payment = session ? await paymentQuery.session(session) : await paymentQuery;
  const paymentStatus = payment && payment.status ? String(payment.status) : String(order.paymentStatus || "");

  if (paymentStatus === "paid" || order.paymentStatus === "paid") {
    return { order, expired: false, payment };
  }

  order.status = "expired";
  order.paymentStatus = "expired";
  if (payment && payment.status === "initiated") {
    payment.status = "expired";
    await payment.save(session ? { session } : undefined);
  }
  await order.save(session ? { session } : undefined);

  await writeLog({
    entityType: "order",
    entityId: order._id,
    action: "order_expired",
    byUserId,
    byRole: "client",
    meta: { orderId: String(order._id), source: "one_time_order" },
  }).catch(() => null);

  return { order, expired: true, payment };
}

async function expirePendingOrders() {
  return { matchedCount: 0, modifiedCount: 0 };
}

module.exports = {
  expireOrderIfNeeded,
  expirePendingOrders,
};
