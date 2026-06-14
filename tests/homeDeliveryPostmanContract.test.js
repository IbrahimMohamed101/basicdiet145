"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const Delivery = require("../src/models/Delivery");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { dashboardAuth } = require("./helpers/dashboardAuthHelper");
const dateUtils = require("../src/utils/date");

const TEST_TAG = `home-delivery-postman-${Date.now()}`;
const TEST_DATE = dateUtils.getTodayKSADate();
const results = { passed: 0, failed: 0 };

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: `^${TEST_TAG}` } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const plans = await Plan.find({ key: { $regex: `^${TEST_TAG}` } }).select("_id").lean();
  const planIds = plans.map((plan) => plan._id);
  const subscriptions = await Subscription.find({ $or: [{ userId: { $in: userIds } }, { planId: { $in: planIds } }] }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);

  await Promise.all([
    Delivery.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    SubscriptionPickupRequest.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function clientHeaders(userId) {
  const token = jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "31d" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

function completeSlots(count, { pendingPayment = false } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const slotNumber = index + 1;
    return {
      slotIndex: slotNumber,
      slotKey: `slot_${slotNumber}`,
      status: "complete",
      selectionType: "standard_meal",
      productKey: `${TEST_TAG}_meal_${slotNumber}`,
      isPremium: pendingPayment,
      premiumSource: pendingPayment ? "pending_payment" : "none",
      premiumExtraFeeHalala: pendingPayment ? 1200 : 0,
      confirmationSnapshot: {
        product: {
          key: `${TEST_TAG}_meal_${slotNumber}`,
          name: { en: `Delivery Meal ${slotNumber}`, ar: `Delivery Meal ${slotNumber}` },
        },
      },
    };
  });
}

function stripArabicDiacritics(value) {
  return String(value || "").replace(/[\u064B-\u065F\u0670]/g, "");
}

async function seedPlan(label, mealsPerDay = 1) {
  return Plan.create({
    key: `${TEST_TAG}-${label}`,
    name: { ar: `${TEST_TAG} ${label}`, en: `${TEST_TAG} ${label}` },
    daysCount: 14,
    durationDays: 30,
    currency: "SAR",
    gramsOptions: [{
      grams: 200,
      isActive: true,
      mealsOptions: [{ mealsPerDay, priceHalala: 70000, compareAtHalala: 80000, isActive: true }],
    }],
  });
}

async function seedHomeDeliveryDay(label, {
  status = "open",
  mealCount = 1,
  entitlementCount = Math.max(1, mealCount),
  pendingPayment = false,
} = {}) {
  const [user, plan] = await Promise.all([
    User.create({ phone: `${TEST_TAG}-${label}`, name: `${TEST_TAG} ${label}`, role: "client", isActive: true }),
    seedPlan(label, Math.max(1, entitlementCount)),
  ]);

  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date("2026-06-01T00:00:00Z"),
    endDate: new Date("2026-07-01T00:00:00Z"),
    validityEndDate: new Date("2026-07-15T00:00:00Z"),
    totalMeals: 10,
    remainingMeals: 10,
    selectedGrams: 200,
    selectedMealsPerDay: entitlementCount,
    deliveryMode: "delivery",
    deliveryAddress: { line1: `${TEST_TAG} ${label} address`, city: "Riyadh" },
    deliveryWindow: "12:00-14:00",
  });

  const slots = mealCount > 0 ? completeSlots(mealCount, { pendingPayment }) : [];
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: TEST_DATE,
    status,
    plannerState: slots.length > 0 ? "confirmed" : "draft",
    planningState: slots.length > 0 ? "confirmed" : "draft",
    mealSlots: slots,
    materializedMeals: slots.map((slot) => ({
      slotKey: slot.slotKey,
      selectionType: slot.selectionType,
      operationalSku: slot.productKey,
      isPremium: Boolean(slot.isPremium),
      premiumSource: slot.premiumSource,
      premiumExtraFeeHalala: slot.premiumExtraFeeHalala,
    })),
    plannerMeta: {
      requiredSlotCount: entitlementCount,
      emptySlotCount: Math.max(0, entitlementCount - mealCount),
      completeSlotCount: mealCount,
      partialSlotCount: 0,
      premiumSlotCount: pendingPayment ? entitlementCount : 0,
      premiumPendingPaymentCount: pendingPayment ? entitlementCount : 0,
      premiumTotalHalala: pendingPayment ? entitlementCount * 1200 : 0,
      isDraftValid: entitlementCount > 0,
      isConfirmable: entitlementCount > 0,
      confirmedAt: entitlementCount > 0 ? new Date() : null,
      confirmedByRole: entitlementCount > 0 ? "client" : null,
    },
    premiumExtraPayment: pendingPayment ? { status: "pending", amountHalala: entitlementCount * 1200, currency: "SAR" } : undefined,
    planningMeta: {
      requiredMealCount: entitlementCount,
      selectedTotalMealCount: mealCount,
      isExactCountSatisfied: mealCount === entitlementCount,
    },
  });

  return { user, subscription, day };
}

function findQueueRow(body, dayId) {
  const items = body && body.data && Array.isArray(body.data.items) ? body.data.items : [];
  return items.find((item) => item.ids && item.ids.subscriptionDayId === String(dayId));
}

async function dashboardAction(api, headers, action, dayId) {
  return api.post(`/api/dashboard/ops/actions/${action}`).set(headers).send({
    entityType: "subscription_day",
    entityId: String(dayId),
  });
}

(async function run() {
  await connect();
  await cleanup();

  const api = request(createApp());
  const { headers: adminHeaders } = await dashboardAuth("admin", TEST_TAG);

  try {
    await test("home delivery queue exposes subscription_day ids and no pickup request", async () => {
      const { day } = await seedHomeDeliveryDay("happy", { mealCount: 2 });
      const res = await api.get(`/api/dashboard/kitchen/queue?date=${TEST_DATE}&method=delivery`).set(adminHeaders);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const row = findQueueRow(res.body, day._id);
      assert(row, "queue row should exist");
      assert.strictEqual(row.ids.entityType, "subscription_day");
      assert.strictEqual(row.ids.entityId, String(day._id));
      assert.strictEqual(row.ids.pickupRequestId, null);
      assert.strictEqual(row.fulfillment.type, "home_delivery");
      assert.strictEqual(row.fulfillment.typeLabel.ar, "توصيل للمنزل");
      assert.strictEqual(row.fulfillment.pickup.pickupRequestId, null);
      assert.strictEqual(row.orderSummary.mealCount, 2);
      assert.strictEqual(row.selectionMode, "customer_selected");
      assert.strictEqual(row.selectionModeLabel.ar, "اختيار العميل");
      assert.strictEqual(row.kitchen.meals[0].product.displayName, "Delivery Meal 1");
      assert.strictEqual(row.actions.canPrepare, true);
    });

    await test("home delivery blocks dispatch before prepare", async () => {
      const { day } = await seedHomeDeliveryDay("invalid-dispatch", { mealCount: 1 });
      const res = await dashboardAction(api, adminHeaders, "dispatch", day._id);
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "INVALID_TRANSITION");
    });

    await test("planned delivery day without selected meals uses Chef Choice entitlement", async () => {
      const { day } = await seedHomeDeliveryDay("chef-choice", { mealCount: 0, entitlementCount: 2 });
      const queue = await api.get(`/api/dashboard/kitchen/queue?date=${TEST_DATE}&method=delivery`).set(adminHeaders);
      assert.strictEqual(queue.status, 200, JSON.stringify(queue.body));
      const row = findQueueRow(queue.body, day._id);
      assert(row, "chef choice day row should exist");
      assert.strictEqual(row.orderSummary.mealCount, 2);
      assert.strictEqual(row.orderSummary.mealCountTextAr, "2 وجبات");
      assert.strictEqual(row.orderSummary.display.titleAr, "اختيار الشيف");
      assert.strictEqual(row.orderSummary.display.subtitleAr, "توصيل للمنزل - 2 وجبات");
      assert.strictEqual(row.kitchen.meals.length, 2);
      assert.strictEqual(row.kitchen.meals[0].mealType, "chef_choice");
      assert.strictEqual(row.kitchen.meals[0].mealTypeLabel.ar, "اختيار الشيف");
      assert.strictEqual(row.kitchen.meals[0].product.name.ar, "اختيار الشيف");
      assert.strictEqual(row.kitchen.meals[0].display.titleAr, "اختيار الشيف");
      assert.strictEqual(stripArabicDiacritics(row.kitchen.meals[0].display.preparationTextAr), "حضر وجبة اختيار الشيف");
      assert(row.kitchen.meals[0].display.badgesAr.includes("اختيار الشيف"));
      assert.strictEqual(row.selectionMode, "chef_choice");
      assert.strictEqual(row.selectionModeLabel.ar, "اختيار الشيف");
      assert.strictEqual(row.selectionNotice.ar, "العميل لم يحدد الوجبات، سيتم تجهيز وجبات اختيار الشيف");
      assert(row.dataQuality.warnings.some((warning) => warning.code === "CHEF_CHOICE_MEALS" && warning.severity === "info"));
      assert.strictEqual(row.dataQuality.warnings.some((warning) => warning.code === "EMPTY_KITCHEN_MEALS"), false);
      assert.strictEqual(row.actions.canPrepare, true);
      assert(row.actions.allowed.some((action) => ["prepare", "start_preparation"].includes(action.id)));
      assert.strictEqual(row.fulfillment.delivery.windowTextAr, "من 12:00 إلى 14:00");
      assert(row.fulfillment.delivery.address.displayAddressAr.includes("address"));

      const prepare = await dashboardAction(api, adminHeaders, "prepare", day._id);
      assert.strictEqual(prepare.status, 200, JSON.stringify(prepare.body));
      const preparedDay = await SubscriptionDay.findById(day._id).select("status").lean();
      assert.strictEqual(preparedDay.status, "in_preparation");
    });

    await test("unpaid delivery day is blocked by payment gate", async () => {
      const { day } = await seedHomeDeliveryDay("unpaid", { mealCount: 0, entitlementCount: 2, pendingPayment: true });
      const queue = await api.get(`/api/dashboard/kitchen/queue?date=${TEST_DATE}&method=delivery`).set(adminHeaders);
      assert.strictEqual(queue.status, 200, JSON.stringify(queue.body));
      const row = findQueueRow(queue.body, day._id);
      assert(row, "unpaid day row should exist");
      assert.strictEqual(row.payment.pendingUnpaid, true);
      assert.strictEqual(row.payment.canPrepare, false);
      assert.strictEqual(row.payment.reason, "PREMIUM_PAYMENT_REQUIRED");

      const prepare = await dashboardAction(api, adminHeaders, "prepare", day._id);
      assert.strictEqual(prepare.status, 409, JSON.stringify(prepare.body));
      assert.strictEqual(prepare.body.error.code, "PREMIUM_PAYMENT_REQUIRED");
    });

    await test("home delivery without entitlement remains blocked as empty kitchen meals", async () => {
      const { day } = await seedHomeDeliveryDay("no-entitlement", { mealCount: 0, entitlementCount: 0 });
      const queue = await api.get(`/api/dashboard/kitchen/queue?date=${TEST_DATE}&method=delivery`).set(adminHeaders);
      assert.strictEqual(queue.status, 200, JSON.stringify(queue.body));
      const row = findQueueRow(queue.body, day._id);
      assert(row, "no-entitlement row should exist");
      assert.strictEqual(row.kitchen.meals.length, 0);
      assert.strictEqual(row.orderSummary.mealCount, 0);
      assert(row.dataQuality.warnings.some((warning) => warning.code === "EMPTY_KITCHEN_MEALS"));
      assert.strictEqual(row.actions.canPrepare, false);

      const prepare = await dashboardAction(api, adminHeaders, "prepare", day._id);
      assert.strictEqual(prepare.status, 422, JSON.stringify(prepare.body));
      assert.strictEqual(prepare.body.error.code, "EMPTY_KITCHEN_MEALS");
    });

    await test("client token cannot perform dashboard ops action", async () => {
      const { user, day } = await seedHomeDeliveryDay("client-auth", { mealCount: 1 });
      const res = await dashboardAction(api, clientHeaders(user._id), "prepare", day._id);
      assert([401, 403].includes(res.status), JSON.stringify(res.body));
    });

    await test("happy path prepare dispatch fulfill does not create pickup request or double consume", async () => {
      const { subscription, day } = await seedHomeDeliveryDay("lifecycle", { mealCount: 3 });
      let res = await dashboardAction(api, adminHeaders, "prepare", day._id);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      res = await dashboardAction(api, adminHeaders, "dispatch", day._id);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(await Delivery.countDocuments({ subscriptionId: subscription._id, date: TEST_DATE }), 1);
      res = await dashboardAction(api, adminHeaders, "fulfill", day._id);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));

      const afterFirstFulfill = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(afterFirstFulfill.remainingMeals, 7);
      assert.strictEqual(await SubscriptionPickupRequest.countDocuments({ subscriptionId: subscription._id }), 0);

      res = await dashboardAction(api, adminHeaders, "fulfill", day._id);
      assert([200, 409].includes(res.status), JSON.stringify(res.body));
      const afterDuplicate = await Subscription.findById(subscription._id).lean();
      assert.strictEqual(afterDuplicate.remainingMeals, 7);
    });
  } finally {
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
