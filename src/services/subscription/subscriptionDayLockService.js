"use strict";

const { SUBSCRIPTION_DAY_LOCKED } = require("../../utils/subscriptionErrors");

/**
 * Centralized day lock determination for subscription operations.
 * This consolidates day status lock logic while preserving existing behavior.
 *
 * Key rules:
 * - Pending unpaid payment does NOT lock the day
 * - Superseded payment does NOT lock the day
 * - Delivered/fulfilled/explicitly locked day rejects client planner edits
 */

/**
 * Determines if a day is modifiable by a client.
 * @param {Object} params - { day, subscription, date }
 * @returns {boolean} True if day is modifiable, false otherwise
 */
function isDayModifiableByClient({ day, subscription, date }) {
  if (!day) return false;

  const normalizedStatus = typeof day.status === "string" && day.status.trim() ? day.status : "open";

  // Terminal statuses that lock the day
  const lockedStatuses = [
    "locked",
    "in_preparation",
    "out_for_delivery",
    "ready_for_pickup",
    "fulfilled",
    "consumed_without_preparation",
    "delivery_canceled",
    "canceled_at_branch",
    "no_show",
  ];

  if (lockedStatuses.includes(normalizedStatus)) {
    return false;
  }

  // Confirmed planner state locks the day (unless it's a payment-related operation)
  const normalizedPlannerState = typeof day.plannerState === "string" && day.plannerState.trim() ? day.plannerState : "draft";
  if (normalizedPlannerState === "confirmed") {
    // Confirmed days are locked for planner edits
    // However, pending payment does NOT lock the day for planner edits
    // This is handled by the payment service, not here
    return false;
  }

  // Explicit lock flag
  if (day.autoLocked === true) {
    return false;
  }

  // Frozen status locks the day
  if (normalizedStatus === "frozen") {
    return false;
  }

  // Skipped days are locked
  if (normalizedStatus === "skipped") {
    return false;
  }

  // Open days with draft planner state are modifiable
  return true;
}

/**
 * Asserts that a day is modifiable by a client.
 * @param {Object} params - { day, subscription, date }
 * @throws {Error} If day is not modifiable
 */
function assertDayModifiableByClient({ day, subscription, date }) {
  if (!isDayModifiableByClient({ day, subscription, date })) {
    const err = new Error("Day is locked");
    err.code = SUBSCRIPTION_DAY_LOCKED;
    err.status = 409;
    throw err;
  }
}

/**
 * Determines if a day has a pending or unpaid payment that should NOT lock planner edits.
 * This is used to ensure that pending payment scenarios allow planner modifications.
 * @param {Object} day - SubscriptionDay document
 * @returns {boolean} True if day has pending/unpaid payment
 */
function hasPendingOrUnpaidPayment(day) {
  if (!day) return false;

  // Check premium extra payment status
  if (day.premiumExtraPayment) {
    const status = day.premiumExtraPayment.status || "none";
    if (status === "pending" || status === "failed" || status === "revision_mismatch") {
      return true;
    }
  }

  // Check addon selections with pending payment source
  if (Array.isArray(day.addonSelections)) {
    const hasPendingAddon = day.addonSelections.some(
      (addon) => addon.source === "pending_payment"
    );
    if (hasPendingAddon) return true;
  }

  // Check premium upgrade selections with pending payment source
  if (Array.isArray(day.premiumUpgradeSelections)) {
    const hasPendingPremium = day.premiumUpgradeSelections.some(
      (upgrade) => upgrade.premiumSource === "pending_payment"
    );
    if (hasPendingPremium) return true;
  }

  return false;
}

/**
 * Determines if a day has a superseded payment that should NOT lock planner edits.
 * @param {Object} day - SubscriptionDay document
 * @returns {boolean} True if day has superseded payment
 */
function hasSupersededPayment(day) {
  if (!day) return false;

  // Check premium extra payment for revision mismatch
  if (day.premiumExtraPayment) {
    const status = day.premiumExtraPayment.status || "none";
    if (status === "revision_mismatch") {
      return true;
    }
  }

  return false;
}

module.exports = {
  isDayModifiableByClient,
  assertDayModifiableByClient,
  hasPendingOrUnpaidPayment,
  hasSupersededPayment,
};
