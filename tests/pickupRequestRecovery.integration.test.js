"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const Subscription = require("../src/models/Subscription");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  reservePickupEntitlements,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  recoverIncompletePickupReservation,
} = require("../src/services/subscription/subscriptionPickupRequestRecoveryService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function createSubscription({ remainingMeals = 4 } = {}) {
  return Subscription.create({
    userId: oid(),
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-31T00:00:00.000Z"),
    totalMeals: remainingMeals,
    remainingMeals,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    deliveryMode: "pickup",
  });
}

async function createIncompleteRequest(subscription, {
  mealCount = 1,
  status = "in_preparation",
  key = `pickup-recovery-${Date.now()}-${Math.random()}`,
} = {}) {
  return SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    userId: subscription.userId,
    date: "2026-07-22",
    mealCount,
    status,
    selectionMode: "legacy_meal_count",
    idempotencyKey: key,
    creditsReserved: false,
    reservationState: "pending",
  });
}

async function wallet(subscriptionId) {
  return Subscription.findById(subscriptionId).lean();
}

async function testNormalRecovery() {
  const subscription = await createSubscription({ remainingMeals: 4 });
  const request = await createIncompleteRequest(subscription, { mealCount: 1 });

  const first = await recoverIncompletePickupReservation({
    pickupRequestId: request._id,
    subscriptionId: subscription._id,
  });
  assert.strictEqual(first.recovered, true);
  assert.strictEqual(first.pickupRequest.creditsReserved, true);
  assert.strictEqual(first.pickupRequest.reservationState, "reserved");
  assert.strictEqual(first.pickupRequest.baseAllocationMode, "standalone");
  assert.strictEqual(first.pickupRequest.baseAllocationKeys.length, 1);

  let current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 3);
  assert.strictEqual(Number(current.reservedMeals), 1);
  assert.strictEqual(current.baseMealAllocations.length, 1);

  const replay = await recoverIncompletePickupReservation({
    pickupRequestId: request._id,
    subscriptionId: subscription._id,
  });
  assert.strictEqual(replay.recovered, false);
  assert.strictEqual(replay.alreadyComplete, true);

  current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 3, "replay must not deduct a second meal");
  assert.strictEqual(Number(current.reservedMeals), 1);
  assert.strictEqual(current.baseMealAllocations.length, 1);
}

async function testCrashAfterAllocationBeforeRequestUpdate() {
  const subscription = await createSubscription({ remainingMeals: 4 });
  const request = await createIncompleteRequest(subscription, { mealCount: 1 });

  const orphanReservation = await reservePickupEntitlements({
    subscriptionId: subscription._id,
    pickupRequest: request,
  });
  assert.strictEqual(orphanReservation.newlyReservedKeys.length, 1);

  let current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 3);
  assert.strictEqual(Number(current.reservedMeals), 1);
  assert.strictEqual(current.baseMealAllocations.length, 1);

  const recovered = await recoverIncompletePickupReservation({
    pickupRequestId: request._id,
    subscriptionId: subscription._id,
  });
  assert.strictEqual(recovered.pickupRequest.creditsReserved, true);
  assert.strictEqual(recovered.pickupRequest.baseAllocationKeys.length, 1);

  current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 3, "orphan allocation recovery must reuse the deterministic key");
  assert.strictEqual(Number(current.reservedMeals), 1);
  assert.strictEqual(current.baseMealAllocations.length, 1);
}

async function testConcurrentRecovery() {
  const subscription = await createSubscription({ remainingMeals: 4 });
  const request = await createIncompleteRequest(subscription, { mealCount: 1 });

  const results = await Promise.all([
    recoverIncompletePickupReservation({ pickupRequestId: request._id, subscriptionId: subscription._id }),
    recoverIncompletePickupReservation({ pickupRequestId: request._id, subscriptionId: subscription._id }),
  ]);
  assert(results.every((result) => result.pickupRequest.creditsReserved === true));

  const current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 3);
  assert.strictEqual(Number(current.reservedMeals), 1);
  assert.strictEqual(current.baseMealAllocations.length, 1);

  const savedRequest = await SubscriptionPickupRequest.findById(request._id).lean();
  assert.strictEqual(savedRequest.reservationState, "reserved");
  assert(savedRequest.reservationAttemptCount >= 1);
}

async function testZeroMealRecovery() {
  const subscription = await createSubscription({ remainingMeals: 4 });
  const request = await createIncompleteRequest(subscription, { mealCount: 0 });
  const result = await recoverIncompletePickupReservation({
    pickupRequestId: request._id,
    subscriptionId: subscription._id,
  });
  assert.strictEqual(result.alreadyComplete, true);
  assert.strictEqual(result.pickupRequest.creditsReserved, true);
  assert.strictEqual(result.pickupRequest.reservationState, "reserved");

  const current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 4);
  assert.strictEqual(Number(current.reservedMeals), 0);
}

async function testTerminalIncompleteRequestRejected() {
  const subscription = await createSubscription({ remainingMeals: 4 });
  const request = await createIncompleteRequest(subscription, {
    mealCount: 1,
    status: "canceled",
  });

  await assert.rejects(
    () => recoverIncompletePickupReservation({
      pickupRequestId: request._id,
      subscriptionId: subscription._id,
    }),
    (err) => err && err.code === "INCOMPLETE_TERMINAL_PICKUP_RESERVATION"
  );

  const current = await wallet(subscription._id);
  assert.strictEqual(Number(current.remainingMeals), 4);
  assert.strictEqual(Number(current.reservedMeals), 0);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `pickup-recovery-${Date.now()}` });
    await testNormalRecovery();
    await mongoose.connection.dropDatabase();
    await testCrashAfterAllocationBeforeRequestUpdate();
    await mongoose.connection.dropDatabase();
    await testConcurrentRecovery();
    await mongoose.connection.dropDatabase();
    await testZeroMealRecovery();
    await mongoose.connection.dropDatabase();
    await testTerminalIncompleteRequestRejected();
    console.log("pickup request reservation recovery checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
