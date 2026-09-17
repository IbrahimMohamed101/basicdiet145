"use strict";

const assert = require("node:assert");
const mongoose = require("mongoose");
const Subscription = require("../src/models/Subscription");
const {
  applyLegacyPickupRelease,
  legacyPickupReleaseKey,
} = require("../src/services/subscription/subscriptionLegacyMealBalanceOperationService");

function queryResult(value) {
  return {
    select() { return this; },
    session() { return this; },
    lean() { return Promise.resolve(value); },
  };
}

async function run() {
  const originals = {
    findById: Subscription.findById,
    findOneAndUpdate: Subscription.findOneAndUpdate,
  };
  const subscriptionId = new mongoose.Types.ObjectId();
  const pickupRequestId = new mongoose.Types.ObjectId();
  const operationKey = legacyPickupReleaseKey(pickupRequestId);
  const canonical = {
    _id: subscriptionId,
    entitlementVersion: 2,
    totalMeals: 5,
    remainingMeals: 3,
    reservedMeals: 0,
    consumedMeals: 2,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    premiumBalance: [],
    legacyMealBalanceOperationKeys: [],
  };
  let captured = null;

  try {
    Subscription.findById = () => queryResult(canonical);
    Subscription.findOneAndUpdate = (filter, update, options) => {
      captured = { filter, update, options };
      return queryResult({
        ...canonical,
        remainingMeals: 4,
        consumedMeals: 1,
        legacyMealBalanceOperationKeys: [operationKey],
      });
    };

    const first = await applyLegacyPickupRelease({
      subscriptionId,
      pickupRequestId,
      mealCount: 1,
    });
    assert.strictEqual(first.applied, true);
    assert.deepStrictEqual(captured.update.$inc, { remainingMeals: 1, consumedMeals: -1 });
    assert.deepStrictEqual(captured.update.$addToSet, { legacyMealBalanceOperationKeys: operationKey });
    assert.deepStrictEqual(captured.filter.$expr, {
      $lte: [{ $add: ["$remainingMeals", 1] }, "$totalMeals"],
    });

    const replayed = {
      ...canonical,
      remainingMeals: 4,
      consumedMeals: 1,
      legacyMealBalanceOperationKeys: [operationKey],
    };
    Subscription.findById = () => queryResult(replayed);
    Subscription.findOneAndUpdate = () => queryResult(null);
    const replay = await applyLegacyPickupRelease({
      subscriptionId,
      pickupRequestId,
      mealCount: 1,
    });
    assert.strictEqual(replay.applied, false);
    assert.strictEqual(replay.alreadyApplied, true);
    assert.strictEqual(replay.subscription.remainingMeals, 4);

    console.log("legacy pickup meal-balance operation tests passed");
  } finally {
    Subscription.findById = originals.findById;
    Subscription.findOneAndUpdate = originals.findOneAndUpdate;
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
