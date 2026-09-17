"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  buildResidualCounts,
  createManualDeductionCommandService,
} = require("../src/services/dashboard/manualDeduction/manualDeductionCommandService");
const {
  selectReservedRegularAllocationKeys,
} = require("../src/services/dashboard/manualDeduction/manualDeductionRepository");
const {
  validateBalances,
  validateCounts,
} = require("../src/services/dashboard/manualDeduction/manualDeductionPolicy");

async function testStackedReservedPath() {
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
}

function buildRegularAllocation(index, state = "reserved") {
  return {
    allocationKey: `regular-${index}`,
    date: `2026-08-${String(index + 10).padStart(2, "0")}`,
    slotKey: `slot_${index}`,
    state,
    premiumFunding: { source: "none", state: state === "reserved" ? "none" : "consumed" },
  };
}

async function testLegacyReservedPathWithAddons() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const smallSaladId = new mongoose.Types.ObjectId();
  const snackId = new mongoose.Types.ObjectId();
  const initialAllocations = Array.from({ length: 10 }, (_, index) => buildRegularAllocation(index));
  const afterReservedAllocations = initialAllocations.map((allocation, index) => index < 2
    ? { ...allocation, state: "consumed", premiumFunding: { source: "none", state: "consumed" } }
    : allocation);

  const baseSubscription = {
    _id: subscriptionId,
    userId: customerId,
    status: "active",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-30T00:00:00.000Z"),
    deliveryMode: "pickup",
    entitlementVersion: 2,
    totalMeals: 14,
    remainingMeals: 0,
    reservedMeals: 10,
    consumedMeals: 4,
    forfeitedMeals: 0,
    premiumBalance: [],
    baseMealAllocations: initialAllocations,
    addonBalance: [
      {
        addonId: smallSaladId,
        purchasedQty: 7,
        includedTotalQty: 7,
        remainingQty: 4,
        consumedQty: 1,
        reservedQty: 2,
      },
      {
        addonId: snackId,
        purchasedQty: 7,
        includedTotalQty: 7,
        remainingQty: 4,
        consumedQty: 1,
        reservedQty: 2,
      },
    ],
    addonSubscriptions: [
      { addonId: smallSaladId, name: "Small salad", category: "small_salad" },
      { addonId: snackId, name: "Snack", category: "snack" },
    ],
  };

  const afterReserved = {
    ...baseSubscription,
    reservedMeals: 8,
    consumedMeals: 6,
    baseMealAllocations: afterReservedAllocations,
  };
  const afterAll = {
    ...afterReserved,
    addonBalance: afterReserved.addonBalance.map((row) => ({
      ...row,
      remainingQty: 3,
      consumedQty: 2,
    })),
  };

  const body = {
    regularMeals: 2,
    premiumMeals: 0,
    addons: [
      { addonId: String(smallSaladId), qty: 1 },
      { addonId: String(snackId), qty: 1 },
    ],
    reason: "cashier_walk_in",
  };
  const counts = validateCounts(body);
  const before = validateBalances(baseSubscription, counts);
  assert.equal(before.remainingMeals, 0);
  assert.equal(before.reservedMeals, 10);
  assert.equal(before.deductibleMeals, 10);
  assert.equal(before.beforeAddons.length, 2);

  const selectedKeys = selectReservedRegularAllocationKeys(baseSubscription, 2);
  assert.deepEqual(selectedKeys, ["regular-0", "regular-1"]);
  assert.deepEqual(buildResidualCounts(counts, 2), {
    ...counts,
    regularMeals: 0,
    total: 0,
  });

  let findCalls = 0;
  let consumedCalls = 0;
  let atomicCalls = 0;
  let logged = null;
  const repository = {
    isValidObjectId: (value) => mongoose.isValidObjectId(value),
    findSubscriptionById: async () => {
      findCalls += 1;
      return findCalls === 1 ? baseSubscription : afterReserved;
    },
    customerExists: async () => true,
    findLastManualDeduction: async () => null,
    consumeReservedRegularMeals: async ({ quantity }) => {
      consumedCalls += 1;
      assert.equal(quantity, 2);
      return { consumedMeals: 2, allocationKeys: selectedKeys };
    },
    deductAtomically: async ({ subscription, counts: writeCounts }) => {
      atomicCalls += 1;
      assert.equal(subscription.reservedMeals, 8, "atomic addon write must use the post-reservation snapshot");
      assert.equal(writeCounts.regularMeals, 0, "reserved regular meals must not hit remainingMeals again");
      assert.equal(writeCounts.premiumMeals, 0);
      assert.equal(writeCounts.total, 0, "remainingMeals CAS must not require already-reserved meals");
      assert.deepEqual(writeCounts.addons, counts.addons, "addons must stay in the same transaction");
      return afterAll;
    },
    createDeductionLog: async (log) => {
      logged = log;
    },
  };

  const { manualDeduction } = createManualDeductionCommandService({
    repository,
    getBusinessDate: async () => "2026-08-29",
    runTransactionWithRetry: async (callback) => callback({ transaction: true }),
    entitlementBatchDetector: async () => false,
  });

  const result = await manualDeduction({
    subscriptionId: String(subscriptionId),
    body,
    actorId: new mongoose.Types.ObjectId(),
    actorRole: "admin",
    idempotencyKey: "reserved-manual-legacy-addons-0001",
  });

  assert.equal(consumedCalls, 1, "reserved regular allocations must be consumed first");
  assert.equal(atomicCalls, 1, "addons must still use the atomic mutation after reserved meal consumption");
  assert.equal(result.deducted.regularMeals, 2);
  assert.equal(result.deducted.total, 2);
  assert.deepEqual(result.deducted.addons, counts.addons);
  assert.equal(result.balance.availableMeals, 0, "available balance must never become negative");
  assert.equal(result.balance.reservedMeals, 8);
  assert.equal(result.balance.deductibleMeals, 8);
  assert.equal(result.balance.manualDeductionMaxMeals, 8);
  assert.deepEqual(
    result.remaining.addons.map((row) => row.remainingQty),
    [3, 3],
    "both addons must decrement exactly once"
  );
  assert(logged, "manual deduction audit log must still be written");
  assert.equal(logged.meta.deductedRegularMeals, 2);
  assert.equal(logged.meta.deductedAddons.length, 2);
}

async function run() {
  await testStackedReservedPath();
  await testLegacyReservedPathWithAddons();
  console.log("manual deduction with fully reserved meals remains allowed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
