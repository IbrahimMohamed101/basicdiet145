"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const {
  checkEntitlementInvariants,
  reserveDayEntitlements,
  transitionAllocation,
} = require("../src/services/subscription/subscriptionMealEntitlementService");

const PREMIUM_KEY = "premium_large_salad";

async function createSubscription(premiumBalance) {
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-07-19T00:00:00.000Z"),
    endDate: new Date("2026-07-26T00:00:00.000Z"),
    validityEndDate: new Date("2026-07-26T00:00:00.000Z"),
    totalMeals: 7,
    remainingMeals: 7,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    baseMealAllocations: [],
    premiumBalance,
    selectedGrams: 100,
    selectedMealsPerDay: 1,
    mealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
  });
}

function premiumBucket({
  configId,
  proteinId,
  purchasedAt,
  remainingQty = 1,
  reservedQty = 0,
  consumedQty = 0,
}) {
  return {
    configId,
    revision: 3,
    premiumKey: PREMIUM_KEY,
    proteinId,
    kind: "product",
    entityType: "premium_large_salad",
    selectionType: "premium_large_salad",
    sourceType: "menu_product",
    sourceId: "premium-large-salad-source",
    sourceProductId: "premium-large-salad-product",
    sourceGroupId: "",
    sourceGroupKey: "",
    sourceKey: PREMIUM_KEY,
    purchasedQty: 1,
    remainingQty,
    reservedQty,
    consumedQty,
    unitExtraFeeHalala: 2900,
    currency: "SAR",
    purchasedAt,
  };
}

function premiumDay({ configId, date }) {
  return {
    _id: new mongoose.Types.ObjectId(),
    date,
    plannerRevisionHash: `${date}-premium-revision`,
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "premium_large_salad",
      isPremium: true,
      premiumKey: PREMIUM_KEY,
      premiumSource: "balance",
      configId,
      revision: 3,
    }],
    premiumUpgradeSelections: [{
      baseSlotKey: "slot_1",
      premiumKey: PREMIUM_KEY,
      premiumSource: "balance",
      source: "subscription",
      coveredQty: 1,
      paidQty: 0,
      configId,
      revision: 3,
    }],
  };
}

function bucketById(subscription, bucketId) {
  return subscription.premiumBalance.find((row) => String(row._id) === String(bucketId));
}

async function verifyEquivalentBucketsUseOldestCredit() {
  const configId = new mongoose.Types.ObjectId();
  const proteinId = new mongoose.Types.ObjectId();
  const subscription = await createSubscription([
    premiumBucket({
      configId,
      proteinId,
      purchasedAt: new Date("2026-07-01T00:00:00.000Z"),
    }),
    premiumBucket({
      configId,
      proteinId,
      purchasedAt: new Date("2026-07-10T00:00:00.000Z"),
    }),
  ]);
  const oldestBucketId = subscription.premiumBalance[0]._id;
  const newerBucketId = subscription.premiumBalance[1]._id;

  const reservation = await reserveDayEntitlements({
    subscriptionId: subscription._id,
    day: premiumDay({ configId, date: "2026-07-20" }),
  });
  assert.equal(reservation.allocationKeys.length, 1);

  const afterReserve = await Subscription.findById(subscription._id).lean();
  const allocation = afterReserve.baseMealAllocations[0];
  assert.equal(afterReserve.remainingMeals, 6);
  assert.equal(afterReserve.reservedMeals, 1);
  assert.equal(String(allocation.premiumFunding.balanceBucketId), String(oldestBucketId));
  assert.equal(bucketById(afterReserve, oldestBucketId).remainingQty, 0);
  assert.equal(bucketById(afterReserve, oldestBucketId).reservedQty, 1);
  assert.equal(bucketById(afterReserve, newerBucketId).remainingQty, 1);

  await transitionAllocation({
    subscriptionId: subscription._id,
    allocationKey: reservation.allocationKeys[0],
    toState: "consumed",
  });
  const afterConsume = await Subscription.findById(subscription._id).lean();
  assert.equal(afterConsume.remainingMeals, 6);
  assert.equal(afterConsume.reservedMeals, 0);
  assert.equal(afterConsume.consumedMeals, 1);
  assert.equal(bucketById(afterConsume, oldestBucketId).reservedQty, 0);
  assert.equal(bucketById(afterConsume, oldestBucketId).consumedQty, 1);
  assert.equal(checkEntitlementInvariants(afterConsume).valid, true);
}

async function verifyExhaustedEquivalentBucketIsSkipped() {
  const configId = new mongoose.Types.ObjectId();
  const proteinId = new mongoose.Types.ObjectId();
  const subscription = await createSubscription([
    premiumBucket({
      configId,
      proteinId,
      purchasedAt: new Date("2026-07-01T00:00:00.000Z"),
      remainingQty: 0,
      consumedQty: 1,
    }),
    premiumBucket({
      configId,
      proteinId,
      purchasedAt: new Date("2026-07-10T00:00:00.000Z"),
    }),
  ]);
  const spendableBucketId = subscription.premiumBalance[1]._id;

  await reserveDayEntitlements({
    subscriptionId: subscription._id,
    day: premiumDay({ configId, date: "2026-07-21" }),
  });
  const refreshed = await Subscription.findById(subscription._id).lean();
  assert.equal(String(refreshed.baseMealAllocations[0].premiumFunding.balanceBucketId), String(spendableBucketId));
  assert.equal(bucketById(refreshed, subscription.premiumBalance[0]._id).consumedQty, 1);
  assert.equal(bucketById(refreshed, spendableBucketId).remainingQty, 0);
  assert.equal(bucketById(refreshed, spendableBucketId).reservedQty, 1);
  assert.equal(checkEntitlementInvariants(refreshed).valid, true);
}

async function verifyNonEquivalentBucketsStillFailClosed() {
  const configId = new mongoose.Types.ObjectId();
  const subscription = await createSubscription([
    premiumBucket({
      configId,
      proteinId: new mongoose.Types.ObjectId(),
      purchasedAt: new Date("2026-07-01T00:00:00.000Z"),
    }),
    premiumBucket({
      configId,
      proteinId: new mongoose.Types.ObjectId(),
      purchasedAt: new Date("2026-07-10T00:00:00.000Z"),
    }),
  ]);

  await assert.rejects(
    reserveDayEntitlements({
      subscriptionId: subscription._id,
      day: premiumDay({ configId, date: "2026-07-22" }),
    }),
    (err) => err && err.code === "DATA_INTEGRITY_ERROR"
  );

  const refreshed = await Subscription.findById(subscription._id).lean();
  assert.equal(refreshed.remainingMeals, 7);
  assert.equal(refreshed.reservedMeals, 0);
  assert.equal(refreshed.baseMealAllocations.length, 0);
  assert.equal(refreshed.premiumBalance.every((row) => row.remainingQty === 1), true);
  assert.equal(checkEntitlementInvariants(refreshed).valid, true);
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri(), { serverSelectionTimeoutMS: 10000 });
    await verifyEquivalentBucketsUseOldestCredit();
    await verifyExhaustedEquivalentBucketIsSkipped();
    await verifyNonEquivalentBucketsStillFailClosed();
    console.log("subscriptionPremiumBalanceBucketIdentityRecovery.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
