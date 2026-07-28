"use strict";

const DASHBOARD_MEAL_BALANCE_PROJECTION_VERSION =
  "dashboard_meal_balance_projection.v1";
const DASHBOARD_MEAL_BALANCE_FLAG =
  "DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED";

function nonNegativeIntegerOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isProjectionEnabled(env = process.env) {
  const value = String(env[DASHBOARD_MEAL_BALANCE_FLAG] || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function resolveDashboardMealBalanceProjection(subscription = {}) {
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) {
    return null;
  }

  // Limit the compatibility projection to active subscriptions with the modern
  // entitlement lifecycle. Legacy records remain byte-for-byte compatible until
  // their reservation/consumption source of truth is explicit.
  if (String(subscription.status || "").toLowerCase() !== "active") {
    return null;
  }

  const entitlementVersion = nonNegativeIntegerOrNull(
    subscription.entitlementVersion
  );
  if (entitlementVersion === null || entitlementVersion < 2) {
    return null;
  }

  const totalMeals = nonNegativeIntegerOrNull(subscription.totalMeals);
  const availableMeals = nonNegativeIntegerOrNull(subscription.remainingMeals);
  const reservedMeals = nonNegativeIntegerOrNull(subscription.reservedMeals);
  const consumedMeals = nonNegativeIntegerOrNull(subscription.consumedMeals);
  const forfeitedMeals = nonNegativeIntegerOrNull(subscription.forfeitedMeals);

  if (
    totalMeals === null
    || availableMeals === null
    || reservedMeals === null
    || consumedMeals === null
    || forfeitedMeals === null
  ) {
    return null;
  }

  const accountedMeals =
    availableMeals + reservedMeals + consumedMeals + forfeitedMeals;

  // Fail closed on incomplete/corrupt aggregates. Never manufacture customer
  // credit when the persisted lifecycle counters do not reconcile exactly.
  if (accountedMeals !== totalMeals) {
    return null;
  }

  return {
    totalMeals,
    availableMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    displayRemainingMeals: availableMeals + reservedMeals,
  };
}

function projectDashboardSubscriptionBalance(subscription = {}) {
  const projection = resolveDashboardMealBalanceProjection(subscription);
  if (!projection) return subscription;

  const currentMealBalance =
    subscription.mealBalance
    && typeof subscription.mealBalance === "object"
    && !Array.isArray(subscription.mealBalance)
      ? subscription.mealBalance
      : {};

  return {
    ...subscription,
    // Backward-compatible dashboard display field. Write paths and reservation
    // services never consume this projected response.
    remainingMeals: projection.displayRemainingMeals,
    availableMeals: projection.availableMeals,
    reservedMeals: projection.reservedMeals,
    consumedMeals: projection.consumedMeals,
    forfeitedMeals: projection.forfeitedMeals,
    displayRemainingMeals: projection.displayRemainingMeals,
    mealBalance: {
      ...currentMealBalance,
      totalMeals: projection.totalMeals,
      remainingMeals: projection.displayRemainingMeals,
      availableMeals: projection.availableMeals,
      reservedMeals: projection.reservedMeals,
      consumedMeals: projection.consumedMeals,
      forfeitedMeals: projection.forfeitedMeals,
      displayRemainingMeals: projection.displayRemainingMeals,
      balanceSemantics: "UNCONSUMED_INCLUDING_RESERVED",
    },
    balanceProjection: {
      version: DASHBOARD_MEAL_BALANCE_PROJECTION_VERSION,
      applied: true,
      remainingMealsSemantics: "UNCONSUMED_INCLUDING_RESERVED",
      availableMealsSemantics: "UNRESERVED_AVAILABLE_FOR_NEW_PLANNING",
    },
  };
}

function isSubscriptionReadModel(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value._id || value.id)
    && Object.prototype.hasOwnProperty.call(value, "totalMeals")
    && Object.prototype.hasOwnProperty.call(value, "remainingMeals")
  );
}

function projectDashboardSubscriptionResponse(payload, {
  enabled = isProjectionEnabled(),
} = {}) {
  if (!enabled || !payload || typeof payload !== "object") {
    return payload;
  }

  const data = payload.data;
  if (Array.isArray(data)) {
    return {
      ...payload,
      data: data.map((item) => (
        isSubscriptionReadModel(item)
          ? projectDashboardSubscriptionBalance(item)
          : item
      )),
    };
  }

  if (isSubscriptionReadModel(data)) {
    return {
      ...payload,
      data: projectDashboardSubscriptionBalance(data),
    };
  }

  if (
    data
    && typeof data === "object"
    && !Array.isArray(data)
    && Array.isArray(data.items)
  ) {
    return {
      ...payload,
      data: {
        ...data,
        items: data.items.map((item) => (
          isSubscriptionReadModel(item)
            ? projectDashboardSubscriptionBalance(item)
            : item
        )),
      },
    };
  }

  return payload;
}

module.exports = {
  DASHBOARD_MEAL_BALANCE_FLAG,
  DASHBOARD_MEAL_BALANCE_PROJECTION_VERSION,
  isProjectionEnabled,
  isSubscriptionReadModel,
  nonNegativeIntegerOrNull,
  projectDashboardSubscriptionBalance,
  projectDashboardSubscriptionResponse,
  resolveDashboardMealBalanceProjection,
};
