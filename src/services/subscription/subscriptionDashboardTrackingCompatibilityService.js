"use strict";

function resolveStackingAggregate(subscription = {}) {
  const stacking =
    subscription
    && subscription.stacking
    && typeof subscription.stacking === "object"
    && !Array.isArray(subscription.stacking)
      ? subscription.stacking
      : null;

  if (
    !stacking
    || stacking.hasEntitlementBatches !== true
    || !stacking.aggregateBalance
    || typeof stacking.aggregateBalance !== "object"
    || Array.isArray(stacking.aggregateBalance)
  ) {
    return null;
  }

  const aggregate = stacking.aggregateBalance;
  const counters = [
    "totalMeals",
    "remainingMeals",
    "reservedMeals",
    "consumedMeals",
    "forfeitedMeals",
  ];

  if (!counters.every((key) => Number.isFinite(Number(aggregate[key])))) {
    return null;
  }

  return aggregate;
}

function normalizeTrackingSubscriptionCounters(subscription = {}) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    return subscription;
  }

  if (Number(subscription.entitlementVersion || 0) >= 2) {
    const aggregate = resolveStackingAggregate(subscription);

    if (aggregate) {
      return {
        ...subscription,
        totalMeals: Number(aggregate.totalMeals),
        remainingMeals: Number(aggregate.remainingMeals),
        reservedMeals: Number(aggregate.reservedMeals),
        consumedMeals: Number(aggregate.consumedMeals),
        forfeitedMeals: Number(aggregate.forfeitedMeals),
      };
    }

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
  resolveStackingAggregate,
};
