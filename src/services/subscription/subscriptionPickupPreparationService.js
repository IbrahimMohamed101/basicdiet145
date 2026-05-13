"use strict";

const { t } = require("../../utils/i18n");
const dateUtils = require("../../utils/date");
const { buildSubscriptionDayFulfillmentState } = require("./subscriptionDayFulfillmentStateService");
const { buildDayCommercialState } = require("./subscriptionDayCommercialStateService");
const { validateDayBeforeLockOrPrepare } = require("./subscriptionDayExecutionValidationService");

const PICKUP_MULTI_REQUEST_ALLOWED_DAY_STATUSES = [
  "open",
  "locked",
  "in_preparation",
  "out_for_delivery",
  "ready_for_pickup",
  "fulfilled",
  "consumed_without_preparation",
  "delivery_canceled",
  "canceled_at_branch",
  "no_show",
];

function resolvePickupValidationReason(err) {
  const code = err && err.code ? err.code : "INVALID_STATE";
  if (code === "PLANNING_INCOMPLETE") return "PLANNING_INCOMPLETE";
  if (code === "PLANNER_UNCONFIRMED") return "PLANNING_UNCONFIRMED";
  if (["PREMIUM_OVERAGE_PAYMENT_REQUIRED", "ONE_TIME_ADDON_PAYMENT_REQUIRED", "PREMIUM_PAYMENT_REQUIRED", "PENDING_ADDON_PAYMENT"].includes(code)) {
    return "PAYMENT_REQUIRED";
  }
  return code;
}

/**
 * Resolves the state of the pickup preparation button for the current subscription overview.
 * 
 * @param {Object} subscription - Current Subscription document
 * @param {Object} todayDay - SubscriptionDay document for today (Can be null)
 * @param {Object} [deps] - Optional dependencies for testing
 * @returns {Object} - { flowStatus, reason, buttonLabel, message, buttonLabelAr, buttonLabelEn }
 */
function resolvePickupPreparationState(subscription, todayDay, deps = {}) {
  const {
    getTodayKSADate = dateUtils.getTodayKSADate,
    toKSADateString = dateUtils.toKSADateString,
    translate = t,
    lang = "en",
    validatePickupDay = validateDayBeforeLockOrPrepare,
    activePickupRequestCount = 0,
    latestPickupRequest = null,
    restaurantHours = null,
  } = deps;

  const buttonLabelAr = translate("read.pickupPreparation.buttonLabel", "ar");
  const buttonLabelEn = translate("read.pickupPreparation.buttonLabel", "en");
  const mealPlannerCtaLabelAr = translate("read.pickupPreparation.mealPlannerCtaLabel", "ar");
  const mealPlannerCtaLabelEn = translate("read.pickupPreparation.mealPlannerCtaLabel", "en");
  const preferredLang = lang === "en" ? "en" : "ar";
  const restaurantHoursPayload = restaurantHours
    ? {
      openTime: restaurantHours.openTime || null,
      closeTime: restaurantHours.closeTime || null,
      isOpenNow: Boolean(restaurantHours.isOpenNow),
    }
    : null;
  const multiRequestExtra = (canCreatePickupRequest, extra = {}) => ({
    mode: "multi_request",
    canCreatePickupRequest,
    availableMealBalance: Number(subscription.remainingMeals || 0),
    activePickupRequestCount,
    latestPickupRequest,
    ...(restaurantHoursPayload ? { restaurantHours: restaurantHoursPayload } : {}),
    ...extra,
  });

  const buildResponse = (flowStatus, reason = null, messageKey = null, messageParams = {}, state = {}) => {
    const messageAr = messageKey ? translate(`read.pickupPreparation.messages.${messageKey}`, "ar", messageParams) : null;
    const messageEn = messageKey ? translate(`read.pickupPreparation.messages.${messageKey}`, "en", messageParams) : null;
    const showMealPlannerCta = Boolean(state.showMealPlannerCta || reason === "PLANNING_INCOMPLETE");
    
    return {
      flowStatus,
      reason,
      canRequestPrepare: Boolean(state.canRequestPrepare ?? flowStatus === "available"),
      canBePrepared: Boolean(state.canBePrepared),
      planningReady: Boolean(state.planningReady),
      showMealPlannerCta,
      mealPlannerCtaLabelAr: showMealPlannerCta ? mealPlannerCtaLabelAr : null,
      mealPlannerCtaLabelEn: showMealPlannerCta ? mealPlannerCtaLabelEn : null,
      pickupPreparationFlowStatus: todayDay
        ? buildSubscriptionDayFulfillmentState({ subscription, day: todayDay, today: todayKSA }).pickupPreparationFlowStatus
        : "waiting_for_prepare",
      buttonLabel: preferredLang === "en" ? buttonLabelEn : buttonLabelAr,
      buttonLabelAr,
      buttonLabelEn,
      messageAr,
      messageEn,
      message: preferredLang === "en" ? messageEn : messageAr,
      pickupRequested: Boolean(todayDay && todayDay.pickupRequested),
      pickupPrepared: Boolean(
        todayDay
          && buildSubscriptionDayFulfillmentState({ subscription, day: todayDay, today: todayKSA }).pickupPrepared
      ),
      consumptionState: todayDay
        ? buildSubscriptionDayFulfillmentState({ subscription, day: todayDay, today: todayKSA }).consumptionState
        : "pending_day",
      fulfillmentMode: todayDay
        ? buildSubscriptionDayFulfillmentState({ subscription, day: todayDay, today: todayKSA }).fulfillmentMode
        : "no_service",
      dayEndConsumptionReason: todayDay && todayDay.dayEndConsumptionReason ? todayDay.dayEndConsumptionReason : null,
      ...(state.extra || {}),
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
    };
  }

  const todayKSA = getTodayKSADate();

  // 2. subscription.status !== 'active' OR today > validityEndDate -> disabled
  const validityEnd = subscription.validityEndDate || subscription.endDate;
  const isExpired = validityEnd && todayKSA > toKSADateString(validityEnd);
  
  if (subscription.status !== "active" || isExpired) {
    return buildResponse("disabled", "SUBSCRIPTION_INACTIVE", "SUBSCRIPTION_INACTIVE", {}, {
      extra: multiRequestExtra(false),
    });
  }

  // 3. todayDay is missing -> disabled (PLANNING_INCOMPLETE)
  if (!todayDay) {
    return buildResponse("disabled", "PLANNING_INCOMPLETE", "PLANNING_INCOMPLETE", {}, {
      extra: multiRequestExtra(false),
    });
  }

  if (["skipped", "frozen"].includes(todayDay.status)) {
    return buildResponse("disabled", "DAY_SKIPPED", "DAY_SKIPPED", {}, {
      extra: multiRequestExtra(false),
    });
  }

  if (restaurantHours && restaurantHours.isOpenNow === false) {
    return buildResponse("disabled", "RESTAURANT_CLOSED", null, {}, {
      canRequestPrepare: false,
      extra: multiRequestExtra(false, {
        reason: "RESTAURANT_CLOSED",
        message: "Restaurant is currently closed",
        messageAr: "المطعم مغلق حاليًا. يمكنك الطلب خلال ساعات العمل.",
        messageEn: "Restaurant is currently closed. Please order during working hours.",
      }),
    });
  }

  const derivedState = buildDayCommercialState(todayDay || {});
  const fulfillmentState = buildSubscriptionDayFulfillmentState({
    subscription,
    day: todayDay,
    derivedState,
    today: todayKSA,
  });

  try {
    validatePickupDay({
      subscription,
      day: todayDay,
      allowedStatuses: PICKUP_MULTI_REQUEST_ALLOWED_DAY_STATUSES,
    });
  } catch (err) {
    const reason = resolvePickupValidationReason(err);
    return buildResponse("disabled", reason, reason, {}, {
      canRequestPrepare: false,
      canBePrepared: Boolean(derivedState && derivedState.canBePrepared),
      planningReady: Boolean(fulfillmentState && fulfillmentState.planningReady),
      extra: multiRequestExtra(false),
    });
  }

  if (Number(subscription.remainingMeals || 0) <= 0) {
    return buildResponse("disabled", "INSUFFICIENT_CREDITS", "INSUFFICIENT_CREDITS", {}, {
      canRequestPrepare: false,
      canBePrepared: Boolean(derivedState && derivedState.canBePrepared),
      planningReady: Boolean(fulfillmentState && fulfillmentState.planningReady),
      extra: multiRequestExtra(false),
    });
  }

  return buildResponse("available", null, null, {}, {
    canRequestPrepare: true,
    canBePrepared: Boolean(derivedState && derivedState.canBePrepared),
    planningReady: Boolean(fulfillmentState && fulfillmentState.planningReady),
    extra: multiRequestExtra(true),
  });
}

module.exports = {
  resolvePickupPreparationState,
};
