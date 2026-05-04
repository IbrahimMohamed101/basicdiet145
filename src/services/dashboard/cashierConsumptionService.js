"use strict";

/**
 * Cashier Consumption Service
 *
 * Provides the cashier-dashboard flow for manually recording meal consumption
 * for a customer identified by phone number.
 *
 * This is the ONLY authorised path for manual (non-fulfillment) meal deductions
 * under the new TOTAL_BALANCE_WITHIN_VALIDITY policy.
 */

const User = require("../../models/User");
const Subscription = require("../../models/Subscription");
const { consumeSubscriptionMealBalance } = require("../subscription/subscriptionDayConsumptionService");
const dateUtils = require("../../utils/date");

/**
 * Find a customer User document by phone number.
 * @param {string} phone
 * @returns {Promise<Document|null>}
 */
async function findCustomerByPhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  const normalized = String(phone).trim();
  return User.findOne({ phone: normalized, role: "client" }).lean();
}

/**
 * Get all active subscriptions for a user with key balance fields.
 * @param {string|ObjectId} userId
 * @returns {Promise<Array>}
 */
async function getActiveSubscriptionsForUser(userId) {
  const subscriptions = await Subscription.find({
    userId,
    status: "active",
  }).lean();
  return subscriptions;
}

/**
 * Serialize a subscription for the cashier customer-lookup response.
 */
function serializeSubscriptionForCashier(sub) {
  const remainingMeals = Number(sub.remainingMeals || 0);
  const totalMeals = Number(sub.totalMeals || 0);

  const validityStartDate = sub.startDate
    ? dateUtils.toKSADateString(sub.startDate)
    : null;
  const validityEndDate = (sub.validityEndDate || sub.endDate)
    ? dateUtils.toKSADateString(sub.validityEndDate || sub.endDate)
    : null;

  const today = dateUtils.getTodayKSADate();
  const canConsumeNow = sub.status === "active"
    && (!validityEndDate || today <= validityEndDate);

  return {
    id: String(sub._id),
    status: sub.status,
    remainingMeals,
    totalMeals,
    consumedMeals: Math.max(0, totalMeals - remainingMeals),
    validityStartDate,
    validityEndDate,
    dailyMealsDefault: Number(sub.selectedMealsPerDay || sub.mealsPerDay || 0),
    deliveryMode: sub.deliveryMode || "pickup",
    canConsumeNow,
    maxConsumableMealsNow: canConsumeNow ? remainingMeals : 0,
  };
}

/**
 * Look up a customer by phone number and return profile + active subscriptions.
 *
 * @param {string} phone
 * @returns {Promise<{ customer, activeSubscriptions }>}
 * @throws {{ code, status, message }}
 */
async function lookupCustomerByPhone(phone) {
  if (!phone) {
    const err = new Error("phone is required");
    err.code = "INVALID_REQUEST";
    err.status = 400;
    throw err;
  }

  const customer = await findCustomerByPhone(phone);
  if (!customer) {
    const err = new Error("Customer not found for this phone number");
    err.code = "CUSTOMER_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const subs = await getActiveSubscriptionsForUser(customer._id);

  return {
    customer: {
      id: String(customer._id),
      name: customer.name || null,
      phone: customer.phone,
    },
    activeSubscriptions: subs.map(serializeSubscriptionForCashier),
  };
}

/**
 * Validate and resolve the subscription to consume from.
 *
 * @param {{ phone, subscriptionId, mealCount, note, actor }}
 * @returns {Promise<{ customer, subscription, consumption }>}
 * @throws {{ code, status, message }}
 */
async function recordCashierConsumption({
  phone,
  subscriptionId = null,
  mealCount,
  note = null,
  actor = null,
}) {
  // 1. Validate mealCount early
  const count = Number(mealCount);
  if (!Number.isInteger(count) || count <= 0) {
    const err = new Error("mealCount must be a positive integer");
    err.code = "INVALID_MEAL_COUNT";
    err.status = 422;
    throw err;
  }

  // 2. Find customer by phone
  if (!phone) {
    const err = new Error("phone is required");
    err.code = "INVALID_REQUEST";
    err.status = 400;
    throw err;
  }
  const customer = await findCustomerByPhone(phone);
  if (!customer) {
    const err = new Error("Customer not found for this phone number");
    err.code = "CUSTOMER_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  // 3. Find active subscriptions
  const activeSubscriptions = await getActiveSubscriptionsForUser(customer._id);

  if (activeSubscriptions.length === 0) {
    const err = new Error("No active subscription found for this customer");
    err.code = "NO_ACTIVE_SUBSCRIPTION";
    err.status = 422;
    throw err;
  }

  // 4. Resolve target subscription
  let targetSub;
  if (subscriptionId) {
    targetSub = activeSubscriptions.find(
      (s) => String(s._id) === String(subscriptionId)
    );
    if (!targetSub) {
      const err = new Error("Specified subscription not found or not active for this customer");
      err.code = "SUBSCRIPTION_NOT_FOUND";
      err.status = 404;
      throw err;
    }
  } else if (activeSubscriptions.length === 1) {
    targetSub = activeSubscriptions[0];
  } else {
    const err = new Error("Multiple active subscriptions found. Please specify subscriptionId.");
    err.code = "SUBSCRIPTION_REQUIRED";
    err.status = 422;
    throw err;
  }

  // 5. Validate validity period
  const today = dateUtils.getTodayKSADate();
  const validityEndDate = targetSub.validityEndDate || targetSub.endDate;
  const validityEndDateStr = validityEndDate
    ? (typeof validityEndDate === "string" ? validityEndDate : dateUtils.toKSADateString(validityEndDate))
    : null;

  if (validityEndDateStr && today > validityEndDateStr) {
    const err = new Error("Subscription validity period has ended");
    err.code = "SUBSCRIPTION_EXPIRED";
    err.status = 422;
    throw err;
  }

  // 6. Execute deduction via the centralized function
  const result = await consumeSubscriptionMealBalance({
    subscriptionId: targetSub._id,
    subscription: targetSub,
    mealCount: count,
    source: "cashier_dashboard",
    actor,
    reason: "cashier_manual_consumption",
    note,
  });

  return {
    customer: {
      id: String(customer._id),
      name: customer.name || null,
      phone: customer.phone,
    },
    subscription: {
      id: String(targetSub._id),
      remainingMealsBefore: result.remainingMealsBefore,
      remainingMealsAfter: result.remainingMealsAfter,
      validityStartDate: targetSub.startDate
        ? dateUtils.toKSADateString(targetSub.startDate)
        : null,
      validityEndDate: validityEndDateStr,
      status: targetSub.status,
      deliveryMode: targetSub.deliveryMode || "pickup",
    },
    consumption: {
      mealCount: count,
      source: "cashier_dashboard",
      consumedAt: new Date().toISOString(),
      performedBy: actor && actor.actorId ? String(actor.actorId) : null,
      note: note || null,
    },
  };
}

module.exports = {
  lookupCustomerByPhone,
  recordCashierConsumption,
  serializeSubscriptionForCashier,
};
