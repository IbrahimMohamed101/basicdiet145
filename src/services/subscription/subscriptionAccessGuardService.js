"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const {
  assertSubscriptionActiveAndOwned,
  assertSubscriptionDateRange,
} = require("./subscriptionDateRangeHelperService");
const { FORBIDDEN, NOT_FOUND, SUBSCRIPTION_NOT_ACTIVE, SUBSCRIPTION_DATE_OUT_OF_RANGE } = require("../../utils/subscriptionErrors");

/**
 * Centralized subscription access guard for client-facing operations.
 * This consolidates ownership, status, and date range checks while preserving existing behavior.
 */

/**
 * Asserts client access to a subscription.
 * Validates subscription exists, is owned by user, is active, and date is within range.
 * @param {Object} params - { subscriptionId, userId, date, session }
 * @returns {Promise<Object>} The subscription document
 * @throws {Error} If access is denied
 */
async function assertClientSubscriptionAccess({ subscriptionId, userId, date = null, session = null }) {
  const subscription = await Subscription.findById(subscriptionId).session(session || null);
  if (!subscription) {
    const err = new Error("Subscription not found");
    err.code = NOT_FOUND;
    err.status = 404;
    throw err;
  }

  assertSubscriptionActiveAndOwned({ subscription, userId, date });

  return subscription;
}

/**
 * Asserts client access to a subscription day.
 * Validates subscription access, day exists, belongs to subscription, and is modifiable.
 * @param {Object} params - { subscriptionId, dayId, date, userId, session }
 * @returns {Promise<Object>} { subscription, day }
 * @throws {Error} If access is denied or day is not modifiable
 */
async function assertClientDayAccess({ subscriptionId, dayId = null, date, userId, session = null }) {
  const subscription = await assertClientSubscriptionAccess({ subscriptionId, userId, date, session });

  let day;
  if (dayId) {
    day = await SubscriptionDay.findById(dayId).session(session || null);
  } else if (date) {
    day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session || null);
  }

  if (!day) {
    const err = new Error("Day not found");
    err.code = NOT_FOUND;
    err.status = 404;
    throw err;
  }

  if (String(day.subscriptionId) !== String(subscription._id)) {
    const err = new Error("Day does not belong to subscription");
    err.code = FORBIDDEN;
    err.status = 403;
    throw err;
  }

  return { subscription, day };
}

/**
 * Asserts admin access to a subscription.
 * Validates subscription exists and caller has admin role.
 * @param {Object} params - { subscriptionId, role, session }
 * @returns {Promise<Object>} The subscription document
 * @throws {Error} If access is denied
 */
async function assertAdminSubscriptionAccess({ subscriptionId, role, session = null }) {
  if (!["admin", "superadmin"].includes(String(role || ""))) {
    const err = new Error("Dashboard admin permission is required");
    err.code = FORBIDDEN;
    err.status = 403;
    throw err;
  }

  const subscription = await Subscription.findById(subscriptionId).session(session || null);
  if (!subscription) {
    const err = new Error("Subscription not found");
    err.code = NOT_FOUND;
    err.status = 404;
    throw err;
  }

  return subscription;
}

module.exports = {
  assertClientSubscriptionAccess,
  assertClientDayAccess,
  assertAdminSubscriptionAccess,
};
