"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "premium-bucket-identity-test-secret";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  checkEntitlementInvariants,
  reserveDayEntitlements,
  transitionDayEntitlements,
} = require("../src/services/subscription/subscriptionMealEntitlementService");

const DB_NAME = `premium_bucket_identity_${Date.now()}`;
let mongoServer;

function premiumSlot(proteinId) {
  return {
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: "premium_large_salad",
    proteinId,
    salad: {
      presetKey: "premium_large_salad",
      groups: {
        protein: [proteinId],
        sauce: [new mongoose.Types.ObjectId()],
      },
    },
    isPremium: true,
    premiumKey: "premium_large_salad",
    premiumSource: "balance",
    premiumExtraFeeHalala: 0,
  };
}

async function createSubscription(premiumBalance) {
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    validityEndDate: new Date("2026-07-31T00:00:00.000Z"),
    totalMeals: 7,
    remainingMeals: 7,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
    premiumBalance,
  });
}

async function createPremiumDay(subscription, {
  date,
  configId = null,
  revision = 0,
} = {}) {
  const proteinId = new mongoose.Types.ObjectId();
  return SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status: "open",
    plannerState: "draft",
    plannerRevisionHash: `revision-${date}`,
    mealSlots: [premiumSlot(proteinId)],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      premiumSlotCount: 1,
      premiumCoveredByBalanceCount: 1,
      premiumPendingPaymentCount: 0,
      isDraftValid: true,
      isConfirmable: true,
    },
    premiumUpgradeSelections: [{
      baseSlotKey: "slot_1",
      proteinId,
      premiumKey: "premium_large_salad",
      configId,
      revision,
      selectionType: "premium_large_salad",
      premiumSource: "balance",
      source: "subscription",
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
    }],
  });
}

async function testEquivalentBucketsResolveDeterministically() {
  const configId = new mongoose.Types.ObjectId();
  const immutableIdentity = {
    configId,
    revision: 3,
    premiumKey: "premium_large_salad",
    entityType: "premium_large_salad",
    selectionType: "premium_large_salad",
    sourceType: "menu_product",
    sourceId: "premium_large_salad_product",
    sourceProductId: "premium_large_salad_product",
    sourceKey: "premium_large_salad",
    unitExtraFeeHalala: 2900,
    currency: "SAR",
    purchasedQty: 1,
    remainingQty: 1,
    reservedQty: 0,
    consumedQty: 0,
  };
  const subscription = await createSubscription([{
    ...immutableIdentity,
    purchasedAt: new Date("2026-07-01T00:00:00.000Z"),
  }, {
    ...immutableIdentity,
    purchasedAt: new Date("2026-07-02T00:00:00.000Z"),
  }]);
  const seeded = await Subscription.findById(subscription._id).lean();
  const oldestBucket = [...seeded.premiumBalance]
    .sort((left, right) => new Date(left.purchasedAt) - new Date(right.purchasedAt))[0];
  const otherBucket = seeded.premiumBalance.find((row) => String(row._id) !== String(oldestBucket._id));
  const day = await createPremiumDay(subscription, {
    date: "2026-07-20",
    configId,
    revision: 3,
  });

  const reservation = await reserveDayEntitlements({
    subscriptionId: subscription._id,
    day,
  });
  assert.strictEqual(reservation.allocationKeys.length, 1);
  assert.strictEqual(reservation.newlyReservedKeys.length, 1);

  const afterReserve = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(afterReserve.remainingMeals, 6);
  assert.strictEqual(afterReserve.reservedMeals, 1);
  assert.strictEqual(afterReserve.baseMealAllocations.length, 1);
  assert.strictEqual(
    String(afterReserve.baseMealAllocations[0].premiumFunding.balanceBucketId),
    String(oldestBucket._id),
    "the oldest equivalent Premium bucket must be selected and persisted"
  );

  const reservedBucket = afterReserve.premiumBalance.find((row) => String(row._id) === String(oldestBucket._id));
  const untouchedBucket = afterReserve.premiumBalance.find((row) => String(row._id) === String(otherBucket._id));
  assert.deepStrictEqual(
    { remainingQty: reservedBucket.remainingQty, reservedQty: reservedBucket.reservedQty, consumedQty: reservedBucket.consumedQty },
    { remainingQty: 0, reservedQty: 1, consumedQty: 0 }
  );
  assert.deepStrictEqual(
    { remainingQty: untouchedBucket.remainingQty, reservedQty: untouchedBucket.reservedQty, consumedQty: untouchedBucket.consumedQty },
    { remainingQty: 1, reservedQty: 0, consumedQty: 0 }
  );
  assert.strictEqual(checkEntitlementInvariants(afterReserve).valid, true);

  const persistedDay = await SubscriptionDay.findById(day._id).lean();
  const consumed = await transitionDayEntitlements({
    subscriptionId: subscription._id,
    day: persistedDay,
    toState: "consumed",
  });
  assert.strictEqual(consumed.changedCount, 1);

  const afterConsume = await Subscription.findById(subscription._id).lean();
  const consumedBucket = afterConsume.premiumBalance.find((row) => String(row._id) === String(oldestBucket._id));
  const stillUntouchedBucket = afterConsume.premiumBalance.find((row) => String(row._id) === String(otherBucket._id));
  assert.deepStrictEqual(
    { remainingQty: consumedBucket.remainingQty, reservedQty: consumedBucket.reservedQty, consumedQty: consumedBucket.consumedQty },
    { remainingQty: 0, reservedQty: 0, consumedQty: 1 }
  );
  assert.deepStrictEqual(
    { remainingQty: stillUntouchedBucket.remainingQty, reservedQty: stillUntouchedBucket.reservedQty, consumedQty: stillUntouchedBucket.consumedQty },
    { remainingQty: 1, reservedQty: 0, consumedQty: 0 }
  );
  assert.strictEqual(afterConsume.remainingMeals, 6);
  assert.strictEqual(afterConsume.reservedMeals, 0);
  assert.strictEqual(afterConsume.consumedMeals, 1);
  assert.strictEqual(checkEntitlementInvariants(afterConsume).valid, true);
}

async function testDifferentIdentitiesStillFailClosed() {
  const subscription = await createSubscription([{
    configId: new mongoose.Types.ObjectId(),
    revision: 1,
    premiumKey: "premium_large_salad",
    entityType: "premium_large_salad",
    selectionType: "premium_large_salad",
    sourceType: "menu_product",
    sourceProductId: "premium_large_salad_v1",
    purchasedQty: 1,
    remainingQty: 1,
    reservedQty: 0,
    consumedQty: 0,
    unitExtraFeeHalala: 2900,
    currency: "SAR",
  }, {
    configId: new mongoose.Types.ObjectId(),
    revision: 2,
    premiumKey: "premium_large_salad",
    entityType: "premium_large_salad",
    selectionType: "premium_large_salad",
    sourceType: "menu_product",
    sourceProductId: "premium_large_salad_v2",
    purchasedQty: 1,
    remainingQty: 1,
    reservedQty: 0,
    consumedQty: 0,
    unitExtraFeeHalala: 2900,
    currency: "SAR",
  }]);
  const day = await createPremiumDay(subscription, {
    date: "2026-07-21",
    configId: null,
    revision: 0,
  });

  await assert.rejects(
    () => reserveDayEntitlements({ subscriptionId: subscription._id, day }),
    (error) => error && error.code === "DATA_INTEGRITY_ERROR"
  );

  const persisted = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(persisted.remainingMeals, 7);
  assert.strictEqual(persisted.reservedMeals, 0);
  assert.strictEqual(persisted.baseMealAllocations.length, 0);
  assert.strictEqual(persisted.premiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0), 2);
  assert.strictEqual(checkEntitlementInvariants(persisted).valid, true);
}

async function run() {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });
  await mongoose.connect(mongoServer.getUri(DB_NAME), { serverSelectionTimeoutMS: 10000 });

  try {
    await testEquivalentBucketsResolveDeterministically();
    await mongoose.connection.db.dropDatabase();
    await testDifferentIdentitiesStillFailClosed();
    console.log("subscriptionPremiumBucketIdentityResolution.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
