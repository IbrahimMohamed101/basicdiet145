"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

async function recoverPaidPremiumDayBeforePlannerWrite({ subscriptionId, date } = {}) {
  if (!subscriptionId || !date) return { recovered: false, reason: "missing_context" };
  let day = await SubscriptionDay.findOne({ subscriptionId, date });
  if (!day || !day.premiumExtraPayment || !day.premiumExtraPayment.paymentId) {
    return { recovered: false, reason: "no_linked_payment" };
  }
  if (clean(day.premiumExtraPayment.status) === "paid") {
    return { recovered: false, reason: "already_paid", day };
  }

  const payment = await Payment.findOne({
    _id: day.premiumExtraPayment.paymentId,
    subscriptionId,
    status: "paid",
  });
  if (!payment) return { recovered: false, reason: "linked_payment_not_paid" };

  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) return { recovered: false, reason: "subscription_not_found" };

  // Required lazily so startup composition can install the synchronization wrapper
  // before this recovery path captures and invokes the settlement function.
  const premiumPaymentService = require("./premiumExtraDayPaymentService");
  const settlement = await premiumPaymentService.settlePaidPremiumExtraDayPayment({
    subscription,
    day,
    payment,
    session: null,
  });
  if (!settlement || !settlement.applied) {
    return {
      recovered: false,
      reason: settlement && settlement.reason ? settlement.reason : "settlement_not_applied",
      settlement,
    };
  }

  await Payment.updateOne(
    { _id: payment._id, status: "paid" },
    {
      $set: {
        applied: true,
        metadata: {
          ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
          recoveredBeforePlannerWriteAt: new Date(),
          unappliedReason: null,
        },
      },
    }
  );
  day = await SubscriptionDay.findById(day._id);
  return {
    recovered: true,
    paymentId: clean(payment._id),
    day,
    settlement,
  };
}

function createPaidPremiumPlannerRecoveryWrapper(originalOperation) {
  if (typeof originalOperation !== "function") throw new TypeError("originalOperation is required");
  async function paidPremiumPlannerRecoveryOperation(args = {}) {
    if (args.subscriptionId && args.date && Array.isArray(args.mealSlots)) {
      await recoverPaidPremiumDayBeforePlannerWrite({
        subscriptionId: args.subscriptionId,
        date: args.date,
      });
    }
    return originalOperation(args);
  }
  Object.defineProperty(paidPremiumPlannerRecoveryOperation, "__recoversPaidPremiumBeforePlannerWrite", { value: true });
  Object.defineProperty(paidPremiumPlannerRecoveryOperation, "__preservesPaidPremiumState", { value: true });
  Object.defineProperty(paidPremiumPlannerRecoveryOperation, "__original", { value: originalOperation });
  return paidPremiumPlannerRecoveryOperation;
}

function createPaidPremiumBulkPlannerRecoveryWrapper(originalOperation) {
  if (typeof originalOperation !== "function") throw new TypeError("originalOperation is required");
  async function paidPremiumBulkPlannerRecoveryOperation(args = {}) {
    const requests = Array.isArray(args.requests) ? args.requests : [];
    if (args.subscriptionId && requests.length) {
      for (const request of requests) {
        if (!request || !request.date || !Array.isArray(request.mealSlots)) continue;
        await recoverPaidPremiumDayBeforePlannerWrite({
          subscriptionId: args.subscriptionId,
          date: request.date,
        });
      }
    }
    return originalOperation(args);
  }
  Object.defineProperty(paidPremiumBulkPlannerRecoveryOperation, "__recoversPaidPremiumBeforePlannerWrite", { value: true });
  Object.defineProperty(paidPremiumBulkPlannerRecoveryOperation, "__preservesPaidPremiumState", { value: true });
  Object.defineProperty(paidPremiumBulkPlannerRecoveryOperation, "__original", { value: originalOperation });
  return paidPremiumBulkPlannerRecoveryOperation;
}

module.exports = {
  createPaidPremiumBulkPlannerRecoveryWrapper,
  createPaidPremiumPlannerRecoveryWrapper,
  recoverPaidPremiumDayBeforePlannerWrite,
};
