"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const ActivityLog = require("../src/models/ActivityLog");
const {
  settlePastSubscriptionDaysForDate,
  settlePastSubscriptionDaysForSubscription,
} = require("../src/services/subscription/pastSubscriptionDaySettlementService");
const { buildSubscriptionTimeline } = require("../src/services/subscription/subscriptionTimelineService");
const {
  fetchSubscriptionDaysByDate,
} = require("../src/services/kitchenOperations/KitchenOperationsDataService");

const TEST_TAG = `past-settlement-${Date.now()}`;

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
    ActivityLog.deleteMany({ "meta.subscriptionId": { $in: subscriptionIds.map(String) } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedSubscription({ deliveryMode = "delivery", remainingMeals = 30 } = {}) {
  const user = await User.create({
    phone: `+1555${Date.now()}${Math.floor(Math.random() * 1000)}${TEST_TAG}`,
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
    startDate: new Date("2026-04-25T00:00:00+03:00"),
    endDate: new Date("2026-05-15T00:00:00+03:00"),
    validityEndDate: new Date("2026-05-15T00:00:00+03:00"),
    totalMeals: 30,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 2,
    deliveryMode,
    deliveryAddress: deliveryMode === "delivery" ? { line1: "Test address" } : undefined,
    deliveryWindow: deliveryMode === "delivery" ? "13:00-16:00" : "",
    pickupLocationId: deliveryMode === "pickup" ? "branch-test" : "",
  });
  return { user, plan, subscription };
}

async function createDay(subscription, date, status, extra = {}) {
  return SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status,
    ...extra,
  });
}

async function assertDay(subscription, date, expectedStatus, message) {
  const day = await SubscriptionDay.findOne({ subscriptionId: subscription._id, date }).lean();
  assert(day, `Missing day ${date}`);
  assert.strictEqual(day.status, expectedStatus, message || date);
  return day;
}

async function runTests() {
  await connect();
  await cleanup();

  const { subscription: deliverySub } = await seedSubscription({ deliveryMode: "delivery", remainingMeals: 30 });
  const { subscription: pickupSub } = await seedSubscription({ deliveryMode: "pickup", remainingMeals: 30 });

  await createDay(deliverySub, "2026-05-01", "open", {
    plannerState: "confirmed",
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    plannerMeta: { requiredSlotCount: 1, completeSlotCount: 1, partialSlotCount: 0, isDraftValid: true },
  });
  await createDay(deliverySub, "2026-05-02", "locked", { lockedSnapshot: { mealsPerDay: 2 } });
  await createDay(deliverySub, "2026-05-03", "open");
  await createDay(deliverySub, "2026-05-04", "out_for_delivery", { lockedSnapshot: { mealsPerDay: 2 } });
  await createDay(deliverySub, "2026-05-05", "skipped", { skipCompensated: true, creditsDeducted: false });
  await createDay(deliverySub, "2026-05-06", "frozen");
  await createDay(deliverySub, "2026-05-07", "fulfilled", { creditsDeducted: true, fulfilledAt: new Date("2026-05-07T10:00:00Z") });
  await createDay(deliverySub, "2026-05-08", "consumed_without_preparation", {
    creditsDeducted: true,
    autoSettled: true,
    settledAt: new Date("2026-05-08T10:00:00Z"),
    settlementReason: "PAST_DAY_AUTO_CONSUMED",
  });
  await createDay(deliverySub, "2026-05-09", "open");
  await createDay(deliverySub, "2026-05-12", "open");
  await createDay(pickupSub, "2026-05-01", "ready_for_pickup", {
    pickupRequested: true,
    pickupCode: "123456",
    lockedSnapshot: { mealsPerDay: 2 },
  });

  const result = await settlePastSubscriptionDaysForSubscription({
    subscriptionId: deliverySub._id,
    businessDate: "2026-05-10",
    now: new Date("2026-05-10T08:00:00Z"),
    actor: { actorType: "system" },
  });
  assert.strictEqual(result.settled, 5, "settles open planned, locked, unselected open, out_for_delivery, and any other past open day");

  const pickupResult = await settlePastSubscriptionDaysForSubscription({
    subscriptionId: pickupSub._id,
    businessDate: "2026-05-10",
    now: new Date("2026-05-10T08:00:00Z"),
    actor: { actorType: "system" },
  });
  assert.strictEqual(pickupResult.settled, 1, "settles ready pickup as no_show");

  await assertDay(deliverySub, "2026-05-01", "consumed_without_preparation", "past planned day consumed");
  await assertDay(deliverySub, "2026-05-02", "consumed_without_preparation", "past locked day consumed");
  await assertDay(deliverySub, "2026-05-03", "consumed_without_preparation", "past unselected day consumed");
  await assertDay(deliverySub, "2026-05-04", "consumed_without_preparation", "past out_for_delivery day consumed");
  await assertDay(deliverySub, "2026-05-05", "skipped", "skipped remains skipped");
  await assertDay(deliverySub, "2026-05-06", "frozen", "frozen remains frozen");
  await assertDay(deliverySub, "2026-05-07", "fulfilled", "fulfilled remains fulfilled");
  await assertDay(deliverySub, "2026-05-08", "consumed_without_preparation", "already consumed remains consumed");
  await assertDay(deliverySub, "2026-05-09", "consumed_without_preparation", "day before business date consumed");
  await assertDay(deliverySub, "2026-05-12", "open", "future day remains open");
  const pickupDay = await assertDay(pickupSub, "2026-05-01", "no_show", "ready pickup becomes no_show");
  assert.strictEqual(Boolean(pickupDay.pickupNoShowAt), true, "auto no_show sets pickupNoShowAt");

  const deliverySubAfter = await Subscription.findById(deliverySub._id).lean();
  const pickupSubAfter = await Subscription.findById(pickupSub._id).lean();
  assert.strictEqual(deliverySubAfter.remainingMeals, 20, "five delivery days deducted once");
  assert.strictEqual(pickupSubAfter.remainingMeals, 28, "one pickup day deducted once");

  const secondResult = await settlePastSubscriptionDaysForSubscription({
    subscriptionId: deliverySub._id,
    businessDate: "2026-05-10",
    now: new Date("2026-05-10T09:00:00Z"),
    actor: { actorType: "system" },
  });
  assert.strictEqual(secondResult.settled, 0, "second settlement is idempotent");
  const deliverySubSecond = await Subscription.findById(deliverySub._id).lean();
  assert.strictEqual(deliverySubSecond.remainingMeals, 20, "second settlement does not deduct again");

  const logCount = await SubscriptionAuditLog.countDocuments({
    "meta.subscriptionId": String(deliverySub._id),
    action: "past_day_auto_settled",
  });
  assert.strictEqual(logCount, 5, "writes one audit log per newly settled delivery day");

  await createDay(deliverySub, "2026-05-13", "locked", { lockedSnapshot: { mealsPerDay: 2 } });
  const dateResult = await settlePastSubscriptionDaysForDate({
    date: "2026-05-13",
    businessDate: "2026-05-14",
    now: new Date("2026-05-14T08:00:00Z"),
    actor: { actorType: "system" },
  });
  assert.strictEqual(dateResult.settled, 1, "date-scoped settlement handles requested past date");

  const queueRows = await fetchSubscriptionDaysByDate("2026-05-13");
  assert.strictEqual(queueRows.some((day) => ["open", "locked", "in_preparation", "ready_for_pickup", "out_for_delivery"].includes(day.status)), false, "past queue rows are not actionable statuses");

  const timeline = await buildSubscriptionTimeline(deliverySub._id, {
    lang: "en",
    now: new Date("2026-05-14T08:00:00Z"),
    businessDate: "2026-05-14",
  });
  const settledTimelineDay = timeline.days.find((day) => day.date === "2026-05-13");
  assert(settledTimelineDay, "timeline includes settled day");
  assert.strictEqual(settledTimelineDay.status, "consumed_without_preparation", "timeline exposes consumed_without_preparation");
  assert.strictEqual(settledTimelineDay.isPast, true, "timeline includes isPast");
  assert.strictEqual(settledTimelineDay.autoSettled, true, "timeline includes autoSettled");
  assert.strictEqual(settledTimelineDay.consumedByPolicy, true, "timeline includes consumedByPolicy");
  assert.strictEqual(Boolean(settledTimelineDay.settledAt), true, "timeline includes settledAt");
  assert.strictEqual(Boolean(settledTimelineDay.settlementReason), true, "timeline includes settlementReason");

  const currentDay = timeline.days.find((day) => day.date === "2026-05-14");
  if (currentDay) {
    assert.strictEqual(currentDay.isPast, false, "current business date is not past");
  }

  await cleanup();
}

runTests()
  .then(async () => {
    await mongoose.disconnect();
    console.log("pastSubscriptionDaySettlement tests passed");
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
