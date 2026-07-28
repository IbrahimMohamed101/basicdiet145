"use strict";

const {
  isWithinSubscriptionDateWindow,
} = require("./subscriptionCurrentResolverService");

const CLIENT_MEAL_BALANCE_FLAG =
  "CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED";
const CLIENT_MEAL_BALANCE_PROJECTION_VERSION =
  "client_meal_balance_projection.v1";
const CLIENT_MEAL_BALANCE_POLICY =
  "UNCONSUMED_INCLUDING_RESERVED_WITH_AVAILABLE_CAPACITY";
const ALLOCATION_STATES = new Set([
  "reserved",
  "consumed",
  "released",
  "forfeited",
]);

function nonNegativeIntegerOrNull(value) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
      ? value
      : null;
}

function isClientMealBalanceProjectionEnabled(env = process.env) {
  const value = String(env[CLIENT_MEAL_BALANCE_FLAG] || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function isProjectionEligible(subscription, businessDate) {
  return String(subscription.status || "").trim().toLowerCase() === "active"
    && typeof businessDate === "string"
    && businessDate.length > 0
    && isWithinSubscriptionDateWindow(subscription, businessDate);
}

function readLifecycleCounters(subscription) {
  const counters = {
    totalMeals: nonNegativeIntegerOrNull(subscription.totalMeals),
    availableMeals: nonNegativeIntegerOrNull(subscription.remainingMeals),
    reservedMeals: nonNegativeIntegerOrNull(subscription.reservedMeals),
    consumedMeals: nonNegativeIntegerOrNull(subscription.consumedMeals),
    forfeitedMeals: nonNegativeIntegerOrNull(subscription.forfeitedMeals),
  };
  return Object.values(counters).includes(null) ? null : counters;
}

function allocationStateCountsOrNull(baseMealAllocations) {
  if (baseMealAllocations === undefined || baseMealAllocations === null) {
    return { reserved: 0, consumed: 0, released: 0, forfeited: 0 };
  }
  if (!Array.isArray(baseMealAllocations)) return null;

  const counts = { reserved: 0, consumed: 0, released: 0, forfeited: 0 };
  const allocationKeys = new Set();
  for (const allocation of baseMealAllocations) {
    const allocationKey = typeof allocation?.allocationKey === "string"
      ? allocation.allocationKey.trim()
      : "";
    if (
      !allocationKey
      || allocationKeys.has(allocationKey)
      || allocation.quantity !== 1
      || !ALLOCATION_STATES.has(allocation.state)
    ) {
      return null;
    }
    allocationKeys.add(allocationKey);
    counts[allocation.state] += 1;
  }
  return counts;
}

function allocationsReconcile(subscription, counters) {
  const allocationCounts = allocationStateCountsOrNull(
    subscription.baseMealAllocations
  );
  // Reservation identity is authoritative. Historical/manual consumption and
  // forfeiture can be aggregate-only, so their allocation counts are upper bounds.
  return Boolean(
    allocationCounts
    && allocationCounts.reserved === counters.reservedMeals
    && allocationCounts.consumed <= counters.consumedMeals
    && allocationCounts.forfeited <= counters.forfeitedMeals
  );
}

function resolveClientMealBalanceProjection(
  subscription = {},
  { businessDate = null } = {}
) {
  if (
    !subscription
    || typeof subscription !== "object"
    || Array.isArray(subscription)
  ) {
    return null;
  }

  if (!isProjectionEligible(subscription, businessDate)) {
    return null;
  }

  const entitlementVersion = nonNegativeIntegerOrNull(
    subscription.entitlementVersion
  );
  if (entitlementVersion !== 2) {
    return null;
  }

  const counters = readLifecycleCounters(subscription);
  if (!counters || !allocationsReconcile(subscription, counters)) return null;

  const accountedMeals =
    counters.availableMeals
    + counters.reservedMeals
    + counters.consumedMeals
    + counters.forfeitedMeals;

  // Never manufacture client credit from incomplete, legacy, or corrupt
  // aggregates. The read projection is available only when all persisted
  // lifecycle counters reconcile exactly with the purchased total.
  if (accountedMeals !== counters.totalMeals) {
    return null;
  }

  return {
    ...counters,
    displayRemainingMeals:
      counters.availableMeals + counters.reservedMeals,
  };
}

function projectClientMealBalance(
  mealBalance,
  subscription,
  {
    enabled = isClientMealBalanceProjectionEnabled(),
    businessDate = null,
  } = {}
) {
  if (
    !enabled
    || !mealBalance
    || typeof mealBalance !== "object"
    || Array.isArray(mealBalance)
  ) {
    return mealBalance;
  }

  const projection = resolveClientMealBalanceProjection(subscription, {
    businessDate,
  });
  if (!projection) return mealBalance;

  if (typeof mealBalance.canConsumeNow !== "boolean") return mealBalance;
  const currentMaxConsumable = nonNegativeIntegerOrNull(
    mealBalance.maxConsumableMealsNow
  );
  if (currentMaxConsumable === null) return mealBalance;

  const canConsumeNow = mealBalance.canConsumeNow
    && projection.availableMeals > 0;
  const maxConsumableMealsNow = canConsumeNow
    ? Math.min(
      projection.availableMeals,
      currentMaxConsumable
    )
    : 0;

  return {
    ...mealBalance,
    totalMeals: projection.totalMeals,
    // Client display balance: reservations remain unconsumed until fulfillment.
    remainingMeals: projection.displayRemainingMeals,
    displayRemainingMeals: projection.displayRemainingMeals,
    // Planning/consumption capacity remains the persisted unreserved balance.
    availableMeals: projection.availableMeals,
    reservedMeals: projection.reservedMeals,
    consumedMeals: projection.consumedMeals,
    forfeitedMeals: projection.forfeitedMeals,
    canConsumeNow,
    maxConsumableMealsNow,
    mealBalancePolicy: CLIENT_MEAL_BALANCE_POLICY,
    balanceSemantics: "UNCONSUMED_INCLUDING_RESERVED",
    availableMealsSemantics: "UNRESERVED_AVAILABLE_FOR_NEW_PLANNING",
    balanceProjection: {
      version: CLIENT_MEAL_BALANCE_PROJECTION_VERSION,
      applied: true,
      remainingMealsSemantics: "UNCONSUMED_INCLUDING_RESERVED",
      availableMealsSemantics: "UNRESERVED_AVAILABLE_FOR_NEW_PLANNING",
    },
  };
}

module.exports = {
  CLIENT_MEAL_BALANCE_FLAG,
  CLIENT_MEAL_BALANCE_POLICY,
  CLIENT_MEAL_BALANCE_PROJECTION_VERSION,
  isClientMealBalanceProjectionEnabled,
  nonNegativeIntegerOrNull,
  projectClientMealBalance,
  resolveClientMealBalanceProjection,
};
