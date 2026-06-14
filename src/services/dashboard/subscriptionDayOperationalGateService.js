"use strict";

const opsActionPolicy = require("./opsActionPolicy");
const { buildPaymentValidityPayload } = require("./opsPayloadService");
const {
  hasExplicitKitchenMeals,
  isValidHomeDeliveryChefChoiceDay,
} = require("./homeDeliveryChefChoiceService");

function hasKitchenMeals(day = {}) {
  return hasExplicitKitchenMeals(day);
}

function validateSubscriptionDayOperationalGate(day, actionId, { subscription = {} } = {}) {
  const normalizedAction = opsActionPolicy.normalizeActionId(actionId);
  if (!["prepare", "start_preparation", "fulfill"].includes(normalizedAction)) {
    return { allowed: true };
  }

  const payment = buildPaymentValidityPayload(day);
  if (payment.pendingUnpaid || payment.revisionMismatch || payment.superseded) {
    return {
      allowed: false,
      status: 409,
      code: payment.reason || "PAYMENT_REQUIRED",
      message: "Payment must be settled before operational fulfillment",
    };
  }

  if (["prepare", "start_preparation"].includes(normalizedAction)
    && !hasKitchenMeals(day)
    && !isValidHomeDeliveryChefChoiceDay(day, subscription)) {
    return {
      allowed: false,
      status: 422,
      code: "EMPTY_KITCHEN_MEALS",
      message: "Cannot prepare a subscription day without selected meals",
    };
  }

  return { allowed: true };
}

module.exports = {
  hasKitchenMeals,
  validateSubscriptionDayOperationalGate,
};
