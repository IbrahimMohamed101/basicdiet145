"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const liveBalanceService = require("../src/services/subscription/subscriptionPickupRequestBalanceService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function allocation({ dayId, slotKey, allocationKey = `allocation-${slotKey}` }) {
  return {
    allocationKey,
    dayId,
    date: "2026-07-22",
    slotKey,
    plannerRevisionHash: "guard-revision",
    quantity: 1,
    state: "reserved",
    reservedAt: new Date(),
    pickupRequestId: null,
    premiumFunding: {
      source: "none",
      state: "none",
      premiumKey: "",
    },
  };
}

async function createSubscription({
  totalMeals = 5,
  remainingMeals = 5,
  reservedMeals = 0,
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
    reservedMeals,
    consumedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    baseMealAllocations: allocations,
    premiumBalance: [],
    addonBalance: [],
    deliveryMode: "pickup",
  });
}

async function createDay(subscriptionId, {
  dayId = oid(),
  slotKey = "lunch-main",
  withMeal = true,
} = {}) {
  return SubscriptionDay.create({
    _id: dayId,
    subscriptionId,
    date: "2026-07-22",
    status: "open",
    plannerVersion: "v1",
    plannerState: withMeal ? "confirmed" : "draft",
    planningState: withMeal ? "confirmed" : "draft",
    plannerRevisionHash: "guard-revision",
    mealSlots: withMeal ? [{
      slotIndex: 1,
      slotKey,
      status: "complete",
      selectionType: "standard_meal",
      productId: oid(),
      productKey: "guard-meal",
      selectedOptions: [],
    }] : [],
    addonSelections: [],
  });
}

async function createPickupRequest({
  subscription,
  day,
  slotKey = "lunch-main",
  selectionMode = "pickup_item_ids",
  includeSelectedSlot = true,
} = {}) {
  return SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: subscription.userId,
    date: day.date,
    mealCount: 1,
    selectedMealSlotIds: includeSelectedSlot ? [slotKey] : [],
    selectedPickupItemIds: includeSelectedSlot ? [slotKey] : [],
    selectedPickupItems: includeSelectedSlot ? [{
      itemId: slotKey,
      itemType: "meal",
      source: "mealSlot",
      sourceId: slotKey,
      slotId: slotKey,
      slotKey,
      slotIndex: 1,
      selectionType: "standard_meal",
    }] : [],
    selectionMode,
    status: "in_preparation",
    creditsReserved: false,
  });
}

async function readWallet(subscriptionId) {
  return Subscription.findById(subscriptionId)
    .select("remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations")
    .lean();
}

async function testInstallerUsesGuardedMutationAuthority() {
  assert.strictEqual(
    liveBalanceService.reserveSubscriptionMealsForPickupRequest.__linkedDayMutationGuard,
    true,
    "production startup must expose the guarded reserve authority before routes capture it"
  );
}

async function testCanonicalLinkedDayWithoutLedgerNeverDebitsStandalone() {
  const subscription = await createSubscription({
    totalMeals: 5,
    remainingMeals: 4,
    reservedMeals: 1,
  });
  const day = await createDay(subscription._id, { slotKey: "lunch-main" });
  const request = await createPickupRequest({ subscription, day, slotKey: "lunch-main" });

  await assert.rejects(
    () => liveBalanceService.reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: request._id,
      mealCount: 1,
    }),
    (error) => error
      && error.code === "LINKED_DAY_ENTITLEMENT_INCONSISTENT"
      && error.details
      && error.details.reason === "linked_day_allocations_missing"
  );

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.baseMealAllocations.length, 0);
  const savedRequest = await SubscriptionPickupRequest.findById(request._id).lean();
  assert.strictEqual(savedRequest.creditsReserved, false);
}

async function testCanonicalSlotMismatchCannotClaimAnotherAllocationByCount() {
  const dayId = oid();
  const linkedAllocation = allocation({ dayId, slotKey: "breakfast-main" });
  const subscription = await createSubscription({
    totalMeals: 5,
    remainingMeals: 4,
    reservedMeals: 1,
    allocations: [linkedAllocation],
  });
  const day = await createDay(subscription._id, {
    dayId,
    slotKey: "lunch-main",
  });
  const request = await createPickupRequest({ subscription, day, slotKey: "lunch-main" });

  await assert.rejects(
    () => liveBalanceService.reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: request._id,
      mealCount: 1,
    }),
    (error) => error
      && error.code === "LINKED_DAY_ENTITLEMENT_INCONSISTENT"
      && error.details
      && error.details.reason === "selected_slots_do_not_match_allocations"
  );

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(wallet.baseMealAllocations[0].pickupRequestId, null);
}

async function testMatchingCanonicalLinkedDayOnlyClaimsExistingReservation() {
  const dayId = oid();
  const linkedAllocation = allocation({ dayId, slotKey: "lunch-main" });
  const subscription = await createSubscription({
    totalMeals: 5,
    remainingMeals: 4,
    reservedMeals: 1,
    allocations: [linkedAllocation],
  });
  const day = await createDay(subscription._id, { dayId, slotKey: "lunch-main" });
  const request = await createPickupRequest({ subscription, day, slotKey: "lunch-main" });

  const result = await liveBalanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(result.reserved, true);
  assert.strictEqual(result.allocationMode, "linked_day");

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4, "pickup claim must not debit a confirmed day twice");
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(
    String(wallet.baseMealAllocations[0].pickupRequestId),
    String(request._id)
  );

  const replay = await liveBalanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(replay.alreadyReserved, true);
  const replayWallet = await readWallet(subscription._id);
  assert.strictEqual(replayWallet.remainingMeals, 4);
  assert.strictEqual(replayWallet.reservedMeals, 1);
}

async function testTrueLegacyEmptyDayStillUsesStandaloneReservationOnce() {
  const subscription = await createSubscription();
  const day = await createDay(subscription._id, { withMeal: false });
  const request = await createPickupRequest({
    subscription,
    day,
    selectionMode: "legacy_meal_count",
    includeSelectedSlot: false,
  });

  const first = await liveBalanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(first.reserved, true);
  assert.strictEqual(first.allocationMode, "standalone");

  const replay = await liveBalanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(replay.alreadyReserved, true);

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(wallet.baseMealAllocations[0].slotKey, "pickup_1");
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), {
      dbName: `pickup-linked-mutation-guard-${Date.now()}`,
    });

    await testInstallerUsesGuardedMutationAuthority();
    await testCanonicalLinkedDayWithoutLedgerNeverDebitsStandalone();
    await mongoose.connection.dropDatabase();
    await testCanonicalSlotMismatchCannotClaimAnotherAllocationByCount();
    await mongoose.connection.dropDatabase();
    await testMatchingCanonicalLinkedDayOnlyClaimsExistingReservation();
    await mongoose.connection.dropDatabase();
    await testTrueLegacyEmptyDayStillUsesStandaloneReservationOnce();

    console.log("pickup linked-day mutation guard checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
