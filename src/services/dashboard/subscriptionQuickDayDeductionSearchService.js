"use strict";

const Subscription = require("../../models/Subscription");
const User = require("../../models/User");

const ALLOWED_ROLES = new Set(["admin", "cashier", "restaurant"]);

class QuickDayDeductionSearchError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "QuickDayDeductionSearchError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function search({ q, role, limit = 10 } = {}) {
  if (!ALLOWED_ROLES.has(String(role || ""))) {
    throw new QuickDayDeductionSearchError("FORBIDDEN", "You are not allowed to search quick deductions", 403);
  }
  const query = String(q || "").trim();
  if (query.length < 2 || query.length > 80) {
    throw new QuickDayDeductionSearchError("INVALID_SEARCH", "Search must contain between 2 and 80 characters", 400);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const pattern = new RegExp(escapeRegExp(query), "i");
  const users = await User.find({
    role: "client",
    $or: [{ name: pattern }, { phone: pattern }],
  }).select("_id name phone").limit(safeLimit).lean();
  if (!users.length) return [];

  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const subscriptions = await Subscription.find({
    userId: { $in: users.map((user) => user._id) },
    status: "active",
    deliveryMode: "pickup",
  }).select("_id userId status deliveryMode remainingMeals selectedMealsPerDay createdAt")
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return subscriptions.map((subscription) => {
    const user = userMap.get(String(subscription.userId));
    return {
      id: String(subscription._id),
      status: subscription.status,
      fulfillmentMethod: subscription.deliveryMode,
      remainingMeals: Number(subscription.remainingMeals || 0),
      selectedMealsPerDay: Number(subscription.selectedMealsPerDay || 0),
      customer: {
        id: user ? String(user._id) : String(subscription.userId || ""),
        name: user && user.name ? user.name : "",
        phone: user && user.phone ? user.phone : "",
      },
    };
  });
}

module.exports = {
  QuickDayDeductionSearchError,
  escapeRegExp,
  search,
};
