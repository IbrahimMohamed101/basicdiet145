"use strict";

const { t } = require("../../utils/i18n");
const dateUtils = require("../../utils/date");
const { buildSubscriptionDayFulfillmentState } = require("./subscriptionDayFulfillmentStateService");
const { buildPickupPreparationPolicy } = require("./subscriptionPickupPreparationPolicyService");

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
    buildPolicy = buildPickupPreparationPolicy,
  } = deps;

  const buttonLabelAr = translate("read.pickupPreparation.buttonLabel", "ar");
  const buttonLabelEn = translate("read.pickupPreparation.buttonLabel", "en");
  const mealPlannerCtaLabelAr = translate("read.pickupPreparation.mealPlannerCtaLabel", "ar");
  const mealPlannerCtaLabelEn = translate("read.pickupPreparation.mealPlannerCtaLabel", "en");
  const preferredLang = lang === "en" ? "en" : "ar";

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
    return buildResponse("disabled", "SUBSCRIPTION_INACTIVE", "SUBSCRIPTION_INACTIVE");
  }

  // 3. todayDay is missing -> disabled (PLANNING_INCOMPLETE)
  if (!todayDay) {
    return buildResponse("disabled", "PLANNING_INCOMPLETE", "PLANNING_INCOMPLETE");
  }

  const policy = buildPolicy({
    subscription,
    day: todayDay,
    today: todayKSA,
  });

  // 4. status === 'fulfilled' -> completed
  if (todayDay.status === "fulfilled") {
    return buildResponse("completed");
  }

  if (todayDay.status === "no_show") {
    return buildResponse("completed", "PICKUP_NO_SHOW", "PICKUP_NO_SHOW");
  }

  if (todayDay.status === "consumed_without_preparation") {
    return buildResponse("completed", "CONSUMED_WITHOUT_PREPARATION", "CONSUMED_WITHOUT_PREPARATION");
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
    if (!policy.canRequestPrepare) {
      const reason = policy.blockReason && policy.blockReason.messageKey
        ? policy.blockReason.messageKey
        : "INVALID_STATE";
      return buildResponse(
        "disabled",
        reason,
        reason,
        {},
        {
          canRequestPrepare: false,
          canBePrepared: Boolean(policy.derivedState && policy.derivedState.canBePrepared),
          planningReady: Boolean(policy.fulfillmentState && policy.fulfillmentState.planningReady),
        }
      );
    }

    return buildResponse("available", null, null, {}, {
      canRequestPrepare: true,
      canBePrepared: Boolean(policy.derivedState && policy.derivedState.canBePrepared),
      planningReady: Boolean(policy.fulfillmentState && policy.fulfillmentState.planningReady),
    });
  }

  // Fallback
  return buildResponse("disabled", "INVALID_STATE", "INVALID_STATE");
}

module.exports = {
  resolvePickupPreparationState,
};
