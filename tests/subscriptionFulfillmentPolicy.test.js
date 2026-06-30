process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Delivery = require("../src/models/Delivery");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const dateUtils = require("../src/utils/date");
const {
  assertDateInsideSubscriptionRange,
  assertFulfillmentMethodAllowed,
  buildFulfillmentPolicy,
} = require("../src/services/subscription/subscriptionFulfillmentPolicyService");
const {
  assertPlanningBalanceAfterSave,
} = require("../src/services/subscription/subscriptionPlanningBalanceService");
const {
  createSubscriptionPickupRequestForClient,
} = require("../src/services/subscription/subscriptionPickupRequestClientService");
const {
  executeAction,
} = require("../src/services/dashboard/opsTransitionService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri(`subscription_phase4_fulfillment_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    Delivery.init(),
    Subscription.init(),
    SubscriptionDay.init(),
    SubscriptionPickupRequest.init(),
  ]);
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function openRestaurant() {
  await Promise.all([
    Setting.updateOne({ key: "restaurant_is_open" }, { $set: { value: true } }, { upsert: true }),
    Setting.updateOne({ key: "restaurant_open_time" }, { $set: { value: "00:00" } }, { upsert: true }),
    Setting.updateOne({ key: "restaurant_close_time" }, { $set: { value: "23:59" } }, { upsert: true }),
    Setting.updateOne(
      { key: "pickup_locations" },
      { $set: { value: [{ id: "main", locationId: "main", name: { en: "Main", ar: "الرئيسي" }, isActive: true }] } },
      { upsert: true }
    ),
  ]);
}

async function createSubscription({ mode = "pickup", startDate, endDate, remainingMeals = 10, selectedMealsPerDay = 1 } = {}) {
  const start = startDate || dateUtils.getTodayKSADate();
  const end = endDate || dateUtils.addDaysToKSADateString(start, 10);
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date(`${start}T00:00:00.000Z`),
    endDate: new Date(`${end}T00:00:00.000Z`),
    validityEndDate: new Date(`${end}T00:00:00.000Z`),
    totalMeals: remainingMeals,
    remainingMeals,
    selectedMealsPerDay,
    deliveryMode: mode,
    pickupLocationId: "main",
    deliveryAddress: { line1: "Phase 4 test" },
    deliveryWindow: "13:00-16:00",
  });
}

function completeSlots(count) {
  return Array.from({ length: count }, (_, index) => ({
    slotIndex: index + 1,
    slotKey: `slot_${index + 1}`,
    status: "complete",
    selectionType: "standard_meal",
  }));
}

async function createOpenDay(subscription, date, status = "open", overrides = {}) {
  return SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status,
    mealSlots: completeSlots(3),
    plannerMeta: {
      requiredSlotCount: 1,
      maxSlotCount: 10,
      completeSlotCount: 3,
      premiumSlotCount: 0,
      isDraftValid: true,
      isConfirmable: true,
    },
    plannerState: "confirmed",
    planningState: "confirmed",
    planningMeta: {
      requiredMealCount: 1,
      selectedTotalMealCount: 3,
      isExactCountSatisfied: true,
    },
    ...overrides,
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    throw err;
  }
}

async function main() {
  await connect();
  try {
    await openRestaurant();
    const today = dateUtils.getTodayKSADate();
    const yesterday = dateUtils.addDaysToKSADateString(today, -1);
    const tomorrow = dateUtils.addDaysToKSADateString(today, 1);

    await test("home delivery policy allows multiple planner slots without daily cap", async () => {
      const subscription = await createSubscription({ mode: "delivery", startDate: today, remainingMeals: 10, selectedMealsPerDay: 1 });
      const policy = buildFulfillmentPolicy({ subscription, date: today });
      assert.strictEqual(policy.dailyMealLimitEnforced, false);
      await assertPlanningBalanceAfterSave({
        subscription,
        affectedDates: [today],
        incomingDaySelections: [{ date: today, mealSlots: completeSlots(5) }],
      });
    });

    await test("home delivery reuses one delivery visit for repeated dispatch on same subscription/date", async () => {
      const subscription = await createSubscription({ mode: "delivery", startDate: today });
      const day = await createOpenDay(subscription, today, "in_preparation");
      await executeAction("dispatch", {
        entityId: day._id,
        entityType: "subscription_day",
        userId: new mongoose.Types.ObjectId(),
        role: "courier",
        payload: { etaAt: "2099-01-01T15:00:00.000Z" },
      });
      await executeAction("dispatch", {
        entityId: day._id,
        entityType: "subscription_day",
        userId: new mongoose.Types.ObjectId(),
        role: "courier",
        payload: { etaAt: "2099-01-01T15:10:00.000Z" },
      });
      const deliveries = await Delivery.find({ subscriptionId: subscription._id, date: today }).lean();
      assert.strictEqual(deliveries.length, 1);
      assert.strictEqual(String(deliveries[0].dayId), String(day._id));
      assert.strictEqual(deliveries[0].status, "out_for_delivery");
    });

    await test("home delivery day 1 branch pickup is allowed through pickup request", async () => {
      const subscription = await createSubscription({ mode: "delivery", startDate: today, remainingMeals: 3 });
      await createOpenDay(subscription, today, "open", {
        fulfillmentModeOverride: "pickup",
        pickupLocationIdOverride: "main",
      });
      const result = await createSubscriptionPickupRequestForClient({
        userId: subscription.userId,
        subscriptionId: subscription._id,
        date: today,
        mealCount: 3,
        idempotencyKey: `phase4-day1-${subscription._id}`,
      });
      assert.strictEqual(result.data.mealCount, 3);
      assert.strictEqual(result.data.status, "locked");
      const refreshed = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(Number(refreshed.remainingMeals), 0);
    });

    await test("home delivery day 2 branch pickup is rejected", async () => {
      const subscription = await createSubscription({ mode: "delivery", startDate: yesterday, remainingMeals: 5 });
      await createOpenDay(subscription, today, "open");
      await assert.rejects(
        () => createSubscriptionPickupRequestForClient({
          userId: subscription.userId,
          subscriptionId: subscription._id,
          date: today,
          mealCount: 1,
        }),
        (err) => err && err.code === "INVALID_DELIVERY_MODE"
      );
    });

    await test("branch pickup can reserve all remaining meals and has no daily cap", async () => {
      const subscription = await createSubscription({ mode: "pickup", startDate: today, remainingMeals: 7, selectedMealsPerDay: 1 });
      await createOpenDay(subscription, today, "open", {
        mealSlots: completeSlots(7),
        plannerMeta: {
          requiredSlotCount: 1,
          maxSlotCount: 10,
          completeSlotCount: 7,
          premiumSlotCount: 0,
          isDraftValid: true,
          isConfirmable: true,
        },
        planningMeta: {
          requiredMealCount: 1,
          selectedTotalMealCount: 7,
          isExactCountSatisfied: true,
        },
      });
      const policy = buildFulfillmentPolicy({ subscription, date: today });
      assert.strictEqual(policy.dailyMealLimitEnforced, false);
      const result = await createSubscriptionPickupRequestForClient({
        userId: subscription.userId,
        subscriptionId: subscription._id,
        date: today,
        mealCount: 7,
      });
      assert.strictEqual(result.data.mealCount, 7);
      const refreshed = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(Number(refreshed.remainingMeals), 0);
    });

    await test("branch pickup rejects above remaining balance", async () => {
      const subscription = await createSubscription({ mode: "pickup", startDate: today, remainingMeals: 3 });
      await createOpenDay(subscription, today, "open", {
        mealSlots: completeSlots(4),
        plannerMeta: {
          requiredSlotCount: 1,
          maxSlotCount: 10,
          completeSlotCount: 4,
          premiumSlotCount: 0,
          isDraftValid: true,
          isConfirmable: true,
        },
        planningMeta: {
          requiredMealCount: 1,
          selectedTotalMealCount: 4,
          isExactCountSatisfied: true,
        },
      });
      await assert.rejects(
        () => createSubscriptionPickupRequestForClient({
          userId: subscription.userId,
          subscriptionId: subscription._id,
          date: today,
          mealCount: 4,
        }),
        (err) => err && err.code === "INSUFFICIENT_CREDITS"
      );
    });

    await test("pickup date range rejects before start and after validity end", async () => {
      const subscription = await createSubscription({ mode: "pickup", startDate: today, endDate: tomorrow });
      assert.throws(
        () => assertDateInsideSubscriptionRange({ subscription, date: yesterday }),
        (err) => err && err.code === "SUBSCRIPTION_DATE_OUT_OF_RANGE"
      );
      assert.throws(
        () => assertDateInsideSubscriptionRange({ subscription, date: dateUtils.addDaysToKSADateString(tomorrow, 1) }),
        (err) => err && err.code === "SUBSCRIPTION_DATE_OUT_OF_RANGE"
      );
    });

    await test("policy helper exposes explicit day 1 override and day 2 delivery-only rule", async () => {
      const day1Subscription = await createSubscription({ mode: "delivery", startDate: today });
      const day1 = await createOpenDay(day1Subscription, today, "open", {
        fulfillmentModeOverride: "pickup",
        pickupLocationIdOverride: "main",
      });
      assert.doesNotThrow(() => assertFulfillmentMethodAllowed({ subscription: day1Subscription, day: day1, date: today, requestedMethod: "pickup" }));
      const day2Subscription = await createSubscription({ mode: "delivery", startDate: yesterday });
      assert.throws(
        () => assertFulfillmentMethodAllowed({ subscription: day2Subscription, date: today, requestedMethod: "pickup" }),
        (err) => err && err.code === "FULFILLMENT_METHOD_NOT_ALLOWED"
      );
    });

    console.log("subscription fulfillment policy tests passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});
