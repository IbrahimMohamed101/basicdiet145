"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Subscription = require("../../src/models/Subscription");
const SubscriptionPickupRequest = require("../../src/models/SubscriptionPickupRequest");
const {
  releaseReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
} = require("../../src/services/subscription/subscriptionPickupRequestBalanceClosureService");
const {
  reservePickupEntitlements,
} = require("../../src/services/subscription/subscriptionMealEntitlementService");
const {
  fulfillSubscriptionPickupRequest,
} = require("../../src/services/fulfillmentService");
const {
  settlePickupRequestAsUncollected,
} = require("../../src/services/subscription/subscriptionPickupCycleAuthorityService");
const {
  applyLegacyPickupRelease,
} = require("../../src/services/subscription/subscriptionLegacyMealBalanceOperationService");

function baseAllocation({ dayId, requestId = null, state = "reserved", slotKey = "slot_1" }) {
  return {
    allocationKey: `allocation_${String(dayId)}_${slotKey}`,
    dayId,
    date: "2026-07-21",
    slotKey,
    plannerRevisionHash: "revision_1",
    quantity: 1,
    state,
    reservedAt: new Date(),
    releasedAt: state === "released" ? new Date() : null,
    pickupRequestId: requestId,
    premiumFunding: {
      source: "none",
      state: "none",
      premiumKey: "",
    },
  };
}

async function insertSubscription({
  subscriptionId,
  allocations = [],
  totalMeals = 10,
  remainingMeals = 9,
  reservedMeals = 1,
}) {
  await Subscription.collection.insertOne({
    _id: subscriptionId,
    userId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    baseMealAllocations: allocations,
    premiumBalance: [],
    addonBalance: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function createRequest({
  subscriptionId,
  dayId,
  userId,
  slotId = "slot_1",
  mealCount = 1,
  status = "in_preparation",
  creditsReserved = false,
  creditsReleasedAt = null,
}) {
  return SubscriptionPickupRequest.create({
    subscriptionId,
    subscriptionDayId: dayId,
    userId,
    date: "2026-07-21",
    mealCount,
    selectedMealSlotIds: mealCount ? [slotId] : [],
    selectedPickupItemIds: mealCount ? [slotId] : [],
    selectedPickupItems: mealCount ? [{
      itemId: slotId,
      itemType: "meal",
      source: "mealSlot",
      sourceId: slotId,
      slotId,
      slotKey: slotId,
      slotIndex: 1,
      selectionType: "full_meal_product",
    }] : [],
    selectionMode: "pickup_item_ids",
    status,
    creditsReserved,
    creditsReleasedAt,
  });
}

async function readAllocation(subscriptionId, allocationKey) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  const allocation = (subscription.baseMealAllocations || [])
    .find((entry) => entry.allocationKey === allocationKey);
  return { subscription, allocation };
}

async function testLinkedLifecycle() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const allocation = baseAllocation({ dayId });
  await insertSubscription({ subscriptionId, allocations: [allocation] });

  const first = await createRequest({ subscriptionId, dayId, userId });
  const reserved = await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: first._id,
    mealCount: 1,
  });
  assert.strictEqual(reserved.reserved, true);
  assert.strictEqual(reserved.pickupRequest.baseAllocationMode, "linked_day");

  let state = await readAllocation(subscriptionId, allocation.allocationKey);
  assert.strictEqual(state.subscription.remainingMeals, 9);
  assert.strictEqual(state.subscription.reservedMeals, 1);
  assert.strictEqual(String(state.allocation.pickupRequestId), String(first._id));
  assert.strictEqual(state.allocation.state, "reserved");

  const released = await releaseReservedPickupMeals({
    subscriptionId,
    pickupRequestId: first._id,
  });
  assert.strictEqual(released.released, true);
  assert.strictEqual(released.pickupRequest.baseAllocationMode, "linked_day");

  state = await readAllocation(subscriptionId, allocation.allocationKey);
  assert.strictEqual(state.subscription.remainingMeals, 9, "canceling linked pickup must not refund the planned meal");
  assert.strictEqual(state.subscription.reservedMeals, 1);
  assert.strictEqual(state.allocation.state, "reserved");
  assert.strictEqual(state.allocation.pickupRequestId, null);

  const second = await createRequest({ subscriptionId, dayId, userId });
  const secondReserved = await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: second._id,
    mealCount: 1,
  });
  assert.strictEqual(secondReserved.reserved, true);

  const competing = await createRequest({ subscriptionId, dayId, userId });
  await assert.rejects(
    () => reserveSubscriptionMealsForPickupRequest({
      subscriptionId,
      pickupRequestId: competing._id,
      mealCount: 1,
    }),
    (err) => err && err.code === "MEAL_SLOT_UNAVAILABLE" && err.status === 409
  );
}

async function testHistoricalReleasedAllocationRepair() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const oldRequestId = new mongoose.Types.ObjectId();
  const allocation = baseAllocation({
    dayId,
    requestId: oldRequestId,
    state: "released",
  });
  await insertSubscription({
    subscriptionId,
    allocations: [allocation],
    remainingMeals: 10,
    reservedMeals: 0,
  });

  await SubscriptionPickupRequest.collection.insertOne({
    _id: oldRequestId,
    subscriptionId,
    subscriptionDayId: dayId,
    userId,
    date: "2026-07-21",
    mealCount: 1,
    selectedMealSlotIds: ["slot_1"],
    selectedPickupItemIds: ["slot_1"],
    status: "canceled",
    creditsReserved: true,
    creditsReleasedAt: new Date(),
    baseAllocationKeys: [allocation.allocationKey],
    baseAllocationMode: "linked_day",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const request = await createRequest({ subscriptionId, dayId, userId });
  const result = await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(result.reserved, true);
  assert.strictEqual(result.pickupRequest.baseAllocationMode, "linked_day");

  const state = await readAllocation(subscriptionId, allocation.allocationKey);
  assert.strictEqual(state.subscription.remainingMeals, 9, "repair must reverse the historical erroneous refund");
  assert.strictEqual(state.subscription.reservedMeals, 1);
  assert.strictEqual(state.allocation.state, "reserved");
  assert.strictEqual(String(state.allocation.pickupRequestId), String(request._id));
}

async function testStandaloneLifecycle() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await insertSubscription({
    subscriptionId,
    allocations: [],
    totalMeals: 5,
    remainingMeals: 5,
    reservedMeals: 0,
  });

  const request = await createRequest({ subscriptionId, dayId, userId });
  const reserved = await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(reserved.reserved, true);
  assert.strictEqual(reserved.pickupRequest.baseAllocationMode, "standalone");

  let subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 4);
  assert.strictEqual(subscription.reservedMeals, 1);
  assert.strictEqual(subscription.baseMealAllocations.length, 1);
  assert(/^pickup_1$/.test(subscription.baseMealAllocations[0].slotKey));

  const firstRelease = await releaseReservedPickupMeals({ subscriptionId, pickupRequestId: request._id });
  const replayRelease = await releaseReservedPickupMeals({ subscriptionId, pickupRequestId: request._id });
  assert.strictEqual(firstRelease.released, true);
  assert.strictEqual(replayRelease.alreadyReleased, true);
  subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 5);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.baseMealAllocations[0].state, "released");
}

async function testRetryAfterAllocationBeforeRequestMarker() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await insertSubscription({
    subscriptionId,
    allocations: [],
    totalMeals: 2,
    remainingMeals: 2,
    reservedMeals: 0,
  });
  const request = await createRequest({ subscriptionId, dayId, userId });

  const orphan = await reservePickupEntitlements({
    subscriptionId,
    pickupRequest: request,
  });
  assert.strictEqual(orphan.newlyReservedKeys.length, 1);

  const retry = await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(retry.pickupRequest.creditsReserved, true);

  const subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 1);
  assert.strictEqual(subscription.reservedMeals, 1);
  assert.strictEqual(subscription.baseMealAllocations.length, 1, "retry must reuse the deterministic allocation key");
}

async function testConcurrentStandaloneRequestsCannotOverspend() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await insertSubscription({
    subscriptionId,
    allocations: [],
    totalMeals: 1,
    remainingMeals: 1,
    reservedMeals: 0,
  });
  const requestA = await createRequest({ subscriptionId, dayId, userId, slotId: "slot_1" });
  const requestB = await createRequest({ subscriptionId, dayId, userId, slotId: "slot_2" });

  const attempts = await Promise.allSettled([
    reserveSubscriptionMealsForPickupRequest({
      subscriptionId,
      pickupRequestId: requestA._id,
      mealCount: 1,
    }),
    reserveSubscriptionMealsForPickupRequest({
      subscriptionId,
      pickupRequestId: requestB._id,
      mealCount: 1,
    }),
  ]);
  assert.strictEqual(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.strictEqual(
    attempts.filter((attempt) => attempt.status === "rejected" && attempt.reason.code === "INSUFFICIENT_CREDITS").length,
    1
  );

  const subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 0);
  assert.strictEqual(subscription.reservedMeals, 1);
  assert.strictEqual(subscription.baseMealAllocations.length, 1);
}

async function testFulfillmentConsumesReservationOnce() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await insertSubscription({
    subscriptionId,
    allocations: [],
    totalMeals: 1,
    remainingMeals: 1,
    reservedMeals: 0,
  });
  const request = await createRequest({
    subscriptionId,
    dayId,
    userId,
    status: "ready_for_pickup",
  });
  await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 1,
  });

  const first = await fulfillSubscriptionPickupRequest({ requestId: request._id });
  const replay = await fulfillSubscriptionPickupRequest({ requestId: request._id });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.alreadyFulfilled, false);
  assert.strictEqual(replay.alreadyFulfilled, true);

  const subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 0);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.consumedMeals, 1);
  assert.strictEqual(subscription.forfeitedMeals, 0);
}

async function testNoShowReturnsReservationOnce() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await insertSubscription({
    subscriptionId,
    allocations: [],
    totalMeals: 1,
    remainingMeals: 1,
    reservedMeals: 0,
  });
  const request = await createRequest({ subscriptionId, dayId, userId });
  await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 1,
  });

  const first = await settlePickupRequestAsUncollected({ requestId: request._id });
  const replay = await settlePickupRequestAsUncollected({ requestId: request._id });
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(replay.idempotent, true);

  const subscription = await Subscription.findById(subscriptionId).lean();
  const savedRequest = await SubscriptionPickupRequest.findById(request._id).lean();
  assert.strictEqual(subscription.remainingMeals, 1);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.consumedMeals, 0);
  assert.strictEqual(subscription.forfeitedMeals, 0);
  assert.strictEqual(savedRequest.status, "no_show");
  assert(savedRequest.creditsReleasedAt);
  assert.strictEqual(savedRequest.creditsConsumedAt, null);
}

async function testLegacyReleaseCrashRetryIsIdempotent() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  await insertSubscription({
    subscriptionId,
    allocations: [],
    totalMeals: 5,
    remainingMeals: 3,
    reservedMeals: 0,
  });
  await Subscription.updateOne(
    { _id: subscriptionId },
    { $set: { consumedMeals: 2 } }
  );
  const request = await createRequest({
    subscriptionId,
    dayId,
    userId,
    creditsReserved: true,
  });

  // Simulate a standalone crash after the Subscription refund but before the
  // pickup request receives creditsReleasedAt.
  const firstStep = await applyLegacyPickupRelease({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(firstStep.applied, true);

  const retry = await releaseReservedPickupMeals({
    subscriptionId,
    pickupRequestId: request._id,
  });
  const replay = await releaseReservedPickupMeals({
    subscriptionId,
    pickupRequestId: request._id,
  });
  assert.strictEqual(retry.released, true);
  assert.strictEqual(replay.alreadyReleased, true);

  const subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 4);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.consumedMeals, 1);
  assert.strictEqual(subscription.legacyMealBalanceOperationKeys.length, 1);
}

async function runPickupEntitlementLifecycleIntegration() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: "pickup-entitlement-closure" });
    await testLinkedLifecycle();
    await mongoose.connection.dropDatabase();
    await testHistoricalReleasedAllocationRepair();
    await mongoose.connection.dropDatabase();
    await testStandaloneLifecycle();
    await mongoose.connection.dropDatabase();
    await testRetryAfterAllocationBeforeRequestMarker();
    await mongoose.connection.dropDatabase();
    await testConcurrentStandaloneRequestsCannotOverspend();
    await mongoose.connection.dropDatabase();
    await testFulfillmentConsumesReservationOnce();
    await mongoose.connection.dropDatabase();
    await testNoShowReturnsReservationOnce();
    await mongoose.connection.dropDatabase();
    await testLegacyReleaseCrashRetryIsIdempotent();
    console.log("pickup entitlement lifecycle integration checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

module.exports = {
  runPickupEntitlementLifecycleIntegration,
};
