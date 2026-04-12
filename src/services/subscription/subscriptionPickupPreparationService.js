"use strict";

const { validateDayBeforeLockOrPrepare } = require("./subscriptionDayExecutionValidationService");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const dateUtils = require("../../utils/date");

/**
 * Resolves the state of the pickup preparation button for the current subscription overview.
 * 
 * @param {Object} subscription - Current Subscription document
 * @param {Object} todayDay - SubscriptionDay document for today (Can be null)
 * @param {Object} [deps] - Optional dependencies for testing
 * @returns {Object} - { flowStatus, reason, buttonLabel, message }
 */
function resolvePickupPreparationState(subscription, todayDay, deps = {}) {
  const {
    validateDayBeforeLockOrPrepare: validateDay = validateDayBeforeLockOrPrepare,
    resolveMealsPerDay: resolveMeals = resolveMealsPerDay,
    getTodayKSADate = dateUtils.getTodayKSADate,
    toKSADateString = dateUtils.toKSADateString,
  } = deps;

  const buttonLabel = "تجهيز الطلب";

  // 1. deliveryMode !== 'pickup' -> hidden
  if (subscription.deliveryMode !== "pickup") {
    return {
      flowStatus: "hidden",
      reason: null,
      buttonLabel: null,
      message: null,
    };
  }

  const todayKSA = getTodayKSADate();

  // 2. subscription.status !== 'active' OR today > validityEndDate -> disabled
  const validityEnd = subscription.validityEndDate || subscription.endDate;
  const isExpired = validityEnd && todayKSA > toKSADateString(validityEnd);
  
  if (subscription.status !== "active" || isExpired) {
    return {
      flowStatus: "disabled",
      reason: "SUBSCRIPTION_INACTIVE",
      buttonLabel,
      message: "اشتراكك غير نشط أو انتهت صلاحيته",
    };
  }

  // 3. todayDay is missing -> disabled (PLANNING_INCOMPLETE)
  if (!todayDay) {
    return {
      flowStatus: "disabled",
      reason: "PLANNING_INCOMPLETE",
      buttonLabel,
      message: "يرجى اختيار وجباتك أولاً",
    };
  }

  // 4. status === 'fulfilled' -> completed
  if (todayDay.status === "fulfilled") {
    return {
      flowStatus: "completed",
      reason: null,
      buttonLabel,
      message: null,
    };
  }

  // 5. In Progress statuses
  const isInProgressStatus = ["locked", "in_preparation", "ready_for_pickup"].includes(todayDay.status);
  if (isInProgressStatus || todayDay.pickupRequested === true) {
    return {
      flowStatus: "in_progress",
      reason: null,
      buttonLabel,
      message: null,
    };
  }

  // 6. Skipped or Frozen
  if (["skipped", "frozen"].includes(todayDay.status)) {
    return {
      flowStatus: "disabled",
      reason: "DAY_SKIPPED",
      buttonLabel,
      message: "هذا اليوم موقوف أو مجمّد",
    };
  }

  // 7. Open day checks
  if (todayDay.status === "open" || !todayDay.status) {
    // 7a + 7b: Validate planning and payments
    try {
      validateDay({ subscription, day: todayDay });
    } catch (err) {
      if (err.code === "PLANNING_INCOMPLETE") {
        return {
          flowStatus: "disabled",
          reason: "PLANNING_INCOMPLETE",
          buttonLabel,
          message: "يرجى اختيار وجباتك أولاً",
        };
      }
      if (["PREMIUM_OVERAGE_PAYMENT_REQUIRED", "ONE_TIME_ADDON_PAYMENT_REQUIRED"].includes(err.code)) {
        return {
          flowStatus: "disabled",
          reason: "PAYMENT_REQUIRED",
          buttonLabel,
          message: "يوجد مبالغ معلقة، يرجى إتمام الدفع",
        };
      }
      // General fallback for validation errors
      return {
        flowStatus: "disabled",
        reason: err.code || "INVALID",
        buttonLabel,
        message: err.message || "لا يمكن تجهيز الطلب حالياً",
      };
    }

    // 7c: Insufficient Credits
    const mealsToDeduct = resolveMeals(subscription);
    if (Number(subscription.remainingMeals || 0) < mealsToDeduct) {
      return {
        flowStatus: "disabled",
        reason: "INSUFFICIENT_CREDITS",
        buttonLabel,
        message: "رصيد وجباتك غير كافٍ",
      };
    }

    // 7d: All checks passed
    return {
      flowStatus: "available",
      reason: null,
      buttonLabel,
      message: null,
    };
  }

  // Fallback
  return {
    flowStatus: "disabled",
    reason: "INVALID_STATE",
    buttonLabel,
    message: "الحالة الحالية غير معروفة",
  };
}

module.exports = {
  resolvePickupPreparationState,
};
