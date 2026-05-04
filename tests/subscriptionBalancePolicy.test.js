"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.SUBSCRIPTION_AUTO_SETTLEMENT_ENABLED = "false";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");
const { buildSubscriptionTimeline } = require("../src/services/subscription/subscriptionTimelineService");
const { applyOperationalSkipForDate } = require("../src/services/subscription/subscriptionSkipService");
const { recordCashierConsumption } = require("../src/services/dashboard/cashierConsumptionService");
const { markPickupNoShow } = require("../src/controllers/kitchenController");

const TEST_TAG = `balance-policy-${Date.now()}`;

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
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
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedSubscription({ deliveryMode = "delivery", remainingMeals = 30, phoneSuffix = "000" } = {}) {
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
    startDate: new Date("2026-04-01T00:00:00+03:00"),
    endDate: new Date("2026-04-15T00:00:00+03:00"),
    validityEndDate: new Date("2026-05-30T00:00:00+03:00"),
    totalMeals: 30,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 2,
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

    // Populate old days
    await SubscriptionDay.create([
      { subscriptionId: sub1._id, date: "2026-04-01", status: "open" },
      { subscriptionId: sub1._id, date: "2026-04-02", status: "locked", lockedSnapshot: { mealsPerDay: 2 } },
      { subscriptionId: sub1._id, date: "2026-04-03", status: "out_for_delivery", lockedSnapshot: { mealsPerDay: 2 } }
    ]);
    await SubscriptionDay.create([
      { subscriptionId: sub2._id, date: "2026-04-01", status: "ready_for_pickup", pickupRequested: true, lockedSnapshot: { mealsPerDay: 2 } }
    ]);

    // Test 1: Timeline/read endpoints do not mutate remainingMeals and past days do not auto-consume
    const timeline1 = await buildSubscriptionTimeline(sub1._id, {
      lang: "en",
      // Act as if today is late May, well past those April dates
      now: new Date("2026-05-20T08:00:00Z"),
      businessDate: "2026-05-20",
    });
    const sub1AfterRead = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterRead.remainingMeals, 30, "Timeline endpoint must not mutate remainingMeals");
    
    // Test 2: Past open/locked/out_for_delivery days do not auto-consume
    const day01 = await SubscriptionDay.findOne({ subscriptionId: sub1._id, date: "2026-04-01" }).lean();
    assert.strictEqual(day01.status, "open", "Past open day remains open");
    
    // Test 8: Repeated GET reads do not change remainingMeals
    for (let i = 0; i < 3; i++) {
      await buildSubscriptionTimeline(sub1._id, { lang: "en", now: new Date(), businessDate: "2026-05-20" });
    }
    const sub1Repeated = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1Repeated.remainingMeals, 30, "Repeated reads must not mutate remainingMeals");

    // Test 3: Operational skip does not deduct remainingMeals
    const sessionSkip = await mongoose.startSession();
    sessionSkip.startTransaction();
    await applyOperationalSkipForDate({ sub: sub1AfterRead, date: "2026-04-04", session: sessionSkip });
    await sessionSkip.commitTransaction();
    sessionSkip.endSession();
    
    const sub1AfterSkip = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterSkip.remainingMeals, 30, "applyOperationalSkipForDate must not deduct remainingMeals");
    const skippedDay = await SubscriptionDay.findOne({ subscriptionId: sub1._id, date: "2026-04-04" }).lean();
    assert.strictEqual(skippedDay.status, "skipped", "Day was skipped");
    assert.strictEqual(skippedDay.creditsDeducted, false, "Credits were NOT deducted");

    // Test 4: markPickupNoShow does not deduct remainingMeals
    const resMock = {
      status: function (code) { this.statusCode = code; return this; },
      json: function (data) { this.body = data; return this; }
    };
    const reqMock = { params: { dayId: (await SubscriptionDay.findOne({ subscriptionId: sub2._id, date: "2026-04-01" }).lean())._id } };
    await markPickupNoShow(reqMock, resMock);
    
    assert.strictEqual(resMock.statusCode, 200, "markPickupNoShow should succeed");
    const sub2AfterNoShow = await Subscription.findById(sub2._id).lean();
    assert.strictEqual(sub2AfterNoShow.remainingMeals, 30, "markPickupNoShow must not deduct remainingMeals");
    const noShowDay = await SubscriptionDay.findOne({ subscriptionId: sub2._id, date: "2026-04-01" }).lean();
    assert.strictEqual(noShowDay.status, "no_show", "Pickup day transitioned to no_show");

    // Test 5 & 9: Cashier can consume more than dailyMealsDefault, creates audit log
    const cashierConsumption = await recordCashierConsumption({
      phone: sub1Phone,
      subscriptionId: sub1._id,
      mealCount: 7, // Default is 2
      actor: { actorId: sub1._id, actorType: "admin" }
    });
    assert.strictEqual(cashierConsumption.consumption.mealCount, 7, "Cashier deduced 7 meals, ignoring dailyMealsDefault");
    const sub1AfterCashier = await Subscription.findById(sub1._id).lean();
    assert.strictEqual(sub1AfterCashier.remainingMeals, 23, "Remaining meals correctly decoupled from calendar and decremented");
    
    const auditLogs = await SubscriptionAuditLog.find({ entityId: sub1._id, action: "cashier_manual_consumption" }).lean();
    assert.strictEqual(auditLogs.length, 1, "Audit log correctly generated");
    
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

    console.log("All subscription balance policy automated tests passed perfectly.");
    await cleanup();
    await mongoose.disconnect();

  } catch (err) {
    console.error("Test failed:", err);
    await cleanup();
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
