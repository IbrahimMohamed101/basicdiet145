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

function oid() {
  return new mongoose.Types.ObjectId();
}

async function runCase() {
  const subscription = await Subscription.create({
    userId: oid(),
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-31T00:00:00.000Z"),
    totalMeals: 5,
    remainingMeals: 4,
    entitlementVersion: 1,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    premiumBalance: [],
    addonBalance: [],
    deliveryMode: "pickup",
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-22",
    status: "open",
    plannerVersion: "v1",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "legacy-entitlement-repair",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "standard_meal",
      productId: oid(),
      productKey: "legacy-meal",
      selectedOptions: [],
    }],
    addonSelections: [],
  });
  const request = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: day._id,
    userId: subscription.userId,
    date: day.date,
    mealCount: 1,
    selectedMealSlotIds: ["slot_1"],
    selectedPickupItemIds: ["slot_1"],
    selectedPickupItems: [{
      itemId: "slot_1",
      itemType: "meal",
      source: "mealSlot",
      sourceId: "slot_1",
      slotId: "slot_1",
      slotKey: "slot_1",
      slotIndex: 1,
      selectionType: "standard_meal",
    }],
    selectionMode: "pickup_item_ids",
    status: "in_preparation",
    creditsReserved: false,
  });

  const first = await balanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(first.reserved, true);
  assert.strictEqual(first.allocationMode, "linked_day");

  const replay = await balanceService.reserveSubscriptionMealsForPickupRequest({
    subscriptionId: subscription._id,
    pickupRequestId: request._id,
    mealCount: 1,
  });
  assert.strictEqual(replay.alreadyReserved, true);

  const wallet = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(wallet.entitlementVersion, 2);
  assert.strictEqual(wallet.remainingMeals, 4, "legacy aggregate debit must not be charged twice");
  assert.strictEqual(wallet.reservedMeals, 1);
  assert.strictEqual(wallet.consumedMeals, 0);
  assert.strictEqual(wallet.baseMealAllocations.length, 1);
  assert.strictEqual(wallet.baseMealAllocations[0].state, "reserved");
  assert.strictEqual(String(wallet.baseMealAllocations[0].pickupRequestId), String(request._id));
  assert.strictEqual(
    wallet.totalMeals,
    wallet.remainingMeals + wallet.reservedMeals + wallet.consumedMeals + wallet.forfeitedMeals
  );
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), {
      dbName: `pickup-legacy-entitlement-repair-${Date.now()}`,
    });
    await runCase();
    console.log("pickup legacy entitlement repair checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
