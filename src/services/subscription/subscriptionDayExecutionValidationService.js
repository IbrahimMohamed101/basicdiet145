const { createLocalizedError } = require("../../utils/errorLocalization");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const {
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../../utils/featureFlags");
const {
  isCanonicalDayPlanningEligible,
  buildCanonicalPlanningView,
  isCanonicalPremiumOverageEligible,
  assertNoPendingPremiumOverage,
} = require("./subscriptionDayPlanningService");
const { assertNoPendingOneTimeAddonPayment } = require("../oneTimeAddonPlanningService");

function createPlanningIncompleteError() {
  return createLocalizedError({
    code: "PLANNING_INCOMPLETE",
    status: 422,
    key: "errors.planning.incomplete",
    fallbackMessage: "Day must contain exactly mealsPerDay total meal selections before confirmation",
  });
}

function countSelectedMeals(day) {
  const regularSelections = Array.isArray(day && day.selections) ? day.selections.filter(Boolean).length : 0;
  const premiumSelections = Array.isArray(day && day.premiumSelections) ? day.premiumSelections.filter(Boolean).length : 0;
  return regularSelections + premiumSelections;
}

function assertDayIsExecutable(day, allowedStatuses = ["open"]) {
  if (!day) {
    throw createLocalizedError({
      code: "NOT_FOUND",
      status: 404,
      key: "errors.subscription.dayNotFound",
      fallbackMessage: "Day not found",
    });
  }

  const normalizedStatus = typeof day.status === "string" && day.status.trim() ? day.status : "open";
  if (!allowedStatuses.includes(normalizedStatus)) {
    throw createLocalizedError({
      code: "LOCKED",
      status: 409,
      key: "errors.subscription.dayLocked",
      fallbackMessage: "Day is locked",
    });
  }
}

function assertMealAssignmentsComplete({ subscription, day }) {
  if (isCanonicalDayPlanningEligible(subscription, {
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  })) {
    const planningView = buildCanonicalPlanningView({ subscription, day });
    if (!planningView || planningView.isExactCountSatisfied !== true) {
      throw createPlanningIncompleteError();
    }
    return planningView;
  }

  const requiredMeals = resolveMealsPerDay(subscription);
  if (countSelectedMeals(day) !== requiredMeals) {
    throw createPlanningIncompleteError();
  }

  return {
    requiredMealCount: requiredMeals,
    selectedTotalMealCount: countSelectedMeals(day),
    isExactCountSatisfied: true,
  };
}

function validateDayBeforeLockOrPrepare({ subscription, day, allowedStatuses = ["open"] } = {}) {
  assertDayIsExecutable(day, allowedStatuses);
  assertMealAssignmentsComplete({ subscription, day });
  assertNoPendingPremiumOverage({
    subscription,
    day,
    overageEligible: isCanonicalPremiumOverageEligible(subscription, {
      dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
      genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
    }),
  });
  assertNoPendingOneTimeAddonPayment({ day });
  return day;
}

function resolveDayExecutionValidationErrorStatus(err) {
  if (!err || typeof err !== "object") return 400;
  if (typeof err.status === "number") return err.status;
  if (["PLANNING_INCOMPLETE", "PREMIUM_OVERAGE_PAYMENT_REQUIRED", "ONE_TIME_ADDON_PAYMENT_REQUIRED"].includes(err.code)) {
    return 422;
  }
  if (err.code === "NOT_FOUND") return 404;
  if (err.code === "LOCKED" || err.code === "INVALID_TRANSITION") return 409;
  return 400;
}

module.exports = {
  validateDayBeforeLockOrPrepare,
  resolveDayExecutionValidationErrorStatus,
};
