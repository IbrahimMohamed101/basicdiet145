"use strict";

const { validateDayBeforeLockOrPrepare } = require("./subscriptionDayExecutionValidationService");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { t } = require("../../utils/i18n");
const dateUtils = require("../../utils/date");

/**
 * Resolves the state of the pickup preparation button for the current subscription overview.
 * 
 * @param {Object} subscription - Current Subscription document
 * @param {Object} todayDay - SubscriptionDay document for today (Can be null)
 * @param {Object} [deps] - Optional dependencies for testing
 * @returns {Object} - { flowStatus, reason, buttonLabel, message, ...bilingualFields }
 */
function resolvePickupPreparationState(subscription, todayDay, deps = {}) {
  const {
    validateDayBeforeLockOrPrepare: validateDay = validateDayBeforeLockOrPrepare,
    resolveMealsPerDay: resolveMeals = resolveMealsPerDay,
    getTodayKSADate = dateUtils.getTodayKSADate,
    toKSADateString = dateUtils.toKSADateString,
    translate = t,
  } = deps;

  const buttonLabelAr = translate("read.pickupPreparation.buttonLabel", "ar");
  const buttonLabelEn = translate("read.pickupPreparation.buttonLabel", "en");

  const buildResponse = (flowStatus, reason = null, messageKey = null, messageParams = {}) => {
    const messageAr = messageKey ? translate(`read.pickupPreparation.messages.${messageKey}`, "ar", messageParams) : null;
    const messageEn = messageKey ? translate(`read.pickupPreparation.messages.${messageKey}`, "en", messageParams) : null;
    
    return {
      flowStatus,
      reason,
      buttonLabel: buttonLabelAr, // Default to Arabic for backward compatibility
      buttonLabelAr,
      buttonLabelEn,
      message: messageAr, // Default to Arabic
      messageAr,
      messageEn,
    };
  };

  // 1. deliveryMode !== 'pickup' -> hidden
  if (subscription.deliveryMode !== "pickup") {
    return {
      flowStatus: "hidden",
      reason: null,
      buttonLabel: null,
      buttonLabelAr: null,
      buttonLabelEn: null,
      message: null,
      messageAr: null,
      messageEn: null,
    };
  }

  const todayKSA = getTodayKSADate();

  // 2. subscription.status !== 'active' OR today > validityEndDate -> disabled
  const validityEnd = subscription.validityEndDate || subscription.endDate;
  const isExpired = validityEnd && todayKSA > toKSADateString(validityEnd);
  
  if (subscription.status !== "active" || isExpired) {
    return buildResponse("disabled", "SUBSCRIPTION_INACTIVE", "SUBSCRIPTION_INACTIVE");
  }

  // 3. todayDay is missing -> disabled (PLANNING_INCOMPLETE)
  if (!todayDay) {
    return buildResponse("disabled", "PLANNING_INCOMPLETE", "PLANNING_INCOMPLETE");
  }

  // 4. status === 'fulfilled' -> completed
  if (todayDay.status === "fulfilled") {
    return buildResponse("completed");
  }

  // 5. In Progress statuses
  const isInProgressStatus = ["locked", "in_preparation", "ready_for_pickup"].includes(todayDay.status);
  if (isInProgressStatus || todayDay.pickupRequested === true) {
    return buildResponse("in_progress");
  }

  // 6. Skipped or Frozen
  if (["skipped", "frozen"].includes(todayDay.status)) {
    return buildResponse("disabled", "DAY_SKIPPED", "DAY_SKIPPED");
  }

  // 7. Open day checks
  if (todayDay.status === "open" || !todayDay.status) {
    // 7a + 7b: Validate planning and payments
    try {
      validateDay({ subscription, day: todayDay });
    } catch (err) {
      if (err.code === "PLANNING_INCOMPLETE") {
        return buildResponse("disabled", "PLANNING_INCOMPLETE", "PLANNING_INCOMPLETE");
      }
      if (["PREMIUM_OVERAGE_PAYMENT_REQUIRED", "ONE_TIME_ADDON_PAYMENT_REQUIRED"].includes(err.code)) {
        return buildResponse("disabled", "PAYMENT_REQUIRED", "PAYMENT_REQUIRED");
      }
      // General fallback for validation errors
      return {
        ...buildResponse("disabled", err.code || "INVALID", "DEFAULT_ERROR"),
        message: err.message || translate("read.pickupPreparation.messages.DEFAULT_ERROR", "ar"),
        messageAr: err.message || translate("read.pickupPreparation.messages.DEFAULT_ERROR", "ar"),
        // If it's a dynamic error message from the engine, we might not have it in both languages unless it's translated there.
        // But for consistency we try to use the message from error if available.
      };
    }

    // 7c: Insufficient Credits
    const mealsToDeduct = resolveMeals(subscription);
    if (Number(subscription.remainingMeals || 0) < mealsToDeduct) {
      return buildResponse("disabled", "INSUFFICIENT_CREDITS", "INSUFFICIENT_CREDITS");
    }

    // 7d: All checks passed
    return buildResponse("available");
  }

  // Fallback
  return buildResponse("disabled", "INVALID_STATE", "INVALID_STATE");
}

module.exports = {
  resolvePickupPreparationState,
};
