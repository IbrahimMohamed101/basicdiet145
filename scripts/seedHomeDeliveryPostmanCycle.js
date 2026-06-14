"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

require("dotenv").config();

const mongoose = require("mongoose");

const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const User = require("../src/models/User");
const { hashAppPassword } = require("../src/services/appPasswordService");
const { hashDashboardPassword } = require("../src/services/dashboardPasswordService");
const dateUtils = require("../src/utils/date");

const TAG = "postman-home-delivery-cycle";
const CLIENT_PASSWORD = "Client12345";
const DASHBOARD_PASSWORD = "PostmanAdmin@123";
const DEFAULT_DATE = process.env.POSTMAN_TEST_DATE || dateUtils.getTodayKSADate();

function parseArgs(argv) {
  const args = { reset: true, date: DEFAULT_DATE };
  for (const arg of argv) {
    if (arg === "--no-reset") args.reset = false;
    if (arg.startsWith("--date=")) args.date = arg.slice("--date=".length);
  }
  return args;
}

function getMongoUri() {
  return process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
}

function assertSafeDatabase(uri) {
  if (process.env.ALLOW_HOME_DELIVERY_POSTMAN_SEED === "true") return;
  const lower = String(uri || "").toLowerCase();
  const safe = lower.includes("localhost")
    || lower.includes("127.0.0.1")
    || lower.includes("basicdiet_test")
    || lower.includes("test")
    || lower.includes("dev");
  if (!safe) {
    throw new Error("Refusing to seed a non-local/non-test database. Set ALLOW_HOME_DELIVERY_POSTMAN_SEED=true to override intentionally.");
  }
}

async function connect() {
  const uri = getMongoUri();
  assertSafeDatabase(uri);
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: `^${TAG}` } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const plans = await Plan.find({ key: { $regex: `^${TAG}` } }).select("_id").lean();
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
    DashboardUser.deleteMany({ email: { $regex: `^${TAG}` } }),
  ]);
}

async function upsertDashboardUser(role) {
  const email = `${TAG}-${role}@example.com`;
  const passwordHash = await hashDashboardPassword(DASHBOARD_PASSWORD);
  return DashboardUser.findOneAndUpdate(
    { email },
    { $set: { email, role, isActive: true, passwordHash, failedAttempts: 0, lockUntil: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function createPlan(label, mealsPerDay) {
  return Plan.create({
    key: `${TAG}-${label}`,
    name: { ar: `${label} delivery`, en: `${label} delivery` },
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

function completeSlots(count, { pendingPayment = false } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const slotNumber = index + 1;
    const key = `${TAG}-meal-${slotNumber}`;
    return {
      slotIndex: slotNumber,
      slotKey: `slot_${slotNumber}`,
      status: "complete",
      selectionType: "standard_meal",
      productKey: key,
      isPremium: pendingPayment,
      premiumSource: pendingPayment ? "pending_payment" : "none",
      premiumExtraFeeHalala: pendingPayment ? 1200 : 0,
      confirmationSnapshot: {
        product: { key, name: { en: `Postman Delivery Meal ${slotNumber}`, ar: `Postman Delivery Meal ${slotNumber}` } },
      },
    };
  });
}

async function createClient(label) {
  const phone = `${TAG}-${label}`;
  return User.create({
    phone,
    phoneE164: phone,
    phoneVerified: true,
    passwordHash: await hashAppPassword(CLIENT_PASSWORD),
    name: `Postman ${label}`,
    role: "client",
    isActive: true,
  });
}

async function createScenario({ label, date, status = "open", mealCount = 1, pendingPayment = false }) {
  const [user, plan] = await Promise.all([
    createClient(label),
    createPlan(label, Math.max(1, mealCount)),
  ]);

  const subscription = await Subscription.create({
    userId: user._id,
    planId: plan._id,
    status: "active",
    startDate: new Date(`${date}T00:00:00Z`),
    endDate: new Date("2026-12-31T00:00:00Z"),
    validityEndDate: new Date("2027-01-31T00:00:00Z"),
    totalMeals: 20,
    remainingMeals: 20,
    selectedGrams: 200,
    selectedMealsPerDay: Math.max(1, mealCount),
    deliveryMode: "delivery",
    deliveryAddress: {
      line1: `${label} Postman Test Address`,
      city: "Riyadh",
      notes: TAG,
    },
    deliveryWindow: "12:00-14:00",
  });

  const slots = mealCount > 0 ? completeSlots(mealCount, { pendingPayment }) : [];
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status,
    plannerState: mealCount > 0 ? "confirmed" : "draft",
    planningState: mealCount > 0 ? "confirmed" : "draft",
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
      requiredSlotCount: Math.max(1, mealCount),
      emptySlotCount: mealCount > 0 ? 0 : 1,
      completeSlotCount: mealCount,
      partialSlotCount: 0,
      premiumSlotCount: pendingPayment ? mealCount : 0,
      premiumPendingPaymentCount: pendingPayment ? mealCount : 0,
      premiumTotalHalala: pendingPayment ? mealCount * 1200 : 0,
      isDraftValid: mealCount > 0,
      isConfirmable: mealCount > 0,
      confirmedAt: mealCount > 0 ? new Date() : null,
      confirmedByRole: mealCount > 0 ? "client" : null,
    },
    premiumExtraPayment: pendingPayment ? { status: "pending", amountHalala: mealCount * 1200, currency: "SAR" } : undefined,
    planningMeta: {
      requiredMealCount: Math.max(1, mealCount),
      selectedTotalMealCount: mealCount,
      isExactCountSatisfied: mealCount > 0,
    },
  });

  return { label, user, subscription, day, mealCount };
}

function printVariables({ date, scenarios, dashboardUsers }) {
  const [happy, empty, unpaid, cancel, multi] = scenarios;
  const admin = dashboardUsers.find((user) => user.role === "admin");
  const kitchen = dashboardUsers.find((user) => user.role === "kitchen");
  const courier = dashboardUsers.find((user) => user.role === "courier");

  const vars = {
    baseUrl: process.env.BASE_URL || "http://localhost:5000",
    testDate: date,
    adminEmail: admin.email,
    adminPassword: DASHBOARD_PASSWORD,
    kitchenEmail: kitchen.email,
    kitchenPassword: DASHBOARD_PASSWORD,
    courierEmail: courier.email,
    courierPassword: DASHBOARD_PASSWORD,
    clientOnePhone: happy.user.phone,
    clientOnePassword: CLIENT_PASSWORD,
    clientTwoPhone: empty.user.phone,
    clientTwoPassword: CLIENT_PASSWORD,
    deliverySubscriptionId: String(happy.subscription._id),
    deliverySubscriptionDayId: String(happy.day._id),
    entityType: "subscription_day",
    entityId: String(happy.day._id),
    deliveryId: "",
    pickupRequestId: "",
    emptySubscriptionDayId: String(empty.day._id),
    unpaidSubscriptionDayId: String(unpaid.day._id),
    cancelSubscriptionDayId: String(cancel.day._id),
    multiMealSubscriptionDayId: String(multi.day._id),
    expectedMealCount: String(happy.mealCount),
    expectedMultiMealCount: String(multi.mealCount),
  };

  console.log("\nPostman environment variables");
  console.log(JSON.stringify(vars, null, 2));
  console.log("\nShell exports");
  for (const [key, value] of Object.entries(vars)) {
    console.log(`${key}=${value}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connect();
  if (args.reset) await cleanup();

  const dashboardUsers = await Promise.all([
    upsertDashboardUser("admin"),
    upsertDashboardUser("kitchen"),
    upsertDashboardUser("courier"),
  ]);

  const scenarios = await Promise.all([
    createScenario({ label: "happy", date: args.date, mealCount: 1 }),
    createScenario({ label: "empty", date: args.date, mealCount: 0 }),
    createScenario({ label: "unpaid", date: args.date, mealCount: 1, pendingPayment: true }),
    createScenario({ label: "cancel", date: args.date, mealCount: 1 }),
    createScenario({ label: "multi", date: args.date, mealCount: 3 }),
  ]);

  printVariables({ date: args.date, scenarios, dashboardUsers });
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
