"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const {
  applyProjectedBaseMealBalance,
  projectBaseMealBalanceForRead,
  projectBaseMealBalancesForRead,
} = require("../src/services/subscription/subscriptionBaseMealBalanceReadService");

function batch({
  containerSubscriptionId,
  totalMeals = 3,
  remainingMeals = 3,
  reservedMeals = 0,
  consumedMeals = 0,
  forfeitedMeals = 0,
  effectiveStartDate = "2026-10-01",
  endDate = "2026-10-30",
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    containerSubscriptionId,
    status: "active",
    effectiveStartDate,
    validityEndDate: endDate,
    endDate,
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    mealsPerDay: 1,
  };
}

async function run() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const otherSubscriptionId = new mongoose.Types.ObjectId();
  const originalFind = SubscriptionEntitlementBatch.find;

  SubscriptionEntitlementBatch.find = () => ({
    sort() {
      return this;
    },
    lean: async () => [
      batch({ containerSubscriptionId: subscriptionId }),
      batch({
        containerSubscriptionId: otherSubscriptionId,
        totalMeals: 2,
        remainingMeals: 2,
      }),
    ],
  });

  try {
    const legacyParent = {
      _id: subscriptionId,
      userId: new mongoose.Types.ObjectId(),
      totalMeals: 10,
      remainingMeals: 0,
      reservedMeals: 0,
      consumedMeals: 10,
      forfeitedMeals: 0,
    };

    const projected = await projectBaseMealBalanceForRead(
      legacyParent,
      "2026-10-04"
    );

    assert.equal(projected.totalMeals, 3);
    assert.equal(projected.remainingMeals, 3);
    assert.equal(projected.availableMeals, 3);
    assert.equal(projected.reservedMeals, 0);
    assert.equal(projected.consumedMeals, 0);
    assert.equal(projected.mealBalanceSource, "subscription_entitlement_batches");

    const subscriptions = await projectBaseMealBalancesForRead(
      [legacyParent, {
        _id: otherSubscriptionId,
        totalMeals: 8,
        remainingMeals: 0,
        reservedMeals: 0,
        consumedMeals: 8,
        forfeitedMeals: 0,
      }],
      "2026-10-04"
    );

    assert.equal(subscriptions[0].remainingMeals, 3);
    assert.equal(subscriptions[0].availableMeals, 3);
    assert.equal(subscriptions[1].remainingMeals, 2);
    assert.equal(subscriptions[1].availableMeals, 2);

    const reservedProjection = applyProjectedBaseMealBalance(
      legacyParent,
      {
        mealBalance: {
          totalMeals: 4,
          remainingMeals: 4,
          reservedMeals: 1,
          consumedMeals: 0,
          forfeitedMeals: 0,
        },
      }
    );

    assert.equal(reservedProjection.remainingMeals, 4);
    assert.equal(reservedProjection.availableMeals, 3);
    assert.equal(reservedProjection.displayRemainingMeals, 4);

    console.log("subscription base meal balance read tests passed");
  } finally {
    SubscriptionEntitlementBatch.find = originalFind;
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
