const SYSTEM_CURRENCY = "SAR";
const { normalizeLegacyOrderStatus } = require("../../utils/orderState");

function toPlain(order) {
  if (!order) return null;
  return typeof order.toObject === "function" ? order.toObject() : { ...order };
}

function normalizePricing(pricing = {}) {
  const totalHalala = Number(
    pricing.totalHalala !== undefined
      ? pricing.totalHalala
      : pricing.total !== undefined
        ? pricing.total
        : pricing.totalPrice || 0
  );
  const subtotalHalala = Number(
    pricing.subtotalHalala !== undefined
      ? pricing.subtotalHalala
      : pricing.subtotal || 0
  );
  const deliveryFeeHalala = Number(
    pricing.deliveryFeeHalala !== undefined
      ? pricing.deliveryFeeHalala
      : pricing.deliveryFee || 0
  );
  const vatHalala = Number(
    pricing.vatHalala !== undefined
      ? pricing.vatHalala
      : pricing.vatAmount || 0
  );

  return {
    subtotalHalala,
    deliveryFeeHalala,
    discountHalala: Number(pricing.discountHalala || 0),
    totalHalala,
    vatPercentage: Number(pricing.vatPercentage || 0),
    vatHalala,
    vatIncluded: pricing.vatIncluded !== false,
    currency: String(pricing.currency || SYSTEM_CURRENCY).trim().toUpperCase() || SYSTEM_CURRENCY,
    ...(pricing.appliedPromo ? { appliedPromo: pricing.appliedPromo } : {}),
  };
}

function normalizeItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const qty = Number(item.qty !== undefined ? item.qty : item.quantity || 1);
    const unitPriceHalala = Number(
      item.unitPriceHalala !== undefined
        ? item.unitPriceHalala
        : item.unitPrice || 0
    );
    return {
      itemType: item.itemType || "standard_meal",
      catalogRef: item.catalogRef || undefined,
      name: item.name || {},
      qty,
      unitPriceHalala,
      lineTotalHalala: Number(item.lineTotalHalala || unitPriceHalala * qty),
      currency: item.currency || SYSTEM_CURRENCY,
      selections: item.selections || {},
      nutrition: item.nutrition || {},
      productSnapshot: item.productSnapshot || undefined,
    };
  });
}

function shouldExposePaymentUrl(order) {
  return String(order.status || "") === "pending_payment"
    && String(order.paymentStatus || "") === "initiated";
}

function buildOrderTimelineEndpoint(orderId) {
  return `/api/orders/${String(orderId)}/timeline`;
}

function normalizeCancellationReason(rawReason, status, paymentStatus) {
  const reason = String(rawReason || "").trim();
  if (reason === "client_cancelled_pending_payment") return "customer_requested";
  if (reason === "customer_requested" || reason === "customer_request" || reason === "customer_requested_cancellation") return "customer_requested";
  if (reason === "stock_out" || reason === "restaurant_rejected") return "restaurant_rejected";
  if (reason === "restaurant_cancelled") return "restaurant_cancelled";
  if (reason === "admin_cancelled") return "admin_cancelled";
  if (reason === "payment_failed" || reason === "payment_canceled" || reason === "payment_cancelled" || reason === "payment_initialization_failed") return "payment_failed";
  if (reason === "payment_expired") return "payment_expired";
  if (reason.startsWith("webhook_failed") || reason.startsWith("webhook_canceled")) return "payment_failed";
  if (reason.startsWith("webhook_expired")) return "payment_expired";
  if (status === "expired" || paymentStatus === "expired") return "payment_expired";
  if (status === "cancelled" && paymentStatus === "failed") return "payment_failed";
  if (status === "cancelled" && paymentStatus === "canceled") return "payment_failed";
  return reason || null;
}

function normalizeCancellationActor(order, reason) {
  const explicit = String(order.cancellationActorType || "").trim();
  if (explicit) return explicit;
  const cancelledBy = String(order.cancelledBy || order.canceledBy || "").trim();
  if (["customer", "client"].includes(cancelledBy)) return "customer";
  if (["restaurant", "admin", "system"].includes(cancelledBy)) return cancelledBy;
  if (reason === "customer_requested") return "customer";
  if (reason === "restaurant_rejected") return "restaurant";
  if (reason === "restaurant_cancelled") return "restaurant";
  if (reason === "payment_failed" || reason === "payment_expired") return "system";
  if (cancelledBy) return "admin";
  return null;
}

function normalizeCancellationSource(order, actor, reason) {
  const explicit = String(order.cancellationSource || "").trim();
  if (explicit) return explicit;
  if (actor === "customer") return "mobile_app";
  if (actor === "admin" || actor === "restaurant") return "dashboard";
  if (reason === "payment_failed") return "payment_provider";
  if (reason === "payment_expired") return "system";
  return null;
}

function serializeCancellationMetadata(order) {
  const status = normalizeLegacyOrderStatus(order && order.status, { paymentStatus: order && order.paymentStatus });
  const isCancelled = status === "cancelled" || status === "expired";
  const reason = isCancelled
    ? normalizeCancellationReason(order.cancellationReason, status, order.paymentStatus)
    : null;
  const actor = isCancelled ? normalizeCancellationActor(order, reason) : null;
  const cancelledAt = order.cancelledAt || order.canceledAt || (status === "expired" ? (order.expiresAt || order.updatedAt) : null);

  return {
    cancelled_by: actor,
    cancellation_reason: reason,
    cancellation_source: isCancelled ? normalizeCancellationSource(order, actor, reason) : null,
    cancelled_at: cancelledAt || null,
  };
}

function getClientAllowedActions(order) {
  const status = normalizeLegacyOrderStatus(order && order.status, { paymentStatus: order && order.paymentStatus });
  if (status === "pending_payment" && String(order && order.paymentStatus || "") === "initiated") {
    return ["cancel"];
  }
  return [];
}

function serializeOrderForClient(order) {
  const plain = toPlain(order);
  if (!plain) return null;
  const pricing = normalizePricing(plain.pricing || {});
  const fulfillmentMethod = plain.fulfillmentMethod || plain.deliveryMode || "";
  const id = String(plain._id);

  return {
    id,
    orderId: id,
    orderNumber: plain.orderNumber || "",
    source: "one_time_order",
    status: normalizeLegacyOrderStatus(plain.status, { paymentStatus: plain.paymentStatus }),
    paymentStatus: plain.paymentStatus,
    allowedActions: getClientAllowedActions(plain),
    timeline_endpoint: buildOrderTimelineEndpoint(id),
    ...serializeCancellationMetadata(plain),
    ...(shouldExposePaymentUrl(plain) ? { paymentUrl: plain.paymentUrl || "" } : {}),
    expiresAt: plain.expiresAt || null,
    fulfillmentMethod,
    fulfillmentDate: plain.fulfillmentDate || plain.deliveryDate || "",
    requestedFulfillmentDate: plain.requestedFulfillmentDate || plain.requestedDeliveryDate || "",
    items: normalizeItems(plain.items),
    pricing,
    pickup: fulfillmentMethod === "pickup" ? (plain.pickup || {}) : undefined,
    delivery: fulfillmentMethod === "delivery" ? (plain.delivery || {}) : undefined,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

function serializeOrderSummaryForClient(order) {
  const plain = toPlain(order);
  if (!plain) return null;
  const pricing = normalizePricing(plain.pricing || {});
  const items = normalizeItems(plain.items);
  const id = String(plain._id);
  return {
    id,
    orderId: id,
    orderNumber: plain.orderNumber || "",
    source: "one_time_order",
    status: normalizeLegacyOrderStatus(plain.status, { paymentStatus: plain.paymentStatus }),
    paymentStatus: plain.paymentStatus,
    allowedActions: getClientAllowedActions(plain),
    timeline_endpoint: buildOrderTimelineEndpoint(id),
    ...serializeCancellationMetadata(plain),
    fulfillmentMethod: plain.fulfillmentMethod || plain.deliveryMode || "",
    fulfillmentDate: plain.fulfillmentDate || plain.deliveryDate || "",
    itemCount: items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
    totalHalala: pricing.totalHalala,
    currency: pricing.currency,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

function normalizeCustomer(order) {
  const user = order && order.userId && typeof order.userId === "object" ? order.userId : null;
  return {
    id: user && user._id ? String(user._id) : (order && order.userId ? String(order.userId) : null),
    name: user && user.name ? String(user.name) : "",
    phone: user && user.phone ? String(user.phone) : "",
  };
}

function sanitizePayment(payment, order) {
  const plainPayment = payment && typeof payment.toObject === "function" ? payment.toObject() : payment;
  return {
    id: plainPayment && plainPayment._id ? String(plainPayment._id) : (order && order.paymentId ? String(order.paymentId) : null),
    provider: plainPayment && plainPayment.provider ? plainPayment.provider : "moyasar",
    status: plainPayment && plainPayment.status ? plainPayment.status : (order && order.paymentStatus ? order.paymentStatus : null),
    amount: plainPayment && plainPayment.amount !== undefined
      ? Number(plainPayment.amount)
      : Number(order && order.pricing ? order.pricing.totalHalala || 0 : 0),
    currency: plainPayment && plainPayment.currency ? plainPayment.currency : (
      order && order.pricing && order.pricing.currency ? order.pricing.currency : SYSTEM_CURRENCY
    ),
    paidAt: plainPayment && plainPayment.paidAt ? plainPayment.paidAt : null,
  };
}

function serializeActivityLog(log) {
  const plain = log && typeof log.toObject === "function" ? log.toObject() : log;
  if (!plain) return null;
  return {
    id: plain._id ? String(plain._id) : undefined,
    action: plain.action || "",
    byUserId: plain.byUserId ? String(plain.byUserId) : null,
    byRole: plain.byRole || null,
    meta: plain.meta || null,
    createdAt: plain.createdAt || null,
  };
}

function serializeOrderForDashboard(order, { allowedActions = [], payment = null, activity = [], detail = false } = {}) {
  const plain = toPlain(order);
  if (!plain) return null;
  const fulfillmentMethod = plain.fulfillmentMethod || plain.deliveryMode || "";
  const pickup = plain.pickup || {};
  const pickupCode = plain.pickupCode || pickup.pickupCode || null;
  const id = String(plain._id);

  const base = {
    id,
    type: "order",
    source: "one_time_order",
    entityType: "order",
    entityId: id,
    orderId: id,
    reference: `ORD-${String(plain._id).slice(-6).toUpperCase()}`,
    orderNumber: plain.orderNumber || "",
    status: normalizeLegacyOrderStatus(plain.status, { paymentStatus: plain.paymentStatus }),
    paymentStatus: plain.paymentStatus,
    fulfillmentMethod,
    mode: fulfillmentMethod,
    customer: normalizeCustomer(plain),
    pricing: normalizePricing(plain.pricing || {}),
    context: {
      date: plain.fulfillmentDate || plain.deliveryDate || "",
      window: plain.deliveryWindow || (plain.delivery && plain.delivery.deliveryWindow ? plain.delivery.deliveryWindow : ""),
      address: plain.deliveryAddress || (plain.delivery && plain.delivery.address ? plain.delivery.address : null),
      branch: fulfillmentMethod === "pickup" ? "Main Branch" : null,
      pickupCode,
      pickupCodeIssuedAt: plain.pickupCodeIssuedAt || null,
      pickupVerifiedAt: plain.pickupVerifiedAt || null,
    },
    createdAt: plain.createdAt || null,
    allowedActions,
    timeline_endpoint: buildOrderTimelineEndpoint(id),
    ...serializeCancellationMetadata(plain),
  };

  if (!detail) {
    return base;
  }

  return {
    ...base,
    items: normalizeItems(plain.items),
    payment: sanitizePayment(payment, plain),
    delivery: fulfillmentMethod === "delivery" ? (plain.delivery || plain.deliveryAddress || {}) : {},
    pickup: fulfillmentMethod === "pickup" ? (plain.pickup || {}) : {},
    activity: (Array.isArray(activity) ? activity : []).map(serializeActivityLog).filter(Boolean),
    updatedAt: plain.updatedAt || null,
  };
}

module.exports = {
  buildOrderTimelineEndpoint,
  normalizeItems,
  normalizePricing,
  serializeCancellationMetadata,
  serializeOrderForDashboard,
  serializeOrderForClient,
  serializeOrderSummaryForClient,
};
