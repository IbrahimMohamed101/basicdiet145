"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");
const {
  repairDuplicateBaseMealAllocations,
} = require("./subscriptionDuplicateMealAllocationRepairService");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

async function repairSafeDuplicateDayReservations({ subscriptionId, day } = {}) {
  if (!subscriptionId || !day || !day._id) {
    return { applied: false, reason: "missing_context" };
  }
  const dryRun = await repairDuplicateBaseMealAllocations({
    subscriptionId,
    dayId: day._id,
    date: day.date,
    apply: false,
  });
  const plan = dryRun && dryRun.plan ? dryRun.plan : null;
  if (!plan || Number(plan.duplicateReservationCount || 0) <= 0) {
    return { applied: false, reason: "no_duplicates", plan };
  }
  return repairDuplicateBaseMealAllocations({
    subscriptionId,
    dayId: day._id,
    date: day.date,
    apply: true,
    expected: {
      totalMeals: plan.before.totalMeals,
      remainingMeals: plan.before.remainingMeals,
      reservedMeals: plan.before.reservedMeals,
      duplicateReservationCount: plan.duplicateReservationCount,
    },
  });
}

async function recoverPaidPremiumDayBeforePlannerWrite({ subscriptionId, date } = {}) {
  if (!subscriptionId || !date) return { recovered: false, reason: "missing_context" };
  let day = await SubscriptionDay.findOne({ subscriptionId, date });
  if (!day) return { recovered: false, reason: "day_not_found" };

  // Historical revision-dependent allocation keys may have reserved the same
  // day slot twice. The repair service only writes when every duplicate is still
  // Reserved and its guarded before/after counters match exactly.
  const duplicateRepair = await repairSafeDuplicateDayReservations({
    subscriptionId,
    day,
  });

  if (!day.premiumExtraPayment || !day.premiumExtraPayment.paymentId) {
    return {
      recovered: Boolean(duplicateRepair && duplicateRepair.applied),
      reason: duplicateRepair && duplicateRepair.applied ? "duplicate_reservations_repaired" : "no_linked_payment",
      duplicateRepair,
    };
  }
  if (clean(day.premiumExtraPayment.status) === "paid") {
    return {
      recovered: Boolean(duplicateRepair && duplicateRepair.applied),
      reason: duplicateRepair && duplicateRepair.applied ? "duplicate_reservations_repaired" : "already_paid",
      day,
      duplicateRepair,
    };
  }

  const payment = await Payment.findOne({
    _id: day.premiumExtraPayment.paymentId,
    subscriptionId,
    status: "paid",
  });
  if (!payment) {
    return {
      recovered: Boolean(duplicateRepair && duplicateRepair.applied),
      reason: duplicateRepair && duplicateRepair.applied ? "duplicate_reservations_repaired" : "linked_payment_not_paid",
      duplicateRepair,
    };
  }

  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) return { recovered: false, reason: "subscription_not_found", duplicateRepair };

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
      recovered: Boolean(duplicateRepair && duplicateRepair.applied),
      reason: settlement && settlement.reason ? settlement.reason : "settlement_not_applied",
      settlement,
      duplicateRepair,
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
    duplicateRepair,
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
  repairSafeDuplicateDayReservations,
};
