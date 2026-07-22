"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installPickupEntitlementClosure");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  checkEntitlementInvariants,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceClosureService");
const {
  fulfillSubscriptionPickupRequest,
} = require("../src/services/fulfillmentService");
const {
  readWallet,
  releaseExpiredReservationsForSubscription,
  reserveMissingDaySlotAllocations,
  settlePickupRequestAsUncollected,
} = require("../src/services/subscription/subscriptionPickupCycleAuthorityService");

const DATE = "2026-07-21";
const NEXT_DATE = "2026-07-22";

function allocation({ subscriptionId, dayId, slotKey, state, requestId = null }) {
  const now = new Date();
  return {
    allocationKey: `alloc_${String(subscriptionId)}_${String(dayId)}_${slotKey}`,
    dayId,
    date: DATE,
    slotKey,
    plannerRevisionHash: "revision_1",
    quantity: 1,
    state,
    reservedAt: now,
    consumedAt: state === "consumed" ? now : null,
    releasedAt: state === "released" ? now : null,
    forfeitedAt: state === "forfeited" ? now : null,
    pickupRequestId: requestId,
    premiumFunding: { source: "none", state: "none", premiumKey: "" },
  };
}

function mealSlot(index) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "standard_meal",
    productId: new mongoose.Types.ObjectId(),
    selectedOptions: [],
    isPremium: false,
    premiumSource: "none",
    updatedAt: new Date(),
  };
}

async function insertSubscription({
  subscriptionId,
  userId,
  dayId,
  totalMeals,
  remainingMeals,
  reservedMeals,
  consumedMeals,
  forfeitedMeals = 0,
  allocations,
}) {
  await Subscription.collection.insertOne({
    _id: subscriptionId,
    userId,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
    entitlementVersion: 2,
    baseMealAllocations: allocations,
    premiumBalance: [],
    addonBalance: [],
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
    selectedMealsPerDay: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await SubscriptionDay.collection.insertOne({
    _id: dayId,
    subscriptionId,
    date: DATE,
    status: "fulfilled",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerVersion: "v1",
    plannerRevisionHash: "revision_2",
    mealSlots: [mealSlot(1), mealSlot(2), mealSlot(3), mealSlot(4)],
    baseAllocationKeys: allocations.map((entry) => entry.allocationKey),
    entitlementTransitionState: "consumed",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function createPickupRequest({
  subscriptionId,
  dayId,
  userId,
  slotKeys,
  status = "in_preparation",
  requestId = new mongoose.Types.ObjectId(),
}) {
  await SubscriptionPickupRequest.collection.insertOne({
    _id: requestId,
    subscriptionId,
    subscriptionDayId: dayId,
    userId,
    date: DATE,
    mealCount: slotKeys.length,
    selectedMealSlotIds: slotKeys,
    selectedPickupItemIds: slotKeys,
    selectedPickupItems: slotKeys.map((slotKey, index) => ({
      itemId: slotKey,
      itemType: "meal",
      source: "mealSlot",
      sourceId: slotKey,
      slotId: slotKey,
      slotKey,
      slotIndex: index + 1,
      selectionType: "standard_meal",
    })),
    selectionMode: "pickup_item_ids",
    status,
    creditsReserved: false,
    creditsReservedAt: null,
    creditsConsumedAt: null,
    creditsReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return SubscriptionPickupRequest.findById(requestId);
}

async function assertInvariant(subscriptionId, expected) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  const invariant = checkEntitlementInvariants(subscription);
  assert.strictEqual(invariant.valid, true, JSON.stringify(invariant));
  for (const [key, value] of Object.entries(expected)) {
    assert.strictEqual(Number(subscription[key] || 0), value, `${key} mismatch`);
  }
  return subscription;
}

async function testAppendAfterFirstFulfillmentAndSecondPickup() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const oldAllocations = [1, 2].map((index) => allocation({
    subscriptionId,
    dayId,
    slotKey: `slot_${index}`,
    state: "consumed",
  }));

  await insertSubscription({
    subscriptionId,
    userId,
    dayId,
    totalMeals: 14,
    remainingMeals: 12,
    reservedMeals: 0,
    consumedMeals: 2,
    allocations: oldAllocations,
  });

  const firstReservation = await reserveMissingDaySlotAllocations({
    subscriptionId,
    dayId,
    slotKeys: ["slot_3", "slot_4"],
  });
  assert.strictEqual(firstReservation.reservedDelta, 2);
  assert.strictEqual(firstReservation.wallet.sourceOfTruth, "subscription.baseMealAllocations");
  assert.strictEqual(firstReservation.wallet.remainingMeals, 10);
  assert.strictEqual(firstReservation.wallet.reservedMeals, 2);
  assert.strictEqual(firstReservation.wallet.consumedMeals, 2);

  let subscription = await assertInvariant(subscriptionId, {
    remainingMeals: 10,
    reservedMeals: 2,
    consumedMeals: 2,
    forfeitedMeals: 0,
  });
  const bySlot = new Map(subscription.baseMealAllocations.map((entry) => [entry.slotKey, entry]));
  assert.strictEqual(bySlot.get("slot_1").state, "consumed");
  assert.strictEqual(bySlot.get("slot_2").state, "consumed");
  assert.strictEqual(bySlot.get("slot_3").state, "reserved");
  assert.strictEqual(bySlot.get("slot_4").state, "reserved");

  const replay = await reserveMissingDaySlotAllocations({
    subscriptionId,
    dayId,
    slotKeys: ["slot_3", "slot_4"],
  });
  assert.strictEqual(replay.reservedDelta, 0, "append reconciliation must be idempotent");
  await assertInvariant(subscriptionId, {
    remainingMeals: 10,
    reservedMeals: 2,
    consumedMeals: 2,
    forfeitedMeals: 0,
  });

  const request = await createPickupRequest({
    subscriptionId,
    dayId,
    userId,
    slotKeys: ["slot_3", "slot_4"],
  });
  const linked = await reserveSubscriptionMealsForPickupRequest({
    subscriptionId,
    pickupRequestId: request._id,
    mealCount: 2,
  });
  assert.strictEqual(linked.reserved, true);
  assert.strictEqual(linked.pickupRequest.baseAllocationMode, "linked_day");
  await assertInvariant(subscriptionId, {
    remainingMeals: 10,
    reservedMeals: 2,
    consumedMeals: 2,
    forfeitedMeals: 0,
  });

  await SubscriptionPickupRequest.updateOne(
    { _id: request._id },
    { $set: { status: "ready_for_pickup" } }
  );
  const fulfilled = await fulfillSubscriptionPickupRequest({ requestId: request._id });
  assert.strictEqual(fulfilled.ok, true);
  assert.strictEqual(fulfilled.consumedCredits, 2);

  subscription = await assertInvariant(subscriptionId, {
    remainingMeals: 10,
    reservedMeals: 0,
    consumedMeals: 4,
    forfeitedMeals: 0,
  });
  const fulfilledRequest = await SubscriptionPickupRequest.findById(request._id).lean();
  assert.strictEqual(fulfilledRequest.status, "fulfilled");
  assert(fulfilledRequest.creditsConsumedAt);
  assert.strictEqual(fulfilledRequest.creditsReleasedAt, null);

  const fulfillReplay = await fulfillSubscriptionPickupRequest({ requestId: request._id });
  assert.strictEqual(fulfillReplay.ok, true);
  assert.strictEqual(fulfillReplay.alreadyFulfilled, true);
  await assertInvariant(subscriptionId, {
    remainingMeals: 10,
    reservedMeals: 0,
    consumedMeals: 4,
    forfeitedMeals: 0,
  });
}

async function testUncollectedMealsReturnNextBusinessDay() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const requestId = new mongoose.Types.ObjectId();
  const allocations = [1, 2, 3, 4].map((index) => allocation({
    subscriptionId,
    dayId,
    slotKey: `slot_${index}`,
    state: "reserved",
    requestId,
  }));

  await insertSubscription({
    subscriptionId,
    userId,
    dayId,
    totalMeals: 14,
    remainingMeals: 10,
    reservedMeals: 4,
    consumedMeals: 0,
    allocations,
  });
  await createPickupRequest({
    subscriptionId,
    dayId,
    userId,
    requestId,
    slotKeys: ["slot_1", "slot_2", "slot_3", "slot_4"],
  });
  await SubscriptionPickupRequest.updateOne(
    { _id: requestId },
    {
      $set: {
        creditsReserved: true,
        creditsReservedAt: new Date(),
        baseAllocationKeys: allocations.map((entry) => entry.allocationKey),
        baseAllocationMode: "linked_day",
      },
    }
  );

  const released = await releaseExpiredReservationsForSubscription({
    subscriptionId,
    businessDate: NEXT_DATE,
  });
  assert.strictEqual(released.releasedCount, 4);
  assert.strictEqual(released.settledRequestCount, 1);
  await assertInvariant(subscriptionId, {
    remainingMeals: 14,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
  });

  const settled = await SubscriptionPickupRequest.findById(requestId).lean();
  assert.strictEqual(settled.status, "canceled");
  assert.strictEqual(settled.cancellationReason, "expired_uncollected_returned_to_balance");
  assert(settled.creditsReleasedAt);
  assert.strictEqual(settled.creditsConsumedAt, null);

  const replay = await releaseExpiredReservationsForSubscription({
    subscriptionId,
    businessDate: NEXT_DATE,
  });
  assert.strictEqual(replay.releasedCount, 0);
  await assertInvariant(subscriptionId, {
    remainingMeals: 14,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
  });
}

async function testExplicitNoShowReturnsBalanceInsteadOfForfeiting() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const requestId = new mongoose.Types.ObjectId();
  const allocations = [1, 2, 3, 4].map((index) => allocation({
    subscriptionId,
    dayId,
    slotKey: `slot_${index}`,
    state: "reserved",
    requestId,
  }));

  await insertSubscription({
    subscriptionId,
    userId,
    dayId,
    totalMeals: 4,
    remainingMeals: 0,
    reservedMeals: 4,
    consumedMeals: 0,
    allocations,
  });
  await createPickupRequest({
    subscriptionId,
    dayId,
    userId,
    requestId,
    slotKeys: ["slot_1", "slot_2", "slot_3", "slot_4"],
    status: "ready_for_pickup",
  });
  await SubscriptionPickupRequest.updateOne(
    { _id: requestId },
    {
      $set: {
        creditsReserved: true,
        creditsReservedAt: new Date(),
        baseAllocationKeys: allocations.map((entry) => entry.allocationKey),
        baseAllocationMode: "linked_day",
      },
    }
  );

  const result = await settlePickupRequestAsUncollected({
    requestId,
    userId,
    reason: "no_show",
  });
  assert.strictEqual(result.releasedCount, 4);
  assert.strictEqual(result.wallet.remainingMeals, 4);
  assert.strictEqual(result.wallet.forfeitedMeals, 0);
  await assertInvariant(subscriptionId, {
    remainingMeals: 4,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
  });

  const settled = await SubscriptionPickupRequest.findById(requestId).lean();
  assert.strictEqual(settled.status, "no_show");
  assert(settled.creditsReleasedAt);
  assert.strictEqual(settled.creditsConsumedAt, null);

  const replay = await settlePickupRequestAsUncollected({ requestId, userId });
  assert.strictEqual(replay.idempotent, true);
  await assertInvariant(subscriptionId, {
    remainingMeals: 4,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
  });
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: "pickup-multi-cycle-policy" });
    await testAppendAfterFirstFulfillmentAndSecondPickup();
    await mongoose.connection.dropDatabase();
    await testUncollectedMealsReturnNextBusinessDay();
    await mongoose.connection.dropDatabase();
    await testExplicitNoShowReturnsBalanceInsteadOfForfeiting();
    console.log("pickup multi-cycle policy integration checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
