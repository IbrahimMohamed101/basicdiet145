"use strict";

process.env.NODE_ENV = "test";
process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS = "false";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");

async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  try {
    await mongoose.connect(replSet.getUri(), { serverSelectionTimeoutMS: 10000 });

    const userId = new mongoose.Types.ObjectId();
    const subscriptionId = new mongoose.Types.ObjectId();
    const dayId = new mongoose.Types.ObjectId();
    const batchId = new mongoose.Types.ObjectId();
    const firstPickupId = new mongoose.Types.ObjectId();
    const secondPickupId = new mongoose.Types.ObjectId();
    process.env.SUBSCRIPTION_STACKING_USER_IDS = String(userId);

    const batchStart = new Date("2026-08-10T00:00:00+03:00");
    const batchEnd = new Date("2026-09-04T23:59:59+03:00");
    await SubscriptionEntitlementBatch.create({
      _id: batchId,
      sourceKey: `pickup-integration-${batchId}`,
      sourceType: "checkout",
      userId,
      containerSubscriptionId: subscriptionId,
      planId: new mongoose.Types.ObjectId(),
      requestedStartDate: batchStart,
      effectiveStartDate: batchStart,
      endDate: batchEnd,
      validityEndDate: batchEnd,
      daysCount: 26,
      mealsPerDay: 2,
      proteinGrams: 150,
      totalMeals: 52,
      remainingMeals: 50,
      reservedMeals: 2,
      consumedMeals: 0,
      forfeitedMeals: 0,
      status: "active",
      applicationState: "applied",
    });

    await SubscriptionDay.create({
      _id: dayId,
      subscriptionId,
      date: "2026-08-10",
      status: "open",
      plannerState: "confirmed",
      planningState: "confirmed",
      plannerRevisionHash: "pickup-integration-revision",
      mealSlots: [
        { slotIndex: 1, slotKey: "slot_1", status: "complete", selectionType: "standard_meal" },
        { slotIndex: 2, slotKey: "slot_2", status: "complete", selectionType: "standard_meal" },
      ],
    });

    const allocationRows = await SubscriptionEntitlementAllocation.create([
      {
        allocationKey: `pickup-allocation-${batchId}-1`,
        userId,
        containerSubscriptionId: subscriptionId,
        entitlementBatchId: batchId,
        subscriptionDayId: dayId,
        date: "2026-08-10",
        slotKey: "slot_1",
        plannerRevisionHash: "pickup-integration-revision",
        quantity: 1,
        proteinGrams: 150,
        state: "reserved",
        reservedAt: new Date(),
      },
      {
        allocationKey: `pickup-allocation-${batchId}-2`,
        userId,
        containerSubscriptionId: subscriptionId,
        entitlementBatchId: batchId,
        subscriptionDayId: dayId,
        date: "2026-08-10",
        slotKey: "slot_2",
        plannerRevisionHash: "pickup-integration-revision",
        quantity: 1,
        proteinGrams: 150,
        state: "reserved",
        reservedAt: new Date(),
      },
    ]);

    await SubscriptionPickupRequest.create({
      _id: firstPickupId,
      subscriptionId,
      subscriptionDayId: dayId,
      userId,
      date: "2026-08-10",
      mealCount: 2,
      selectionMode: "slot_ids",
      selectedMealSlotIds: ["slot_1", "slot_2"],
      selectedPickupItemIds: ["slot_1", "slot_2"],
      status: "in_preparation",
      creditsReserved: false,
      snapshot: {
        mealSlots: [
          { slotKey: "slot_1", slotIndex: 1 },
          { slotKey: "slot_2", slotIndex: 2 },
        ],
      },
    });

    const beforeBatch = await SubscriptionEntitlementBatch.findById(batchId).lean();
    const reservation = await withTransaction((session) => (
      reserveSubscriptionMealsForPickupRequest({
        subscriptionId,
        pickupRequestId: firstPickupId,
        mealCount: 2,
        session,
      })
    ));

    assert.strictEqual(reservation.reserved, true);
    assert.strictEqual(reservation.pickupRequest.baseAllocationMode, "linked_day");
    assert.deepStrictEqual(
      [...reservation.pickupRequest.baseAllocationKeys].sort(),
      allocationRows.map((row) => row.allocationKey).sort()
    );

    const [afterBatch, claimedRows, persistedPickup] = await Promise.all([
      SubscriptionEntitlementBatch.findById(batchId).lean(),
      SubscriptionEntitlementAllocation.find({ containerSubscriptionId: subscriptionId }).sort({ slotKey: 1 }).lean(),
      SubscriptionPickupRequest.findById(firstPickupId).lean(),
    ]);

    assert.strictEqual(afterBatch.remainingMeals, beforeBatch.remainingMeals, "pickup must not debit base credits twice");
    assert.strictEqual(afterBatch.reservedMeals, beforeBatch.reservedMeals, "pickup must reuse the confirmed-day reservation");
    assert.ok(claimedRows.every((row) => String(row.pickupRequestId) === String(firstPickupId)));
    assert.strictEqual(persistedPickup.creditsReserved, true);
    assert.strictEqual(persistedPickup.baseAllocationMode, "linked_day");

    const replay = await withTransaction((session) => (
      reserveSubscriptionMealsForPickupRequest({
        subscriptionId,
        pickupRequestId: firstPickupId,
        mealCount: 2,
        session,
      })
    ));
    assert.strictEqual(replay.reserved, false);
    assert.strictEqual(replay.alreadyReserved, true);

    const replayBatch = await SubscriptionEntitlementBatch.findById(batchId).lean();
    assert.strictEqual(replayBatch.remainingMeals, beforeBatch.remainingMeals);
    assert.strictEqual(replayBatch.reservedMeals, beforeBatch.reservedMeals);

    await SubscriptionPickupRequest.create({
      _id: secondPickupId,
      subscriptionId,
      subscriptionDayId: dayId,
      userId,
      date: "2026-08-10",
      mealCount: 2,
      selectionMode: "slot_ids",
      selectedMealSlotIds: ["slot_1", "slot_2"],
      selectedPickupItemIds: ["slot_1", "slot_2"],
      status: "in_preparation",
      creditsReserved: false,
      snapshot: { mealSlots: [{ slotKey: "slot_1" }, { slotKey: "slot_2" }] },
    });

    await assert.rejects(
      () => withTransaction((session) => (
        reserveSubscriptionMealsForPickupRequest({
          subscriptionId,
          pickupRequestId: secondPickupId,
          mealCount: 2,
          session,
        })
      )),
      (err) => Boolean(
        err
        && [
          "STACKING_PICKUP_ALLOCATION_SET_INCOMPLETE",
          "STACKING_PICKUP_ALLOCATION_COUNT_MISMATCH",
          "STACKING_PICKUP_ALLOCATION_CLAIM_CONFLICT",
        ].includes(err.code)
      )
    );

    const finalRows = await SubscriptionEntitlementAllocation.find({ containerSubscriptionId: subscriptionId }).lean();
    assert.ok(finalRows.every((row) => String(row.pickupRequestId) === String(firstPickupId)));

    console.log("subscription stacking pickup balance integration test passed");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
