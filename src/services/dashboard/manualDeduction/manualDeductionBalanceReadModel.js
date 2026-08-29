"use strict";

const {
  resolveDashboardMealBalanceProjection,
} = require("../../subscription/subscriptionDashboardMealBalanceProjectionService");
const { resolveBalances } = require("./manualDeductionPolicy");

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function buildManualDeductionBalanceReadModel(subscription = {}, suppliedBalances = null) {
  const balances = suppliedBalances || resolveBalances(subscription);
  const entitlementVersion = nonNegativeInteger(subscription.entitlementVersion);
  const availableMeals = nonNegativeInteger(balances.remainingMeals);
  const reservedMeals = entitlementVersion >= 2
    ? nonNegativeInteger(subscription.reservedMeals)
    : 0;
  const deductibleMeals = availableMeals + reservedMeals;
  const consumedMeals = nonNegativeInteger(balances.consumedMeals);
  const forfeitedMeals = entitlementVersion >= 2
    ? nonNegativeInteger(subscription.forfeitedMeals)
    : 0;
  const totalMeals = nonNegativeInteger(balances.totalMeals);
  const accountedMeals = availableMeals + reservedMeals + consumedMeals + forfeitedMeals;
  const equationDifference = totalMeals - accountedMeals;
  const projection = resolveDashboardMealBalanceProjection(subscription);
  const projectionApplied = Boolean(projection);
  const displayRemainingMeals = projectionApplied
    ? nonNegativeInteger(projection.displayRemainingMeals)
    : availableMeals;

  return {
    totalMeals,
    displayRemainingMeals,
    availableMeals,
    reservedMeals,
    deductibleMeals,
    consumedMeals,
    forfeitedMeals,
    accountedMeals,
    equationDifference,
    balanced: entitlementVersion < 2 || equationDifference === 0,
    projectionApplied,
    canManualDeduct: deductibleMeals > 0,
    manualDeductionMaxMeals: deductibleMeals,
    displaySemantics: projectionApplied
      ? "UNCONSUMED_INCLUDING_RESERVED"
      : "AVAILABLE_ONLY_FAIL_CLOSED",
    availableSemantics: "UNRESERVED_AVAILABLE",
    manualDeductionSemantics: "UNCONSUMED_AVAILABLE_PLUS_RESERVED",
  };
}

module.exports = {
  buildManualDeductionBalanceReadModel,
  nonNegativeInteger,
};
