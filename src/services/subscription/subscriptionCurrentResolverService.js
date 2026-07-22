"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const { logger } = require("../../utils/logger");
const { getTodayKSADate, toKSADateString } = require("../../utils/date");

const ACTIVE_SUBSCRIPTION_SORT = Object.freeze({ createdAt: -1, _id: -1 });

function applySession(query, session) {
  return session ? query.session(session) : query;
}

function sanitizeSubscriptionIds(rows) {
  return (rows || []).map((row) => String(row && row._id || "")).filter(Boolean);
}

function subscriptionDateWindow(subscription) {
  const startDate = subscription && subscription.startDate
    ? toKSADateString(subscription.startDate)
    : null;
  const endValue = subscription && (subscription.validityEndDate || subscription.endDate);
  const endDate = endValue ? toKSADateString(endValue) : null;
  return { startDate, endDate };
}

function isWithinSubscriptionDateWindow(subscription, businessDate = getTodayKSADate()) {
  const { startDate, endDate } = subscriptionDateWindow(subscription);
  return (!startDate || businessDate >= startDate)
    && (!endDate || businessDate <= endDate);
}

function explainSubscriptionCurrentState(subscription, businessDate = getTodayKSADate()) {
  const { startDate, endDate } = subscriptionDateWindow(subscription);
  if (!subscription || String(subscription.status || "") !== "active") {
    return { eligible: false, reason: "status_not_active", businessDate, startDate, endDate };
  }
  if (!startDate || !endDate) {
    return { eligible: false, reason: "date_window_missing", businessDate, startDate, endDate };
  }
  if (businessDate < startDate) {
    return { eligible: false, reason: "not_started", businessDate, startDate, endDate };
  }
  if (businessDate > endDate) {
    return { eligible: false, reason: "date_window_ended", businessDate, startDate, endDate };
  }
  return {
    eligible: true,
    reason: "active_in_current_date_window",
    businessDate,
    startDate,
    endDate,
  };
}

function selectCurrentSubscription(rows, {
  businessDate = getTodayKSADate(),
  includeUpcoming = false,
} = {}) {
  const evaluated = (Array.isArray(rows) ? rows : []).map((subscription) => ({
    subscription,
    evaluation: explainSubscriptionCurrentState(subscription, businessDate),
  }));
  const eligible = evaluated.filter((row) => row.evaluation.eligible);
  const upcoming = includeUpcoming
    ? evaluated.filter((row) => row.evaluation.reason === "not_started")
    : [];
  const selectedRow = eligible[0] || upcoming[0] || null;
  return {
    subscription: selectedRow ? selectedRow.subscription : null,
    reason: eligible.length
      ? "newest_active_in_current_date_window"
      : (upcoming.length ? "newest_active_upcoming_subscription" : "no_active_subscription_in_current_date_window"),
    businessDate,
    evaluated,
    eligible,
    upcoming,
  };
}

async function findActiveSubscriptionsForUser(userId, {
  SubscriptionModel = Subscription,
  session = null,
  excludeSubscriptionId = null,
  lean = false,
  limit = 0,
} = {}) {
  const query = {
    userId,
    status: "active",
  };
  if (excludeSubscriptionId && mongoose.Types.ObjectId.isValid(String(excludeSubscriptionId))) {
    query._id = { $ne: excludeSubscriptionId };
  }

  let dbQuery = SubscriptionModel.find(query).sort(ACTIVE_SUBSCRIPTION_SORT);
  if (limit > 0) dbQuery = dbQuery.limit(limit);
  if (lean) dbQuery = dbQuery.lean();
  return applySession(dbQuery, session);
}

async function findCurrentActiveSubscriptionForUser(userId, {
  SubscriptionModel = Subscription,
  session = null,
  lean = true,
  context = "current_subscription",
  businessDate = getTodayKSADate(),
  includeUpcoming = false,
} = {}) {
  const rows = await findActiveSubscriptionsForUser(userId, {
    SubscriptionModel,
    session,
    lean,
  });
  const resolution = selectCurrentSubscription(rows, { businessDate, includeUpcoming });
  const selected = resolution.subscription;

  if (resolution.eligible.length > 1) {
    logger.warn("subscription integrity: multiple active subscriptions resolved deterministically", {
      context,
      userId: String(userId || ""),
      selectedSubscriptionId: String(selected && selected._id || ""),
      activeSubscriptionIds: sanitizeSubscriptionIds(resolution.eligible.map((row) => row.subscription)),
      businessDate,
      reason: resolution.reason,
    });
  }

  logger.info("current subscription resolved", {
    context,
    userId: String(userId || ""),
    selectedSubscriptionId: selected ? String(selected._id || "") : null,
    reason: resolution.reason,
    businessDate,
    selectedDateWindow: selected ? subscriptionDateWindow(selected) : null,
    activeCandidateCount: rows.length,
    eligibleCandidateCount: resolution.eligible.length,
    upcomingCandidateCount: resolution.upcoming.length,
    rejectedCandidates: resolution.evaluated
      .filter((row) => !row.evaluation.eligible)
      .map((row) => ({
        subscriptionId: String(row.subscription && row.subscription._id || ""),
        reason: row.evaluation.reason,
        startDate: row.evaluation.startDate,
        endDate: row.evaluation.endDate,
      })),
  });

  return selected;
}

module.exports = {
  ACTIVE_SUBSCRIPTION_SORT,
  explainSubscriptionCurrentState,
  findActiveSubscriptionsForUser,
  findCurrentActiveSubscriptionForUser,
  isWithinSubscriptionDateWindow,
  selectCurrentSubscription,
  subscriptionDateWindow,
};
