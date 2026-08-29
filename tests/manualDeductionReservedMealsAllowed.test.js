"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  createManualDeductionCommandService,
} = require("../src/services/dashboard/manualDeduction/manualDeductionCommandService");
const {
  validateBalances,
  validateCounts,
} = require("../src/services/dashboard/manualDeduction/manualDeductionPolicy");

async function run() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  let legacyAtomicDeductionCalls = 0;
  let stackedCalls = 0;

  const fullyReservedSubscription = {
    _id: subscriptionId,
    userId: customerId,
    status: "active",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-30T00:00:00.000Z"),
    deliveryMode: "pickup",
    entitlementVersion: 2,
    totalMeals: 10,
    remainingMeals: 0,
    reservedMeals: 10,
    consumedMeals: 0,
    forfeitedMeals: 0,
    premiumBalance: [],
    addonBalance: [],
    addonSubscriptions: [],
  };

  const counts = validateCounts({ regularMeals: 3, premiumMeals: 0 });
  const before = validateBalances(fullyReservedSubscription, counts);
  assert.equal(before.remainingMeals, 0);
  assert.equal(before.reservedMeals, 10);
  assert.equal(before.deductibleMeals, 10);

  const repository = {
    isValidObjectId: (value) => mongoose.isValidObjectId(value),
    findSubscriptionById: async () => fullyReservedSubscription,
    customerExists: async () => true,
    findLastManualDeduction: async () => null,
    deductAtomically: async () => {
      legacyAtomicDeductionCalls += 1;
      throw new Error("legacy atomic path must not run for stacked entitlements");
    },
    createDeductionLog: async () => {},
  };

  const expected = {
    subscriptionId: String(subscriptionId),
    deducted: { regularMeals: 3, premiumMeals: 0, total: 3, addons: [] },
    remaining: { regularMeals: 7, premiumMeals: 0, totalMeals: 0, addons: [] },
    balance: {
      availableMeals: 0,
      reservedMeals: 7,
      deductibleMeals: 7,
      manualDeductionMaxMeals: 7,
    },
  };

  const { manualDeduction } = createManualDeductionCommandService({
    repository,
    getBusinessDate: async () => "2026-08-03",
    runTransactionWithRetry: async (callback) => callback({}),
    entitlementBatchDetector: async () => true,
    legacyBatchValidityRepair: async () => {},
    stackedManualDeductionExecutor: async (args) => {
      stackedCalls += 1;
      assert.equal(String(args.subscriptionId), String(subscriptionId));
      assert.equal(args.counts.total, 3);
      assert.equal(args.counts.regularMeals, 3);
      return expected;
    },
  });

  const result = await manualDeduction({
    subscriptionId: String(subscriptionId),
    body: {
      regularMeals: 3,
      premiumMeals: 0,
      reason: "cashier_walk_in",
    },
    actorId: new mongoose.Types.ObjectId(),
    actorRole: "admin",
    idempotencyKey: "reserved-manual-test-0001",
  });

  assert.equal(stackedCalls, 1, "fully reserved stacked balance must reach the reserved-aware executor");
  assert.equal(legacyAtomicDeductionCalls, 0, "stacked balance must never use the legacy remaining-only mutation");
  assert.deepEqual(result, expected);

  console.log("manual deduction with fully reserved meals remains allowed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
