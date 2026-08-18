"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  applyProjectionToCurrentOverviewResponse,
  createCurrentOverviewReadWrapper,
} = require("../src/services/subscription/subscriptionStackingReadService");

function overviewResponse(overrides = {}) {
  return {
    status: true,
    data: {
      subscriptionId: String(new mongoose.Types.ObjectId()),
      businessDate: "2026-08-06",
      totalMeals: 78,
      remainingMeals: 20,
      selectedMealsPerDay: 3,
      mealBalance: {
        totalMeals: 78,
        remainingMeals: 20,
        availableMeals: 20,
        reservedMeals: 0,
        consumedMeals: 58,
        forfeitedMeals: 0,
        canConsumeNow: true,
        maxConsumableMealsNow: 20,
        dailyMealsDefault: 3,
      },
      ...overrides,
    },
  };
}

function batch({
  status = "active",
  start = "2026-08-01",
  end = "2026-08-26",
  mealsPerDay = 3,
  grams = 200,
  totalMeals = 78,
  remainingMeals = 20,
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status,
    effectiveStartDate: start,
    endDate: end,
    validityEndDate: end,
    mealsPerDay,
    proteinGrams: grams,
    totalMeals,
    remainingMeals,
    reservedMeals: 0,
    consumedMeals: Math.max(0, totalMeals - remainingMeals),
    forfeitedMeals: 0,
    deliverySnapshot: {
      mode: "delivery",
      zoneId: "zone-a",
      slot: { window: "13:00-15:00" },
      address: { city: "Riyadh", district: "Olaya", street: "A" },
    },
  };
}

async function testDisabledReadDoesNotQuery() {
  const response = overviewResponse();
  let queryCount = 0;
  const wrapped = createCurrentOverviewReadWrapper(async () => response, {
    readEnabledForUser: () => false,
    writeEnabledForUser: () => false,
    findBatches: async () => {
      queryCount += 1;
      return [];
    },
  });

  const result = await wrapped({ userId: "user-a" });
  assert.strictEqual(result, response);
  assert.strictEqual(queryCount, 0);
}

async function testImmediateOverlapProjectsAggregateBalance() {
  const response = overviewResponse();
  const originalJson = JSON.stringify(response);
  const logs = [];
  const wrapped = createCurrentOverviewReadWrapper(async () => response, {
    readEnabledForUser: () => true,
    writeEnabledForUser: () => true,
    extraActivationEnabledForUser: () => true,
    extraSelectionEnabledForUser: () => true,
    findExtraBuckets: async () => [],
    findBatches: async () => [
      batch(),
      batch({
        mealsPerDay: 2,
        grams: 150,
        totalMeals: 52,
        remainingMeals: 52,
      }),
    ],
    info: (message, meta) => logs.push({ message, meta }),
    error: () => undefined,
  });

  const result = await wrapped({ userId: "user-a" });
  assert.notStrictEqual(result, response);
  assert.strictEqual(JSON.stringify(response), originalJson, "legacy response must remain immutable");
  assert.strictEqual(result.data.totalMeals, 130);
  assert.strictEqual(result.data.remainingMeals, 72);
  assert.strictEqual(result.data.selectedMealsPerDay, 5);
  assert.strictEqual(result.data.mealBalance.totalMeals, 130);
  assert.strictEqual(result.data.mealBalance.remainingMeals, 72);
  assert.strictEqual(result.data.mealBalance.maxConsumableMealsNow, 72);
  assert.strictEqual(result.data.mealBalance.dailyMealsDefault, 5);
  assert.deepStrictEqual(result.data.entitlementGroups, [
    { proteinGrams: 150, requiredMeals: 2 },
    { proteinGrams: 200, requiredMeals: 3 },
  ]);
  assert.strictEqual(result.data.hasMixedProteinGrams, true);
  assert.strictEqual(result.data.entitlementPackages.length, 2);
  assert.strictEqual(result.data.entitlementPackages[0].proteinGrams, 200);
  assert.strictEqual(result.data.entitlementPackages[1].proteinGrams, 150);
  assert.strictEqual(result.data.entitlementPackages.every((row) => row.spendableNow), true);
  assert.deepStrictEqual(result.data.stackingCapabilities, {
    canAddPackage: true,
    canStackBaseMeals: true,
    canStackPremium: true,
    canStackAddons: true,
    canScheduleFuture: true,
  });
  assert.strictEqual(logs.at(-1).meta.mixedProteinGrams, true);
}

async function testFutureBalanceIsZeroBeforeStartWhenBatchesExist() {
  const response = overviewResponse({
    businessDate: "2026-08-10",
  });
  const wrapped = createCurrentOverviewReadWrapper(async () => response, {
    readEnabledForUser: () => true,
    writeEnabledForUser: () => false,
    findBatches: async () => [
      batch({
        status: "expired",
        start: "2026-08-01",
        end: "2026-08-09",
        totalMeals: 27,
        remainingMeals: 20,
      }),
      batch({
        status: "paid_scheduled",
        start: "2026-08-11",
        end: "2026-09-05",
        mealsPerDay: 2,
        grams: 150,
        totalMeals: 52,
        remainingMeals: 52,
      }),
    ],
    info: () => undefined,
    error: () => undefined,
  });

  const result = await wrapped({ userId: "user-a" });
  assert.strictEqual(result.data.totalMeals, 0);
  assert.strictEqual(result.data.remainingMeals, 0);
  assert.strictEqual(result.data.selectedMealsPerDay, 0);
  assert.strictEqual(result.data.mealBalance.canConsumeNow, false);
  assert.strictEqual(result.data.mealBalance.maxConsumableMealsNow, 0);
  assert.strictEqual(result.data.entitlementPackages.length, 2);
  const scheduled = result.data.entitlementPackages.find((row) => row.status === "paid_scheduled");
  assert(scheduled);
  assert.strictEqual(scheduled.proteinGrams, 150);
  assert.strictEqual(scheduled.effectiveStartDate, "2026-08-11");
  assert.strictEqual(scheduled.spendableNow, false);
}

async function testNoBatchesUsesLegacyFallback() {
  const response = overviewResponse();
  const wrapped = createCurrentOverviewReadWrapper(async () => response, {
    readEnabledForUser: () => true,
    writeEnabledForUser: () => false,
    findBatches: async () => [],
    info: () => undefined,
    error: () => undefined,
  });

  const result = await wrapped({ userId: "user-a" });
  assert.strictEqual(result, response);
}

async function testReadFailureFallsBackWhenWritesAreOff() {
  const response = overviewResponse();
  const wrapped = createCurrentOverviewReadWrapper(async () => response, {
    readEnabledForUser: () => true,
    writeEnabledForUser: () => false,
    findBatches: async () => {
      throw new Error("temporary batch query failure");
    },
    info: () => undefined,
    error: () => undefined,
  });

  const result = await wrapped({ userId: "user-a" });
  assert.strictEqual(result, response);
}

async function testReadFailureFailsClosedWhenWritesAreOn() {
  const response = overviewResponse();
  const wrapped = createCurrentOverviewReadWrapper(async () => response, {
    readEnabledForUser: () => true,
    writeEnabledForUser: () => true,
    findBatches: async () => {
      throw new Error("temporary batch query failure");
    },
    info: () => undefined,
    error: () => undefined,
  });

  await assert.rejects(
    () => wrapped({ userId: "user-a" }),
    (err) => Boolean(err && err.code === "STACKING_READ_UNAVAILABLE" && err.status === 503)
  );
}

function testProjectionAdapterPreservesUnknownFields() {
  const response = overviewResponse({ customCompatibilityField: "keep-me" });
  const result = applyProjectionToCurrentOverviewResponse(response, {
    batchCount: 1,
    requiredMealsPerDay: 2,
    mealBalance: {
      totalMeals: 52,
      remainingMeals: 40,
      reservedMeals: 2,
      consumedMeals: 10,
      forfeitedMeals: 0,
    },
  });

  assert.strictEqual(result.data.customCompatibilityField, "keep-me");
  assert.strictEqual(result.data.mealBalance.reservedMeals, 2);
}

async function run() {
  await testDisabledReadDoesNotQuery();
  await testImmediateOverlapProjectsAggregateBalance();
  await testFutureBalanceIsZeroBeforeStartWhenBatchesExist();
  await testNoBatchesUsesLegacyFallback();
  await testReadFailureFallsBackWhenWritesAreOff();
  await testReadFailureFailsClosedWhenWritesAreOn();
  testProjectionAdapterPreservesUnknownFields();

  console.log("subscription stacking current overview read tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
