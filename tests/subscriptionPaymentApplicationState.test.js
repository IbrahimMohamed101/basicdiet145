"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  hasMinimumAppliedLink,
  isSubscriptionPaymentType,
} = require("../src/services/subscription/subscriptionPaymentApplicationStateService");

assert.strictEqual(isSubscriptionPaymentType("subscription_activation"), true);
assert.strictEqual(isSubscriptionPaymentType("subscription_renewal"), true);
assert.strictEqual(isSubscriptionPaymentType("one_time_order"), false);

assert.strictEqual(hasMinimumAppliedLink({
  type: "subscription_activation",
  status: "paid",
  applied: true,
  subscriptionId: null,
}), false);

assert.strictEqual(hasMinimumAppliedLink({
  type: "subscription_activation",
  status: "paid",
  applied: true,
  subscriptionId: "subscription-1",
}), true);

assert.strictEqual(hasMinimumAppliedLink({
  type: "one_time_order",
  status: "paid",
  applied: true,
}), true);

console.log("subscription payment application state tests passed");
