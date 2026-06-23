process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const DashboardUser = require("../src/models/DashboardUser");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const TEST_TAG = `dashboard-kitchen-queue-actions-${Date.now()}`;

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function auth(user) {
  const token = jwt.sign(
    { userId: String(user._id), role: user.role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);

  await Promise.all([
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
  ]);
}

async function main() {
  await connect();
  await cleanup();

  const app = createApp();
  const api = request(app);

  const dashboardUser = await DashboardUser.create({
    email: `${TEST_TAG}@example.com`,
    passwordHash: "not-used-in-this-test",
    role: "admin",
    isActive: true,
  });
  const user = await User.create({
    phone: `+${Date.now()}`,
    name: `${TEST_TAG} Customer`,
    isActive: true,
  });
  const subscription = await Subscription.create({
    userId: user._id,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    validityEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    totalMeals: 7,
    remainingMeals: 7,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode: "delivery",
    deliveryAddress: { line1: "Queue action test address" },
  });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-05-10",
    status: "open",
    materializedMeals: [{
      slotKey: "slot_1",
      selectionType: "standard_meal",
      operationalSku: "queue-action-test-meal",
    }],
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    plannerState: "confirmed",
  });

  try {
    let res = await api.get("/api/dashboard/kitchen/queue?date=2026-05-10&method=delivery").set(auth(dashboardUser));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const row = res.body.data.items.find((item) => item.ids.entityType === "subscription_day" && item.ids.entityId === String(day._id));
    assert(row, "subscription_day row should be present");
    assert.deepStrictEqual(row.actions.allowed.map((action) => action.id), ["prepare", "lock", "cancel"]);
    assert(row.actions.allowed.every((action) => action.endpoint && action.method === "POST"));

    res = await api.post("/api/dashboard/kitchen/actions/lock").set(auth(dashboardUser)).send({
      entityType: "subscription_day",
      entityId: String(day._id),
      payload: { reason: "regression test lock" },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.source.status, "locked");

    res = await api.post("/api/dashboard/kitchen/actions/prepare").set(auth(dashboardUser)).send({
      entityType: "subscription_day",
      entityId: String(day._id),
      payload: { reason: "regression test prepare" },
    });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.data.source.status, "in_preparation");
    assert.deepStrictEqual(res.body.data.actions.allowed.map((action) => action.id), ["ready_for_delivery", "cancel"]);
    assert(!res.body.data.actions.allowed.some((action) => action.id === "set_ready"));
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
