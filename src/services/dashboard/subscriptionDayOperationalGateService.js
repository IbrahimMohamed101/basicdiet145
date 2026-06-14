"use strict";

const opsActionPolicy = require("./opsActionPolicy");
const { buildPaymentValidityPayload } = require("./opsPayloadService");

function hasKitchenMeals(day = {}) {
  const mealSlots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
  if (mealSlots.some((slot) => slot && slot.status === "complete")) return true;
  if (Array.isArray(day.materializedMeals) && day.materializedMeals.length > 0) return true;
  if (Array.isArray(day.selections) && day.selections.length > 0) return true;
  if (Array.isArray(day.baseMealSlots) && day.baseMealSlots.length > 0) return true;
  return false;
}

function validateSubscriptionDayOperationalGate(day, actionId) {
  const normalizedAction = opsActionPolicy.normalizeActionId(actionId);
  if (["prepare", "start_preparation"].includes(normalizedAction) && !hasKitchenMeals(day)) {
    return {
      allowed: false,
      status: 422,
      code: "EMPTY_KITCHEN_MEALS",
      message: "Cannot prepare a subscription day without selected meals",
    };
  }

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

  return { allowed: true };
}

module.exports = {
  hasKitchenMeals,
  validateSubscriptionDayOperationalGate,
};
