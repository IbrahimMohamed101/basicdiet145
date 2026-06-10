"use strict";

const dateUtils = require("../../utils/date");
const {
  SUBSCRIPTION_NOT_ACTIVE,
  SUBSCRIPTION_DATE_OUT_OF_RANGE,
  SUBSCRIPTION_NOT_STARTED,
  SUBSCRIPTION_EXPIRED,
} = require("../../utils/subscriptionErrors");

/**
 * Centralized date range and subscription status validation helpers.
 * These functions consolidate scattered validation logic while preserving existing behavior.
 */

/**
 * Validates that a date string is a valid KSA date format.
 * @param {string} date - Date string in YYYY-MM-DD format
 * @throws {Error} If date is invalid
 */
function validateKSADateString(date) {
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
}

/**
 * Resolves subscription date range, handling both Date objects and strings.
 * @param {Object} subscription - Subscription document
 * @returns {Object} { startDate, endDate } as KSA date strings
 */
function resolveSubscriptionDateRange(subscription) {
  const startDate = subscription.startDate;
  const startDateStr = startDate instanceof Date || typeof startDate === "number"
    ? dateUtils.toKSADateString(startDate)
    : startDate;

  const endDate = subscription.validityEndDate || subscription.endDate;
  const endDateStr = endDate instanceof Date || typeof endDate === "number"
    ? dateUtils.toKSADateString(endDate)
    : endDate;

  return { startDate: startDateStr, endDate: endDateStr };
}

/**
 * Asserts that a date is within the subscription's valid range.
 * @param {Object} subscription - Subscription document
 * @param {string} date - Date string in YYYY-MM-DD format
 * @throws {Error} If date is outside subscription range
 */
function assertSubscriptionDateRange({ subscription, date }) {
  validateKSADateString(date);

  const { startDate, endDate } = resolveSubscriptionDateRange(subscription);

  if (startDate && dateUtils.isBeforeKSADate(date, startDate)) {
    const err = new Error("Date is before subscription start");
    err.code = SUBSCRIPTION_NOT_STARTED;
    err.status = 422;
    throw err;
  }

  if (endDate && dateUtils.isAfterKSADate(date, endDate)) {
    const err = new Error("Subscription expired for this date");
    err.code = SUBSCRIPTION_EXPIRED;
    err.status = 422;
    throw err;
  }
}

/**
 * Asserts that subscription is in active status.
 * @param {Object} subscription - Subscription document
 * @param {string} date - Optional date for additional validation
 * @throws {Error} If subscription is not active
 */
function assertSubscriptionActive(subscription, date = null) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = SUBSCRIPTION_NOT_ACTIVE;
    err.status = 422;
    throw err;
  }

  if (date) {
    assertSubscriptionDateRange({ subscription, date });
  }
}

/**
 * Asserts that subscription is owned by the specified user.
 * @param {Object} subscription - Subscription document
 * @param {string|ObjectId} userId - User ID to check against
 * @throws {Error} If subscription belongs to different user
 */
function assertSubscriptionOwnership({ subscription, userId }) {
  if (String(subscription.userId) !== String(userId)) {
    const err = new Error("Forbidden");
    err.code = "FORBIDDEN";
    err.status = 403;
    throw err;
  }
}

/**
 * Combined check for subscription active status and ownership.
 * @param {Object} subscription - Subscription document
 * @param {string|ObjectId} userId - User ID to check against
 * @param {string} date - Optional date for range validation
 * @throws {Error} If subscription is not active or not owned by user
 */
function assertSubscriptionActiveAndOwned({ subscription, userId, date = null }) {
  assertSubscriptionOwnership({ subscription, userId });
  assertSubscriptionActive(subscription, date);
}

/**
 * Determines if a date is the first day of a subscription.
 * Uses existing logic from subscriptionFulfillmentPolicyService.
 * @param {Object} subscription - Subscription document
 * @param {string} date - Date string in YYYY-MM-DD format
 * @returns {boolean} True if this is the first subscription day
 */
function isFirstSubscriptionDay({ subscription, date }) {
  validateKSADateString(date);
  const { startDate } = resolveSubscriptionDateRange(subscription);
  return startDate === date;
}

module.exports = {
  validateKSADateString,
  resolveSubscriptionDateRange,
  assertSubscriptionDateRange,
  assertSubscriptionActive,
  assertSubscriptionOwnership,
  assertSubscriptionActiveAndOwned,
  isFirstSubscriptionDay,
};
