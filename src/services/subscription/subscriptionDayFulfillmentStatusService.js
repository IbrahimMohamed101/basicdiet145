"use strict";

/**
 * Lightweight fulfillment status service — Phase 5 (Status-based tracking, no WebSockets).
 *
 * Returns a compact payload for mobile to poll every N seconds.
 * Works for both pickup and delivery subscriptions.
 * Reuses buildFulfillmentReadFields to guarantee consistency with the timeline.
 */

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const {
  buildFulfillmentReadFields,
  getPickupLocationsSetting,
} = require("./subscriptionFulfillmentSummaryService");
const {
  buildSubscriptionDayFulfillmentState,
} = require("./subscriptionDayFulfillmentStateService");
const { resolveReadLabel } = require("../../utils/subscription/subscriptionLocalizationCommon");

/**
 * Statuses where no further updates will happen — mobile should stop polling.
 */
const TERMINAL_STATUSES = new Set([
  "fulfilled",
  "delivery_canceled",
  "no_show",
  "consumed_without_preparation",
  "skipped",
  "frozen",
  "canceled_at_branch",
]);

/**
 * Determine the recommended polling interval in seconds based on current status.
 * Returns lower intervals for "active" states so mobile reflects changes quickly.
 */
function resolvePollingIntervalSeconds(status, deliveryMode) {
  if (TERMINAL_STATUSES.has(status)) return null; // terminal — stop polling
  if (status === "in_preparation") return 30;
  if (status === "out_for_delivery") return 30;
  if (status === "ready_for_pickup") return 30;
  if (status === "locked") return 60;
  return 60; // open / other non-terminal
}

/**
 * Build the fulfillment status payload for a given subscription and day.
 *
 * @param {object} options
 * @param {string} options.subscriptionId
 * @param {string} options.date
 * @param {string} options.userId
 * @param {string} options.lang
 * @param {Function} options.ensureActiveFn
 * @returns {Promise<{ok: boolean, status?: number, code?: string, message?: string, data?: object}>}
 */
async function getDayFulfillmentStatusForClient({
  subscriptionId,
  date,
  userId,
  lang = "ar",
  ensureActiveFn,
}) {
  // 1. Load subscription and verify ownership
  const sub = await Subscription.findById(subscriptionId).lean();
  if (!sub) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  }
  if (String(sub.userId) !== String(userId)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };
  }

  // 2. Ensure active (soft check — still return status for non-active to show terminal state)
  const activeCheck = ensureActiveFn ? ensureActiveFn(sub) : null;
  if (activeCheck && !activeCheck.ok) {
    return { ok: false, status: 400, code: activeCheck.code, message: activeCheck.message };
  }

  // 3. Load the subscription day
  const day = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  if (!day) {
    return { ok: false, status: 404, code: "DAY_NOT_FOUND", message: "Day not found" };
  }

  // 4. Derive fulfillment state flags (planningReady, fulfillmentReady, etc.)
  const fulfillmentState = buildSubscriptionDayFulfillmentState({ subscription: sub, day });

  // 5. Load pickup locations (only needed for pickup mode, but cheap)
  const pickupLocations = sub.deliveryMode === "pickup"
    ? await getPickupLocationsSetting()
    : [];

  // 6. Build the rich fulfillment copy using existing service
  const readFields = buildFulfillmentReadFields({
    subscription: sub,
    day,
    pickupLocations,
    lang,
    fulfillmentState,
    statusLabel: resolveReadLabel("dayStatuses", day.status, lang) || "",
  });

  const status = String(day.status || "open");
  const deliveryMode = readFields.deliveryMode;
  const isTerminal = TERMINAL_STATUSES.has(status);
  const pollingIntervalSeconds = resolvePollingIntervalSeconds(status, deliveryMode);

  // 7. Compose response
  const data = {
    subscriptionId,
    date,
    deliveryMode,
    status,
    statusLabel: readFields.fulfillmentSummary?.statusLabel || "",
    message: readFields.fulfillmentSummary?.message || "",
    nextAction: readFields.fulfillmentSummary?.nextAction || "",
    isTerminal,
    pollingIntervalSeconds,
    lastUpdatedAt: day.updatedAt ? new Date(day.updatedAt).toISOString() : null,

    // Fulfillment summary details
    fulfillmentSummary: readFields.fulfillmentSummary || null,
    deliveryAddress: readFields.deliveryAddress || null,
    deliveryWindow: readFields.deliveryWindow || null,
    deliverySlot: readFields.deliverySlot || null,
    pickupLocation: readFields.pickupLocation || null,

    // Pickup-specific fields (null for delivery)
    pickupCode: deliveryMode === "pickup" && status === "ready_for_pickup"
      ? (day.pickupCode || null)
      : null,
    pickupCodeIssuedAt: deliveryMode === "pickup" && day.pickupCodeIssuedAt
      ? new Date(day.pickupCodeIssuedAt).toISOString()
      : null,

    // State flags
    planningReady: Boolean(fulfillmentState.planningReady),
    fulfillmentReady: Boolean(fulfillmentState.fulfillmentReady),
    isFulfillable: Boolean(fulfillmentState.isFulfillable),
    canBePrepared: Boolean(fulfillmentState.canBePrepared),
  };

  return { ok: true, status: 200, data };
}

module.exports = {
  getDayFulfillmentStatusForClient,
  TERMINAL_STATUSES,
};
