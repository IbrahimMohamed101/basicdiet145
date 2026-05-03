const ORDER_STATUSES = Object.freeze({
  PENDING_PAYMENT: "pending_payment",
  CONFIRMED: "confirmed",
  IN_PREPARATION: "in_preparation",
  READY_FOR_PICKUP: "ready_for_pickup",
  OUT_FOR_DELIVERY: "out_for_delivery",
  FULFILLED: "fulfilled",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const FINAL_ORDER_STATUSES = Object.freeze([
  ORDER_STATUSES.PENDING_PAYMENT,
  ORDER_STATUSES.CONFIRMED,
  ORDER_STATUSES.IN_PREPARATION,
  ORDER_STATUSES.READY_FOR_PICKUP,
  ORDER_STATUSES.OUT_FOR_DELIVERY,
  ORDER_STATUSES.FULFILLED,
  ORDER_STATUSES.CANCELLED,
  ORDER_STATUSES.EXPIRED,
]);

const FINAL_ORDER_STATUS_SET = new Set(FINAL_ORDER_STATUSES);
const TERMINAL_ORDER_STATUS_SET = new Set([
  ORDER_STATUSES.FULFILLED,
  ORDER_STATUSES.CANCELLED,
  ORDER_STATUSES.EXPIRED,
]);

const ORDER_TRANSITIONS = Object.freeze({
  pending_payment: ["confirmed", "cancelled", "expired"],
  confirmed: ["in_preparation", "cancelled"],
  in_preparation: ["ready_for_pickup", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["fulfilled", "cancelled"],
  out_for_delivery: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
  expired: [],
});

function normalizeLegacyOrderStatus(status, context = {}) {
  const normalized = String(status || "").trim();
  if (!normalized) return normalized;

  if (normalized === "created") {
    return context && context.paymentStatus === "paid"
      ? ORDER_STATUSES.CONFIRMED
      : ORDER_STATUSES.PENDING_PAYMENT;
  }
  if (normalized === "preparing") return ORDER_STATUSES.IN_PREPARATION;
  if (normalized === "canceled" || normalized === "cancelled") return ORDER_STATUSES.CANCELLED;
  if (normalized === "delivered") return ORDER_STATUSES.FULFILLED;
  return normalized;
}

function isFinalOrderStatus(status) {
  return TERMINAL_ORDER_STATUS_SET.has(normalizeLegacyOrderStatus(status));
}

function canTransitionOrderStatus(from, to, context = {}) {
  const fromStatus = normalizeLegacyOrderStatus(from, context);
  const toStatus = normalizeLegacyOrderStatus(to, context);
  const allowed = ORDER_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

function canOrderTransition(from, to, context = {}) {
  return canTransitionOrderStatus(from, to, context);
}

module.exports = {
  ORDER_STATUSES,
  FINAL_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  normalizeLegacyOrderStatus,
  isFinalOrderStatus,
  canTransitionOrderStatus,
  canOrderTransition,
};
