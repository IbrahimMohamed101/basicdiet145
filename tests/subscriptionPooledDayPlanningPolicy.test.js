"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const policy = require("../src/services/installSubscriptionPooledDayPlanningPolicy");
const support = require("../src/services/subscription/subscriptionClientSupportService");
const planner = require("../src/services/subscription/mealSlotPlannerService");
const {
  buildAddonChoicePricingPreview,
} = require("../src/services/subscription/subscriptionAddonPricingService");

function activeSubscription(overrides = {}) {
  return {
    _id: "507f191e810c19729de86001",
    status: "active",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T23:59:59.999Z"),
    validityEndDate: new Date("2026-08-31T23:59:59.999Z"),
    totalMeals: 7,
    remainingMeals: 7,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    baseMealAllocations: [],
    premiumBalance: [],
    addonSubscriptions: [],
    addonBalance: [],
    ...overrides,
  };
}

function testFutureDayUsesRequestedDate() {
  const subscription = activeSubscription({
    totalMeals: 5,
    remainingMeals: 5,
    contractMode: undefined,
  });
  const day = {
    _id: "507f191e810c19729de86002",
    date: "2026-08-10",
    status: "open",
    mealSlots: [],
  };

  const shaped = support.shapeMealPlannerReadFields({
    subscription,
    day,
    lang: "ar",
    businessDate: "2026-07-22",
  });

  assert.strictEqual(shaped.mealBalance.remainingMeals, 5);
  assert.strictEqual(shaped.mealBalance.maxConsumableMealsNow, 5);
  assert.strictEqual(shaped.mealBalance.dailyMealLimitEnforced, false);
  assert.strictEqual(shaped.mealBalance.mealBalancePolicy, "TOTAL_BALANCE_WITHIN_VALIDITY");
}

function testCommittedMealsAreAddedBackForSameDayDisplay() {
  const dayId = "507f191e810c19729de86003";
  const subscription = activeSubscription({
    totalMeals: 5,
    remainingMeals: 3,
    reservedMeals: 2,
    entitlementVersion: 2,
    baseMealAllocations: [
      {
        allocationKey: "allocation-1",
        dayId,
        date: "2026-08-11",
        slotKey: "slot_1",
        state: "reserved",
      },
      {
        allocationKey: "allocation-2",
        dayId,
        date: "2026-08-11",
        slotKey: "slot_2",
        state: "reserved",
      },
    ],
  });
  const day = {
    _id: dayId,
    date: "2026-08-11",
    status: "in_preparation",
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", status: "complete" },
      { slotIndex: 2, slotKey: "slot_2", status: "complete" },
    ],
  };

  const balance = policy.buildDayPooledMealBalance({
    subscription,
    day,
    buildMealBalance: support.buildMealBalance,
  });

  assert.strictEqual(balance.remainingMeals, 3);
  assert.strictEqual(balance.existingCommittedMealsForDay, 2);
  assert.strictEqual(balance.maximumAdditionalMealsNow, 3);
  assert.strictEqual(balance.maxConsumableMealsNow, 5);
}

function testCustomSubscriptionUsesTotalWalletAsPlanningUpperBound() {
  const max = policy.resolvePooledPlannerMax({
    subscription: activeSubscription({
      contractMode: undefined,
      totalMeals: 7,
      remainingMeals: 7,
      selectedMealsPerDay: 1,
    }),
    maxSlotCount: 0,
  });
  assert.strictEqual(max, 7);
}

function testCountErrorsUseFlutterLifecycleCode() {
  const normalized = policy.normalizePlannerLimitResult({
    valid: false,
    errorCode: "MEAL_SLOT_COUNT_EXCEEDED",
    errorMessage: "Only 0 meal slots allowed for this day",
    slotErrors: [{
      slotIndex: 1,
      field: "mealSlots",
      code: "MEAL_SLOT_COUNT_EXCEEDED",
      message: "Only 0 meal slots allowed for this day",
    }],
  });

  assert.strictEqual(normalized.errorCode, "MEAL_PLANNING_LIMIT_EXCEEDED");
  assert.strictEqual(normalized.slotErrors[0].code, "MEAL_PLANNING_LIMIT_EXCEEDED");
  assert.strictEqual(normalized.slotErrors[0].originalCode, "MEAL_SLOT_COUNT_EXCEEDED");
}

function testAppendRecomputeDoesNotReapplyDailyDefaultCap() {
  const result = planner.recomputePlannerMetaFromSlots({
    requiredSlotCount: 1,
    maxSlotCount: 0,
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", status: "complete", selectionType: "standard_meal" },
      { slotIndex: 2, slotKey: "slot_2", status: "complete", selectionType: "standard_meal" },
    ],
  });
  const countErrors = result.slotErrors.filter((entry) =>
    ["MEAL_SLOT_COUNT_EXCEEDED", "COMPLETE_SLOT_COUNT_EXCEEDED"].includes(entry.code)
  );
  assert.strictEqual(countErrors.length, 0);
  assert.strictEqual(result.plannerMeta.completeSlotCount, 2);
}

function testAddonWalletCanBePooledIntoOneDay() {
  const planId = "507f191e810c19729de86010";
  const productId = "507f191e810c19729de86011";
  const bucketId = "507f191e810c19729de86012";
  const entitlement = {
    addonId: planId,
    addonPlanId: planId,
    category: "juice",
    quantityPerDay: 1,
    includedTotalQty: 3,
    menuProductIds: [productId],
    unitPriceHalala: 500,
    currency: "SAR",
  };
  const subscription = activeSubscription({
    addonSubscriptions: [entitlement],
    addonBalance: [{
      _id: bucketId,
      addonId: planId,
      addonPlanId: planId,
      category: "juice",
      includedTotalQty: 3,
      purchasedQty: 3,
      remainingQty: 3,
      reservedQty: 0,
      consumedQty: 0,
      unitPriceHalala: 500,
      currency: "SAR",
    }],
  });
  const product = {
    _id: productId,
    priceHalala: 500,
    currency: "SAR",
    maxPerDay: 1,
  };

  const preview = buildAddonChoicePricingPreview({
    subscription,
    entitlement,
    product,
    category: "juice",
    addonPlanId: planId,
    balanceBucketId: bucketId,
    quantity: 3,
  });

  assert.strictEqual(preview.defaultDailyQty, 1);
  assert.strictEqual(preview.maximumSpendableFromWallet, 3);
  assert.strictEqual(preview.maxPerDay, 3);
  assert.strictEqual(preview.coveredQty, 3);
  assert.strictEqual(preview.paidQty, 0);
  assert.strictEqual(preview.remainingAfter, 0);
  assert.strictEqual(preview.source, "subscription");
}

function run() {
  assert.strictEqual(
    support.shapeMealPlannerReadFields.__pooledDayBalance,
    true,
    "pooled day response wrapper must be installed before tests"
  );
  assert.strictEqual(
    planner.buildMealSlotDraft.__pooledDayBalance,
    true,
    "pooled planner wrapper must be installed before tests"
  );

  testFutureDayUsesRequestedDate();
  testCommittedMealsAreAddedBackForSameDayDisplay();
  testCustomSubscriptionUsesTotalWalletAsPlanningUpperBound();
  testCountErrorsUseFlutterLifecycleCode();
  testAppendRecomputeDoesNotReapplyDailyDefaultCap();
  testAddonWalletCanBePooledIntoOneDay();
  console.log("subscription pooled day planning policy checks passed");
}

run();
