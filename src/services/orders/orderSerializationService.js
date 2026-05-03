const SYSTEM_CURRENCY = "SAR";

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
    };
  });
}

function shouldExposePaymentUrl(order) {
  return String(order.status || "") === "pending_payment"
    && String(order.paymentStatus || "") === "initiated";
}

function serializeOrderForClient(order) {
  const plain = toPlain(order);
  if (!plain) return null;
  const pricing = normalizePricing(plain.pricing || {});
  const fulfillmentMethod = plain.fulfillmentMethod || plain.deliveryMode || "";

  return {
    id: String(plain._id),
    orderId: String(plain._id),
    orderNumber: plain.orderNumber || "",
    source: "one_time_order",
    status: plain.status,
    paymentStatus: plain.paymentStatus,
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
  return {
    orderId: String(plain._id),
    orderNumber: plain.orderNumber || "",
    source: "one_time_order",
    status: plain.status,
    paymentStatus: plain.paymentStatus,
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

  const base = {
    source: "one_time_order",
    entityType: "order",
    entityId: String(plain._id),
    orderId: String(plain._id),
    orderNumber: plain.orderNumber || "",
    status: plain.status,
    paymentStatus: plain.paymentStatus,
    fulfillmentMethod,
    customer: normalizeCustomer(plain),
    pricing: normalizePricing(plain.pricing || {}),
    createdAt: plain.createdAt || null,
    allowedActions,
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
  normalizeItems,
  normalizePricing,
  serializeOrderForDashboard,
  serializeOrderForClient,
  serializeOrderSummaryForClient,
};
