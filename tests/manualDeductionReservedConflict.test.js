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
      {
        allocationKey: "2026-08-03:slot_2",
        date: "2026-08-03",
        slotKey: "slot_2",
        quantity: 1,
        state: "reserved",
      },
    ],
  };

  const repository = {
    isValidObjectId: (value) => mongoose.isValidObjectId(value),
    findSubscriptionById: async () => subscription,
    customerExists: async () => true,
    findLastManualDeduction: async () => null,
    deductAtomically: async () => {
      atomicDeductionCalls += 1;
      return subscription;
    },
    createDeductionLog: async () => {
      logCalls += 1;
    },
  };
  const runTransactionWithRetry = async (callback) => callback({});
  const { manualDeduction } = createManualDeductionCommandService({
    repository,
    getBusinessDate: async () => "2026-08-03",
    runTransactionWithRetry,
  });

  await assert.rejects(
    () => manualDeduction({
      subscriptionId: String(subscriptionId),
      body: {
        regularMeals: 1,
        premiumMeals: 0,
        reason: "cashier_walk_in",
      },
      actorId: new mongoose.Types.ObjectId(),
      actorRole: "admin",
    }),
    (error) => {
      assert.equal(error.code, "MANUAL_DEDUCTION_CONFLICTS_WITH_RESERVED_MEALS");
      assert.equal(error.status, 409);
      assert.equal(error.details.businessDate, "2026-08-03");
      assert.equal(error.details.reservedMeals, 2);
      assert.equal(error.details.actionRequired, "FULFILL_OR_RELEASE_RESERVED_DAY");
      return true;
    }
  );
  assert.equal(atomicDeductionCalls, 0, "reserved-day conflict must stop before balance mutation");
  assert.equal(logCalls, 0, "failed deduction must not create an audit success log");

  console.log("manual deduction reserved conflict tests passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
