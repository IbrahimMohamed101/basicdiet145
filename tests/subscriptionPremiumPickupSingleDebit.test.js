"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const {
  checkEntitlementInvariants,
  reserveDayEntitlements,
  transitionDayEntitlements,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  consumeReservedPickupMeals,
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");

async function main() {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri(), { serverSelectionTimeoutMS: 10000 });
    const subscription = await Subscription.create({
      userId: new mongoose.Types.ObjectId(),
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      startDate: new Date("2026-07-19T00:00:00.000Z"),
      endDate: new Date("2026-07-26T00:00:00.000Z"),
      validityEndDate: new Date("2026-07-26T00:00:00.000Z"),
      totalMeals: 7,
      remainingMeals: 7,
      selectedGrams: 100,
      selectedMealsPerDay: 1,
      mealsPerDay: 1,
      contractMode: "canonical",
      deliveryMode: "pickup",
      pickupLocationId: "branch_1",
    });

    const day = await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date: "2026-07-19",
      status: "open",
      plannerState: "draft",
      plannerRevisionHash: "premium-large-salad-revision-1",
      mealSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "premium_large_salad",
        productId: new mongoose.Types.ObjectId(),
        productKey: "premium_large_salad",
        selectedOptions: [],
        salad: { presetKey: "premium_large_salad", groups: {} },
        isPremium: true,
        premiumKey: "premium_large_salad",
        premiumSource: "paid_extra",
        premiumExtraFeeHalala: 1800,
      }],
      plannerMeta: {
        requiredSlotCount: 1,
        completeSlotCount: 1,
        premiumSlotCount: 1,
        isDraftValid: true,
      },
    });

    const paymentReservation = await reserveDayEntitlements({
      subscriptionId: subscription._id,
      day,
    });
    assert.equal(paymentReservation.allocationKeys.length, 1);

    const afterPayment = await Subscription.findById(subscription._id).lean();
    assert.equal(afterPayment.remainingMeals, 6, "payment initiation reserves exactly one base meal");
    assert.equal(afterPayment.reservedMeals, 1);
    assert.equal(afterPayment.baseMealAllocations.length, 1);

    const pickupRequest = await SubscriptionPickupRequest.create({
      subscriptionId: subscription._id,
      subscriptionDayId: day._id,
      userId: subscription.userId,
      date: day.date,
      mealCount: 1,
      selectedMealSlotIds: ["slot_1"],
      selectedPickupItemIds: ["slot_1"],
      selectionMode: "slot_ids",
      status: "in_preparation",
      snapshot: { mealSlots: [{ slotIndex: 1, slotKey: "slot_1" }] },
    });

    const firstReserve = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    });
    assert.equal(firstReserve.reserved, true);

    const afterPickup = await Subscription.findById(subscription._id).lean();
    const persistedPickup = await SubscriptionPickupRequest.findById(pickupRequest._id).lean();
    assert.equal(afterPickup.remainingMeals, 6, "pickup request must reuse the paid day reservation instead of deducting a second meal");
    assert.equal(afterPickup.reservedMeals, 1);
    assert.equal(afterPickup.baseMealAllocations.length, 1);
    assert.deepEqual(persistedPickup.baseAllocationKeys, paymentReservation.allocationKeys);
    assert.equal(String(afterPickup.baseMealAllocations[0].pickupRequestId), String(pickupRequest._id));
    assert.equal(checkEntitlementInvariants(afterPickup).valid, true);

    const replay = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: subscription._id,
      pickupRequestId: pickupRequest._id,
      mealCount: 1,
    });
    assert.equal(replay.alreadyReserved, true);
    const afterReplay = await Subscription.findById(subscription._id).lean();
    assert.equal(afterReplay.remainingMeals, 6);
    assert.equal(afterReplay.baseMealAllocations.length, 1);

    await consumeReservedPickupMeals({ pickupRequestId: pickupRequest._id });
    const refreshedDay = await SubscriptionDay.findById(day._id);
    await transitionDayEntitlements({
      subscriptionId: subscription._id,
      day: refreshedDay,
      toState: "consumed",
    });
    const finalSubscription = await Subscription.findById(subscription._id).lean();
    assert.equal(finalSubscription.remainingMeals, 6);
    assert.equal(finalSubscription.reservedMeals, 0);
    assert.equal(finalSubscription.consumedMeals, 1);
    assert.equal(finalSubscription.baseMealAllocations.length, 1);
    assert.equal(checkEntitlementInvariants(finalSubscription).valid, true);

    console.log("subscriptionPremiumPickupSingleDebit.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
