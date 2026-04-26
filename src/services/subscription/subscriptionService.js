// Import from extracted services
const {
  countAlreadySkippedDays,
  countCompensatedSkipDays,
  countFrozenDays,
  getCompensationSnapshot,
  syncSubscriptionValidity,
} = require("./subscriptionCompensationService");

const {
  applyOperationalSkipForDate,
  applySkipForDate,
} = require("./subscriptionSkipService");

const { buildSubscriptionTimeline } = require("./subscriptionTimelineService");

/**
 * @typedef {import("../types/subscriptionTimeline").TimelineDay} TimelineDay
 * @typedef {import("../types/subscriptionTimeline").SubscriptionTimeline} SubscriptionTimeline
 */

module.exports = {
  applyOperationalSkipForDate,
  applySkipForDate: applySkipForDate,
  countAlreadySkippedDays,
  countCompensatedSkipDays,
  countFrozenDays,
  getCompensationSnapshot,
  syncSubscriptionValidity,
  buildSubscriptionTimeline,
};
