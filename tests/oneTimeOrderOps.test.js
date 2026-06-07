process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const Delivery = require("../src/models/Delivery");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const DashboardUser = require("../src/models/DashboardUser");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const { ORDER_STATUSES } = require("../src/utils/orderState");

const TEST_TAG = `one-time-order-ops-${Date.now()}`;
const results = { passed: 0, failed: 0 };
const ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED = process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
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

async function withOneTimeDeliveryEnabled(fn) {
  const previous = process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
  process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = "true";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    else process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = previous;
  }
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
    Delivery.deleteMany({ orderId: { $in: orderIds } }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { orderId: { $in: orderIds } }] }),
    Order.deleteMany({ _id: { $in: orderIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
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

async function seedDashboardUsers() {
  dashboardUsers.clear();
  for (const role of ["admin", "kitchen", "courier", "superadmin"]) {
    const user = await DashboardUser.create({
      email: `${TEST_TAG}-${role}@example.com`,
      passwordHash: "test-password-hash",
      role,
      isActive: true,
    });
    dashboardUsers.set(role, user);
  }
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
    deliveryDate: "2026-05-04",
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
      vatHalala: fulfillmentMethod === "delivery" ? 552 : 345,
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
  await seedDashboardUsers();

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
      assert.strictEqual(res.body.data.timeline_endpoint, `/api/orders/${order._id}/timeline`);
      assert.strictEqual(res.body.data.cancelled_by, null);
      assert.strictEqual(res.body.data.cancellation_reason, null);
      assert.strictEqual(res.body.data.cancellation_source, null);
      assert.strictEqual(res.body.data.cancelled_at, null);
      assert(Array.isArray(res.body.data.items));
      assert(!Object.prototype.hasOwnProperty.call(res.body.data, "requestHash"));
      assert(!Object.prototype.hasOwnProperty.call(res.body.data.payment, "metadata"));
    });

    await test("Customer order detail includes timeline endpoint and normalized cancellation fields", async () => {
      const order = await createOrder(user);
      const res = await api.get(`/api/orders/${order._id}`).set(customerAuth(user));
      expectStatus(res, 200, "customer order detail contract");
      assert.strictEqual(res.body.data.timeline_endpoint, `/api/orders/${order._id}/timeline`);
      assert(Array.isArray(res.body.data.allowedActions));
      assert.strictEqual(res.body.data.cancelled_by, null);
      assert.strictEqual(res.body.data.cancellation_reason, null);
      assert.strictEqual(res.body.data.cancellation_source, null);
      assert.strictEqual(res.body.data.cancelled_at, null);
    });

    await test("Confirmed paid order allowedActions includes prepare", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED, paymentStatus: "paid" });
      const res = await api.get(`/api/dashboard/orders/${order._id}`).set(auth());
      expectStatus(res, 200, "confirmed allowed actions");
      assert(res.body.data.allowedActions.includes("prepare"));
    });

    await test("Kitchen cancel remains allowed and is treated as restaurant cancellation", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED, paymentStatus: "paid" });
      const detail = await api.get(`/api/dashboard/orders/${order._id}`).set(auth("kitchen"));
      expectStatus(detail, 200, "kitchen allowed actions");
      assert(detail.body.data.allowedActions.includes("prepare"));
      assert(detail.body.data.allowedActions.includes("cancel"));

      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/cancel`).set(auth("kitchen")).send({
        reason: "admin_cancelled",
      });
      expectStatus(res, 200, "kitchen cancel canonical restaurant metadata");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
      assert.strictEqual(res.body.data.cancelled_by, "restaurant");
      assert.strictEqual(res.body.data.cancellation_reason, "restaurant_cancelled");
      assert.strictEqual(res.body.data.cancellation_source, "dashboard");
      assert(!JSON.stringify(res.body.data).includes('"cancelled_by":"branch"'));
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
      assert.strictEqual(res.body.data.timeline_endpoint, `/api/orders/${order._id}/timeline`);
      assert.deepStrictEqual(res.body.data.allowedActions.sort(), ["cancel", "ready_for_pickup"].sort());
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
      await withOneTimeDeliveryEnabled(async () => {
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
    });

    await test("dispatch rejects pickup order", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/dispatch`).set(auth()).send({});
      expectStatus(res, 409, "dispatch rejects pickup");
    });

    await test("delivery order actions are blocked by default", async () => {
      const dispatchOrder = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      let res = await api.post(`/api/dashboard/orders/${dispatchOrder._id}/actions/dispatch`).set(auth()).send({});
      expectStatus(res, 409, "dispatch delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      const notifyOrder = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.OUT_FOR_DELIVERY,
      });
      res = await api.post(`/api/dashboard/orders/${notifyOrder._id}/actions/notify_arrival`).set(auth()).send({});
      expectStatus(res, 409, "notify delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      res = await api.post(`/api/dashboard/orders/${notifyOrder._id}/actions/fulfill`).set(auth()).send({});
      expectStatus(res, 409, "fulfill delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");
    });

    await test("delivery order DTO hides actions by default", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      const res = await api.get(`/api/dashboard/orders/${order._id}`).set(auth());
      expectStatus(res, 200, "delivery detail action gate");
      assert.deepStrictEqual(res.body.data.allowedActions, []);
    });

    await test("legacy kitchen/courier delivery order routes are blocked by default", async () => {
      const kitchenOrder = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      let res = await api.post(`/api/kitchen/orders/${kitchenOrder._id}/out-for-delivery`).set(auth("kitchen")).send({});
      expectStatus(res, 409, "legacy kitchen dispatch delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      const courierOrder = await createOrder(user, {
        fulfillmentMethod: "delivery",
        status: ORDER_STATUSES.OUT_FOR_DELIVERY,
      });
      res = await api.put(`/api/courier/orders/${courierOrder._id}/arriving-soon`).set(auth("courier")).send({});
      expectStatus(res, 409, "legacy courier arriving soon delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      res = await api.put(`/api/courier/orders/${courierOrder._id}/delivered`).set(auth("courier")).send({});
      expectStatus(res, 409, "legacy courier delivered delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");

      res = await api.put(`/api/courier/orders/${courierOrder._id}/cancel`).set(auth("courier")).send({
        reason: "customer_unavailable",
      });
      expectStatus(res, 409, "legacy courier cancel delivery disabled");
      assert.strictEqual(res.body.error.code, "DELIVERY_NOT_SUPPORTED");
    });

    await test("fulfill pickup ready_for_pickup -> fulfilled", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.READY_FOR_PICKUP,
        pickupCode: "123456",
        pickupCodeIssuedAt: new Date(),
        pickup: {
          branchId: "main",
          pickupWindow: "18:00-20:00",
          pickupCode: "123456",
        },
      });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/fulfill`).set(auth()).send({});
      expectStatus(res, 200, "fulfill pickup");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.FULFILLED);
    });

    await test("fulfill delivery out_for_delivery -> fulfilled", async () => {
      await withOneTimeDeliveryEnabled(async () => {
        const order = await createOrder(user, {
          fulfillmentMethod: "delivery",
          status: ORDER_STATUSES.OUT_FOR_DELIVERY,
        });
        const res = await api.post(`/api/dashboard/orders/${order._id}/actions/fulfill`).set(auth()).send({});
        expectStatus(res, 200, "fulfill delivery");
        assert.strictEqual(res.body.data.status, ORDER_STATUSES.FULFILLED);
      });
    });

    await test("cancel confirmed/in_preparation -> cancelled", async () => {
      const confirmed = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const preparing = await createOrder(user, { status: ORDER_STATUSES.IN_PREPARATION });

      let res = await api.post(`/api/dashboard/orders/${confirmed._id}/actions/cancel`).set(auth()).send({ reason: "restaurant_rejected" });
      expectStatus(res, 200, "cancel confirmed");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
      assert.deepStrictEqual(res.body.data.allowedActions, []);
      assert.strictEqual(res.body.data.cancelled_by, "restaurant");
      assert.strictEqual(res.body.data.cancellation_reason, "restaurant_rejected");
      assert.strictEqual(res.body.data.cancellation_source, "dashboard");
      assert(res.body.data.cancelled_at);

      res = await api.post(`/api/dashboard/orders/${preparing._id}/actions/cancel`).set(auth()).send({ reason: "admin_cancelled" });
      expectStatus(res, 200, "cancel preparing");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
      assert.strictEqual(res.body.data.cancelled_by, "admin");
      assert.strictEqual(res.body.data.cancellation_reason, "admin_cancelled");
    });

    await test("Kitchen cancellation uses restaurant metadata, not branch", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.IN_PREPARATION });
      const res = await api.post(`/api/dashboard/orders/${order._id}/actions/cancel`).set(auth("kitchen")).send({});
      expectStatus(res, 200, "kitchen restaurant cancellation");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
      assert.strictEqual(res.body.data.cancelled_by, "restaurant");
      assert.strictEqual(res.body.data.cancellation_reason, "restaurant_cancelled");
      assert.strictEqual(res.body.data.cancellation_source, "dashboard");
      assert.notStrictEqual(res.body.data.cancelled_by, "branch");
    });

    await test("Customer pending-payment cancel returns normalized cancellation metadata", async () => {
      const order = await createOrder(user, {
        status: ORDER_STATUSES.PENDING_PAYMENT,
        paymentStatus: "initiated",
      });
      const res = await api.delete(`/api/orders/${order._id}`).set(customerAuth(user)).send({
        reason: "please_cancel_this_specific_reason",
      });
      expectStatus(res, 200, "customer cancel metadata");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
      assert.strictEqual(res.body.data.cancelled_by, "customer");
      assert.strictEqual(res.body.data.cancellation_reason, "customer_requested");
      assert.strictEqual(res.body.data.cancellation_source, "mobile_app");
      assert(res.body.data.cancelled_at);
      assert.deepStrictEqual(res.body.data.allowedActions, []);
    });

    await test("Payment initialization failure serializes as system payment_failed metadata", async () => {
      const order = await createOrder(user, {
        status: ORDER_STATUSES.CANCELLED,
        paymentStatus: "failed",
        cancellationReason: "payment_initialization_failed",
        cancellationSource: "payment_provider",
        cancellationActorType: "system",
        cancelledBy: "system",
        canceledBy: "system",
        cancelledAt: new Date("2026-05-19T12:30:00.000Z"),
        canceledAt: new Date("2026-05-19T12:30:00.000Z"),
      });
      const res = await api.get(`/api/orders/${order._id}`).set(customerAuth(user));
      expectStatus(res, 200, "payment init failure metadata");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.CANCELLED);
      assert.strictEqual(res.body.data.paymentStatus, "failed");
      assert.strictEqual(res.body.data.cancelled_by, "system");
      assert.strictEqual(res.body.data.cancellation_reason, "payment_failed");
      assert.strictEqual(res.body.data.cancellation_source, "payment_provider");
      assert(!JSON.stringify(res.body.data).includes('"cancelled_by":"branch"'));
    });

    await test("Dashboard and customer timeline endpoints return pickup-only timeline states", async () => {
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.IN_PREPARATION,
        confirmedAt: new Date("2026-05-19T10:05:00.000Z"),
        preparationStartedAt: new Date("2026-05-19T10:10:00.000Z"),
      });

      let res = await api.get(`/api/dashboard/orders/${order._id}/timeline`).set(auth());
      expectStatus(res, 200, "dashboard order timeline");
      assert.strictEqual(res.body.data.order_id, String(order._id));
      assert.strictEqual(res.body.data.current_status, ORDER_STATUSES.IN_PREPARATION);
      assert.deepStrictEqual(res.body.data.timeline.map((item) => item.key), [
        "order_created",
        "payment_confirmed",
        "preparing",
        "ready_for_pickup",
        "fulfilled",
      ]);
      assert.strictEqual(res.body.data.timeline.find((item) => item.key === "preparing").state, "active");
      assert(!res.body.data.timeline.some((item) => item.key === "out_for_delivery"));

      res = await api.get(`/api/orders/${order._id}/timeline`).set(customerAuth(user));
      expectStatus(res, 200, "customer order timeline");
      assert.strictEqual(res.body.data.current_status, ORDER_STATUSES.IN_PREPARATION);
    });

    await test("Cancelled and expired timelines return terminal cancellation items", async () => {
      const cancelled = await createOrder(user, {
        status: ORDER_STATUSES.CANCELLED,
        cancelledAt: new Date("2026-05-19T11:00:00.000Z"),
        canceledAt: new Date("2026-05-19T11:00:00.000Z"),
        cancellationActorType: "restaurant",
        cancellationReason: "restaurant_rejected",
        cancellationSource: "dashboard",
      });
      let res = await api.get(`/api/dashboard/orders/${cancelled._id}/timeline`).set(auth());
      expectStatus(res, 200, "cancelled timeline");
      const lastCancelled = res.body.data.timeline[res.body.data.timeline.length - 1];
      assert.strictEqual(lastCancelled.key, "cancelled");
      assert.strictEqual(lastCancelled.state, "cancelled");
      assert.strictEqual(lastCancelled.cancelled_by, "restaurant");
      assert.strictEqual(lastCancelled.cancellation_reason, "restaurant_rejected");

      const expired = await createOrder(user, {
        status: ORDER_STATUSES.EXPIRED,
        paymentStatus: "expired",
        expiresAt: new Date("2026-05-19T12:00:00.000Z"),
      });
      res = await api.get(`/api/dashboard/orders/${expired._id}/timeline`).set(auth());
      expectStatus(res, 200, "expired timeline");
      const lastExpired = res.body.data.timeline[res.body.data.timeline.length - 1];
      assert.strictEqual(lastExpired.key, "expired");
      assert.strictEqual(lastExpired.state, "cancelled");
    });

    await test("legacy kitchen preparing route writes canonical in_preparation", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const res = await api.post(`/api/kitchen/orders/${order._id}/preparing`).set(auth("kitchen")).send({});
      expectStatus(res, 200, "legacy kitchen preparing route");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.IN_PREPARATION);

      const saved = await Order.findById(order._id).lean();
      assert.strictEqual(saved.status, ORDER_STATUSES.IN_PREPARATION);
    });

    await test("legacy seeded order statuses serialize canonically", async () => {
      const preparing = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      await Order.collection.updateOne({ _id: preparing._id }, { $set: { status: "preparing" } });
      let res = await api.get(`/api/dashboard/orders/${preparing._id}`).set(auth());
      expectStatus(res, 200, "legacy preparing detail");
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.IN_PREPARATION);

      const canceled = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      await Order.collection.updateOne({ _id: canceled._id }, { $set: { status: "canceled" } });
      res = await api.get(`/api/dashboard/orders/${canceled._id}`).set(auth());
      expectStatus(res, 200, "legacy canceled detail");
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

    await test("Board order action routes to order service and returns order DTO", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const res = await api.post("/api/dashboard/kitchen/actions/prepare").set(auth()).send({
        entityType: "order",
        entityId: String(order._id),
      });
      expectStatus(res, 200, "board order prepare");
      assert.strictEqual(res.body.data.source, "one_time_order");
      assert.strictEqual(res.body.data.entityType, "order");
      assert.strictEqual(res.body.data.entityId, String(order._id));
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.IN_PREPARATION);
      assert(Array.isArray(res.body.data.allowedActions));
    });

    await test("Unified ops order action routes by source and returns order DTO", async () => {
      const order = await createOrder(user, { status: ORDER_STATUSES.CONFIRMED });
      const res = await api.post("/api/dashboard/ops/actions/prepare").set(auth()).send({
        source: "one_time_order",
        entityId: String(order._id),
      });
      expectStatus(res, 200, "unified ops source order prepare");
      assert.strictEqual(res.body.data.source, "one_time_order");
      assert.strictEqual(res.body.data.entityType, "order");
      assert.strictEqual(res.body.data.entityId, String(order._id));
      assert.strictEqual(res.body.data.status, ORDER_STATUSES.IN_PREPARATION);
      assert(Array.isArray(res.body.data.allowedActions));
    });

    await test("Kitchen queue excludes unpaid orders and includes paid pickup orders", async () => {
      const paid = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.CONFIRMED,
        paymentStatus: "paid",
      });
      const unpaid = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.PENDING_PAYMENT,
        paymentStatus: "initiated",
      });
      const res = await api.get("/api/dashboard/kitchen/queue?date=2026-05-04&method=pickup").set(auth());
      expectStatus(res, 200, "kitchen queue payment filter");
      const ids = res.body.data.items.map((item) => item.entityId);
      assert(ids.includes(String(paid._id)));
      assert(!ids.includes(String(unpaid._id)));
    });
  } finally {
    if (ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED === undefined) {
      delete process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
    } else {
      process.env.ONE_TIME_ORDER_DELIVERY_ENABLED = ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED;
    }
    await cleanup();
    await mongoose.disconnect();
  }

  console.log(`\nOne-time order ops tests complete: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exit(1);
  }
})();
