"use strict";

const Payment = require("../../models/Payment");
const {
  transitionAllocation,
} = require("./subscriptionMealEntitlementService");

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

function paymentAllocationKeys(payment) {
  const metadata = getPaymentMetadata(payment);
  return Array.isArray(metadata.baseAllocationKeys)
    ? [...new Set(metadata.baseAllocationKeys.map((key) => String(key || "")).filter(Boolean))]
    : [];
}

async function savePaymentMetadata(payment, metadata, session = null) {
  payment.metadata = metadata;
  if (typeof payment.markModified === "function") payment.markModified("metadata");
  await payment.save(session ? { session } : undefined);
}

async function releaseSupersededPaymentAllocations({ payment, subscriptionId, session = null }) {
  const metadata = getPaymentMetadata(payment);
  if (metadata.entitlementAllocationsReleasedAt) {
    return { releasedCount: 0, alreadyReleased: true };
  }

  const allocationKeys = paymentAllocationKeys(payment);
  let releasedCount = 0;
  for (const allocationKey of allocationKeys) {
    const result = await transitionAllocation({
      subscriptionId,
      allocationKey,
      toState: "released",
      session,
    });
    if (result.changed) releasedCount += 1;
  }

  await savePaymentMetadata(payment, {
    ...getPaymentMetadata(payment),
    entitlementReleasePending: false,
    entitlementAllocationsReleasedAt: new Date(),
  }, session);

  return { releasedCount, alreadyReleased: false };
}

async function supersedeInitiatedDayPlanningPaymentsForRevisionChange({
  subscriptionId,
  dayId = null,
  date = "",
  nextRevisionHash = "",
  reason = "planner_revision_changed",
  session = null,
} = {}) {
  if (!subscriptionId || !nextRevisionHash) return { matchedCount: 0, supersededCount: 0, releasedAllocationCount: 0 };

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
  if (dayFilters.length === 0) return { matchedCount: 0, supersededCount: 0, releasedAllocationCount: 0 };

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
  let releasedAllocationCount = 0;
  for (const payment of payments) {
    const metadata = getPaymentMetadata(payment);
    const alreadySuperseded = isPaymentSuperseded(payment);
    const sameRevision = String(metadata.revisionHash || "") === revisionHash;

    if (!alreadySuperseded && sameRevision) continue;
    if (alreadySuperseded && metadata.entitlementAllocationsReleasedAt) continue;

    if (!alreadySuperseded) {
      await savePaymentMetadata(payment, {
        ...metadata,
        isSuperseded: true,
        supersededAt: now,
        supersededByRevisionHash: revisionHash,
        supersededPreviousRevisionHash: metadata.revisionHash || null,
        supersededReason: reason,
        entitlementReleasePending: true,
      }, session);
      supersededCount += 1;
    } else if (!metadata.entitlementReleasePending) {
      await savePaymentMetadata(payment, {
        ...metadata,
        entitlementReleasePending: true,
      }, session);
    }

    const releaseResult = await releaseSupersededPaymentAllocations({
      payment,
      subscriptionId,
      session,
    });
    releasedAllocationCount += releaseResult.releasedCount;
  }

  return { matchedCount: payments.length, supersededCount, releasedAllocationCount };
}

module.exports = {
  DAY_PLANNING_PAYMENT_TYPE,
  buildSupersededPaymentErrorDetails,
  isPaymentSuperseded,
  releaseSupersededPaymentAllocations,
  supersedeInitiatedDayPlanningPaymentsForRevisionChange,
};
