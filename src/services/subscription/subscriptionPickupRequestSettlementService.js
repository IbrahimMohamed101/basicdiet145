"use strict";

const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const {
  settlePickupRequestAsUncollected,
} = require("./subscriptionPickupCycleAuthorityService");

const OPEN_PICKUP_REQUEST_STATUSES = Object.freeze([
  "locked",
  "in_preparation",
  "ready_for_pickup",
]);

function normalizeDateString(date) {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function buildSettlementResult(date) {
  return {
    date,
    matchedCount: 0,
    settledCount: 0,
    skippedCount: 0,
    errors: [],
  };
}

async function settlePickupRequest({ pickupRequestId, now, actor, reason, session }) {
  const query = SubscriptionPickupRequest.findOne({
    _id: pickupRequestId,
    status: { $in: OPEN_PICKUP_REQUEST_STATUSES },
  });
  if (session) query.session(session);
  const current = await query.lean();
  if (!current) {
    return { settled: false, skipped: true };
  }

  // No-show is an uncollected operation: return the reservation first, then
  // finalize the request projection. The authority uses deterministic
  // allocation transitions, so a crash or retry cannot refund twice.
  const settlement = await settlePickupRequestAsUncollected({
    requestId: current._id,
    userId: actor,
    reason,
    now,
    session,
  });
  return {
    settled: true,
    skipped: false,
    pickupRequest: settlement.pickupRequest,
  };
}

async function settleOnePickupRequest(options) {
  if (options.session) return settlePickupRequest(options);
  const session = await startSafeSession();
  try {
    let output;
    await session.withTransaction(async () => {
      output = await settlePickupRequest({ ...options, session });
    });
    return output;
  } finally {
    session.endSession();
  }
}

async function settleOpenSubscriptionPickupRequestsForDate({
  date,
  session = null,
  now = new Date(),
  actor = "system",
  reason = "PICKUP_REQUEST_AUTO_NO_SHOW",
} = {}) {
  const dateStr = normalizeDateString(date);
  const result = buildSettlementResult(dateStr);
  if (!dateStr) {
    result.errors.push({ code: "INVALID_DATE", message: "date must be YYYY-MM-DD" });
    return result;
  }

  const query = {
    date: dateStr,
    status: { $in: OPEN_PICKUP_REQUEST_STATUSES },
  };
  const requestIds = await SubscriptionPickupRequest.find(query)
    .select("_id")
    .sort({ createdAt: 1 })
    .lean()
    .session(session);

  result.matchedCount = requestIds.length;

  for (const row of requestIds) {
    try {
      const settlement = await settleOnePickupRequest({
        pickupRequestId: row._id,
        now,
        actor,
        reason,
        session,
      });
      if (settlement.settled) {
        result.settledCount += 1;
      } else {
        result.skippedCount += 1;
      }
    } catch (err) {
      result.errors.push({
        requestId: String(row._id),
        code: err.code || "SETTLEMENT_FAILED",
        message: err.message || "Pickup request settlement failed",
      });
    }
  }

  return result;
}

module.exports = {
  OPEN_PICKUP_REQUEST_STATUSES,
  settleOpenSubscriptionPickupRequestsForDate,
};
