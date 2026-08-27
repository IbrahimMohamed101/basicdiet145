"use strict";

const SUBSCRIPTION_PAYMENT_TYPES = new Set([
  "subscription_activation",
  "subscription_renewal",
]);

function isSubscriptionPaymentType(paymentOrType) {
  const type = typeof paymentOrType === "string"
    ? paymentOrType
    : paymentOrType && paymentOrType.type;
  return SUBSCRIPTION_PAYMENT_TYPES.has(String(type || ""));
}

function hasMinimumAppliedLink(payment) {
  if (!payment || payment.applied !== true || String(payment.status || "") !== "paid") {
    return false;
  }
  if (!isSubscriptionPaymentType(payment)) return true;
  return Boolean(payment.subscriptionId);
}

module.exports = {
  SUBSCRIPTION_PAYMENT_TYPES,
  hasMinimumAppliedLink,
  isSubscriptionPaymentType,
};
