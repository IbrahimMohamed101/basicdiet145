"use strict";

const CLIENT_MEAL_BALANCE_FLAG =
  "CLIENT_UNCONSUMED_MEAL_BALANCE_ENABLED";
const CLIENT_MEAL_BALANCE_PROJECTION_VERSION =
  "client_meal_balance_projection.v1";
const CLIENT_MEAL_BALANCE_POLICY =
  "UNCONSUMED_INCLUDING_RESERVED_WITH_AVAILABLE_CAPACITY";

function nonNegativeIntegerOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isClientMealBalanceProjectionEnabled(env = process.env) {
  const value = String(env[CLIENT_MEAL_BALANCE_FLAG] || "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function resolveClientMealBalanceProjection(subscription = {}) {
  if (
    !subscription
    || typeof subscription !== "object"
    || Array.isArray(subscription)
  ) {
    return null;
  }

  if (String(subscription.status || "").trim().toLowerCase() !== "active") {
    return null;
  }

  const entitlementVersion = nonNegativeIntegerOrNull(
    subscription.entitlementVersion
  );
  if (entitlementVersion === null || entitlementVersion < 2) {
    return null;
  }

  const totalMeals = nonNegativeIntegerOrNull(subscription.totalMeals);
  const availableMeals = nonNegativeIntegerOrNull(
    subscription.remainingMeals
  );
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

  // Never manufacture client credit from incomplete, legacy, or corrupt
  // aggregates. The read projection is available only when all persisted
  // lifecycle counters reconcile exactly with the purchased total.
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

function projectClientMealBalance(
  mealBalance,
  subscription,
  { enabled = isClientMealBalanceProjectionEnabled() } = {}
) {
  if (
    !enabled
    || !mealBalance
    || typeof mealBalance !== "object"
    || Array.isArray(mealBalance)
  ) {
    return mealBalance;
  }

  const projection = resolveClientMealBalanceProjection(subscription);
  if (!projection) return mealBalance;

  const canConsumeNow = Boolean(mealBalance.canConsumeNow)
    && projection.availableMeals > 0;
  const currentMaxConsumable = nonNegativeIntegerOrNull(
    mealBalance.maxConsumableMealsNow
  );
  const maxConsumableMealsNow = canConsumeNow
    ? Math.min(
      projection.availableMeals,
      currentMaxConsumable === null
        ? projection.availableMeals
        : currentMaxConsumable
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
