"use strict";

const dateUtils = require("../../utils/date");

function createFulfillmentPolicyError(code, message, status = 422, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details && typeof details === "object") err.details = details;
  return err;
}

function toSubscriptionDateString(value) {
  if (!value) return "";
  if (value instanceof Date || typeof value === "number") return dateUtils.toKSADateString(value);
  return String(value || "").trim();
}

function resolveSubscriptionDateRange(subscription = {}) {
  const startDate = toSubscriptionDateString(subscription.startDate);
  const endDate = toSubscriptionDateString(subscription.validityEndDate || subscription.endDate);
  return { startDate, endDate };
}

function assertDateInsideSubscriptionRange({ subscription, date } = {}) {
  const normalizedDate = String(date || "").trim();
  if (!dateUtils.isValidKSADateString(normalizedDate)) {
    throw createFulfillmentPolicyError("INVALID_DATE", "Invalid date format", 400);
  }

  const { startDate, endDate } = resolveSubscriptionDateRange(subscription);
  if (startDate && dateUtils.isBeforeKSADate(normalizedDate, startDate)) {
    throw createFulfillmentPolicyError("SUBSCRIPTION_DATE_OUT_OF_RANGE", "Date is before subscription start date", 422, {
      date: normalizedDate,
      startDate,
      endDate: endDate || null,
    });
  }
  if (endDate && dateUtils.isAfterKSADate(normalizedDate, endDate)) {
    throw createFulfillmentPolicyError("SUBSCRIPTION_DATE_OUT_OF_RANGE", "Date is outside subscription validity", 422, {
      date: normalizedDate,
      startDate: startDate || null,
      endDate,
    });
  }

  return { date: normalizedDate, startDate: startDate || null, endDate: endDate || null };
}

function isFirstSubscriptionDay({ subscription, date } = {}) {
  const normalizedDate = String(date || "").trim();
  const { startDate } = resolveSubscriptionDateRange(subscription);
  return Boolean(startDate && normalizedDate === startDate);
}

function buildFulfillmentPolicy({ subscription, date } = {}) {
  const normalizedMode = String(subscription && subscription.deliveryMode || "").trim() === "pickup"
    ? "pickup"
    : "delivery";
  const isFirstDay = isFirstSubscriptionDay({ subscription, date });
  const allowedMethods = normalizedMode === "pickup"
    ? ["pickup"]
    : (isFirstDay ? ["delivery", "pickup"] : ["delivery"]);

  return {
    subscriptionMode: normalizedMode,
    date: String(date || "").trim(),
    isPickupSubscription: normalizedMode === "pickup",
    isDeliverySubscription: normalizedMode === "delivery",
    isFirstSubscriptionDay: isFirstDay,
    allowedMethods,
    branchPickupAllowed: allowedMethods.includes("pickup"),
    homeDeliveryAllowed: allowedMethods.includes("delivery"),
    dailyMealLimitEnforced: false,
  };
}

function assertFulfillmentMethodAllowed({ subscription, date, requestedMethod } = {}) {
  const method = String(requestedMethod || "").trim();
  const range = assertDateInsideSubscriptionRange({ subscription, date });
  const policy = buildFulfillmentPolicy({ subscription, date: range.date });
  if (!["delivery", "pickup"].includes(method)) {
    throw createFulfillmentPolicyError("INVALID_FULFILLMENT_METHOD", "Fulfillment method must be delivery or pickup", 400);
  }
  if (!policy.allowedMethods.includes(method)) {
    throw createFulfillmentPolicyError("FULFILLMENT_METHOD_NOT_ALLOWED", "Fulfillment method is not allowed for this subscription date", 422, {
      requestedMethod: method,
      allowedMethods: policy.allowedMethods,
      date: range.date,
      startDate: range.startDate,
      subscriptionMode: policy.subscriptionMode,
    });
  }
  return { ...policy, ...range, requestedMethod: method };
}

function shouldEnforceDailyMealLimit() {
  return false;
}

module.exports = {
  assertDateInsideSubscriptionRange,
  assertFulfillmentMethodAllowed,
  buildFulfillmentPolicy,
  createFulfillmentPolicyError,
  isFirstSubscriptionDay,
  resolveSubscriptionDateRange,
  shouldEnforceDailyMealLimit,
};
