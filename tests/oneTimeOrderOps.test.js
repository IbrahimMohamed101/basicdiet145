process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const { ORDER_STATUSES } = require("../src/utils/orderState");

const TEST_TAG = `one-time-order-ops-${Date.now()}`;
const results = { passed: 0, failed: 0 };

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
  return jwt.sign(
    { userId: new mongoose.Types.ObjectId().toString(), role, tokenType: "dashboard_access" },
    DASHBOARD_JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function auth(role = "admin") {
  return { Authorization: `Bearer ${dashboardToken(role)}`, "Accept-Language": "en" };
}

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const orders = await Order.find({ userId: { $in: userIds } }).select("_id").lean();
  const orderIds = orders.map((order) => order._id);

  await Promise.all([
    ActivityLog.deleteMany({ $or: [{ entityId: { $in: orderIds } }, { "meta.source": "dashboard_orders" }] }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { orderId: { $in: orderIds } }] }),
    Order.deleteMany({ _id: { $in: orderIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

async function seedUser() {
  return User.create({
    phone: `${TEST_TAG}-+966500000000`,
    name: `${TEST_TAG} Customer`,
    role: "client",
    isActive: true,
  });
}

async function createOrder(user, overrides = {}) {
  const fulfillmentMethod = overrides.fulfillmentMethod || "pickup";
  const order = await Order.create({
    userId: user._id,
    orderNumber: `${TEST_TAG}-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    status: ORDER_STATUSES.CONFIRMED,
    paymentStatus: "paid",
    fulfillmentMethod,
    fulfillmentDate: "2026-05-04",
    items: [{
      itemType: "sandwich",
      name: { ar: "", en: `${TEST_TAG} Sandwich` },
      qty: 1,
      unitPriceHalala: 2500,
      lineTotalHalala: 2500,
      currency: "SAR",
    }],
    pricing: {
      subtotalHalala: 2500,
      deliveryFeeHalala: fulfillmentMethod === "delivery" ? 1000 : 0,
      discountHalala: 0,
      totalHalala: fulfillmentMethod === "delivery" ? 3500 : 2500,
      vatPercentage: 15,
      vatHalala: fulfillmentMethod === "delivery" ? 457 : 326,
      vatIncluded: true,
      currency: "SAR",
    },
    delivery: fulfillmentMethod === "delivery" ? {
      address: {
        line1: `${TEST_TAG} Street`,
        city: "Riyadh",
        phone: "+966500000001",
      },
    } : undefined,
    pickup: fulfillmentMethod === "pickup" ? {
      branchId: "main",
      pickupWindow: "18:00-20:00",
    } : undefined,
    ...overrides,
  });

  const payment = await Payment.create({
    provider: "moyasar",
    type: "one_time_order",
    status: order.paymentStatus,
    amount: order.pricing.totalHalala,
    currency: "SAR",
    userId: user._id,
    orderId: order._id,
    applied: order.paymentStatus === "paid",
    paidAt: order.paymentStatus === "paid" ? new Date() : undefined,
    metadata: { rawWebhookPayload: { should: "not leak" } },
  });
  order.paymentId = payment._id;
  await order.save();
  return order;
}

(async function run() {
  await connectDatabase();
  await cleanup();

  const app = createApp();
  const api = request(app);
  const user = await seedUser();

  try {
    await test("Dashboard list returns one-time orders", async () => {
      const order = await createOrder(user);
      const res = await api.get("/api/dashboard/orders").set(auth());
      expectStatus(res, 200, "dashboard list");
      assert(res.body.data.items.some((item) => item.orderId === String(order._id)));
      const item = res.body.data.items.find((row) => row.orderId === String(order._id));
      assert.strictEqual(item.source, "one_time_order");
      assert.strictEqual(item.entityType, "order");
      assert(Array.isArray(res.body.data.pagination ? res.body.data.items : []));
    });

    await test("Dashboard detail returns source=one_time_order and entityType=order", async () => {
      const order = await createOrder(user);
      const res = await api.get(`/api/dashboard/orders/${order._id}`).set(auth());
      expectStatus(res, 200, "dashboard detail");
      assert.strictEqual(res.body.data.source, "one_time_order");
      assert.strictEqual(res.body.data.entityType, "order");
      assert(Array.isArray(res.body.data.items));
      assert(!Object.prototype.hasOwnProperty.call(res.body.data, "requestHash"));
      assert(!Object.prototype.hasOwnProperty.call(res.body.data.payment, "metadata"));
    });

    await test("Confirmed paid order allowedActions includes prepare", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED, paymentStatus: "paid" });
      const res = await api.get(`/api/dashboard/orders/${order._id}`).set(auth());
      expectStatus(res, 200, "confirmed allowed actions");
      assert(res.body.data.allowedActions.includes("prepare"));
    });

    await test("Pending payment order does not allow prepare", async () => {
      const order = await createOrder(user, {
        status: ORDER_STATUSES.PENDING_PAYMENT,
        paymentStatus: "initiated",
      });
      const res = await api.get(`/api/dashboard/orders/${order._id}`).set(auth());
      expectStatus(res, 200, "pending allowed actions");
      assert(!res.body.data.allowedActions.includes("prepare"));
    });

    await test("prepare changes confirmed -> in_preparation", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/prepare`).set(auth()).send({});
      expectStatus(res, 200, "prepare action");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.IN_PREPARATION);
    });

    await test("ready_for_pickup works only for pickup in_preparation", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/ready_for_pickup`).set(auth()).send({
        pickupCode: "123456",
      });
      expectStatus(res, 200, "ready pickup action");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.READY_FOR_PICKUP);
      assert.strictEqual(res.body.data.pickup.pickupCode, "123456");
    });

    await test("ready_for_pickup rejects delivery order", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/ready_for_pickup`).set(auth()).send({});
      expectStatus(res, 409, "ready pickup rejects delivery");
    });

    await test("dispatch works only for delivery in_preparation", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/dispatch`).set(auth()).send({
        etaAt: "2026-05-03T15:30:00.000Z",
      });
      expectStatus(res, 200, "dispatch action");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.OUT_FOR_DELIVERY);
    });

    await test("dispatch rejects pickup order", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/dispatch`).set(auth()).send({});
      expectStatus(res, 409, "dispatch rejects pickup");
    });

    await test("fulfill pickup ready_for_pickup -> fulfilled", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.READY_FOR_PICKUP,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/fulfill`).set(auth()).send({});
      expectStatus(res, 200, "fulfill pickup");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.FULFILLED);
    });

    await test("fulfill delivery out_for_delivery -> fulfilled", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.OUT_FOR_DELIVERY,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/fulfill`).set(auth()).send({});
      expectStatus(res, 200, "fulfill delivery");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.FULFILLED);
    });

    await test("cancel confirmed/in_preparation -> cancelled", async () => {
      const confirmed = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const preparing = await createOrder(user, { status: ORDER_STATUSES.IN_PREPARATION });

      let res = await api.post(`/api/dashboard/orders/${confirmed._id}/actions/cancel`).set(auth()).send({ reason: "customer_request" });
      expectStatus(res, 200, "cancel confirmed");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);

      res = await api.post(`/api/dashboard/orders/${preparing._id}/actions/cancel`).set(auth()).send({ reason: "stock_out" });
      expectStatus(res, 200, "cancel preparing");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
    });

    await test("final statuses reject actions", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.FULFILLED });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/cancel`).set(auth()).send({ reason: "late" });
      expectStatus(res, 409, "final reject");
    });

    await test("reopen returns not supported", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CANCELLED });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/reopen`).set(auth()).send({ reason: "approved" });
      expectStatus(res, 409, "reopen unsupported");
      assert.strictEqual(res.body.error.code, "REOPEN_NOT_SUPPORTED");
    });

    await test("ActivityLog is written for successful actions", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const before = await ActivityLog.countDocuments({ entityType: "order", entityId: order._id });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/prepare`).set(auth()).send({});
      expectStatus(res, 200, "activity prepare");
      const after = await ActivityLog.countDocuments({
        entityType: "order",
        entityId: order._id,
        action: "dashboard_order_prepare",
      });
      assert.strictEqual(before, 0);
      assert.strictEqual(after, 1);
    });

    await test("SubscriptionDay documents are not created by dashboard order actions", async () => {
      const before = await SubscriptionDay.countDocuments();
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/prepare`).set(auth()).send({});
      expectStatus(res, 200, "subscription untouched action");
      const after = await SubscriptionDay.countDocuments();
      assert.strictEqual(after, before);
    });
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }

  console.log(`\nOne-time order ops tests complete: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exit(1);
  }
})();
