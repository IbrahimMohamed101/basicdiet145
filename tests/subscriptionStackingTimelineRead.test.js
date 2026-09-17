"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");

const {
  applyProjectionToTimelineResult,
  createTimelineReadWrapper,
} = require("../src/services/subscription/subscriptionStackingTimelineReadService");

function dateRange(startDay, endDay) {
  return Array.from({ length: endDay - startDay + 1 }, (_, index) => {
    const day = startDay + index;
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    return {
      date,
      status: "open",
      dayStatus: "open",
      selectedMeals: 0,
      requiredMeals: 3,
      specifiedMealCount: 0,
      unspecifiedMealCount: 3,
      meals: { selected: 0, required: 3, isSatisfied: false },
      dailyMeals: { selected: 0, required: 3, remaining: 3, isComplete: false },
      plannerMeta: { requiredSlotCount: 3, completeSlotCount: 0 },
      planningMeta: { requiredMealCount: 3, selectedTotalMealCount: 0 },
      calendar: {
        year: 2026,
        month: { number: 8, key: "august", labels: { ar: "أغسطس", en: "August" } },
        monthYearLabels: { ar: "أغسطس 2026", en: "August 2026" },
      },
    };
  });
}

function timeline() {
  return {
    subscriptionId: String(new mongoose.Types.ObjectId()),
    days: dateRange(1, 15),
    months: [],
    dailyMealsRequired: 3,
    dailyMealsConfig: { required: 3 },
    mealBalance: {
      totalMeals: 78,
      remainingMeals: 20,
      reservedMeals: 0,
      consumedMeals: 58,
      canConsumeNow: true,
      maxConsumableMealsNow: 20,
      dailyMealsDefault: 3,
    },
  };
}

function batch({
  userId,
  status = "active",
  start = "2026-08-01",
  end = "2026-08-09",
  mealsPerDay = 3,
  grams = 200,
  totalMeals = 27,
  remainingMeals = 20,
  expiredAt = null,
} = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: userId || new mongoose.Types.ObjectId(),
    status,
    effectiveStartDate: start,
    endDate: end,
    validityEndDate: end,
    expiredAt,
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

function testHistoricalExpiredAndOverlappingRequirements() {
  const userId = new mongoose.Types.ObjectId();
  const oldBatch = batch({
    userId,
    status: "expired",
    start: "2026-08-01",
    end: "2026-08-09",
    mealsPerDay: 3,
    totalMeals: 27,
    remainingMeals: 0,
    expiredAt: new Date("2026-08-10T00:00:00+03:00"),
  });
  const newBatch = batch({
    userId,
    status: "active",
    start: "2026-08-05",
    end: "2026-08-30",
    mealsPerDay: 2,
    grams: 150,
    totalMeals: 52,
    remainingMeals: 52,
  });

  const result = applyProjectionToTimelineResult(
    timeline(),
    [oldBatch, newBatch],
    "2026-08-10"
  );

  assert.strictEqual(result.days.length, 15);
  const requiredByDate = new Map(result.days.map((day) => [day.date, day.requiredMeals]));
  assert.strictEqual(requiredByDate.get("2026-08-04"), 3);
  assert.strictEqual(requiredByDate.get("2026-08-05"), 5);
  assert.strictEqual(requiredByDate.get("2026-08-09"), 5);
  assert.strictEqual(requiredByDate.get("2026-08-10"), 2);
  assert.strictEqual(result.dailyMealsRequired, 2);
  assert.strictEqual(result.mealBalance.totalMeals, 52);
  assert.strictEqual(result.mealBalance.remainingMeals, 52);
  assert.strictEqual(result.mealBalance.dailyMealsDefault, 2);
  assert.deepStrictEqual(
    result.days.find((day) => day.date === "2026-08-05").entitlementGroups,
    [
      { proteinGrams: 150, requiredMeals: 2 },
      { proteinGrams: 200, requiredMeals: 3 },
    ]
  );
  assert.strictEqual(result.days.find((day) => day.date === "2026-08-05").hasMixedProteinGrams, true);
  assert.strictEqual(result.entitlementPackages.length, 2);
}

function testFutureScheduledPeriodHiddenUntilStartDate() {
  const userId = new mongoose.Types.ObjectId();
  const oldBatch = batch({
    userId,
    status: "expired",
    start: "2026-08-01",
    end: "2026-08-09",
    remainingMeals: 0,
  });
  const futureBatch = batch({
    userId,
    status: "paid_scheduled",
    start: "2026-08-11",
    end: "2026-09-05",
    mealsPerDay: 2,
    grams: 150,
    totalMeals: 52,
    remainingMeals: 52,
  });

  const beforeStart = applyProjectionToTimelineResult(
    timeline(),
    [oldBatch, futureBatch],
    "2026-08-10"
  );
  assert.strictEqual(beforeStart.days.at(-1).date, "2026-08-09");
  assert.strictEqual(beforeStart.days.some((day) => day.date === "2026-08-11"), false);
  assert.strictEqual(beforeStart.mealBalance.remainingMeals, 0);
  const scheduledPackage = beforeStart.entitlementPackages.find(
    (row) => row.status === "paid_scheduled"
  );
  assert(scheduledPackage);
  assert.strictEqual(scheduledPackage.effectiveStartDate, "2026-08-11");
  assert.strictEqual(scheduledPackage.spendableNow, false);

  const onStart = applyProjectionToTimelineResult(
    timeline(),
    [oldBatch, futureBatch],
    "2026-08-11"
  );
  assert.strictEqual(onStart.days.some((day) => day.date === "2026-08-10"), false);
  assert.strictEqual(onStart.days.some((day) => day.date === "2026-08-11"), true);
  assert.strictEqual(
    onStart.days.find((day) => day.date === "2026-08-11").requiredMeals,
    2
  );
  assert.strictEqual(onStart.mealBalance.remainingMeals, 52);
}

async function testWrapperUsesRestaurantBusinessDateFallback() {
  const sourceTimeline = timeline();
  const userId = new mongoose.Types.ObjectId();
  let businessDateCalls = 0;
  const wrapped = createTimelineReadWrapper(async () => sourceTimeline, {
    globallyEnabled: () => true,
    readEnabledForUser: () => true,
    writeEnabledForUser: () => false,
    getBusinessDate: async () => {
      businessDateCalls += 1;
      return "2026-08-10";
    },
    findBatchesByContainer: async () => [
      batch({
        userId,
        status: "active",
        start: "2026-08-01",
        end: "2026-08-26",
      }),
    ],
    info: () => undefined,
    error: () => undefined,
  });

  const result = await wrapped(sourceTimeline.subscriptionId, {});
  assert.strictEqual(businessDateCalls, 1);
  assert.notStrictEqual(result, sourceTimeline);
  assert.strictEqual(result.dailyMealsRequired, 3);
}

async function testDisabledWrapperDoesNotQuery() {
  const sourceTimeline = timeline();
  let queries = 0;
  const wrapped = createTimelineReadWrapper(async () => sourceTimeline, {
    globallyEnabled: () => false,
    findBatchesByContainer: async () => {
      queries += 1;
      return [];
    },
  });

  const result = await wrapped(sourceTimeline.subscriptionId, {});
  assert.strictEqual(result, sourceTimeline);
  assert.strictEqual(queries, 0);
}

async function testFailureFallsBackUnlessWritesEnabled() {
  const sourceTimeline = timeline();
  const userId = new mongoose.Types.ObjectId();
  const commonRuntime = {
    globallyEnabled: () => true,
    readEnabledForUser: () => true,
    getBusinessDate: async () => "2026-08-10",
    findBatchesByContainer: async () => [batch({ userId })],
    info: () => undefined,
    error: () => undefined,
  };

  const fallback = createTimelineReadWrapper(
    async () => ({ ...sourceTimeline, days: null }),
    { ...commonRuntime, writeEnabledForUser: () => false }
  );
  const fallbackResult = await fallback(sourceTimeline.subscriptionId, {});
  assert.strictEqual(fallbackResult.days, null);

  const failClosed = createTimelineReadWrapper(
    async () => ({ ...sourceTimeline, days: null }),
    { ...commonRuntime, writeEnabledForUser: () => true }
  );
  await assert.rejects(
    () => failClosed(sourceTimeline.subscriptionId, {}),
    (err) => Boolean(err && err.code === "STACKING_TIMELINE_READ_UNAVAILABLE")
  );
}

async function run() {
  testHistoricalExpiredAndOverlappingRequirements();
  testFutureScheduledPeriodHiddenUntilStartDate();
  await testWrapperUsesRestaurantBusinessDateFallback();
  await testDisabledWrapperDoesNotQuery();
  await testFailureFallsBackUnlessWritesEnabled();

  console.log("subscription stacking timeline read tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
