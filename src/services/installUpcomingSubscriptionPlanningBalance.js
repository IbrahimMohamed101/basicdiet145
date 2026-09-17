"use strict";

const supportService = require("./subscription/subscriptionClientSupportService");
const {
  subscriptionDateWindow,
} = require("./subscription/subscriptionCurrentResolverService");

const INSTALL_KEY = Symbol.for(
  "basicdiet.upcomingSubscriptionPlanningBalance.installed"
);
const BUILD_WRAPPED_KEY = Symbol.for(
  "basicdiet.upcomingSubscriptionPlanningBalance.buildWrapped"
);
const SHAPE_WRAPPED_KEY = Symbol.for(
  "basicdiet.upcomingSubscriptionPlanningBalance.shapeWrapped"
);
const POLICY_VERSION = "upcoming_subscription_planning_balance.v1";

function copyFunctionMetadata(source, target) {
  for (const key of Reflect.ownKeys(source)) {
    if (
      ["length", "name", "prototype", "arguments", "caller", "__original"].includes(
        key
      )
    ) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(target, key, descriptor);
    } catch (_error) {
      // Non-critical metadata must never prevent startup.
    }
  }
  return target;
}

function normalizeDateString(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function resolveAvailablePlanningMeals(balance, subscription) {
  return nonNegativeInteger(
    balance && balance.availableMeals !== undefined
      ? balance.availableMeals
      : subscription && subscription.remainingMeals
  );
}

function isActiveUpcomingSubscription(subscription, evaluationDate) {
  const date = normalizeDateString(evaluationDate);
  if (!date || !subscription || String(subscription.status || "") !== "active") {
    return false;
  }

  const { startDate, endDate } = subscriptionDateWindow(subscription);
  return Boolean(
    startDate
      && date < startDate
      && (!endDate || date <= endDate)
  );
}

function applyUpcomingPlanningCompatibility({
  balance,
  subscription,
  evaluationDate,
}) {
  if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
    return balance;
  }

  const normalizedDate = normalizeDateString(evaluationDate);
  const baseCanConsumeNow = balance.canConsumeNow === true;

  if (!isActiveUpcomingSubscription(subscription, normalizedDate)) {
    return {
      ...balance,
      canPlanNow:
        typeof balance.canPlanNow === "boolean"
          ? balance.canPlanNow
          : baseCanConsumeNow,
    };
  }

  const availableMeals = resolveAvailablePlanningMeals(balance, subscription);
  const canPlanNow = availableMeals > 0;
  const { startDate, endDate } = subscriptionDateWindow(subscription);

  return {
    ...balance,
    availableMeals,
    canPlanNow,
    // Flutter currently uses canConsumeNow as its meal-planner add guard. For an
    // active upcoming subscription, planning future valid days is allowed even
    // though physical fulfillment has not started yet.
    canConsumeNow: canPlanNow,
    maxConsumableMealsNow: canPlanNow ? availableMeals : 0,
    planningCompatibility: {
      version: POLICY_VERSION,
      applied: true,
      reason: "ACTIVE_SUBSCRIPTION_NOT_STARTED",
      evaluationDate: normalizedDate,
      startDate,
      endDate,
      fulfillmentStarted: false,
    },
  };
}

function resolvePlannerBalanceDate(args = {}, result = null) {
  const candidates = [
    result && result.date,
    args && args.day && args.day.date,
    args && args.businessDate,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDateString(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function installUpcomingSubscriptionPlanningBalance() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const originalBuildMealBalance = supportService.buildMealBalance;
  const originalShapeMealPlannerReadFields =
    supportService.shapeMealPlannerReadFields;

  if (typeof originalBuildMealBalance !== "function") {
    throw new Error("subscriptionClientSupportService.buildMealBalance is missing");
  }
  if (typeof originalShapeMealPlannerReadFields !== "function") {
    throw new Error(
      "subscriptionClientSupportService.shapeMealPlannerReadFields is missing"
    );
  }

  let wrappedBuildMealBalance = originalBuildMealBalance;
  if (originalBuildMealBalance[BUILD_WRAPPED_KEY] !== true) {
    wrappedBuildMealBalance = function buildMealBalanceWithUpcomingPlanning(
      subscription,
      businessDate
    ) {
      const balance = originalBuildMealBalance(subscription, businessDate);
      return applyUpcomingPlanningCompatibility({
        balance,
        subscription,
        evaluationDate: businessDate,
      });
    };

    copyFunctionMetadata(originalBuildMealBalance, wrappedBuildMealBalance);
    Object.defineProperty(wrappedBuildMealBalance, BUILD_WRAPPED_KEY, {
      value: true,
    });
    Object.defineProperty(wrappedBuildMealBalance, "__original", {
      value: originalBuildMealBalance,
    });
    supportService.buildMealBalance = wrappedBuildMealBalance;
  }

  if (originalShapeMealPlannerReadFields[SHAPE_WRAPPED_KEY] !== true) {
    const wrappedShapeMealPlannerReadFields =
      function shapeMealPlannerReadFieldsWithPlanningDate(args = {}) {
        const result = originalShapeMealPlannerReadFields(args);
        const evaluationDate = resolvePlannerBalanceDate(args, result);
        if (!evaluationDate || !args.subscription) return result;

        return {
          ...result,
          mealBalance: wrappedBuildMealBalance(
            args.subscription,
            evaluationDate
          ),
        };
      };

    copyFunctionMetadata(
      originalShapeMealPlannerReadFields,
      wrappedShapeMealPlannerReadFields
    );
    Object.defineProperty(
      wrappedShapeMealPlannerReadFields,
      SHAPE_WRAPPED_KEY,
      { value: true }
    );
    Object.defineProperty(wrappedShapeMealPlannerReadFields, "__original", {
      value: originalShapeMealPlannerReadFields,
    });
    supportService.shapeMealPlannerReadFields =
      wrappedShapeMealPlannerReadFields;
  }

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    policyVersion: POLICY_VERSION,
    buildMealBalanceWrapped: true,
    plannerReadBalanceWrapped: true,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installUpcomingSubscriptionPlanningBalance();

module.exports = {
  BUILD_WRAPPED_KEY,
  INSTALL_KEY,
  POLICY_VERSION,
  SHAPE_WRAPPED_KEY,
  applyUpcomingPlanningCompatibility,
  installUpcomingSubscriptionPlanningBalance,
  isActiveUpcomingSubscription,
  normalizeDateString,
  resolvePlannerBalanceDate,
};
