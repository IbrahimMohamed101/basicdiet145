"use strict";

const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const {
  loadSubscriptionSummaryCatalog,
  resolveAdminSubscriptionFiltersOrThrow,
  serializeSubscriptionAdminFromCatalog,
} = require("../subscription/subscriptionOperationsReadService");

const ALLOWED_FULFILLMENT_METHODS = new Set(["delivery", "pickup"]);

function createInvalidError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID";
  return error;
}

function normalizeFulfillmentMethodOrThrow(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "all") return null;
  if (!ALLOWED_FULFILLMENT_METHODS.has(normalized)) {
    throw createInvalidError(
      "fulfillmentMethod must be one of: delivery, pickup, all"
    );
  }
  return normalized;
}

function resolvePaginationOrThrow(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const parsedLimit =
    query.limit === undefined || query.limit === null || query.limit === ""
      ? 50
      : Number(query.limit);

  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    throw createInvalidError("limit must be a positive number");
  }
  if (parsedLimit > 200) {
    throw createInvalidError("limit cannot exceed 200");
  }

  return {
    page,
    limit: Math.min(Math.floor(parsedLimit), 200),
  };
}

async function listSubscriptionsByFulfillment(query = {}) {
  const filters = await resolveAdminSubscriptionFiltersOrThrow(query, {
    includeStatus: true,
  });
  const fulfillmentMethod = normalizeFulfillmentMethodOrThrow(
    query.fulfillmentMethod
  );
  const pagination = resolvePaginationOrThrow(query);
  const match = {
    ...filters.match,
    ...(fulfillmentMethod ? { deliveryMode: fulfillmentMethod } : {}),
  };
  const skip = (pagination.page - 1) * pagination.limit;

  const [subscriptions, total] = await Promise.all([
    Subscription.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    Subscription.countDocuments(match),
  ]);

  const userIds = Array.from(
    new Set(
      subscriptions
        .map((subscription) => String(subscription.userId || ""))
        .filter(Boolean)
    )
  );
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).lean()
    : [];
  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const lang = String(query.lang || "ar");
  const catalog = await loadSubscriptionSummaryCatalog(subscriptions, lang);

  return {
    filters: {
      ...filters,
      fulfillmentMethod,
    },
    pagination,
    total,
    data: subscriptions.map((subscription) =>
      serializeSubscriptionAdminFromCatalog(
        subscription,
        userMap.get(String(subscription.userId)) || null,
        catalog
      )
    ),
  };
}

module.exports = {
  listSubscriptionsByFulfillment,
  normalizeFulfillmentMethodOrThrow,
  resolvePaginationOrThrow,
};
