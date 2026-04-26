"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const { writeAuditLog } = require("./subscriptionAuditLogService");

/**
 * Valid transitions for Delivery mode
 * Restricts locked -> fulfilled to prevent bypassing steps.
 * In_preparation does not transition to no_show in delivery.
 */
const DELIVERY_TRANSITIONS = {
  open: ["locked", "skipped", "frozen"],
  locked: ["in_preparation", "delivery_canceled", "canceled_at_branch"],
  in_preparation: ["out_for_delivery", "delivery_canceled", "canceled_at_branch"],
  ready_for_pickup: [], // N/A
  out_for_delivery: ["fulfilled", "no_show", "delivery_canceled"],
  skipped: ["open"],
  frozen: ["open"],
  fulfilled: [],
  consumed_without_preparation: [],
  no_show: [],
  delivery_canceled: [],
  canceled_at_branch: []
};

/**
 * Valid transitions for Pickup mode
 * Restricts in_preparation -> no_show because it should only happen after it's ready.
 */
const PICKUP_TRANSITIONS = {
  open: ["locked", "skipped", "frozen"],
  locked: ["in_preparation", "canceled_at_branch"],
  in_preparation: ["ready_for_pickup", "canceled_at_branch"],
  ready_for_pickup: ["fulfilled", "no_show", "canceled_at_branch"],
  out_for_delivery: [], // N/A
  skipped: ["open"],
  frozen: ["open"],
  fulfilled: [],
  consumed_without_preparation: [],
  no_show: [],
  canceled_at_branch: [],
  delivery_canceled: []
};

function resolveTransitionRules(deliveryMode) {
  if (deliveryMode === "pickup") {
    return PICKUP_TRANSITIONS;
  }
  return DELIVERY_TRANSITIONS;
}

/**
 * Checks if the transition is allowed based on the day's status and delivery mode.
 * @returns {Boolean} true if valid, false if invalid transition
 */
function assertCanTransitionDay(day, toStatus, deliveryMode = "delivery") {
  const currentStatus = day.status || "open";
  // A self-transition allows idempotency safely
  if (currentStatus === toStatus) return true;
  
  const rules = resolveTransitionRules(deliveryMode);
  const allowed = rules[currentStatus] || [];
  return allowed.includes(toStatus);
}

/**
 * Validates and applies a status transition to a day. Logs the transition automatically.
 */
async function transitionSubscriptionDay({
  day,
  toStatus,
  actorType = "system",
  actorId = null,
  note = "",
  meta = {},
  deliveryMode = "delivery",
  session = null,
}) {
  const fromStatus = day.status || "open";
  
  if (!assertCanTransitionDay(day, toStatus, deliveryMode)) {
    const err = new Error(`Invalid transition from ${fromStatus} to ${toStatus} for mode ${deliveryMode}`);
    err.code = "INVALID_TRANSITION";
    throw err;
  }

  // Idempotent return
  if (fromStatus === toStatus) {
    return day;
  }

  day.status = toStatus;
  
  if (session) {
    await day.save({ session });
  } else {
    await day.save();
  }

  await writeAuditLog({
    entityType: "subscription_day",
    entityId: day._id,
    action: "status_transition",
    fromStatus,
    toStatus,
    actorType,
    actorId,
    note,
    meta,
    session,
  });

  return day;
}

module.exports = {
  assertCanTransitionDay,
  transitionSubscriptionDay,
};
