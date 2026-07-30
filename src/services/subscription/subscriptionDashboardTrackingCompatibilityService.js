"use strict";

function normalizeTrackingSubscriptionCounters(subscription = {}) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    return subscription;
  }

  if (Number(subscription.entitlementVersion || 0) >= 2) {
    return subscription;
  }

  // Historical subscriptions can carry schema-default consumed/reserved values
  // even though their actual consumed count is derived from total - remaining.
  // Remove those non-authoritative defaults for the dashboard read model so it
  // falls back to the legacy calculation already produced by the timeline.
  return {
    ...subscription,
    consumedMeals: undefined,
    reservedMeals: 0,
  };
}

module.exports = {
  normalizeTrackingSubscriptionCounters,
};
