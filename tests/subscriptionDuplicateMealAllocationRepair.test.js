"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  repairDuplicateBaseMealAllocations,
} = require("../src/services/subscription/subscriptionDuplicateMealAllocationRepairService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function allocation({ dayId, slotKey, revision, key, reservedAt }) {
  return {
    allocationKey: key,
    dayId,
    date: "2026-07-22",
    slotKey,
    plannerRevisionHash: revision,
    quantity: 1,
    state: "reserved",
    reservedAt,
    premiumFunding: slotKey === "slot_3"
      ? {
        source: revision === "paid-revision" ? "paid_difference" : "pending_payment",
        state: revision === "paid-revision" ? "paid" : "reserved",
        premiumKey: "shrimp",
      }
      : { source: "none", state: "none", premiumKey: "" },
  };
}

async function createCorruptedCase() {
  const subscriptionId = oid();
  const dayId = oid();
  const oldKeys = ["old-slot-1", "old-slot-2", "old-slot-3"];
  const currentKeys = ["paid-slot-1", "paid-slot-2", "paid-slot-3"];
  const rows = [];
  for (let index = 0; index < 3; index += 1) {
    const slotKey = `slot_${index + 1}`;
    rows.push(allocation({
      dayId,
      slotKey,
      revision: "pending-revision",
      key: oldKeys[index],
      reservedAt: new Date("2026-07-22T15:07:20.000Z"),
    }));
    rows.push(allocation({
      dayId,
      slotKey,
      revision: "paid-revision",
      key: currentKeys[index],
      reservedAt: new Date("2026-07-22T15:07:42.000Z"),
    }));
  }

  const subscription = await Subscription.create({
    _id: subscriptionId,
    userId: oid(),
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-21T21:00:00.000Z"),
    endDate: new Date("2026-07-27T21:00:00.000Z"),
    validityEndDate: new Date("2026-07-27T21:00:00.000Z"),
    totalMeals: 14,
    remainingMeals: 8,
    entitlementVersion: 2,
    reservedMeals: 6,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: rows,
    premiumBalance: [],
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
  });

  const day = await SubscriptionDay.create({
    _id: dayId,
    subscriptionId,
    date: "2026-07-22",
    status: "open",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "paid-revision",
    baseAllocationKeys: currentKeys,
    entitlementTransitionState: "reserved",
    mealSlots: [1, 2, 3].map((index) => ({
      slotIndex: index,
      slotKey: `slot_${index}`,
      status: "complete",
      selectionType: index === 3 ? "premium_meal" : "standard_meal",
      proteinId: oid(),
      carbs: [{ carbId: oid(), grams: 100 }],
      isPremium: index === 3,
      premiumKey: index === 3 ? "shrimp" : null,
      premiumSource: index === 3 ? "paid_extra" : "none",
    })),
  });

  return { subscription, day, oldKeys, currentKeys };
}

async function testDryRunAndGuardedApply() {
  const { subscription, day, oldKeys, currentKeys } = await createCorruptedCase();
  const expected = {
    totalMeals: 14,
    remainingMeals: 8,
    reservedMeals: 6,
    duplicateReservationCount: 3,
  };

  const dryRun = await repairDuplicateBaseMealAllocations({
    subscriptionId: subscription._id,
    dayId: day._id,
    date: day.date,
    apply: false,
    expected,
  });
  assert.strictEqual(dryRun.applied, false);
  assert.strictEqual(dryRun.plan.duplicateReservationCount, 3);
  assert.deepStrictEqual(dryRun.plan.keeperAllocationKeys.sort(), currentKeys.sort());
  assert.deepStrictEqual(dryRun.plan.releaseAllocationKeys.sort(), oldKeys.sort());
  assert.deepStrictEqual(dryRun.plan.expectedAfter, {
    remainingMeals: 11,
    reservedMeals: 3,
    consumedMeals: 0,
  });

  let unchanged = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(unchanged.remainingMeals, 8);
  assert.strictEqual(unchanged.reservedMeals, 6);

  const applied = await repairDuplicateBaseMealAllocations({
    subscriptionId: subscription._id,
    dayId: day._id,
    date: day.date,
    apply: true,
    expected,
  });
  assert.strictEqual(applied.applied, true);
  assert.strictEqual(applied.after.remainingMeals, 11);
  assert.strictEqual(applied.after.reservedMeals, 3);
  assert.strictEqual(applied.after.consumedMeals, 0);
  assert.strictEqual(applied.after.invariant.valid, true);
  assert.deepStrictEqual(applied.after.baseAllocationKeys.sort(), currentKeys.sort());

  const repaired = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(repaired.totalMeals, 14);
  assert.strictEqual(repaired.remainingMeals, 11);
  assert.strictEqual(repaired.reservedMeals, 3);
  assert.strictEqual(repaired.consumedMeals, 0);
  assert.strictEqual(repaired.baseMealAllocations.filter((row) => row.state === "reserved").length, 3);
  assert.strictEqual(repaired.baseMealAllocations.filter((row) => row.state === "released").length, 3);
}

async function testWrongPreconditionNeverWrites() {
  const { subscription, day } = await createCorruptedCase();
  await assert.rejects(
    () => repairDuplicateBaseMealAllocations({
      subscriptionId: subscription._id,
      dayId: day._id,
      apply: true,
      expected: {
        totalMeals: 14,
        remainingMeals: 11,
        reservedMeals: 3,
        duplicateReservationCount: 3,
      },
    }),
    (error) => error && error.code === "REPAIR_PRECONDITION_FAILED"
  );
  const unchanged = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(unchanged.remainingMeals, 8);
  assert.strictEqual(unchanged.reservedMeals, 6);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `duplicate-meal-repair-${Date.now()}` });
    await testDryRunAndGuardedApply();
    await mongoose.connection.dropDatabase();
    await testWrongPreconditionNeverWrites();
    console.log("duplicate meal allocation repair checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
