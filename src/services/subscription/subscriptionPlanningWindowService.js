"use strict";

const dateUtils = require("../../utils/date");

const PLANNING_WINDOW_REASONS = Object.freeze({
  DATE_IN_PAST: "DATE_IN_PAST",
  BEFORE_SUBSCRIPTION_START: "BEFORE_SUBSCRIPTION_START",
  AFTER_SUBSCRIPTION_VALIDITY: "AFTER_SUBSCRIPTION_VALIDITY",
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

  const planningWindowStart = maxDate(
    week.businessDate,
    normalizedStartDate || week.businessDate
  );
  const planningWindowEnd = minDate(
    week.menuWeekEnd,
    normalizedValidityEndDate || week.menuWeekEnd
  );
  const hasSelectableDates = planningWindowStart <= planningWindowEnd;

  return {
    ...week,
    subscriptionStartDate: normalizedStartDate,
    subscriptionValidityEndDate: normalizedValidityEndDate,
    planningWindowStart,
    planningWindowEnd,
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
    normalizedRequestedDate < window.menuWeekStart
    || normalizedRequestedDate > window.menuWeekEnd
    || !window.hasSelectableDates
  ) {
    reason = PLANNING_WINDOW_REASONS.OUTSIDE_CURRENT_MENU_WEEK;
  } else if (
    normalizedRequestedDate < window.planningWindowStart
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

module.exports = {
  INVALID_PLANNING_WINDOW_DATE_CODE,
  PLANNING_WINDOW_REASONS,
  evaluatePlanningDate,
  normalizeDateInput,
  resolveCurrentMenuWeek,
  resolveSubscriptionPlanningWindow,
};
