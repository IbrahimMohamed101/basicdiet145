"use strict";

const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { buildDayCommercialState } = require("./subscriptionDayCommercialStateService");
const { buildSubscriptionDayFulfillmentState } = require("./subscriptionDayFulfillmentStateService");
const { validateDayBeforeLockOrPrepare } = require("./subscriptionDayExecutionValidationService");

function mapBlockingReasonToPrepareCode(blockingReason) {
  switch (blockingReason) {
    case "planning_incomplete":
      return "PLANNING_INCOMPLETE";
    case "planner_unconfirmed":
      return "PLANNING_UNCONFIRMED";
    case "premium_pending_payment":
    case "pricing_pending":
    case "pricing_failed":
    case "payment_revision_mismatch":
      return "PAYMENT_REQUIRED";
    case "locked":
      return "LOCKED";
    default:
      return "INVALID_STATE";
  }
}

function mapBlockingReasonToPrepareStatus(blockingReason) {
  switch (blockingReason) {
    case "planning_incomplete":
    case "planner_unconfirmed":
    case "premium_pending_payment":
    case "pricing_pending":
    case "pricing_failed":
    case "payment_revision_mismatch":
      return 422;
    case "locked":
      return 409;
    default:
      return 409;
  }
}

function mapBlockingReasonToOverviewReason(blockingReason) {
  switch (blockingReason) {
    case "planning_incomplete":
      return "PLANNING_INCOMPLETE";
    case "planner_unconfirmed":
      return "PLANNING_UNCONFIRMED";
    case "premium_pending_payment":
    case "pricing_pending":
    case "pricing_failed":
    case "payment_revision_mismatch":
      return "PAYMENT_REQUIRED";
    default:
      return "INVALID_STATE";
  }
}

function buildPickupPreparationPolicy({
  subscription,
  day,
  today,
  restaurantHours = null,
} = {}) {
  if (!day) {
    return {
      canRequestPrepare: false,
      blockReason: { code: "PLANNING_INCOMPLETE", status: 422, messageKey: "PLANNING_INCOMPLETE" },
      derivedState: null,
      fulfillmentState: null,
    };
  }

  if (!subscription || subscription.deliveryMode !== "pickup") {
    return {
      canRequestPrepare: false,
      blockReason: { code: "INVALID", status: 400, messageKey: null },
      derivedState: null,
      fulfillmentState: null,
    };
  }

  const derivedState = buildDayCommercialState(day || {});
  const fulfillmentState = buildSubscriptionDayFulfillmentState({
    subscription,
    day,
    derivedState,
    today,
  });

  const status = String(day.status || "open");

  if (status === "skipped") {
    return {
      canRequestPrepare: false,
      blockReason: { code: "DAY_SKIPPED", status: 409, messageKey: "DAY_SKIPPED" },
      derivedState,
      fulfillmentState,
    };
  }

  if (status === "frozen") {
    return {
      canRequestPrepare: false,
      blockReason: { code: "DAY_FROZEN", status: 409, messageKey: "DAY_SKIPPED" },
      derivedState,
      fulfillmentState,
    };
  }

  if (status === "fulfilled") {
    return {
      canRequestPrepare: false,
      blockReason: { code: "PICKUP_ALREADY_COMPLETED", status: 409, messageKey: null },
      derivedState,
      fulfillmentState,
    };
  }

  if (status === "no_show") {
    return {
      canRequestPrepare: false,
      blockReason: { code: "PICKUP_ALREADY_CLOSED", status: 409, messageKey: "PICKUP_NO_SHOW" },
      derivedState,
      fulfillmentState,
    };
  }

  if (status === "consumed_without_preparation" || day.creditsDeducted) {
    return {
      canRequestPrepare: false,
      blockReason: { code: "DAY_ALREADY_CONSUMED", status: 409, messageKey: "CONSUMED_WITHOUT_PREPARATION" },
      derivedState,
      fulfillmentState,
    };
  }

  if (day.pickupRequested || ["locked", "in_preparation", "ready_for_pickup"].includes(status)) {
    return {
      canRequestPrepare: false,
      blockReason: { code: "PICKUP_ALREADY_REQUESTED", status: 409, messageKey: null },
      derivedState,
      fulfillmentState,
    };
  }

  const requiredMeals = Number(resolveMealsPerDay(subscription) || 0);
  const remainingMeals = Number(subscription.remainingMeals || 0);
  if (remainingMeals < requiredMeals) {
    return {
      canRequestPrepare: false,
      blockReason: { code: "INSUFFICIENT_CREDITS", status: 422, messageKey: "INSUFFICIENT_CREDITS" },
      derivedState,
      fulfillmentState,
    };
  }

  if (derivedState.canBePrepared !== true) {
    const blockingReason = derivedState.paymentRequirement && derivedState.paymentRequirement.blockingReason
      ? derivedState.paymentRequirement.blockingReason
      : "planning_incomplete";
    return {
      canRequestPrepare: false,
      blockReason: {
        code: mapBlockingReasonToPrepareCode(blockingReason),
        status: mapBlockingReasonToPrepareStatus(blockingReason),
        messageKey: mapBlockingReasonToOverviewReason(blockingReason),
        blockingReason,
      },
      derivedState,
      fulfillmentState,
    };
  }

  try {
    validateDayBeforeLockOrPrepare({ subscription, day });
  } catch (err) {
    const code = err && err.code ? err.code : "INVALID_STATE";
    let messageKey = "INVALID_STATE";
    if (code === "PLANNING_INCOMPLETE") messageKey = "PLANNING_INCOMPLETE";
    if (code === "PLANNER_UNCONFIRMED") messageKey = "PLANNING_UNCONFIRMED";
    if (["PREMIUM_OVERAGE_PAYMENT_REQUIRED", "ONE_TIME_ADDON_PAYMENT_REQUIRED", "PREMIUM_PAYMENT_REQUIRED"].includes(code)) {
      messageKey = "PAYMENT_REQUIRED";
    }

    return {
      canRequestPrepare: false,
      blockReason: {
        code,
        status: typeof err.status === "number" ? err.status : 422,
        messageKey,
      },
      derivedState,
      fulfillmentState,
    };
  }

  if (restaurantHours && restaurantHours.isOpenNow === false) {
    return {
      canRequestPrepare: false,
      blockReason: { code: "RESTAURANT_CLOSED", status: 400, messageKey: null },
      derivedState,
      fulfillmentState,
    };
  }

  return {
    canRequestPrepare: true,
    blockReason: null,
    derivedState,
    fulfillmentState,
  };
}

module.exports = {
  buildPickupPreparationPolicy,
};
