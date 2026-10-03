"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { projectSubscriptionEntitlements } = require("./subscriptionEntitlementProjectionService");
const { isReadStackingEnabledForUser } = require("./subscriptionStackingRolloutPolicyService");

function stringId(value) {
  return value ? String(value && value._id ? value._id : value) : "";
}

function hasStackingBaseBatches(subscription, batches) {
  if (!subscription || !subscription._id || !Array.isArray(batches)) return false;
  return batches.some((batch) => (
    stringId(batch.containerSubscriptionId) === stringId(subscription._id)
  ));
}

function applyProjectedBaseMealBalance(subscription, projection) {
  if (!subscription || !projection || !projection.mealBalance) return subscription;

  const totalMeals = Math.max(0, Number(projection.mealBalance.totalMeals || 0));
  const remainingMeals = Math.max(0, Number(projection.mealBalance.remainingMeals || 0));
  const reservedMeals = Math.max(0, Number(projection.mealBalance.reservedMeals || 0));
  const consumedMeals = Math.max(0, Number(projection.mealBalance.consumedMeals || 0));
  const forfeitedMeals = Math.max(0, Number(projection.mealBalance.forfeitedMeals || 0));
  const availableMeals = Math.max(0, remainingMeals - reservedMeals);

  return {
    ...subscription,
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    mealBalanceSource: "subscription_entitlement_batches",
    availableMeals,
    displayRemainingMeals: remainingMeals,
  };
}

async function projectBaseMealBalanceForRead(
  subscription,
  businessDate,
  { requireRollout = false } = {}
) {
  if (!subscription || !subscription._id) return subscription;

  if (
    requireRollout
    && !isReadStackingEnabledForUser(stringId(subscription.userId))
  ) {
    return subscription;
  }

  const batches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: subscription._id,
    status: { $in: ["paid_scheduled", "active", "exhausted", "expired", "canceled"] },
  })
    .sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 })
    .lean();

  if (!hasStackingBaseBatches(subscription, batches)) return subscription;

  const projection = projectSubscriptionEntitlements({
    batches,
    businessDate,
  });

  // Do not replace a valid legacy balance with an empty/incomplete projection.
  if (!projection || projection.batchCount === 0) return subscription;

  return applyProjectedBaseMealBalance(subscription, projection);
}

async function projectBaseMealBalancesForRead(
  subscriptions,
  businessDate,
  { requireRollout = false } = {}
) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return subscriptions || [];

  const ids = subscriptions
    .map((subscription) => subscription && subscription._id)
    .filter(Boolean);

  if (!ids.length) return subscriptions;

  const batches = await SubscriptionEntitlementBatch.find({
    containerSubscriptionId: { $in: ids },
    status: { $in: ["paid_scheduled", "active", "exhausted", "expired", "canceled"] },
  })
    .sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 })
    .lean();

  const batchesByContainer = new Map();
  for (const batch of batches) {
    const key = stringId(batch.containerSubscriptionId);
    if (!key) continue;
    const rows = batchesByContainer.get(key) || [];
    rows.push(batch);
    batchesByContainer.set(key, rows);
  }

  return subscriptions.map((subscription) => {
    if (!subscription || !subscription._id) return subscription;
    if (
      requireRollout
      && !isReadStackingEnabledForUser(stringId(subscription.userId))
    ) {
      return subscription;
    }

    const rows = batchesByContainer.get(stringId(subscription._id)) || [];
    if (!rows.length) return subscription;

    const projection = projectSubscriptionEntitlements({
      batches: rows,
      businessDate,
    });
    if (!projection || projection.batchCount === 0) return subscription;

    return applyProjectedBaseMealBalance(subscription, projection);
  });
}

module.exports = {
  applyProjectedBaseMealBalance,
  projectBaseMealBalanceForRead,
  projectBaseMealBalancesForRead,
};
