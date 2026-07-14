"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const { logger } = require("../../utils/logger");

const ACTIVE_SUBSCRIPTION_SORT = Object.freeze({ createdAt: -1, _id: -1 });

function applySession(query, session) {
  return session ? query.session(session) : query;
}

function sanitizeSubscriptionIds(rows) {
  return (rows || []).map((row) => String(row && row._id || "")).filter(Boolean);
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
} = {}) {
  const rows = await findActiveSubscriptionsForUser(userId, {
    SubscriptionModel,
    session,
    lean,
    limit: 2,
  });

  if (rows.length > 1) {
    logger.warn("subscription integrity: multiple active subscriptions resolved deterministically", {
      context,
      userId: String(userId || ""),
      selectedSubscriptionId: String(rows[0]._id || ""),
      activeSubscriptionIds: sanitizeSubscriptionIds(rows),
    });
  }

  return rows[0] || null;
}

module.exports = {
  ACTIVE_SUBSCRIPTION_SORT,
  findActiveSubscriptionsForUser,
  findCurrentActiveSubscriptionForUser,
};
