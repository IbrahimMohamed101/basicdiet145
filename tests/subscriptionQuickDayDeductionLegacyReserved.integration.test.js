"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

mongoose.set("autoIndex", true);

const Subscription = require("../src/models/Subscription");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionQuickDayDeduction = require("../src/models/SubscriptionQuickDayDeduction");
const {
  LEGACY_TARGET_ID,
  deduct,
  listOption,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionLegacyService");

function reservedRegularAllocation(index) {
  return {
    allocationKey: `legacy-reserved-${index}`,
    dayId: null,
    date: `2026-08-${String(index + 10).padStart(2, "0")}`,
    slotKey: `slot_${index + 1}`,
    plannerRevisionHash: "",
    quantity: 1,
    state: "reserved",
    reservedAt: new Date("2026-08-20T00:00:00.000Z"),
    premiumFunding: {
      source: "none",
      state: "none",
      premiumKey: "",
    },
  };
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  try {
    await mongoose.connect(replSet.getUri(), {
      serverSelectionTimeoutMS: 10000,
      autoIndex: true,
    });

    await Promise.all([
      SubscriptionEntitlementBatch.syncIndexes(),
      SubscriptionQuickDayDeduction.syncIndexes(),
    ]);

    const subscriptionId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const planId = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const startDate = new Date("2026-08-01T00:00:00+03:00");
    const endDate = new Date("2026-09-30T23:59:59+03:00");

    await Subscription.create({
      _id: subscriptionId,
      userId,
      planId,
      status: "active",
      startDate,
      endDate,
      validityEndDate: endDate,
      totalMeals: 14,
      remainingMeals: 0,
      entitlementVersion: 2,
      reservedMeals: 10,
      consumedMeals: 4,
      forfeitedMeals: 0,
      baseMealAllocations: Array.from({ length: 10 }, (_, index) => reservedRegularAllocation(index)),
      selectedMealsPerDay: 2,
      mealsPerDay: 2,
      selectedGrams: 150,
      deliveryMode: "pickup",
      premiumBalance: [],
    });

    assert.strictEqual(
      await SubscriptionEntitlementBatch.countDocuments({ containerSubscriptionId: subscriptionId }),
      0,
      "fixture must stay on the legacy embedded entitlement path"
    );

    const option = await listOption({ subscriptionId, role: "cashier" });
    assert(option, "fully reserved legacy subscription must remain eligible for quick-day deduction");
    assert.strictEqual(option.id, LEGACY_TARGET_ID);
    assert.strictEqual(option.remainingMeals, 0);
    assert.strictEqual(option.reservedMeals, 10);
    assert.strictEqual(option.deductibleMeals, 10);
    assert.strictEqual(option.mealsPerDay, 2);

    const args = {
      subscriptionId,
      batchId: LEGACY_TARGET_ID,
      days: 1,
      idempotencyKey: "pickup-quick-legacy-reserved-0001",
      actorId,
      actorRole: "cashier",
    };

    const first = await deduct(args);
    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(first.mealsDeducted, 2);
    assert.deepStrictEqual(first.allocationKeys, ["legacy-reserved-0", "legacy-reserved-1"]);

    const updated = await Subscription.findById(subscriptionId).lean();
    assert.strictEqual(updated.remainingMeals, 0, "reserved consumption must not debit available meals below zero");
    assert.strictEqual(updated.reservedMeals, 8);
    assert.strictEqual(updated.consumedMeals, 6);
    assert.strictEqual(updated.forfeitedMeals, 0);
    assert.strictEqual(updated.baseMealAllocations.filter((row) => row.state === "consumed").length, 2);
    assert.strictEqual(updated.baseMealAllocations.filter((row) => row.state === "reserved").length, 8);
    assert.strictEqual(
      await SubscriptionEntitlementBatch.countDocuments({ containerSubscriptionId: subscriptionId }),
      0,
      "legacy reserved deduction must not materialize a stacking batch"
    );

    const replay = await deduct(args);
    assert.strictEqual(replay.idempotent, true);
    const replayed = await Subscription.findById(subscriptionId).lean();
    assert.strictEqual(replayed.remainingMeals, 0);
    assert.strictEqual(replayed.reservedMeals, 8);
    assert.strictEqual(replayed.consumedMeals, 6);
    assert.strictEqual(
      await SubscriptionQuickDayDeduction.countDocuments({ idempotencyKey: args.idempotencyKey }),
      1,
      "replay must not create a second deduction operation"
    );

    console.log("subscriptionQuickDayDeductionLegacyReserved.integration.test.js: OK");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await replSet.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
