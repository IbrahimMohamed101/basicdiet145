"use strict";

process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Delivery = require("../src/models/Delivery");
const Order = require("../src/models/Order");
const Plan = require("../src/models/Plan");
const { getTodayKSADate } = require("../src/utils/date");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");

const TEST_TAG = `courier-contract-${Date.now()}`;
const results = { passed: 0, failed: 0 };
const dashboardUsers = new Map();

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

function dashboardToken(role = "admin") {
  const dashboardUser = dashboardUsers.get(role);
  assert(dashboardUser, `missing dashboard user for role ${role}`);
  return jwt.sign(
    { userId: String(dashboardUser._id), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(role = "admin") {
  return { Authorization: `Bearer ${dashboardToken(role)}`, "Accept-Language": "en" };
}

function customerAuth(user) {
  const token = jwt.sign(
    { userId: String(user._id), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "1h" }
  );
  return { Authorization: `Bearer ${token}`, "Accept-Language": "en" };
}

let mongoServer;

async function startMemoryMongo() {
  if (mongoServer) return;
  process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = "true";
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI_TEST = uri;
}

async function connectDatabase() {
  await startMemoryMongo();
  if (mongoose.connection.readyState === 0) {
    mongoose.set("autoIndex", false);
    await mongoose.connect(process.env.MONGO_URI_TEST);
  }
}

function assertDeliveryAddress(addr) {
  assert(addr, "deliveryAddress must be present");
  const keys = [
    "label", "city", "district", "street", "building",
    "floor", "apartment", "notes", "latitude", "longitude", "formattedAddress"
  ];
  for (const k of keys) {
    assert(k in addr, `deliveryAddress must have key ${k}`);
  }
}

function assertDeliveryTaskContract(item) {
  assert.strictEqual(typeof item.id, "string");
  assert(["subscription_delivery", "one_time_order"].includes(item.type));
  assert.strictEqual(typeof item.customerName, "string");
  assert.strictEqual(typeof item.customerPhone, "string");
  assertDeliveryAddress(item.deliveryAddress);
  assert("deliveryZone" in item);
  assert("deliveryWindow" in item);
  assert(["preparing", "ready_for_delivery", "READY", "out_for_delivery", "arriving_soon", "delivered", "failed", "canceled"].includes(item.status));
  assert("scheduledDate" in item);
  assert("orderNumber" in item);
  assert("subscriptionId" in item);
  assert("subscriptionDayId" in item);
  assert.strictEqual(item._id, undefined);
  assert.strictEqual(item.__v, undefined);
}

function assertSubscriptionDeliveryTaskContract(item) {
  assertDeliveryTaskContract(item);
  assert.strictEqual(item.type, "subscription_delivery");
  assert.strictEqual(item.orderNumber, null);
  assert.strictEqual(typeof item.subscriptionId, "string");
  assert.strictEqual(typeof item.subscriptionDayId, "string");
}

function assertOneTimeOrderDeliveryTaskContract(item) {
  assertDeliveryTaskContract(item);
  assert.strictEqual(item.type, "one_time_order");
  assert.strictEqual(typeof item.orderNumber, "string");
  assert.strictEqual(item.subscriptionId, null);
  assert.strictEqual(item.subscriptionDayId, null);
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subs = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subIds = subs.map((sub) => sub._id);
  const orders = await Order.find({ userId: { $in: userIds } }).select("_id").lean();
  const orderIds = orders.map((order) => order._id);

  await Promise.all([
    Delivery.deleteMany({ $or: [{ subscriptionId: { $in: subIds } }, { orderId: { $in: orderIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subIds } }),
    Subscription.deleteMany({ _id: { $in: subIds } }),
    Order.deleteMany({ _id: { $in: orderIds } }),
    Plan.deleteMany({ "name.en": { $regex: TEST_TAG } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
}

async function seedDashboardUsers() {
  dashboardUsers.clear();
  for (const role of ["admin", "courier"]) {
    const user = await DashboardUser.create({
      email: `${TEST_TAG}-${role}@example.com`,
      passwordHash: "test-password-hash",
      role,
      isActive: true,
    });
    dashboardUsers.set(role, user);
  }
}

(async function run() {
  await connectDatabase();
  await cleanup();
  await seedDashboardUsers();

  const app = createApp();
  const api = request(app);
  const today = getTodayKSADate();

  const userSub = await User.create({ phone: `${TEST_TAG}-sub`, name: "Sub Client" });
  const userOrd = await User.create({ phone: `${TEST_TAG}-ord`, name: "Ord Client" });
  
  const plan = await Plan.create({
    name: { ar: "Test", en: `Plan ${TEST_TAG}` },
    isActive: true,
    daysCount: 7,
    currency: "SAR"
  });

  const sub = await Subscription.create({
    userId: userSub._id,
    planId: plan._id,
    status: "active",
    totalMeals: 10,
    remainingMeals: 10,
    deliveryMode: "delivery",
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const day = await SubscriptionDay.create({
    subscriptionId: sub._id,
    date: today,
    status: "out_for_delivery",
  });

  const deliverySub = await Delivery.create({
    subscriptionId: sub._id,
    dayId: day._id,
    date: today,
    status: "out_for_delivery",
    address: { line1: "123 Test St", city: "Riyadh" },
  });

  const order = await Order.create({
    userId: userOrd._id,
    orderNumber: "ORD-12345",
    status: "out_for_delivery",
    paymentStatus: "paid",
    fulfillmentMethod: "delivery",
    fulfillmentDate: today,
    delivery: { address: { line1: "456 Order St", city: "Jeddah" } },
  });

  const deliveryOrd = await Delivery.create({
    orderId: order._id,
    status: "out_for_delivery",
  });

  try {
    await test("GET /api/courier/deliveries/today should return strictly typed DTO", async () => {
      const res = await api.get("/api/courier/deliveries/today").set(auth("courier"));
      expectStatus(res, 200, "deliveries today");
      assert(res.body.status === true);
      
      const item = res.body.data.find(d => d.id === String(deliverySub._id));
      assert(item, "Delivery should be in list");
      assertSubscriptionDeliveryTaskContract(item);
      assert.strictEqual(item.customerName, "Sub Client");
      assert.strictEqual(item.status, "out_for_delivery");
      assert.strictEqual(item.deliveryAddress.city, "Riyadh");
    });

    await test("PUT /api/courier/deliveries/:id/arriving-soon transitions and returns DTO", async () => {
      const res = await api.put(`/api/courier/deliveries/${deliverySub._id}/arriving-soon`).set(auth("courier"));
      expectStatus(res, 200, "arriving soon sub");
      assertSubscriptionDeliveryTaskContract(res.body.data);
      assert.strictEqual(res.body.data.status, "arriving_soon");
      assert.strictEqual(res.body.data.id, String(deliverySub._id));
    });

    await test("PUT /api/courier/deliveries/:id/delivered handles fulfillment exactly once without double deduction", async () => {
      const subBefore = await Subscription.findById(sub._id);
      const balanceBefore = subBefore.remainingMeals;
      
      const res1 = await api.put(`/api/courier/deliveries/${deliverySub._id}/delivered`).set(auth("courier"));
      expectStatus(res1, 200, "delivered sub 1");
      assertSubscriptionDeliveryTaskContract(res1.body.data);
      assert.strictEqual(res1.body.data.status, "delivered");
      
      const subAfterFirst = await Subscription.findById(sub._id);
      const mealsDeducted = balanceBefore - subAfterFirst.remainingMeals;
      assert(mealsDeducted > 0, "balance must be deducted exactly once");
      
      const updatedDay = await SubscriptionDay.findById(day._id);
      assert.strictEqual(updatedDay.status, "fulfilled");
      assert.strictEqual(updatedDay.creditsDeducted, true);

      const res2 = await api.put(`/api/courier/deliveries/${deliverySub._id}/delivered`).set(auth("courier"));
      expectStatus(res2, 200, "delivered sub 2");
      assert.strictEqual(res2.body.idempotent, true);
      assertSubscriptionDeliveryTaskContract(res2.body.data);
      assert.strictEqual(res2.body.data.status, "delivered");

      const subAfterSecond = await Subscription.findById(sub._id);
      assert.strictEqual(subAfterSecond.remainingMeals, subAfterFirst.remainingMeals, "balance must not double deduct");
    });

    await test("Invalid transitions on deliveries: cancel before delivered works, deliver after cancel rejected", async () => {
      const tomorrow = "2026-06-21";
      const dayCancel = await SubscriptionDay.create({ subscriptionId: sub._id, date: tomorrow, status: "out_for_delivery" });
      const delCancel = await Delivery.create({ subscriptionId: sub._id, dayId: dayCancel._id, date: tomorrow, status: "out_for_delivery" });
      
      const resCancel = await api.put(`/api/courier/deliveries/${delCancel._id}/cancel`).send({ reason: "customer_not_available" }).set(auth("courier"));
      expectStatus(resCancel, 200, "cancel delivery");
      assertSubscriptionDeliveryTaskContract(resCancel.body.data);
      assert.strictEqual(resCancel.body.data.status, "canceled");
      
      const resDeliverAfterCancel = await api.put(`/api/courier/deliveries/${delCancel._id}/delivered`).set(auth("courier"));
      expectStatus(resDeliverAfterCancel, 409, "deliver after cancel should reject");
      
      const resCancelAfterDeliver = await api.put(`/api/courier/deliveries/${deliverySub._id}/cancel`).set(auth("courier")).send({ reason: "customer_not_available" });
      if (resCancelAfterDeliver.status === 200) {
        assertSubscriptionDeliveryTaskContract(resCancelAfterDeliver.body.data);
        assert.strictEqual(resCancelAfterDeliver.body.data.status, "delivered", "if 200, must not change state to canceled");
      } else {
        assert([400, 409].includes(resCancelAfterDeliver.status), "cancel after deliver rejected with 400 or 409");
      }
    });

    await test("Operations mark ready_for_delivery, courier pickups, and verifies transitions", async () => {
      const tomorrowStr = "2026-06-22";
      const dayPrep = await SubscriptionDay.create({
        subscriptionId: sub._id,
        date: tomorrowStr,
        status: "in_preparation",
      });

      const resReady = await api
        .put(`/api/dashboard/operations/subscription-days/${dayPrep._id}/ready-for-delivery`)
        .set(auth("admin"));
      expectStatus(resReady, 200, "mark ready_for_delivery");
      assert.strictEqual(resReady.body.status, true);
      assert.strictEqual(resReady.body.data.status, "ready_for_delivery");

      const delivery = await Delivery.findOne({ dayId: dayPrep._id });
      assert(delivery, "Delivery document should have been created/synced");
      assert.strictEqual(delivery.status, "ready_for_delivery");

      const resPickup = await api
        .put(`/api/courier/deliveries/${delivery._id}/pickup`)
        .set(auth("courier"));
      expectStatus(resPickup, 200, "courier pickup");
      assert.strictEqual(resPickup.body.status, true);
      assert.strictEqual(resPickup.body.data.status, "out_for_delivery");

      const updatedDay = await SubscriptionDay.findById(dayPrep._id);
      assert.strictEqual(updatedDay.status, "out_for_delivery");

      const resPickupDup = await api
        .put(`/api/courier/deliveries/${delivery._id}/pickup`)
        .set(auth("courier"));
      expectStatus(resPickupDup, 200, "idempotent courier pickup");
      assert.strictEqual(resPickupDup.body.idempotent, true);

      await Delivery.deleteOne({ _id: delivery._id });
      await SubscriptionDay.deleteOne({ _id: dayPrep._id });
    });

    await test("GET /api/courier/deliveries/today filters out pickup mode subscriptions", async () => {
      const userPickup = await User.create({ phone: `${TEST_TAG}-pickup-user`, name: "Pickup Client" });
      const subPickup = await Subscription.create({
        userId: userPickup._id,
        planId: plan._id,
        status: "active",
        totalMeals: 10,
        remainingMeals: 10,
        deliveryMode: "pickup",
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      const dayPickup = await SubscriptionDay.create({
        subscriptionId: subPickup._id,
        date: today,
        status: "out_for_delivery",
      });

      const deliveryPickup = await Delivery.create({
        subscriptionId: subPickup._id,
        dayId: dayPickup._id,
        date: today,
        status: "out_for_delivery",
        address: { line1: "Branch Pickup Address", city: "Riyadh" },
      });

      const res = await api.get("/api/courier/deliveries/today").set(auth("courier"));
      expectStatus(res, 200, "deliveries today");
      
      const found = res.body.data.find(d => d.id === String(deliveryPickup._id));
      assert(!found, "Pickup mode subscription deliveries must be filtered out of courier list");

      await Delivery.deleteOne({ _id: deliveryPickup._id });
      await SubscriptionDay.deleteOne({ _id: dayPickup._id });
      await Subscription.deleteOne({ _id: subPickup._id });
      await User.deleteOne({ _id: userPickup._id });
    });

    await test("GET /api/courier/orders/today should return strictly typed DTO", async () => {
      const res = await api.get("/api/courier/orders/today").set(auth("courier"));
      expectStatus(res, 200, "orders today");
      assert(res.body.status === true);
      
      const item = res.body.data.find(o => o.id === String(order._id));
      assert(item, "Order should be in list");
      assertOneTimeOrderDeliveryTaskContract(item);
      assert.strictEqual(item.customerName, "Ord Client");
      assert.strictEqual(item.status, "out_for_delivery");
    });

    await test("PUT /api/courier/orders/:id/delivered handles order fulfillment safely without touching subscriptions", async () => {
      const subBefore = await Subscription.findById(sub._id);
      const balanceBefore = subBefore.remainingMeals;

      const res1 = await api.put(`/api/courier/orders/${order._id}/delivered`).set(auth("admin"));
      expectStatus(res1, 200, "delivered ord 1");
      assertOneTimeOrderDeliveryTaskContract(res1.body.data);
      assert.strictEqual(res1.body.data.status, "delivered");
      
      const subAfter = await Subscription.findById(sub._id);
      assert.strictEqual(subAfter.remainingMeals, balanceBefore, "one-time order delivery must not mutate subscription balance");

      const updatedOrder = await Order.findById(order._id);
      assert.strictEqual(updatedOrder.status, "fulfilled");
      
      const res2 = await api.put(`/api/courier/orders/${order._id}/delivered`).set(auth("courier"));
      expectStatus(res2, 200, "delivered ord 2");
      assert.strictEqual(res2.body.idempotent, true);
      assertOneTimeOrderDeliveryTaskContract(res2.body.data);
      assert.strictEqual(res2.body.data.status, "delivered");
    });

    await test("Role permissions enforcement", async () => {
      const resCourier = await api.get("/api/courier/deliveries/today").set(auth("courier"));
      expectStatus(resCourier, 200, "courier allowed");

      const resAdmin = await api.get("/api/courier/deliveries/today").set(auth("admin"));
      expectStatus(resAdmin, 200, "admin allowed");

      const resClient = await api.get("/api/courier/deliveries/today").set(customerAuth(userSub));
      expectStatus(resClient, 401, "client forbidden / unauth (invalid dashboard token)");

      const resUnauth = await api.get("/api/courier/deliveries/today");
      expectStatus(resUnauth, 401, "unauth forbidden");
    });

  } finally {
    await cleanup();
    await disconnect();
  }

  console.log(`\nCourier delivery contract tests complete: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exit(1);
  }
})();
