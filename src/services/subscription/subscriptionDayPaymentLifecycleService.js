"use strict";

const Payment = require("../../models/Payment");

const DAY_PLANNING_PAYMENT_TYPE = "day_planning_payment";

function getPaymentMetadata(payment) {
  return payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};
}

function isPaymentSuperseded(payment) {
  const metadata = getPaymentMetadata(payment);
  return Boolean(metadata.isSuperseded || metadata.supersededAt);
}

function buildSupersededPaymentErrorDetails(payment) {
  const metadata = getPaymentMetadata(payment);
  return {
    paymentId: payment && payment._id ? String(payment._id) : null,
    supersededAt: metadata.supersededAt || null,
    supersededByRevisionHash: metadata.supersededByRevisionHash || null,
    supersededReason: metadata.supersededReason || null,
  };
}

async function supersedeInitiatedDayPlanningPaymentsForRevisionChange({
  subscriptionId,
  dayId = null,
  date = "",
  nextRevisionHash = "",
  reason = "planner_revision_changed",
  session = null,
} = {}) {
  if (!subscriptionId || !nextRevisionHash) return { matchedCount: 0, supersededCount: 0 };

  const revisionHash = String(nextRevisionHash);
  const now = new Date();
  const dayFilters = [];
  if (dayId) dayFilters.push({ "metadata.dayId": String(dayId) });
  if (date) {
    dayFilters.push({
      "metadata.subscriptionId": String(subscriptionId),
      "metadata.date": String(date),
    });
  }
  if (dayFilters.length === 0) return { matchedCount: 0, supersededCount: 0 };

  let query = Payment.find({
    subscriptionId,
    type: DAY_PLANNING_PAYMENT_TYPE,
    status: "initiated",
    applied: { $ne: true },
    $or: dayFilters,
  });
  if (session) query = query.session(session);
  const payments = await query;

  let supersededCount = 0;
  for (const payment of payments) {
    const metadata = getPaymentMetadata(payment);
    if (isPaymentSuperseded(payment)) continue;
    if (String(metadata.revisionHash || "") === revisionHash) continue;

    payment.metadata = {
      ...metadata,
      isSuperseded: true,
      supersededAt: now,
      supersededByRevisionHash: revisionHash,
      supersededPreviousRevisionHash: metadata.revisionHash || null,
      supersededReason: reason,
    };
    if (typeof payment.markModified === "function") payment.markModified("metadata");
    await payment.save(session ? { session } : undefined);
    supersededCount += 1;
  }

  return { matchedCount: payments.length, supersededCount };
}

module.exports = {
  DAY_PLANNING_PAYMENT_TYPE,
  buildSupersededPaymentErrorDetails,
  isPaymentSuperseded,
  supersedeInitiatedDayPlanningPaymentsForRevisionChange,
};
