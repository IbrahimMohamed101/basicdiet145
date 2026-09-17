"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionDayFullMealCompatibility");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const balanceService = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const {
  repairLinkedDayAllocations,
} = require("../src/services/subscription/pickupLinkedDayAllocationRepairService");
const {
  assertLinkedDayAllocationIntegrity,
} = require("../src/services/subscription/pickupLinkedDayIntegrityService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function noPremiumFunding() {
  return {
    source: "none",
    state: "none",
    premiumKey: "",
  };
}

async function createSubscription({
  totalMeals = 5,
  remainingMeals = 5,
  reservedMeals = 0,
  consumedMeals = 0,
  forfeitedMeals = 0,
  allocations = [],
  premiumBalance = [],
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
    consumedMeals,
    forfeitedMeals,
    entitlementVersion: 2,
    baseMealAllocations: allocations,
    premiumBalance,
    addonBalance: [],
    deliveryMode: "pickup",
  });
}

function standardSlot(slotKey, slotIndex) {
  return {
    slotIndex,
    slotKey,
    status: "complete",
    selectionType: "standard_meal",
    productId: oid(),
    productKey: `product-${slotKey}`,
    selectedOptions: [],
  };
}

async function createDay(subscriptionId, {
  dayId = oid(),
  slots = [standardSlot("lunch-main", 1)],
  premiumUpgradeSelections = [],
} = {}) {
  return SubscriptionDay.create({
    _id: dayId,
    subscriptionId,
    date: "2026-07-22",
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "repair-revision",
    plannerMeta: {
      requiredSlotCount: slots.length,
      completeSlotCount: slots.length,
      partialSlotCount: 0,
      isDraftValid: true,
      isConfirmable: true,
    },
    mealSlots: slots,
    premiumUpgradeSelections,
    addonSelections: [],
  });
}

async function readWallet(subscriptionId) {
  return Subscription.findById(subscriptionId)
    .select("totalMeals remainingMeals reservedMeals consumedMeals forfeitedMeals baseMealAllocations premiumBalance")
    .lean();
}

function assertInvariant(wallet) {
  assert.strictEqual(
    Number(wallet.totalMeals),
    Number(wallet.remainingMeals)
      + Number(wallet.reservedMeals)
      + Number(wallet.consumedMeals)
      + Number(wallet.forfeitedMeals)
  );
}

async function testConsumedAggregateDebitBecomesReservedAllocationWithoutSecondDebit() {
  const subscription = await createSubscription({
    remainingMeals: 4,
    consumedMeals: 1,
  });
  const day = await createDay(subscription._id);

  const repair = await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["lunch-main"],
  });
  assert.strictEqual(repair.linked, true);
  assert.strictEqual(repair.repaired, true);
  assert.strictEqual(repair.results[0].mode, "adopted_consumed_gap");

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4, "historical debit must not be applied again");
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.consumedMeals, 0);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(wallet.baseMealAllocations[0].slotKey, "lunch-main");
  assert.strictEqual(wallet.baseMealAllocations[0].state, "reserved");
  assertInvariant(wallet);

  await assertLinkedDayAllocationIntegrity({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedMealSlotIds: ["lunch-main"],
  });
}

async function testReservedAggregateGapMaterializesWithoutChangingCounters() {
  const subscription = await createSubscription({
    remainingMeals: 4,
    reservedMeals: 1,
  });
  const day = await createDay(subscription._id);

  const repair = await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["lunch-main"],
  });
  assert.strictEqual(repair.results[0].mode, "adopted_reserved_gap");

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.consumedMeals, 0);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assertInvariant(wallet);
}

async function testNeverDebitedConfirmedSlotReservesExactlyOnce() {
  const subscription = await createSubscription();
  const day = await createDay(subscription._id);

  const first = await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["lunch-main"],
  });
  assert.strictEqual(first.results[0].mode, "reserved_fresh_credit");

  const second = await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["lunch-main"],
  });
  assert.strictEqual(second.results[0].mode, "already_materialized");

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assertInvariant(wallet);
}

async function testConcurrentRepairCannotMaterializeOrDebitTwice() {
  const subscription = await createSubscription({
    remainingMeals: 4,
    consumedMeals: 1,
  });
  const day = await createDay(subscription._id);

  const args = {
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["lunch-main"],
  };
  await Promise.all([
    repairLinkedDayAllocations(args),
    repairLinkedDayAllocations(args),
  ]);

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.consumedMeals, 0);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assertInvariant(wallet);
}

async function testStaleSlotKeysAreReprojectedWithoutDebit() {
  const dayId = oid();
  const subscription = await createSubscription({
    remainingMeals: 3,
    reservedMeals: 2,
    allocations: [
      {
        allocationKey: "old-allocation-1",
        dayId,
        date: "2026-07-22",
        slotKey: "old_slot_a",
        plannerRevisionHash: "old-revision",
        quantity: 1,
        state: "reserved",
        reservedAt: new Date(),
        pickupRequestId: null,
        premiumFunding: noPremiumFunding(),
      },
      {
        allocationKey: "old-allocation-2",
        dayId,
        date: "2026-07-22",
        slotKey: "old_slot_b",
        plannerRevisionHash: "old-revision",
        quantity: 1,
        state: "reserved",
        reservedAt: new Date(),
        pickupRequestId: null,
        premiumFunding: noPremiumFunding(),
      },
    ],
  });
  const day = await createDay(subscription._id, {
    dayId,
    slots: [standardSlot("lunch-main", 1), standardSlot("dinner-main", 2)],
  });

  const repair = await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 2,
    selectedPickupItemIds: ["lunch-main", "dinner-main"],
  });
  assert.deepStrictEqual(
    repair.results.map((entry) => entry.mode),
    ["reprojected_stale_allocation", "reprojected_stale_allocation"]
  );

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 3);
  assert.strictEqual(wallet.reservedMeals, 2);
  assert.deepStrictEqual(
    wallet.baseMealAllocations.map((entry) => entry.slotKey).sort(),
    ["dinner-main", "lunch-main"]
  );
  assertInvariant(wallet);
}

async function testRepairedAllocationIsClaimedByPickupWithoutAnotherDebit() {
  const subscription = await createSubscription({
    remainingMeals: 4,
    consumedMeals: 1,
  });
  const day = await createDay(subscription._id);
  await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["lunch-main"],
  });

  const request = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: subscription.userId,
    date: day.date,
    mealCount: 1,
    selectedMealSlotIds: ["lunch-main"],
    selectedPickupItemIds: ["lunch-main"],
    selectedPickupItems: [{
      itemId: "lunch-main",
      itemType: "meal",
      source: "mealSlot",
      sourceId: "lunch-main",
      slotId: "lunch-main",
      slotKey: "lunch-main",
      slotIndex: 1,
      selectionType: "standard_meal",
    }],
    selectionMode: "pickup_item_ids",
    status: "in_preparation",
    creditsReserved: false,
  });

  const reservation = await balanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(reservation.reserved, true);
  assert.strictEqual(reservation.allocationMode, "linked_day");

  const replay = await balanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(replay.alreadyReserved, true);

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.consumedMeals, 0);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(String(wallet.baseMealAllocations[0].pickupRequestId), String(request._id));
  assertInvariant(wallet);
}

async function testPremiumConsumedGapIsReclassifiedWithoutSecondPremiumDebit() {
  const bucketId = oid();
  const subscription = await createSubscription({
    remainingMeals: 4,
    consumedMeals: 1,
    premiumBalance: [{
      _id: bucketId,
      premiumKey: "beef-premium",
      purchasedQty: 1,
      remainingQty: 0,
      reservedQty: 0,
      consumedQty: 1,
      currency: "SAR",
    }],
  });
  const premiumSlot = {
    ...standardSlot("premium-lunch", 1),
    selectionType: "premium_meal",
    isPremium: true,
    premiumKey: "beef-premium",
    premiumSource: "balance",
  };
  const day = await createDay(subscription._id, {
    slots: [premiumSlot],
    premiumUpgradeSelections: [{
      baseSlotKey: "premium-lunch",
      premiumKey: "beef-premium",
      premiumSource: "balance",
      source: "subscription",
      quantity: 1,
      coveredQty: 1,
      paidQty: 0,
      balanceBucketId: bucketId,
      premiumWalletRowId: bucketId,
    }],
  });

  const repair = await repairLinkedDayAllocations({
    subscriptionId: subscription._id,
    date: day.date,
    mealCount: 1,
    selectedPickupItemIds: ["premium-lunch"],
  });
  assert.strictEqual(repair.results[0].mode, "adopted_consumed_gap");
  assert.strictEqual(repair.results[0].premiumMode, "consumed_gap");

  const wallet = await readWallet(subscription._id);
  assert.strictEqual(wallet.remainingMeals, 4);
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.consumedMeals, 0);
  assert.strictEqual(wallet.premiumBalance[0].remainingQty, 0);
  assert.strictEqual(wallet.premiumBalance[0].reservedQty, 1);
  assert.strictEqual(wallet.premiumBalance[0].consumedQty, 0);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(wallet.baseMealAllocations[0].premiumFunding.source, "wallet");
  assertInvariant(wallet);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), {
      dbName: `pickup-linked-day-allocation-repair-${Date.now()}`,
    });

    await testConsumedAggregateDebitBecomesReservedAllocationWithoutSecondDebit();
    await mongoose.connection.dropDatabase();
    await testReservedAggregateGapMaterializesWithoutChangingCounters();
    await mongoose.connection.dropDatabase();
    await testNeverDebitedConfirmedSlotReservesExactlyOnce();
    await mongoose.connection.dropDatabase();
    await testConcurrentRepairCannotMaterializeOrDebitTwice();
    await mongoose.connection.dropDatabase();
    await testStaleSlotKeysAreReprojectedWithoutDebit();
    await mongoose.connection.dropDatabase();
    await testRepairedAllocationIsClaimedByPickupWithoutAnotherDebit();
    await mongoose.connection.dropDatabase();
    await testPremiumConsumedGapIsReclassifiedWithoutSecondPremiumDebit();

    console.log("pickup linked-day allocation repair checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
