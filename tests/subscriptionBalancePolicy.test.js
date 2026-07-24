"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const ActivityLog = require("../src/models/ActivityLog");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const Delivery = require("../src/models/Delivery");
const { buildSubscriptionTimeline } = require("../src/services/subscription/subscriptionTimelineService");
const { applyOperationalSkipForDate } = require("../src/services/subscription/subscriptionSkipService");
const { freezeSubscriptionForClient, unfreezeSubscriptionForClient } = require("../src/services/subscription/subscriptionFreezeClientService");
const { cancelSubscriptionDomain } = require("../src/services/subscription/subscriptionCancellationService");
const { recordCashierConsumption } = require("../src/services/dashboard/cashierConsumptionService");
const { listOperations, getEnrichedDTO } = require("../src/services/dashboard/opsReadService");
const { executeAction } = require("../src/services/dashboard/opsTransitionService");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../src/services/subscription/subscriptionPickupRequestBalanceService");
const {
  performDaySelectionUpdate,
  performDaySelectionValidation,
} = require("../src/services/subscription/subscriptionSelectionService");
const { markPickupNoShow } = require("../src/controllers/kitchenController");
const { runMongoTransactionWithRetry } = require("../src/services/mongoTransactionRetryService");
const dateUtils = require("../src/utils/date");
const BuilderProtein = require("../src/models/BuilderProtein");
const BuilderCarb = require("../src/models/BuilderCarb");
const MealCategory = require("../src/models/MealCategory");
const Meal = require("../src/models/Meal");
const SaladIngredient = require("../src/models/SaladIngredient");
const Sandwich = require("../src/models/Sandwich");

const TEST_TAG = `balance-policy-${Date.now()}`;
const TEST_DB_NAME = TEST_TAG.replace(/-/g, "_");
let replSet;
dateUtils.getTodayKSADate = () => "2026-06-01";
const PLANNER_IDS = {
  regularProtein: "507f191e810c19729de870a1",
  premiumProtein: "507f191e810c19729de870a2",
  carbOne: "507f191e810c19729de870b1",
};

function mockQuery(result) {
  return {
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
  };
}

async function withMockedPlannerCatalog(fn) {
  const originalProteinFind = BuilderProtein.find;
  const originalProteinFindOne = BuilderProtein.findOne;
  const originalCarbFind = BuilderCarb.find;
  const originalMealCategoryFindOne = MealCategory.findOne;
  const originalMealFind = Meal.find;
  const originalSaladIngredientFind = SaladIngredient.find;
  const originalSandwichFind = Sandwich.find;

  BuilderProtein.find = () => mockQuery([
    {
      _id: PLANNER_IDS.regularProtein,
      isPremium: false,
      premiumKey: null,
      displayCategoryKey: "chicken",
      proteinFamilyKey: "chicken",
      ruleTags: [],
      extraFeeHalala: 0,
    },
    {
      _id: PLANNER_IDS.premiumProtein,
      isPremium: true,
      premiumKey: "shrimp",
      displayCategoryKey: "premium",
      proteinFamilyKey: "fish",
      ruleTags: ["premium"],
      extraFeeHalala: 1500,
    },
  ]);
  BuilderProtein.findOne = () => mockQuery({
    _id: PLANNER_IDS.premiumProtein,
    isPremium: true,
    premiumKey: "shrimp",
    displayCategoryKey: "premium",
    proteinFamilyKey: "fish",
    ruleTags: ["premium"],
    extraFeeHalala: 1500,
    isActive: true,
    availableForSubscription: true,
  });
  BuilderCarb.find = () => mockQuery([
    { _id: PLANNER_IDS.carbOne, isActive: true, availableForSubscription: true, displayCategoryKey: "standard_carbs" },
  ]);
  MealCategory.findOne = () => mockQuery(null);
  Meal.find = () => mockQuery([]);
  SaladIngredient.find = () => mockQuery([]);
  Sandwich.find = () => mockQuery([]);

  try {
    return await fn();
  } finally {
    BuilderProtein.find = originalProteinFind;
    BuilderProtein.findOne = originalProteinFindOne;
    BuilderCarb.find = originalCarbFind;
    MealCategory.findOne = originalMealCategoryFindOne;
    Meal.find = originalMealFind;
    SaladIngredient.find = originalSaladIngredientFind;
    Sandwich.find = originalSandwichFind;
  }
}

function buildStandardSlots(count) {
  return Array.from({ length: count }, (_, index) => ({
    slotIndex: index + 1,
    selectionType: "standard_meal",
    proteinId: PLANNER_IDS.regularProtein,
    carbs: [{ carbId: PLANNER_IDS.carbOne, grams: 150 }],
  }));
}

async function connect() {
  if (mongoose.connection.readyState === 0) {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, dbName: TEST_DB_NAME },
    });
    const uri = replSet.getUri(TEST_DB_NAME);
    process.env.MONGO_URI = uri;
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  }
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((sub) => sub._id);
  const plans = await Plan.find({ "name.en": { $regex: TEST_TAG } }).select("_id").lean();
  const planIds = plans.map((plan) => plan._id);

  await Promise.all([
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    SubscriptionAuditLog.deleteMany({ "meta.subscriptionId": { $in: subscriptionIds.map(String) } }),
    SubscriptionAuditLog.deleteMany({ entityId: { $in: subscriptionIds } }),
    ActivityLog.deleteMany({ entityId: { $in: subscriptionIds } }),
    ActivityLog.deleteMany({ "meta.subscriptionId": { $in: subscriptionIds.map(String) } }),
    Delivery.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function assertRemainingMeals(subscriptionId, expected, message) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  assert(subscription, "subscription should exist");
  assert.strictEqual(subscription.remainingMeals, expected, message);
}

async function seedSubscription({
  deliveryMode = "delivery",
  remainingMeals = 30,
  totalMeals = 30,
  selectedMealsPerDay = 2,
  contractMode,
  phoneSuffix = "000",
} = {}) {
  const phone = `+1555${Date.now()}${phoneSuffix}${TEST_TAG}`;
  const user = await User.create({
    phone,
    name: `${TEST_TAG} User`,
    role: "client",
    isActive: true,
  });
  const plan = await Plan.create({
    name: { ar: "", en: `${TEST_TAG} Plan ${deliveryMode}` },
    daysCount: 14,
    currency: "SAR",
    isActive: true,
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{ mealsPerDay: 2, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
    }],
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-06-01T00:00:00+03:00"),
    endDate: new Date("2026-06-15T00:00:00+03:00"),
    validityEndDate: new Date("2026-07-30T00:00:00+03:00"),
    totalMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay,
    ...(contractMode ? { contractMode } : {}),
    deliveryMode,
    deliveryAddress: deliveryMode === "delivery" ? { line1: "Test address" } : undefined,
    deliveryWindow: deliveryMode === "delivery" ? "13:00-16:00" : "",
    pickupLocationId: deliveryMode === "pickup" ? "branch-test" : "",
  });
  return { user, plan, subscription, phone };
}

async function runTests() {
  try {
    await connect();
    await cleanup();

    console.log("Setting up testing payload...");
    const { subscription: sub1, phone: sub1Phone } = await seedSubscription({ deliveryMode: "delivery", remainingMeals: 30, phoneSuffix: "001" });
    const { subscription: sub2, phone: sub2Phone } = await seedSubscription({ deliveryMode: "pickup", remainingMeals: 30, phoneSuffix: "002" });
    const { subscription: sub3 } = await seedSubscription({
      deliveryMode: "pickup",
      remainingMeals: 7,
      totalMeals: 7,
      selectedMealsPerDay: 1,
      contractMode: "canonical",
      phoneSuffix: "003",
    });
    const { subscription: legacySub } = await seedSubscription({
      deliveryMode: "pickup",
      remainingMeals: 7,
      totalMeals: 7,
      selectedMealsPerDay: 1,
      phoneSuffix: "004",
    });

    // Populate old days
    await SubscriptionDay.create([
      { subscriptionId: sub1._id, date: "2026-06-01", status: "open" },
      { subscriptionId: sub1._id, date: "2026-06-02", status: "locked", lockedSnapshot: { mealsPerDay: 2 } },
      { subscriptionId: sub1._id, date: "2026-06-03", status: "out_for_delivery", lockedSnapshot: { mealsPerDay: 2 } }
    ]);
    await SubscriptionDay.create([
      { subscriptionId: sub2._id, date: "2026-06-01", status: "ready_for_pickup", pickupRequested: true, lockedSnapshot: { mealsPerDay: 2 } }
    ]);

    // Test 1: Timeline/read endpoints do not mutate remainingMeals and past days do not auto-consume
    const timeline1 = await buildSubscriptionTimeline(sub1._id, {
      lang: "en",
      // Act as if today is late June
      now: new Date("2026-06-20T08:00:00Z"),
      businessDate: "2026-06-20",
    });
    const sub1AfterRead = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterRead.remainingMeals, 30, "Timeline endpoint must not mutate remainingMeals");
    
    // Test 2: Past open/locked/out_for_delivery days do not auto-consume
    const day01 = await SubscriptionDay.findOne({ subscriptionId: sub1._id, date: "2026-06-01" }).lean();
    assert.strictEqual(day01.status, "open", "Past open day remains open");
    
    // Test 8: Repeated GET reads do not change remainingMeals
    for (let i = 0; i < 3; i++) {
      await buildSubscriptionTimeline(sub1._id, { lang: "en", now: new Date(), businessDate: "2026-06-20" });
    }
    const sub1Repeated = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1Repeated.remainingMeals, 30, "Repeated reads must not mutate remainingMeals");

    // Test 3: Operational skip does not deduct remainingMeals
    await runMongoTransactionWithRetry(
      (session) => applyOperationalSkipForDate({ sub: sub1AfterRead, date: "2026-06-04", session }),
      { label: "subscription_balance_policy_operational_skip" }
    );
    
    const sub1AfterSkip = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterSkip.remainingMeals, 30, "applyOperationalSkipForDate must not deduct remainingMeals");
    const skippedDay = await SubscriptionDay.findOne({ subscriptionId: sub1._id, date: "2026-06-04" }).lean();
    assert.strictEqual(skippedDay.status, "skipped", "Day was skipped");
    assert.strictEqual(skippedDay.creditsDeducted, false, "Credits were NOT deducted");

    // Test 4: markPickupNoShow does not deduct remainingMeals
    const resMock = {
      status: function (code) { this.statusCode = code; return this; },
      json: function (data) { this.body = data; return this; }
    };
    const reqMock = { params: { dayId: (await SubscriptionDay.findOne({ subscriptionId: sub2._id, date: "2026-06-01" }).lean())._id } };
    await markPickupNoShow(reqMock, resMock);
    
    assert.strictEqual(resMock.statusCode, 200, "markPickupNoShow should succeed");
    const sub2AfterNoShow = await Subscription.findById(sub2._id).lean();
    assert.strictEqual(sub2AfterNoShow.remainingMeals, 30, "markPickupNoShow must not deduct remainingMeals");
    const noShowDay = await SubscriptionDay.findOne({ subscriptionId: sub2._id, date: "2026-06-01" }).lean();
    assert.strictEqual(noShowDay.status, "no_show", "Pickup day transitioned to no_show");

    // Test 4a: freeze does not deduct remainingMeals
    const { subscription: freezeSub } = await seedSubscription({
      deliveryMode: "pickup",
      remainingMeals: 7,
      totalMeals: 7,
      selectedMealsPerDay: 1,
      phoneSuffix: "006",
    });
    await Subscription.updateOne(
      { _id: freezeSub._id },
      {
        $set: {
          startDate: new Date("2026-06-07T00:00:00+03:00"),
          endDate: new Date("2026-06-14T00:00:00+03:00"),
          validityEndDate: new Date("2026-06-14T00:00:00+03:00"),
        },
      }
    );
    const freezeResult = await freezeSubscriptionForClient({
      subscriptionId: freezeSub._id,
      startDate: "2026-06-08",
      days: 1,
      userId: freezeSub.userId,
      ensureActiveFn: () => {},
      validateFutureDateOrThrowFn: () => {},
      writeLogSafelyFn: async () => {},
    });
    assert.strictEqual(freezeResult.ok, true, "Freeze should succeed");
    await assertRemainingMeals(freezeSub._id, 7, "freeze must not deduct remainingMeals");
    const frozenDay = await SubscriptionDay.findOne({ subscriptionId: freezeSub._id, date: "2026-06-08" }).lean();
    assert.strictEqual(frozenDay.status, "frozen", "Day was frozen");
    assert.strictEqual(frozenDay.creditsDeducted, false, "Freeze did not mark credits deducted");
    const parentAfterFreeze = await Subscription.findById(freezeSub._id).lean();
    assert.strictEqual(parentAfterFreeze.status, "active", "Freeze is day-level; parent subscription remains active");

    const unfreezeResult = await unfreezeSubscriptionForClient({
      subscriptionId: freezeSub._id,
      startDate: "2026-06-08",
      days: 1,
      userId: freezeSub.userId,
      ensureActiveFn: () => {},
      validateFutureDateOrThrowFn: () => {},
      writeLogSafelyFn: async () => {},
    });
    assert.strictEqual(unfreezeResult.ok, true, "Unfreeze should succeed");
    await assertRemainingMeals(freezeSub._id, 7, "unfreeze must not deduct remainingMeals");
    const unfrozenDay = await SubscriptionDay.findOne({ subscriptionId: freezeSub._id, date: "2026-06-08" }).lean();
    assert.strictEqual(unfrozenDay.status, "open", "Day was unfrozen back to open");

    const { subscription: cancelActiveSub } = await seedSubscription({
      deliveryMode: "pickup",
      remainingMeals: 7,
      totalMeals: 7,
      selectedMealsPerDay: 1,
      phoneSuffix: "007",
    });
    await SubscriptionDay.create([
      { subscriptionId: cancelActiveSub._id, date: "2026-06-09", status: "open" },
      { subscriptionId: cancelActiveSub._id, date: "2026-06-10", status: "frozen" },
      { subscriptionId: cancelActiveSub._id, date: "2026-06-11", status: "ready_for_pickup" },
    ]);
    const cancelActiveResult = await cancelSubscriptionDomain({
      subscriptionId: cancelActiveSub._id,
      actor: { kind: "client", userId: cancelActiveSub.userId },
      runtime: { getTodayKSADate: async () => "2026-06-09" },
    });
    assert.strictEqual(cancelActiveResult.outcome, "canceled", "Active subscription cancellation should succeed");
    const canceledActive = await Subscription.findById(cancelActiveSub._id).lean();
    assert.strictEqual(canceledActive.status, "canceled", "Active subscription transitions to canceled");
    assert.strictEqual(canceledActive.remainingMeals, 1, "Active cancellation preserves committed undeducted credits only");

    const { subscription: cancelPendingSub } = await seedSubscription({
      deliveryMode: "pickup",
      remainingMeals: 7,
      totalMeals: 7,
      selectedMealsPerDay: 1,
      phoneSuffix: "008",
    });
    await Subscription.updateOne({ _id: cancelPendingSub._id }, { $set: { status: "pending_payment" } });
    const cancelPendingResult = await cancelSubscriptionDomain({
      subscriptionId: cancelPendingSub._id,
      actor: { kind: "client", userId: cancelPendingSub.userId },
    });
    assert.strictEqual(cancelPendingResult.outcome, "canceled", "Pending subscription cancellation should succeed");
    const canceledPending = await Subscription.findById(cancelPendingSub._id).lean();
    assert.strictEqual(canceledPending.status, "canceled", "Pending subscription transitions to canceled");
    assert.strictEqual(canceledPending.remainingMeals, 0, "Pending cancellation clears remaining meals");

    for (const finalStatus of ["expired", "completed"]) {
      const { subscription: finalSub } = await seedSubscription({
        deliveryMode: "pickup",
        remainingMeals: 7,
        totalMeals: 7,
        selectedMealsPerDay: 1,
        phoneSuffix: `final-${finalStatus}`,
      });
      await Subscription.updateOne({ _id: finalSub._id }, { $set: { status: finalStatus } });
      const finalCancelResult = await cancelSubscriptionDomain({
        subscriptionId: finalSub._id,
        actor: { kind: "client", userId: finalSub.userId },
      });
      assert.strictEqual(finalCancelResult.outcome, "invalid_transition", `Final ${finalStatus} subscription cannot be canceled`);
    }

    // Test 4a.1: dashboard GET/read endpoints do not mutate remainingMeals
    await listOperations({ date: "2026-06-01", role: "admin", lang: "en" });
    await getEnrichedDTO({ entityId: noShowDay._id, entityType: "subscription", role: "admin", lang: "en" });
    await assertRemainingMeals(sub2._id, 30, "dashboard read endpoints must not deduct remainingMeals");

    // Test 4a.2: prepare, ready_for_pickup, no_show, cancel do not deduct for pickup subscriptions
    const pickupOpsDay = await SubscriptionDay.create({
      subscriptionId: sub2._id,
      date: "2026-06-07",
      status: "locked",
      pickupRequested: true,
      lockedSnapshot: { mealsPerDay: 2, requiredMealCount: 2 },
    });
    await SubscriptionPickupRequest.create({
      subscriptionId: sub2._id,
      userId: sub2.userId,
      date: "2026-06-07",
      mealCount: 2,
      status: "locked",
      creditsReserved: true,
    });
    await executeAction("prepare", {
      entityId: pickupOpsDay._id,
      entityType: "subscription",
      userId: sub2.userId,
      role: "admin",
      payload: {},
    });
    await assertRemainingMeals(sub2._id, 30, "prepare must not deduct remainingMeals");
    await executeAction("ready_for_pickup", {
      entityId: pickupOpsDay._id,
      entityType: "subscription",
      userId: sub2.userId,
      role: "admin",
      payload: {},
    });
    await assertRemainingMeals(sub2._id, 30, "ready_for_pickup must not deduct remainingMeals");
    await executeAction("cancel", {
      entityId: pickupOpsDay._id,
      entityType: "subscription",
      userId: sub2.userId,
      role: "admin",
      payload: { noShow: true, reason: "customer_no_show" },
    });
    await assertRemainingMeals(sub2._id, 30, "no_show/cancel must not deduct remainingMeals");

    const pickupFulfillDay = await SubscriptionDay.create({
      subscriptionId: sub2._id,
      date: "2026-06-09",
      status: "ready_for_pickup",
      pickupRequested: true,
      lockedSnapshot: { mealsPerDay: 2, requiredMealCount: 2 },
    });
    const pickupFulfillRequest = await SubscriptionPickupRequest.create({
      subscriptionId: sub2._id,
      userId: sub2.userId,
      date: "2026-06-09",
      mealCount: 2,
      status: "ready_for_pickup",
    });
    const pickupReservation = await reserveSubscriptionMealsForPickupRequest({
      subscriptionId: sub2._id,
      pickupRequestId: pickupFulfillRequest._id,
      mealCount: 2,
    });
    assert.strictEqual(pickupReservation.reserved, true, "Pickup reservation should reserve the requested meals");
    await assertRemainingMeals(sub2._id, 28, "pickup reservation deducts the exact reserved count once");

    const pickupFulfillResult = await fulfillSubscriptionDay({ dayId: pickupFulfillDay._id });
    assert.strictEqual(pickupFulfillResult.ok, true, "Pickup fulfill should succeed");
    await assertRemainingMeals(sub2._id, 28, "pickup fulfill consumes the reservation without deducting again");
    const consumedPickupRequest = await SubscriptionPickupRequest.findById(pickupFulfillRequest._id).lean();
    assert(consumedPickupRequest.creditsConsumedAt, "Pickup request reservation is marked consumed");

    const repeatedPickupFulfillResult = await fulfillSubscriptionDay({ dayId: pickupFulfillDay._id });
    assert.strictEqual(repeatedPickupFulfillResult.ok, true, "Repeated pickup fulfill should be idempotent");
    await assertRemainingMeals(sub2._id, 28, "repeated pickup fulfill does not deduct again");

    // Test 4a.3: delivery dispatch, notify_arrival, and cancellation do not deduct
    const deliveryOpsDay = await SubscriptionDay.create({
      subscriptionId: sub1._id,
      date: "2026-06-08",
      status: "ready_for_delivery",
      lockedSnapshot: {
        mealsPerDay: 2,
        requiredMealCount: 2,
        address: { line1: "Dispatch address" },
        deliveryWindow: "13:00-16:00",
      },
    });
    await executeAction("dispatch", {
      entityId: deliveryOpsDay._id,
      entityType: "subscription",
      userId: sub1.userId,
      role: "admin",
      payload: {},
    });
    await assertRemainingMeals(sub1._id, 30, "dispatch must not deduct remainingMeals");
    await executeAction("notify_arrival", {
      entityId: deliveryOpsDay._id,
      entityType: "subscription",
      userId: sub1.userId,
      role: "admin",
      payload: {},
    });
    await assertRemainingMeals(sub1._id, 30, "notify_arrival must not deduct remainingMeals");
    await executeAction("cancel", {
      entityId: deliveryOpsDay._id,
      entityType: "subscription",
      userId: sub1.userId,
      role: "admin",
      payload: { reason: "customer_issue" },
    });
    await assertRemainingMeals(sub1._id, 30, "delivery cancel must not deduct remainingMeals");

    // Test 4b: repeated fulfillment deducts exactly once
    await SubscriptionDay.create({
      subscriptionId: sub1._id,
      date: "2026-06-05",
      status: "out_for_delivery",
      lockedSnapshot: { mealsPerDay: 2 },
    });
    let fulfillResult = await fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-05" });
    assert.strictEqual(fulfillResult.ok, true, "First fulfillment should succeed");
    fulfillResult = await fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-05" });
    assert.strictEqual(fulfillResult.ok, true, "Repeated fulfillment should be idempotent");
    const sub1AfterRepeatedFulfill = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterRepeatedFulfill.remainingMeals, 28, "Repeated fulfill deducts only once");

    // Test 4c: concurrent fulfillment deducts exactly once
    await SubscriptionDay.create({
      subscriptionId: sub1._id,
      date: "2026-06-06",
      status: "out_for_delivery",
      lockedSnapshot: { mealsPerDay: 2 },
    });
    const concurrentFulfillResults = await Promise.all([
      fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-06" }),
      fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-06" }),
      fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-06" }),
      fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-06" }),
      fulfillSubscriptionDay({ subscriptionId: sub1._id, date: "2026-06-06" }),
    ]);
    assert(concurrentFulfillResults.every((result) => result.ok), "Concurrent fulfillment calls should resolve successfully");
    const sub1AfterConcurrentFulfill = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterConcurrentFulfill.remainingMeals, 26, "Concurrent fulfill deducts only once");
    const concurrentFulfilledDay = await SubscriptionDay.findOne({ subscriptionId: sub1._id, date: "2026-06-06" }).lean();
    assert.strictEqual(concurrentFulfilledDay.status, "fulfilled", "Concurrent fulfilled day is fulfilled");
    assert.strictEqual(concurrentFulfilledDay.creditsDeducted, true, "Concurrent fulfilled day marks credits deducted");
    assert.strictEqual(concurrentFulfilledDay.fulfilledSnapshot.deductedCredits, 2, "Concurrent fulfilled day snapshot stores deducted credits");

    // Test 4d: fulfilled meal-slot count, not daily default, controls deduction
    const { subscription: exactSub } = await seedSubscription({
      deliveryMode: "delivery",
      remainingMeals: 7,
      totalMeals: 7,
      selectedMealsPerDay: 1,
      contractMode: "canonical",
      phoneSuffix: "005",
    });
    await SubscriptionDay.create({
      subscriptionId: exactSub._id,
      date: "2026-06-23",
      status: "out_for_delivery",
      plannerState: "confirmed",
      planningState: "confirmed",
      lockedSnapshot: { mealsPerDay: 1, requiredMealCount: 1 },
      mealSlots: buildStandardSlots(3).map((slot) => ({ ...slot, status: "complete" })),
      plannerMeta: { requiredSlotCount: 1, maxSlotCount: 7, completeSlotCount: 3, premiumSlotCount: 0, isDraftValid: true, isConfirmable: true },
      planningMeta: { requiredMealCount: 1, selectedTotalMealCount: 3, isExactCountSatisfied: true },
    });
    const exactFulfillResult = await fulfillSubscriptionDay({ subscriptionId: exactSub._id, date: "2026-06-23" });
    assert.strictEqual(exactFulfillResult.ok, true, "Fulfillment with 3 selected meals should succeed");
    const exactSubAfterFulfill = await Subscription.findById(exactSub._id).lean();
    assert.strictEqual(exactSubAfterFulfill.remainingMeals, 4, "Fulfillment deducts exact selected meal count, not dailyMealsDefault");
    const exactFulfilledDay = await SubscriptionDay.findOne({ subscriptionId: exactSub._id, date: "2026-06-23" }).lean();
    assert.strictEqual(exactFulfilledDay.fulfilledSnapshot.deductedCredits, 3, "Fulfilled snapshot records exact deducted credits");

    // Test 5 & 9: Cashier can consume more than dailyMealsDefault, creates audit log
    const cashierConsumption = await recordCashierConsumption({
      phone: sub1Phone,
      subscriptionId: sub1._id,
      mealCount: 7, // Default is 2
      actor: { actorId: sub1._id, actorType: "admin" }
    });
    assert.strictEqual(cashierConsumption.consumption.mealCount, 7, "Cashier deduced 7 meals, ignoring dailyMealsDefault");
    const sub1AfterCashier = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterCashier.remainingMeals, 19, "Remaining meals correctly decoupled from calendar and decremented");
    
    const auditLogs = await ActivityLog.find({
      entityType: "subscription",
      entityId: sub1._id,
      action: "manual_subscription_meal_deduction",
    }).lean();
    assert.strictEqual(auditLogs.length, 1, "Canonical manual deduction audit log correctly generated");
    assert.strictEqual(auditLogs[0].meta.reason, "cashier_manual_consumption", "Audit reason preserves the cashier compatibility source");
    assert.strictEqual(auditLogs[0].meta.deductedRegularMeals, 7, "Audit log records the exact deducted meal count");
    
    // Test 6: Cashier cannot consume more than remainingMeals
    try {
      await recordCashierConsumption({
        phone: sub1Phone,
        subscriptionId: sub1._id,
        mealCount: 50,
      });
      assert.fail("Should have thrown INSUFFICIENT_CREDITS");
    } catch (err) {
      assert.strictEqual(err.code, "INSUFFICIENT_CREDITS", "Cannot consume more than available");
    }
    const sub1AfterFailedCashier = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterFailedCashier.remainingMeals, 19, "Failed over-consumption must not change remainingMeals");
    
    // Test 7: Expired subscription blocks cashier consumption
    // Move validityEndDate to yesterday
    await Subscription.updateOne({ _id: sub1._id }, { validityEndDate: new Date("2026-01-01T00:00:00Z") });
    try {
      await recordCashierConsumption({
        phone: sub1Phone,
        subscriptionId: sub1._id,
        mealCount: 1,
      });
      assert.fail("Should have thrown SUBSCRIPTION_EXPIRED");
    } catch (err) {
      assert.strictEqual(err.code, "SUBSCRIPTION_EXPIRED", "Expired subscriptions block further consumption");
    }

    await withMockedPlannerCatalog(async () => {
      // Test 10: Validate endpoint/service accepts more than selectedMealsPerDay up to maxConsumableMealsNow
      const validation3 = await performDaySelectionValidation({
        userId: sub3.userId,
        subscriptionId: sub3._id,
        date: "2026-07-01",
        mealSlots: buildStandardSlots(3),
      });
      assert.strictEqual(validation3.valid, true, "Validation accepts 3 slots when requiredMealCount is 1 and remainingMeals is 7");
      assert.strictEqual(validation3.plannerMeta.requiredSlotCount, 1, "requiredSlotCount stays the default planning count");
      assert.strictEqual(validation3.plannerMeta.maxSlotCount, 7, "maxSlotCount comes from maxConsumableMealsNow");
      assert.strictEqual(validation3.plannerMeta.completeSlotCount, 3, "all 3 slots are complete");

      // Test 11: Validate endpoint/service rejects over remaining meal balance
      try {
        await performDaySelectionValidation({
          userId: sub3.userId,
          subscriptionId: sub3._id,
          date: "2026-07-01",
          mealSlots: buildStandardSlots(8),
        });
        assert.fail("Should have thrown MEAL_SLOT_COUNT_EXCEEDED");
      } catch (err) {
        assert.strictEqual(err.code, "MEAL_SLOT_COUNT_EXCEEDED", "Cannot select more than maxConsumableMealsNow");
        assert.strictEqual(err.slotErrors.length, 1, "Only the 8th slot is over balance");
      }

      // Test 12: Save endpoint/service accepts extra slots and does not deduct remainingMeals
      const saveResult = await performDaySelectionUpdate({
        userId: sub3.userId,
        subscriptionId: sub3._id,
        date: "2026-07-02",
        mealSlots: buildStandardSlots(3),
      });
      assert.strictEqual(saveResult.day.mealSlots.length, 3, "Save accepts 3 slots");
      const sub3AfterSave = await Subscription.findById(sub3._id).lean();
      assert.strictEqual(sub3AfterSave.remainingMeals, 7, "Save must not deduct remainingMeals");

      // Test 13: Old behavior remains when mealBalance is unavailable
      try {
        await performDaySelectionValidation({
          userId: legacySub.userId,
          subscriptionId: legacySub._id,
          date: "2026-07-01",
          mealSlots: buildStandardSlots(2),
        });
        assert.fail("Should have kept requiredMealCount cap for legacy subscriptions");
      } catch (err) {
        assert.strictEqual(err.code, "MEAL_SLOT_COUNT_EXCEEDED", "Legacy subscription keeps daily cap");
      }

      // Test 14: Premium payment requirement still applies inside expanded slot count
      const premiumValidation = await performDaySelectionValidation({
        userId: sub3.userId,
        subscriptionId: sub3._id,
        date: "2026-07-03",
        mealSlots: [
          ...buildStandardSlots(2),
          {
            slotIndex: 3,
            selectionType: "premium_meal",
            proteinId: PLANNER_IDS.premiumProtein,
            carbs: [{ carbId: PLANNER_IDS.carbOne, grams: 150 }],
          },
        ],
      });
      assert.strictEqual(premiumValidation.valid, true, "Premium validation remains valid structurally");
      assert.strictEqual(premiumValidation.paymentRequirement.requiresPayment, true, "Premium extra still requires payment");
      assert.strictEqual(premiumValidation.paymentRequirement.premiumPendingPaymentCount, 1, "One unpaid premium extra is counted");
    });

    console.log("All subscription balance policy automated tests passed perfectly.");
    await cleanup();
    await disconnect();

  } catch (err) {
    console.error("Test failed:", err);
    await cleanup();
    await disconnect();
    process.exit(1);
  }
}

runTests();
