"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  createManualDeductionCommandService,
} = require("../src/services/dashboard/manualDeduction/manualDeductionCommandService");

async function run() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  let atomicDeductionCalls = 0;
  let logCalls = 0;

  const subscription = {
    _id: subscriptionId,
    userId: customerId,
    status: "active",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-30T00:00:00.000Z"),
    deliveryMode: "pickup",
    entitlementVersion: 2,
    totalMeals: 30,
    remainingMeals: 24,
    reservedMeals: 2,
    consumedMeals: 4,
    forfeitedMeals: 0,
    premiumBalance: [],
    addonBalance: [],
    addonSubscriptions: [],
    baseMealAllocations: [
      {
        allocationKey: "2026-08-03:slot_1",
        date: "2026-08-03",
        slotKey: "slot_1",
        quantity: 1,
        state: "reserved",
      },
    ],
  };

  const updatedSubscription = {
    ...subscription,
    remainingMeals: 23,
    consumedMeals: 5,
  };

  const repository = {
    isValidObjectId: (value) => mongoose.isValidObjectId(value),
    findSubscriptionById: async () => subscription,
    customerExists: async () => true,
    findLastManualDeduction: async () => null,
    deductAtomically: async () => {
      atomicDeductionCalls += 1;
      return updatedSubscription;
    },
    createDeductionLog: async () => {
      logCalls += 1;
    },
  };

  const { manualDeduction } = createManualDeductionCommandService({
    repository,
    getBusinessDate: async () => "2026-08-03",
    runTransactionWithRetry: async (callback) => callback({}),
  });

  const result = await manualDeduction({
    subscriptionId: String(subscriptionId),
    body: {
      regularMeals: 1,
      premiumMeals: 0,
      reason: "cashier_walk_in",
    },
    actorId: new mongoose.Types.ObjectId(),
    actorRole: "admin",
  });

  assert.equal(atomicDeductionCalls, 1, "manual deduction remains available when a day has reserved meals");
  assert.equal(logCalls, 1, "successful deduction keeps its audit log");
  assert.equal(result.deducted.total, 1);
  assert.equal(result.remaining.totalMeals, 23);
  assert.equal(result.balance.reservedMeals, 2);
  assert.equal(result.balance.displayRemainingMeals, 25);

  console.log("manual deduction with reserved meals remains allowed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
