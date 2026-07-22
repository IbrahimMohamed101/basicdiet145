"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  assertLinkedDayAllocationIntegrity,
  requestedMealCount,
} = require("../src/services/subscription/pickupLinkedDayIntegrityService");
const {
  recoverIncompletePickupReservation,
} = require("../src/services/subscription/subscriptionPickupRequestRecoveryService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function createSubscription({
  totalMeals = 4,
  remainingMeals = 3,
  reservedMeals = 1,
  allocations = [],
} = {}) {
  return Subscription.create({
    userId: oid(),
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-31T00:00:00.000Z"),
    totalMeals,
    remainingMeals,
    entitlementVersion: 2,
    reservedMeals,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: allocations,
    deliveryMode: "pickup",
  });
}

async function createPlannedDay(subscriptionId, {
  date = "2026-07-22",
  status = "open",
  withMeal = true,
  baseAllocationKeys = [],
} = {}) {
  return SubscriptionDay.create({
    subscriptionId,
    date,
    status,
    plannerVersion: "v1",
    plannerState: "confirmed",
    plannerRevisionHash: `linked-day-${date}`,
    baseAllocationKeys,
    mealSlots: withMeal ? [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "standard_meal",
      productId: oid(),
      productKey: "test_meal",
      selectedOptions: [],
    }] : [],
    addonSelections: [],
  });
}

async function assertWalletUnchanged(subscriptionId, expected) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(Number(subscription.remainingMeals), expected.remainingMeals);
  assert.strictEqual(Number(subscription.reservedMeals), expected.reservedMeals);
  assert.strictEqual((subscription.baseMealAllocations || []).length, expected.allocations);
}

async function testPlannedDayWithoutLedgerIsRejected() {
  const subscription = await createSubscription();
  const day = await createPlannedDay(subscription._id);

  await assert.rejects(
    () => assertLinkedDayAllocationIntegrity({
      subscriptionId: subscription._id,
      date: day.date,
      mealCount: 1,
      selectedMealSlotIds: ["slot_1"],
    }),
    (err) => err
      && err.code === "LINKED_DAY_ENTITLEMENT_INCONSISTENT"
      && err.details
      && err.details.subscriptionDayId === String(day._id)
  );

  await assertWalletUnchanged(subscription._id, {
    remainingMeals: 3,
    reservedMeals: 1,
    allocations: 0,
  });
}

async function testIncompleteLinkedRequestDoesNotDoubleDebit() {
  const subscription = await createSubscription();
  const day = await createPlannedDay(subscription._id, { date: "2026-07-23" });
  const request = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: subscription.userId,
    date: day.date,
    mealCount: 1,
    selectedMealSlotIds: ["slot_1"],
    selectedPickupItemIds: ["slot_1"],
    status: "in_preparation",
    selectionMode: "slot_ids",
    idempotencyKey: "linked-day-no-ledger-recovery",
    creditsReserved: false,
    reservationState: "pending",
  });

  await assert.rejects(
    () => recoverIncompletePickupReservation({
      pickupRequestId: request._id,
      subscriptionId: subscription._id,
    }),
    (err) => err && err.code === "LINKED_DAY_ENTITLEMENT_INCONSISTENT"
  );

  const savedRequest = await SubscriptionPickupRequest.findById(request._id).lean();
  assert.strictEqual(savedRequest.creditsReserved, false);
  assert.strictEqual(savedRequest.reservationState, "failed");
  assert.strictEqual(savedRequest.reservationErrorCode, "LINKED_DAY_ENTITLEMENT_INCONSISTENT");
  assert.strictEqual((savedRequest.baseAllocationKeys || []).length, 0);

  await assertWalletUnchanged(subscription._id, {
    remainingMeals: 3,
    reservedMeals: 1,
    allocations: 0,
  });
}

async function testLinkedDayWithLedgerPasses() {
  const dayId = oid();
  const allocationKey = "linked-allocation-slot-1";
  const subscription = await createSubscription({
    allocations: [{
      allocationKey,
      dayId,
      date: "2026-07-24",
      slotKey: "slot_1",
      plannerRevisionHash: "linked-day-2026-07-24",
      quantity: 1,
      state: "reserved",
      reservedAt: new Date(),
      premiumFunding: { source: "none", state: "none", premiumKey: "" },
    }],
  });
  const day = await SubscriptionDay.create({
    _id: dayId,
    subscriptionId: subscription._id,
    date: "2026-07-24",
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    plannerRevisionHash: "linked-day-2026-07-24",
    baseAllocationKeys: [allocationKey],
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "standard_meal",
      productId: oid(),
      productKey: "test_meal",
      selectedOptions: [],
    }],
    addonSelections: [],
  });

  const result = await assertLinkedDayAllocationIntegrity({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedMealSlotIds: ["slot_1"],
  });
  assert.strictEqual(result.linked, true);
  assert.strictEqual(result.allocations.length, 1);
  assert.strictEqual(result.allocations[0].allocationKey, allocationKey);
}

async function testTrueStandaloneDayRemainsAllowed() {
  const subscription = await createSubscription({
    totalMeals: 4,
    remainingMeals: 4,
    reservedMeals: 0,
  });
  const day = await createPlannedDay(subscription._id, {
    date: "2026-07-25",
    withMeal: false,
  });

  const result = await assertLinkedDayAllocationIntegrity({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
  });
  assert.strictEqual(result.linked, false);
  await assertWalletUnchanged(subscription._id, {
    remainingMeals: 4,
    reservedMeals: 0,
    allocations: 0,
  });
}

async function testMissingExplicitLinkedDayIsRejected() {
  const subscription = await createSubscription({
    totalMeals: 4,
    remainingMeals: 4,
    reservedMeals: 0,
  });
  const request = {
    _id: oid(),
    subscriptionDayId: oid(),
    subscriptionId: subscription._id,
    date: "2026-07-26",
    mealCount: 1,
    selectedMealSlotIds: ["slot_1"],
  };

  await assert.rejects(
    () => assertLinkedDayAllocationIntegrity({
      subscriptionId: subscription._id,
      date: request.date,
      pickupRequest: request,
    }),
    (err) => err && err.code === "LINKED_DAY_NOT_FOUND"
  );
}

function testOpaquePickupItemIdsAreNotPreflightMealCounts() {
  assert.strictEqual(requestedMealCount({
    mealCount: 0,
    selectedPickupItemIds: ["507f1f77bcf86cd799439011", "addon_1"],
  }), 0);
  assert.strictEqual(requestedMealCount({
    mealCount: 0,
    selectedPickupItemIds: ["slot_1", "addon_1"],
  }), 1);
}

async function testAddonOnlyRequestNeedsNoBaseLedger() {
  const subscription = await createSubscription();
  const day = await createPlannedDay(subscription._id, { date: "2026-07-27" });
  const result = await assertLinkedDayAllocationIntegrity({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 0,
    selectedPickupItemIds: ["addon_1"],
  });
  assert.strictEqual(result.linked, false);
  assert.strictEqual(result.requiredMealCount, 0);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `pickup-linked-integrity-${Date.now()}` });
    await testPlannedDayWithoutLedgerIsRejected();
    await mongoose.connection.dropDatabase();
    await testIncompleteLinkedRequestDoesNotDoubleDebit();
    await mongoose.connection.dropDatabase();
    await testLinkedDayWithLedgerPasses();
    await mongoose.connection.dropDatabase();
    await testTrueStandaloneDayRemainsAllowed();
    await mongoose.connection.dropDatabase();
    await testMissingExplicitLinkedDayIsRejected();
    testOpaquePickupItemIdsAreNotPreflightMealCounts();
    await mongoose.connection.dropDatabase();
    await testAddonOnlyRequestNeedsNoBaseLedger();
    console.log("pickup linked-day no-standalone-fallback checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
