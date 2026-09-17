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
  const projection = resolveDashboardMealBalanceProjection(subscription);
  const projectedStackingBalance = projection
    && subscription.stacking
    && subscription.stacking.hasEntitlementBatches === true
    && subscription.stacking.aggregateBalance
    && typeof subscription.stacking.aggregateBalance === "object"
    ? projection
    : null;

  // Stacked entitlement batches are the authoritative balance. Never fall back
  // to the legacy parent subscription counters when their aggregate is present.
  const balances = suppliedBalances || resolveBalances(subscription);
  const entitlementVersion = nonNegativeInteger(subscription.entitlementVersion);
  const availableMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.availableMeals)
    : nonNegativeInteger(balances.remainingMeals);
  const reservedMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.reservedMeals)
    : (entitlementVersion >= 2 ? nonNegativeInteger(subscription.reservedMeals) : 0);
  const deductibleMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.displayRemainingMeals)
    : availableMeals + reservedMeals;
  const consumedMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.consumedMeals)
    : nonNegativeInteger(balances.consumedMeals);
  const forfeitedMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.forfeitedMeals)
    : (entitlementVersion >= 2 ? nonNegativeInteger(subscription.forfeitedMeals) : 0);
  const totalMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.totalMeals)
    : nonNegativeInteger(balances.totalMeals);
  const accountedMeals = availableMeals + reservedMeals + consumedMeals + forfeitedMeals;
  const equationDifference = totalMeals - accountedMeals;
  const projectionApplied = Boolean(projectedStackingBalance || projection);
  const displayRemainingMeals = projectedStackingBalance
    ? nonNegativeInteger(projectedStackingBalance.displayRemainingMeals)
    : (projectionApplied
      ? nonNegativeInteger(projection.displayRemainingMeals)
      : availableMeals);

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
    balanced: Boolean(projectedStackingBalance) || entitlementVersion < 2 || equationDifference === 0,
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
