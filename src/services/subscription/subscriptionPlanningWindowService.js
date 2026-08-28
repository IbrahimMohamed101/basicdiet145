"use strict";

const dateUtils = require("../../utils/date");

const SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_FLAG =
  "SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_ENABLED";
const PLANNING_WINDOW_MODE = "rolling_7_days";
const PLANNING_WINDOW_DAYS = 7;

const PLANNING_WINDOW_REASONS = Object.freeze({
  DATE_IN_PAST: "DATE_IN_PAST",
  BEFORE_SUBSCRIPTION_START: "BEFORE_SUBSCRIPTION_START",
  AFTER_SUBSCRIPTION_VALIDITY: "AFTER_SUBSCRIPTION_VALIDITY",
  // Kept as a compatibility error code for existing mobile clients. In v2 it
  // means the requested date is outside the active rolling planning horizon,
  // not literally outside the Saturday-Friday calendar week.
  OUTSIDE_CURRENT_MENU_WEEK: "OUTSIDE_CURRENT_MENU_WEEK",
});

const INVALID_PLANNING_WINDOW_DATE_CODE = "INVALID_PLANNING_WINDOW_DATE";

function serializeDateErrorValue(value) {
  if (!(value instanceof Date)) return value;
  return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
}

function buildDateError(fieldName, value) {
  const err = new Error(`${fieldName} must be a valid KSA date in YYYY-MM-DD format`);
  err.code = INVALID_PLANNING_WINDOW_DATE_CODE;
  err.status = 400;
  err.details = {
    field: fieldName,
    value: serializeDateErrorValue(value),
  };
  return err;
}

function normalizeDateInput(value, fieldName, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    throw buildDateError(fieldName, value);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw buildDateError(fieldName, value);
    }
    return dateUtils.toKSADateString(value);
  }

  const normalized = String(value).trim();
  if (!dateUtils.isValidKSADateString(normalized)) {
    throw buildDateError(fieldName, value);
  }
  return normalized;
}

function isWeeklyPlanningWindowEnabled(env = process.env) {
  const value = String(env[SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_FLAG] || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function minDate(...values) {
  return values.filter(Boolean).reduce((min, value) => (value < min ? value : min));
}

function maxDate(...values) {
  return values.filter(Boolean).reduce((max, value) => (value > max ? value : max));
}

function resolveCurrentMenuWeek({ businessDate }) {
  const normalizedBusinessDate = normalizeDateInput(businessDate, "businessDate");
  const utcDate = new Date(`${normalizedBusinessDate}T00:00:00.000Z`);
  const weekdayIndex = utcDate.getUTCDay();
  const daysSinceSaturday = (weekdayIndex + 1) % 7;
  const menuWeekStart = dateUtils.addDaysToKSADateString(
    normalizedBusinessDate,
    -daysSinceSaturday
  );
  const menuWeekEnd = dateUtils.addDaysToKSADateString(menuWeekStart, 6);

  return {
    businessDate: normalizedBusinessDate,
    menuWeekStart,
    menuWeekEnd,
  };
}

function resolveSubscriptionPlanningWindow({
  businessDate,
  subscriptionStartDate = null,
  subscriptionValidityEndDate = null,
} = {}) {
  const week = resolveCurrentMenuWeek({ businessDate });
  const normalizedStartDate = normalizeDateInput(
    subscriptionStartDate,
    "subscriptionStartDate",
    { required: false }
  );
  const normalizedValidityEndDate = normalizeDateInput(
    subscriptionValidityEndDate,
    "subscriptionValidityEndDate",
    { required: false }
  );

  // UX invariant: whenever a customer can plan, expose a continuous seven-day
  // horizon instead of shortening the experience as Friday approaches. For an
  // upcoming active subscription, the horizon begins at the subscription start
  // so the customer can prepare the first week before fulfillment starts.
  const planningWindowStart = maxDate(
    week.businessDate,
    normalizedStartDate || week.businessDate
  );
  const rollingWindowEnd = dateUtils.addDaysToKSADateString(
    planningWindowStart,
    PLANNING_WINDOW_DAYS - 1
  );
  const planningWindowEnd = minDate(
    rollingWindowEnd,
    normalizedValidityEndDate || rollingWindowEnd
  );
  const hasSelectableDates = planningWindowStart <= planningWindowEnd;

  return {
    ...week,
    mode: PLANNING_WINDOW_MODE,
    horizonDays: PLANNING_WINDOW_DAYS,
    subscriptionStartDate: normalizedStartDate,
    subscriptionValidityEndDate: normalizedValidityEndDate,
    planningWindowStart,
    planningWindowEnd,
    rollingWindowEnd,
    hasSelectableDates,
  };
}

function evaluatePlanningDate({
  requestedDate,
  businessDate,
  subscriptionStartDate = null,
  subscriptionValidityEndDate = null,
} = {}) {
  const normalizedRequestedDate = normalizeDateInput(requestedDate, "requestedDate");
  const window = resolveSubscriptionPlanningWindow({
    businessDate,
    subscriptionStartDate,
    subscriptionValidityEndDate,
  });

  let reason = null;
  if (normalizedRequestedDate < window.businessDate) {
    reason = PLANNING_WINDOW_REASONS.DATE_IN_PAST;
  } else if (
    window.subscriptionStartDate
    && normalizedRequestedDate < window.subscriptionStartDate
  ) {
    reason = PLANNING_WINDOW_REASONS.BEFORE_SUBSCRIPTION_START;
  } else if (
    window.subscriptionValidityEndDate
    && normalizedRequestedDate > window.subscriptionValidityEndDate
  ) {
    reason = PLANNING_WINDOW_REASONS.AFTER_SUBSCRIPTION_VALIDITY;
  } else if (
    !window.hasSelectableDates
    || normalizedRequestedDate < window.planningWindowStart
    || normalizedRequestedDate > window.planningWindowEnd
  ) {
    reason = PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK;
  }

  return {
    allowed: reason === null,
    requestedDate: normalizedRequestedDate,
    reason,
    ...window,
  };
}

function resolveSubscriptionPlanningBounds(subscription = {}) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    return {
      subscriptionStartDate: null,
      subscriptionValidityEndDate: null,
    };
  }

  return {
    subscriptionStartDate: subscription.startDate || null,
    subscriptionValidityEndDate:
      subscription.validityEndDate || subscription.endDate || null,
  };
}

function evaluateSubscriptionPlanningDate({
  subscription,
  requestedDate,
  businessDate,
} = {}) {
  const bounds = resolveSubscriptionPlanningBounds(subscription);
  return evaluatePlanningDate({
    requestedDate,
    businessDate,
    ...bounds,
  });
}

module.exports = {
  INVALID_PLANNING_WINDOW_DATE_CODE,
  PLANNING_WINDOW_DAYS,
  PLANNING_WINDOW_MODE,
  PLANNING_WINDOW_REASONS,
  SUBSCRIPTION_WEEKLY_PLANNING_WINDOW_FLAG,
  evaluatePlanningDate,
  evaluateSubscriptionPlanningDate,
  isWeeklyPlanningWindowEnabled,
  normalizeDateInput,
  resolveCurrentMenuWeek,
  resolveSubscriptionPlanningBounds,
  resolveSubscriptionPlanningWindow,
};
