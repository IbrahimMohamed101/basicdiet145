"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  buildOverviewShadowSnapshot,
  compareShadowProjection,
  createCurrentOverviewShadowWrapper,
  isShadowUserAllowed,
  parseShadowUserAllowlist,
} = require("../src/services/subscription/subscriptionStackingShadowService");

function buildOverviewResponse(overrides = {}) {
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
        reservedMeals: 0,
        consumedMeals: 58,
        forfeitedMeals: 0,
        dailyMealsDefault: 3,
      },
      ...overrides,
    },
  };
}

function buildBatch({
  id = new mongoose.Types.ObjectId(),
  mealsPerDay = 3,
  grams = 200,
  totalMeals = 78,
  remainingMeals = 20,
} = {}) {
  return {
    _id: id,
    status: "active",
    effectiveStartDate: "2026-08-01",
    endDate: "2026-08-26",
    validityEndDate: "2026-08-26",
    mealsPerDay,
    proteinGrams: grams,
    totalMeals,
    remainingMeals,
    reservedMeals: 0,
    consumedMeals: totalMeals - remainingMeals,
    forfeitedMeals: 0,
    deliverySnapshot: {
      mode: "delivery",
      zoneId: "zone-a",
      slot: { window: "13:00-15:00" },
      address: { city: "Riyadh", district: "Olaya", street: "A" },
    },
  };
}

function testAllowlistParsingIsClosedByDefault() {
  assert.deepStrictEqual([...parseShadowUserAllowlist("")], []);
  assert.strictEqual(isShadowUserAllowed("user-1", ""), false);
  assert.strictEqual(isShadowUserAllowed("user-1", " user-1, user-2 "), true);
  assert.strictEqual(isShadowUserAllowed("any-user", "*"), true);
}

async function testDisabledShadowDoesNotQueryOrMutate() {
  const response = buildOverviewResponse();
  let findCalls = 0;
  const wrapper = createCurrentOverviewShadowWrapper(
    async () => response,
    {
      shadowEnabled: () => false,
      isUserAllowed: () => true,
      findBatches: async () => {
        findCalls += 1;
        return [];
      },
    }
  );

  const result = await wrapper({ userId: "user-1" });
  assert.strictEqual(result, response, "shadow wrapper must preserve response identity");
  assert.strictEqual(findCalls, 0, "disabled shadow must not query batches");
}

async function testNonAllowlistedUserDoesNotQuery() {
  const response = buildOverviewResponse();
  let findCalls = 0;
  const wrapper = createCurrentOverviewShadowWrapper(
    async () => response,
    {
      shadowEnabled: () => true,
      isUserAllowed: () => false,
      findBatches: async () => {
        findCalls += 1;
        return [];
      },
    }
  );

  const result = await wrapper({ userId: "user-1" });
  assert.strictEqual(result, response);
  assert.strictEqual(findCalls, 0, "non-allowlisted users must never query shadow batches");
}

async function testMatchingProjectionLogsInfoOnly() {
  const response = buildOverviewResponse();
  const infos = [];
  const warnings = [];
  const wrapper = createCurrentOverviewShadowWrapper(
    async () => response,
    {
      shadowEnabled: () => true,
      isUserAllowed: () => true,
      findBatches: async () => [buildBatch()],
      info: (message, meta) => infos.push({ message, meta }),
      warn: (message, meta) => warnings.push({ message, meta }),
      error: () => undefined,
    }
  );

  const result = await wrapper({ userId: "user-1" });
  assert.strictEqual(result, response);
  assert.strictEqual(infos.length, 1);
  assert.strictEqual(infos[0].meta.outcome, "match");
  assert.strictEqual(warnings.length, 0);
}

async function testOverlappingProjectionLogsMismatchWithoutChangingResponse() {
  const response = buildOverviewResponse();
  const before = JSON.stringify(response);
  const warnings = [];
  const wrapper = createCurrentOverviewShadowWrapper(
    async () => response,
    {
      shadowEnabled: () => true,
      isUserAllowed: () => true,
      findBatches: async () => [
        buildBatch(),
        buildBatch({
          mealsPerDay: 2,
          grams: 150,
          totalMeals: 52,
          remainingMeals: 52,
        }),
      ],
      info: () => undefined,
      warn: (message, meta) => warnings.push({ message, meta }),
      error: () => undefined,
    }
  );

  const result = await wrapper({ userId: "user-1" });
  assert.strictEqual(result, response);
  assert.strictEqual(JSON.stringify(result), before, "shadow mode must not mutate payload fields");
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].meta.outcome, "mismatch");
  assert.strictEqual(warnings[0].meta.batchCount, 2);
  assert.strictEqual(warnings[0].meta.mixedProteinGrams, true);
  assert(
    warnings[0].meta.mismatches.some((row) => row.field === "mealBalance.remainingMeals")
  );
  assert(
    warnings[0].meta.mismatches.some((row) => row.field === "requiredMealsPerDay")
  );
}

async function testShadowFailureCannotFailCustomerRequest() {
  const response = buildOverviewResponse();
  const errors = [];
  const wrapper = createCurrentOverviewShadowWrapper(
    async () => response,
    {
      shadowEnabled: () => true,
      isUserAllowed: () => true,
      findBatches: async () => {
        throw new Error("shadow database unavailable");
      },
      info: () => undefined,
      warn: () => undefined,
      error: (message, meta) => errors.push({ message, meta }),
    }
  );

  const result = await wrapper({ userId: "user-1" });
  assert.strictEqual(result, response);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].meta.outcome, "error");
}

function testComparisonContract() {
  const legacy = buildOverviewShadowSnapshot(buildOverviewResponse().data);
  const match = compareShadowProjection({
    legacy,
    projected: {
      mealBalance: { ...legacy.mealBalance },
      requiredMealsPerDay: legacy.requiredMealsPerDay,
    },
  });
  assert.strictEqual(match.matches, true);
  assert.deepStrictEqual(match.mismatches, []);
}

async function run() {
  testAllowlistParsingIsClosedByDefault();
  await testDisabledShadowDoesNotQueryOrMutate();
  await testNonAllowlistedUserDoesNotQuery();
  await testMatchingProjectionLogsInfoOnly();
  await testOverlappingProjectionLogsMismatchWithoutChangingResponse();
  await testShadowFailureCannotFailCustomerRequest();
  testComparisonContract();

  console.log("subscription stacking shadow service tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
