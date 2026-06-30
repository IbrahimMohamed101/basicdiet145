"use strict";

// Canonical operational state policy. Legacy spellings are normalized only at
// the boundary; they never participate in transition decisions.
const STATUS_ALIASES = Object.freeze({
  created: "pending_payment",
  preparing: "in_preparation",
  canceled: "cancelled",
  delivered: "fulfilled",
});

const TRANSITIONS = Object.freeze({
  subscription: Object.freeze({
    open: ["locked", "in_preparation", "delivery_canceled", "canceled_at_branch"],
    locked: ["open", "in_preparation", "delivery_canceled", "canceled_at_branch"],
    in_preparation: ["ready_for_pickup", "ready_for_delivery", "out_for_delivery", "delivery_canceled", "canceled_at_branch"],
    ready_for_delivery: ["out_for_delivery", "fulfilled", "delivery_canceled"],
    out_for_delivery: ["fulfilled", "delivery_canceled"],
    ready_for_pickup: ["fulfilled", "canceled_at_branch", "no_show"],
    delivery_canceled: ["open"],
    canceled_at_branch: ["open"],
    no_show: ["open"],
    fulfilled: [],
    consumed_without_preparation: [],
    skipped: [],
    frozen: [],
  }),
  order: Object.freeze({
    pending_payment: ["confirmed", "cancelled", "expired"],
    confirmed: ["in_preparation", "cancelled"],
    in_preparation: ["ready_for_pickup", "out_for_delivery", "cancelled"],
    ready_for_pickup: ["fulfilled", "cancelled"],
    out_for_delivery: ["fulfilled", "cancelled"],
    fulfilled: [],
    cancelled: [],
    expired: [],
  }),
  subscription_pickup_request: Object.freeze({
    locked: ["in_preparation", "canceled"],
    in_preparation: ["ready_for_pickup", "canceled"],
    ready_for_pickup: ["fulfilled", "no_show"],
    fulfilled: [],
    no_show: [],
    canceled: [],
  }),
});

function normalizeOperationalStatus(entityType, status, context = {}) {
  const value = String(status || "").trim().toLowerCase();
  if (entityType !== "order") return value;
  if (value === "created") return context.paymentStatus === "paid" ? "confirmed" : "pending_payment";
  return STATUS_ALIASES[value] || value;
}

function canTransitionStatus(entityType, fromStatus, toStatus, context = {}) {
  const rules = TRANSITIONS[entityType] || {};
  const from = normalizeOperationalStatus(entityType, fromStatus, context);
  const to = normalizeOperationalStatus(entityType, toStatus, context);
  return Boolean(rules[from] && rules[from].includes(to));
}

module.exports = {
  TRANSITIONS,
  canTransitionStatus,
  normalizeOperationalStatus,
};
