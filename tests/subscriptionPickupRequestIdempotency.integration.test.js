"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installPickupEntitlementClosure");

const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const dateUtils = require("../src/utils/date");
const {
  createSubscriptionPickupRequestForClient,
} = require("../src/services/subscription/subscriptionPickupRequestClientService");

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `pickup-idempotency-${Date.now()}` });
    await SubscriptionPickupRequest.init();
    await Promise.all([
      Setting.create({ key: "restaurant_is_open", value: true }),
      Setting.create({ key: "restaurant_open_time", value: "00:00" }),
      Setting.create({ key: "restaurant_close_time", value: "23:59" }),
    ]);

    const userId = new mongoose.Types.ObjectId();
    const date = dateUtils.getTodayKSADate();
    const subscription = await Subscription.create({
      userId,
      planId: new mongoose.Types.ObjectId(),
      status: "active",
      startDate: new Date(`${dateUtils.addDaysToKSADateString(date, -1)}T00:00:00Z`),
      endDate: new Date(`${dateUtils.addDaysToKSADateString(date, 30)}T00:00:00Z`),
      validityEndDate: new Date(`${dateUtils.addDaysToKSADateString(date, 30)}T00:00:00Z`),
      totalMeals: 1,
      remainingMeals: 1,
      entitlementVersion: 2,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      baseMealAllocations: [],
      selectedGrams: 200,
      selectedMealsPerDay: 1,
      deliveryMode: "pickup",
      pickupLocationId: "main",
    });
    await SubscriptionDay.create({
      subscriptionId: subscription._id,
      date,
      status: "open",
      plannerState: "confirmed",
      planningState: "confirmed",
      selections: [new mongoose.Types.ObjectId()],
      plannerMeta: {
        requiredSlotCount: 1,
        completeSlotCount: 1,
        isDraftValid: true,
        isConfirmable: true,
        confirmedAt: new Date(),
        confirmedByRole: "client",
      },
      planningMeta: {
        requiredMealCount: 1,
        selectedTotalMealCount: 1,
        isExactCountSatisfied: true,
        confirmedAt: new Date(),
        confirmedByRole: "client",
      },
    });

    const payload = {
      userId,
      subscriptionId: subscription._id,
      date,
      mealCount: 1,
      idempotencyKey: `pickup-concurrent-${Date.now()}`,
    };
    const [first, second] = await Promise.all([
      createSubscriptionPickupRequestForClient(payload),
      createSubscriptionPickupRequestForClient(payload),
    ]);
    const replay = await createSubscriptionPickupRequestForClient(payload);

    assert.strictEqual(String(first.data.requestId), String(second.data.requestId));
    assert.strictEqual(String(first.data.requestId), String(replay.data.requestId));
    assert.strictEqual(replay.idempotent, true);
    assert.strictEqual(await SubscriptionPickupRequest.countDocuments({ subscriptionId: subscription._id }), 1);

    const current = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(current.remainingMeals, 0);
    assert.strictEqual(current.reservedMeals, 1);
    assert.strictEqual(current.consumedMeals, 0);
    assert.strictEqual(current.forfeitedMeals, 0);
    assert.strictEqual(current.baseMealAllocations.length, 1);
    assert.strictEqual(current.remainingMeals + current.reservedMeals + current.consumedMeals + current.forfeitedMeals, current.totalMeals);

    console.log("subscription pickup request idempotency integration checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
