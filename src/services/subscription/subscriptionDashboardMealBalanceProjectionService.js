"use strict";

const DASHBOARD_MEAL_BALANCE_PROJECTION_VERSION =
  "dashboard_meal_balance_projection.v1";
const DASHBOARD_MEAL_BALANCE_FLAG =
  "DASHBOARD_UNCONSUMED_MEAL_BALANCE_ENABLED";

function nonNegativeIntegerOrNull(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isProjectionEnabled(env = process.env) {
  const value = String(env[DASHBOARD_MEAL_BALANCE_FLAG] || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function allocationQuantity(row) {
  const quantity = nonNegativeIntegerOrNull(row && row.quantity);
  return quantity === null ? 1 : quantity;
}

function sumAllocationsByState(allocations, state) {
  return (Array.isArray(allocations) ? allocations : []).reduce(
    (total, row) => (
      row && row.state === state ? total + allocationQuantity(row) : total
    ),
    0
  );
}

function resolveLifecycleCounter(subscription, field, allocationState) {
  const explicit = nonNegativeIntegerOrNull(subscription && subscription[field]);
  if (explicit !== null) return explicit;

  if (
    Number(subscription && subscription.entitlementVersion) >= 2
    && Array.isArray(subscription && subscription.baseMealAllocations)
  ) {
    return sumAllocationsByState(
      subscription.baseMealAllocations,
      allocationState
    );
  }

  return null;
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

  const totalMeals = nonNegativeIntegerOrNull(subscription.totalMeals);
  const availableMeals = nonNegativeIntegerOrNull(subscription.remainingMeals);
  const reservedMeals = resolveLifecycleCounter(
    subscription,
    "reservedMeals",
    "reserved"
  );
  const consumedMeals = resolveLifecycleCounter(
    subscription,
    "consumedMeals",
    "consumed"
  );
  const forfeitedMeals = resolveLifecycleCounter(
    subscription,
    "forfeitedMeals",
    "forfeited"
  );

  if (
    totalMeals === null
    || availableMeals === null
    || reservedMeals === null
    || consumedMeals === null
  ) {
    return null;
  }

  const safeForfeitedMeals = forfeitedMeals === null ? 0 : forfeitedMeals;
  const accountedMeals =
    availableMeals + reservedMeals + consumedMeals + safeForfeitedMeals;

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
    forfeitedMeals: safeForfeitedMeals,
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
  sumAllocationsByState,
};
