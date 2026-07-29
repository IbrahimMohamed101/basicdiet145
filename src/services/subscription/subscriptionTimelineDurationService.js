"use strict";

const MAX_TIMELINE_EXTRA_DAYS = 365;

const LEGACY_CANONICAL_EXTRA_DAYS_BY_KEY = Object.freeze({
  subscription_7_days: 1,
  subscription_26_days: 4,
  subscription_30_days: 5,
});

function normalizeTimelineExtraDays(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_TIMELINE_EXTRA_DAYS) {
    return null;
  }
  return parsed;
}

function resolvePlanTimelineExtraDays(plan) {
  const explicit = normalizeTimelineExtraDays(plan && plan.timelineExtraDays);
  if (explicit !== null) return explicit;

  const key = String(plan && plan.key || "").trim();
  return LEGACY_CANONICAL_EXTRA_DAYS_BY_KEY[key] || 0;
}

function resolveSubscriptionTimelineExtraDays(subscription) {
  const explicit = normalizeTimelineExtraDays(subscription && subscription.timelineExtraDays);
  if (explicit !== null) return explicit;

  const snapshotPlan = subscription
    && subscription.contractSnapshot
    && subscription.contractSnapshot.plan;
  const snapshotValue = normalizeTimelineExtraDays(snapshotPlan && snapshotPlan.timelineExtraDays);
  return snapshotValue === null ? 0 : snapshotValue;
}

module.exports = {
  LEGACY_CANONICAL_EXTRA_DAYS_BY_KEY,
  MAX_TIMELINE_EXTRA_DAYS,
  normalizeTimelineExtraDays,
  resolvePlanTimelineExtraDays,
  resolveSubscriptionTimelineExtraDays,
};
