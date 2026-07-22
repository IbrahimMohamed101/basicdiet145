"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installStableDayMealReservationIdentity");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionMealReservationLock = require("../src/models/SubscriptionMealReservationLock");
const entitlementService = require("../src/services/subscription/subscriptionMealEntitlementService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function standardSlot(index) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "standard_meal",
    proteinId: oid(),
    carbs: [{ carbId: oid(), grams: 100 }],
    isPremium: false,
    premiumSource: "none",
  };
}

function premiumSlot(index, premiumSource) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "premium_meal",
    proteinId: oid(),
    carbs: [{ carbId: oid(), grams: 100 }],
    isPremium: true,
    premiumKey: "shrimp",
    premiumSource,
    premiumExtraFeeHalala: 2000,
  };
}

async function createCase() {
  const subscription = await Subscription.create({
    userId: oid(),
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-21T21:00:00.000Z"),
    endDate: new Date("2026-07-27T21:00:00.000Z"),
    validityEndDate: new Date("2026-07-27T21:00:00.000Z"),
    totalMeals: 14,
    remainingMeals: 14,
    entitlementVersion: 2,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    premiumBalance: [],
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
  });

  const slots = [standardSlot(1), standardSlot(2), premiumSlot(3, "pending_payment")];
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-22",
    status: "open",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "revision-before-premium-payment",
    mealSlots: slots,
    premiumUpgradeSelections: [{
      baseSlotKey: "slot_3",
      premiumKey: "shrimp",
      proteinId: slots[2].proteinId,
      premiumSource: "pending_payment",
      source: "pending_payment",
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      quantity: 1,
      paidQty: 1,
      coveredQty: 0,
    }],
  });

  return { subscription, day };
}

async function wallet(subscriptionId) {
  return Subscription.findById(subscriptionId).lean();
}

function activeDayRows(subscription, dayId) {
  return (subscription.baseMealAllocations || []).filter((row) => (
    String(row.dayId) === String(dayId)
      && ["reserved", "consumed", "forfeited"].includes(String(row.state))
  ));
}

async function testPremiumPaymentRevisionDoesNotDebitAgain() {
  const { subscription, day } = await createCase();

  const first = await entitlementService.reserveDayEntitlements({
    subscriptionId: subscription._id,
    day,
  });
  assert.strictEqual(first.allocationKeys.length, 3);
  assert.strictEqual(first.newlyReservedKeys.length, 3);

  let stored = await wallet(subscription._id);
  assert.strictEqual(stored.totalMeals, 14);
  assert.strictEqual(stored.remainingMeals, 11);
  assert.strictEqual(stored.reservedMeals, 3);
  assert.strictEqual(stored.consumedMeals, 0);
  assert.strictEqual(activeDayRows(stored, day._id).length, 3);

  const paidSlots = day.mealSlots.map((slot) => {
    const plain = slot.toObject ? slot.toObject() : { ...slot };
    return plain.slotKey === "slot_3"
      ? { ...plain, premiumSource: "paid_extra" }
      : plain;
  });
  const paidDay = await SubscriptionDay.findByIdAndUpdate(
    day._id,
    {
      $set: {
        mealSlots: paidSlots,
        plannerRevisionHash: "revision-after-premium-payment",
        "premiumExtraPayment.status": "paid",
      },
    },
    { new: true }
  );

  const second = await entitlementService.reserveDayEntitlements({
    subscriptionId: subscription._id,
    day: paidDay,
  });

  assert.deepStrictEqual(second.allocationKeys.sort(), first.allocationKeys.sort());
  assert.strictEqual(second.newlyReservedKeys.length, 0);

  stored = await wallet(subscription._id);
  assert.strictEqual(stored.totalMeals, 14);
  assert.strictEqual(stored.remainingMeals, 11);
  assert.strictEqual(stored.reservedMeals, 3);
  assert.strictEqual(stored.consumedMeals, 0);
  assert.strictEqual(activeDayRows(stored, day._id).length, 3);

  const storedDay = await SubscriptionDay.findById(day._id).lean();
  assert.strictEqual(storedDay.baseAllocationKeys.length, 3);
  assert.deepStrictEqual(
    [...storedDay.baseAllocationKeys].map(String).sort(),
    first.allocationKeys.map(String).sort()
  );
}

async function testConcurrentDifferentRevisionsStillReserveOnce() {
  const { subscription, day } = await createCase();
  const dayA = day.toObject();
  const dayB = {
    ...day.toObject(),
    plannerRevisionHash: "parallel-paid-revision",
    mealSlots: day.mealSlots.map((slot) => {
      const plain = slot.toObject ? slot.toObject() : { ...slot };
      return plain.slotKey === "slot_3" ? { ...plain, premiumSource: "paid_extra" } : plain;
    }),
  };

  const [first, second] = await Promise.all([
    entitlementService.reserveDayEntitlements({ subscriptionId: subscription._id, day: dayA }),
    entitlementService.reserveDayEntitlements({ subscriptionId: subscription._id, day: dayB }),
  ]);

  assert.strictEqual(first.allocationKeys.length, 3);
  assert.strictEqual(second.allocationKeys.length, 3);
  assert.deepStrictEqual(first.allocationKeys.map(String).sort(), second.allocationKeys.map(String).sort());

  const stored = await wallet(subscription._id);
  assert.strictEqual(stored.remainingMeals, 11);
  assert.strictEqual(stored.reservedMeals, 3);
  assert.strictEqual(activeDayRows(stored, day._id).length, 3);
}

async function testExistingDuplicateRowsFailClosed() {
  const { subscription, day } = await createCase();
  const first = await entitlementService.reserveDayEntitlements({
    subscriptionId: subscription._id,
    day,
  });
  const original = (await wallet(subscription._id)).baseMealAllocations.find(
    (row) => String(row.allocationKey) === String(first.allocationKeys[0])
  );
  const duplicate = {
    ...original,
    _id: oid(),
    allocationKey: `duplicate-${original.allocationKey}`,
    plannerRevisionHash: "different-revision",
    reservedAt: new Date(),
  };
  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $push: { baseMealAllocations: duplicate },
      $inc: { remainingMeals: -1, reservedMeals: 1 },
    }
  );

  await assert.rejects(
    () => entitlementService.reserveDayEntitlements({ subscriptionId: subscription._id, day }),
    (error) => error && error.code === "DUPLICATE_DAY_SLOT_ALLOCATIONS"
  );
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `stable-day-meal-reservation-${Date.now()}` });
    await testPremiumPaymentRevisionDoesNotDebitAgain();
    await mongoose.connection.dropDatabase();
    await testConcurrentDifferentRevisionsStillReserveOnce();
    await mongoose.connection.dropDatabase();
    await testExistingDuplicateRowsFailClosed();
    console.log("stable subscription day meal reservation checks passed");
  } finally {
    await SubscriptionMealReservationLock.deleteMany({}).catch(() => {});
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
