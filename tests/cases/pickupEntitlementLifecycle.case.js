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

  await releaseReservedPickupMeals({ subscriptionId, pickupRequestId: request._id });
  subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.remainingMeals, 5);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.baseMealAllocations[0].state, "released");
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
    console.log("pickup entitlement lifecycle integration checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

module.exports = {
  runPickupEntitlementLifecycleIntegration,
};
