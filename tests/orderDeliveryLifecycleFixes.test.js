process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const ActivityLog = require("../src/models/ActivityLog");
const DashboardUser = require("../src/models/DashboardUser");
const Delivery = require("../src/models/Delivery");
const Order = require("../src/models/Order");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const { DASHBOARD_JWT_SECRET } = require("../src/services/dashboardTokenService");
const { ORDER_STATUSES } = require("../src/utils/orderState");

const TEST_TAG = `delivery-lifecycle-${Date.now()}`;
const ORIGINAL_ONE_TIME_ORDER_DELIVERY_ENABLED = process.env.ONE_TIME_ORDER_DELIVERY_ENABLED;
const dashboardUsers = new Map();
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

async function connectDatabase() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test");
  }
}

function expectStatus(res, status, label) {
  assert.strictEqual(res.status, status, `${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
}

function dashboardToken(role = "admin") {
  const user = dashboardUsers.get(role);
  assert(user, `missing dashboard user for role ${role}`);
  return jwt.sign(
    { userId: String(user._id), role, tokenType: "dashboard_access" },
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
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "supersecret",
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

async function seedDashboardUsers() {
  dashboardUsers.clear();
  for (const role of ["superadmin", "admin", "kitchen", "courier"]) {
    const user = await DashboardUser.create({
      email: `${TEST_TAG}-${role}@example.com`,
      passwordHash: "not-used",
      role,
      isActive: true,
    });
    dashboardUsers.set(role, user);
  }
}

async function seedUser(suffix = "customer") {
  return User.create({
    phone: `${TEST_TAG}-${suffix}`,
    name: `${TEST_TAG} ${suffix}`,
    role: "client",
    isActive: true,
  });
}

async function createSubscription(user, overrides = {}) {
  const deliveryMode = overrides.deliveryMode || "delivery";
  return Subscription.create({
    userId: user._id,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: new Date("2026-05-01T00:00:00.000Z"),
    endDate: new Date("2026-05-30T00:00:00.000Z"),
    validityEndDate: new Date("2026-05-30T00:00:00.000Z"),
    totalMeals: 20,
    remainingMeals: 20,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode,
    deliveryAddress: deliveryMode === "delivery" ? { line1: `${TEST_TAG} address`, city: "Riyadh" } : undefined,
    deliveryWindow: "18:00-20:00",
    pickupLocationId: deliveryMode === "pickup" ? "main-branch" : "",
    ...overrides,
  });
}

async function createDay(subscription, overrides = {}) {
  return SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: overrides.date || "2026-05-21",
    status: overrides.status || "open",
    materializedMeals: [{
      slotKey: "slot_1",
      selectionType: "standard_meal",
      operationalSku: `${TEST_TAG}-meal`,
    }],
    mealSlots: [{ slotIndex: 1, slotKey: "slot_1", status: "complete" }],
    ...overrides,
  });
}

async function createOrder(user, overrides = {}) {
  const fulfillmentMethod = overrides.fulfillmentMethod || "pickup";
  const order = await Order.create({
    userId: user._id,
    orderNumber: `${TEST_TAG}-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    status: overrides.status || ORDER_STATUSES.CONFIRMED,
    paymentStatus: overrides.paymentStatus || "paid",
    fulfillmentMethod,
    deliveryMode: fulfillmentMethod,
    fulfillmentDate: overrides.fulfillmentDate || "2026-05-21",
    deliveryDate: overrides.fulfillmentDate || "2026-05-21",
    items: [{
      itemType: "sandwich",
      name: { en: `${TEST_TAG} sandwich`, ar: "" },
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
        line1: `${TEST_TAG} street`,
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
  });
  order.paymentId = payment._id;
  await order.save();
  return order;
}

async function cleanup() {
  const users = await User.find({ phone: { $regex: TEST_TAG } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);
  const orders = await Order.find({ userId: { $in: userIds } }).select("_id").lean();
  const orderIds = orders.map((order) => order._id);

  await Promise.all([
    ActivityLog.deleteMany({ $or: [{ entityId: { $in: [...subscriptionIds, ...orderIds] } }, { "meta.source": "dashboard_orders" }] }),
    Delivery.deleteMany({ $or: [{ subscriptionId: { $in: subscriptionIds } }, { dayId: { $in: await SubscriptionDay.find({ subscriptionId: { $in: subscriptionIds } }).distinct("_id") } }, { orderId: { $in: orderIds } }] }),
    Payment.deleteMany({ $or: [{ userId: { $in: userIds } }, { orderId: { $in: orderIds } }] }),
    SubscriptionAuditLog.deleteMany({ $or: [{ entityId: { $in: subscriptionIds } }, { "meta.subscriptionId": { $in: subscriptionIds.map(String) } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    Order.deleteMany({ _id: { $in: orderIds } }),
    DashboardUser.deleteMany({ email: { $regex: TEST_TAG } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
}

(async function run() {
  await connectDatabase();
  await cleanup();
  await seedDashboardUsers();

  const app = createApp();
  const api = request(app);
  const user = await seedUser();

  try {
    await test("subscription delivery cancel, reopen, dispatch, and fulfill are executable and sync Delivery", async () => {
      const subscription = await createSubscription(user, { deliveryMode: "delivery" });

      const openCancelDay = await createDay(subscription, { date: "2026-05-21", status: "open" });
      let res = await api.post("/api/dashboard/ops/actions/cancel").set(auth("kitchen")).send({
        entityId: String(openCancelDay._id),
        entityType: "subscription_day",
        payload: { reason: "stock_out" },
      });
      expectStatus(res, 200, "delivery open cancel");
      assert.strictEqual(res.body.data.status, "delivery_canceled");

      const lockedDay = await createDay(subscription, { date: "2026-05-22", status: "open" });
      res = await api.post("/api/dashboard/ops/actions/lock").set(auth("kitchen")).send({
        entityId: String(lockedDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "delivery lock");
      assert.strictEqual(res.body.data.status, "locked");
      res = await api.post("/api/dashboard/ops/actions/reopen").set(auth("admin")).send({
        entityId: String(lockedDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "delivery locked reopen");
      assert.strictEqual(res.body.data.status, "open");

      const flowDay = await createDay(subscription, { date: "2026-05-23", status: "open" });
      res = await api.post("/api/dashboard/ops/actions/prepare").set(auth("kitchen")).send({
        entityId: String(flowDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "delivery prepare");
      assert.strictEqual(res.body.data.status, "in_preparation");
      res = await api.post("/api/dashboard/ops/actions/dispatch").set(auth("courier")).send({
        entityId: String(flowDay._id),
        entityType: "subscription_day",
        payload: { etaAt: "2026-05-23T15:30:00.000Z" },
      });
      expectStatus(res, 200, "delivery dispatch");
      assert.strictEqual(res.body.data.status, "out_for_delivery");
      let delivery = await Delivery.findOne({ dayId: flowDay._id }).lean();
      assert(delivery, "delivery record should exist");
      assert.strictEqual(delivery.status, "out_for_delivery");
      res = await api.post("/api/dashboard/ops/actions/fulfill").set(auth("courier")).send({
        entityId: String(flowDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "delivery fulfill");
      assert.strictEqual(res.body.data.status, "fulfilled");
      delivery = await Delivery.findOne({ dayId: flowDay._id }).lean();
      assert.strictEqual(delivery.status, "delivered");
    });

    await test("subscription pickup code is exposed to dashboard and owner, visual-only for fulfill, and no_show works", async () => {
      const subscription = await createSubscription(user, { deliveryMode: "pickup" });
      const otherUser = await seedUser("other-subscription-user");

      const openCancelDay = await createDay(subscription, {
        date: "2026-05-24",
        status: "open",
        pickupRequested: true,
      });
      let res = await api.post("/api/dashboard/ops/actions/cancel").set(auth("kitchen")).send({
        entityId: String(openCancelDay._id),
        entityType: "subscription_day",
        payload: { reason: "customer_request" },
      });
      expectStatus(res, 200, "pickup open cancel");
      assert.strictEqual(res.body.data.status, "canceled_at_branch");

      const flowDay = await createDay(subscription, {
        date: "2026-05-25",
        status: "open",
        pickupRequested: true,
        pickupRequestedAt: new Date(),
      });
      res = await api.post("/api/dashboard/ops/actions/prepare").set(auth("kitchen")).send({
        entityId: String(flowDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "pickup prepare");
      assert.strictEqual(res.body.data.status, "in_preparation");
      res = await api.post("/api/dashboard/ops/actions/ready_for_pickup").set(auth("kitchen")).send({
        entityId: String(flowDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "pickup ready");
      assert.strictEqual(res.body.data.status, "ready_for_pickup");
      const pickupCode = res.body.data.context.pickupCode;
      assert.match(pickupCode, /^\d{6}$/);

      res = await api.get("/api/dashboard/pickup/queue?date=2026-05-25&method=pickup").set(auth("kitchen"));
      expectStatus(res, 200, "pickup queue");
      const row = res.body.data.items.find((item) => item.entityId === String(flowDay._id));
      assert(row, "ready pickup day should be in queue");
      assert.strictEqual(row.pickup.pickupCode, pickupCode);
      assert(row.allowedActions.some((action) => action.id === "no_show"), "no_show should be visible for pickup ready day");

      res = await api.get(`/api/subscriptions/${subscription._id}/days/2026-05-25`).set(customerAuth(user));
      expectStatus(res, 200, "owner subscription day");
      assert.strictEqual(res.body.data.pickupCode, pickupCode);

      res = await api.get(`/api/subscriptions/${subscription._id}/days/2026-05-25`).set(customerAuth(otherUser));
      expectStatus(res, 403, "unrelated customer cannot read subscription pickup code");

      res = await api.post("/api/dashboard/ops/actions/fulfill").set(auth("kitchen")).send({
        entityId: String(flowDay._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 200, "pickup fulfill without code payload");
      assert.strictEqual(res.body.data.status, "fulfilled");
      const fulfilledDay = await SubscriptionDay.findById(flowDay._id).lean();
      assert(fulfilledDay.pickupVerifiedAt, "pickup verification timestamp should be stored");
      assert.strictEqual(String(fulfilledDay.pickupVerifiedByDashboardUserId), String(dashboardUsers.get("kitchen")._id));

      const noShowDay = await createDay(subscription, {
        date: "2026-05-26",
        status: "ready_for_pickup",
        pickupRequested: true,
        pickupCode: "123456",
        pickupCodeIssuedAt: new Date(),
      });
      res = await api.post("/api/dashboard/ops/actions/no_show").set(auth("kitchen")).send({
        entityId: String(noShowDay._id),
        entityType: "subscription_day",
        payload: { reason: "customer_no_show" },
      });
      expectStatus(res, 200, "pickup no_show");
      assert.strictEqual(res.body.data.status, "no_show");
    });

    await test("one-time delivery syncs Delivery on dispatch, fulfill, and cancel", async () => {
      await withOneTimeDeliveryEnabled(async () => {
        const dispatchOrder = await createOrder(user, {
          fulfillmentMethod: "delivery",
          status: ORDER_STATUSES.IN_PREPARATION,
        });
        let res = await api.post(`/api/dashboard/orders/${dispatchOrder._id}/actions/dispatch`).set(auth("courier")).send({
          etaAt: "2026-05-21T15:30:00.000Z",
        });
        expectStatus(res, 200, "order delivery dispatch");
        assert.strictEqual(res.body.data.status, "out_for_delivery");
        let delivery = await Delivery.findOne({ orderId: dispatchOrder._id }).lean();
        assert(delivery, "order delivery record should exist after dispatch");
        assert.strictEqual(delivery.status, "out_for_delivery");

        res = await api.post(`/api/dashboard/orders/${dispatchOrder._id}/actions/fulfill`).set(auth("courier")).send({});
        expectStatus(res, 200, "order delivery fulfill");
        assert.strictEqual(res.body.data.status, "fulfilled");
        delivery = await Delivery.findOne({ orderId: dispatchOrder._id }).lean();
        assert.strictEqual(delivery.status, "delivered");

        const cancelOrder = await createOrder(user, {
          fulfillmentMethod: "delivery",
          status: ORDER_STATUSES.IN_PREPARATION,
        });
        res = await api.post(`/api/dashboard/orders/${cancelOrder._id}/actions/cancel`).set(auth("kitchen")).send({
          reason: "restaurant_cancelled",
          notes: "closed early",
        });
        expectStatus(res, 200, "order delivery cancel");
        assert.strictEqual(res.body.data.status, "cancelled");
        delivery = await Delivery.findOne({ orderId: cancelOrder._id }).lean();
        assert(delivery, "order delivery record should exist after cancel");
        assert.strictEqual(delivery.status, "canceled");
      });
    });

    await test("one-time pickup code is exposed to dashboard and owner and visual-only for fulfill", async () => {
      const otherUser = await seedUser("other-order-user");
      const order = await createOrder(user, {
        fulfillmentMethod: "pickup",
        status: ORDER_STATUSES.IN_PREPARATION,
      });
      let res = await api.post(`/api/dashboard/orders/${order._id}/actions/ready_for_pickup`).set(auth("kitchen")).send({});
      expectStatus(res, 200, "order pickup ready");
      assert.strictEqual(res.body.data.status, "ready_for_pickup");
      const pickupCode = res.body.data.pickup.pickupCode;
      assert.match(pickupCode, /^\d{6}$/);

      res = await api.get(`/api/orders/${order._id}`).set(customerAuth(user));
      expectStatus(res, 200, "owner order detail");
      assert.strictEqual(res.body.data.pickup.pickupCode, pickupCode);

      res = await api.get(`/api/orders/${order._id}`).set(customerAuth(otherUser));
      expectStatus(res, 404, "unrelated customer cannot read order pickup code");

      res = await api.post(`/api/dashboard/orders/${order._id}/actions/fulfill`).set(auth("kitchen")).send({});
      expectStatus(res, 200, "order pickup fulfill without code payload");
      assert.strictEqual(res.body.data.status, "fulfilled");
      const saved = await Order.findById(order._id).lean();
      assert(saved.pickupVerifiedAt, "order pickup verification timestamp should be stored");
      assert.strictEqual(String(saved.pickupVerifiedByDashboardUserId), String(dashboardUsers.get("kitchen")._id));
    });

    await test("pickup fulfill still requires dashboard auth and an allowed role", async () => {
      const subscription = await createSubscription(user, { deliveryMode: "pickup" });
      const day = await createDay(subscription, {
        date: "2026-05-27",
        status: "ready_for_pickup",
        pickupRequested: true,
        pickupCode: "111222",
        pickupCodeIssuedAt: new Date(),
      });

      let res = await api.post("/api/dashboard/ops/actions/fulfill").send({
        entityId: String(day._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 401, "unauthenticated dashboard fulfill blocked");

      res = await api.post("/api/dashboard/ops/actions/fulfill").set(auth("courier")).send({
        entityId: String(day._id),
        entityType: "subscription_day",
      });
      expectStatus(res, 409, "courier pickup fulfill blocked by policy");
    });

    await test("visible one-time order actions match executable role rules", async () => {
      await withOneTimeDeliveryEnabled(async () => {
        const deliveryOrder = await createOrder(user, {
          fulfillmentMethod: "delivery",
          status: ORDER_STATUSES.OUT_FOR_DELIVERY,
        });
        const res = await api.get(`/api/dashboard/orders/${deliveryOrder._id}`).set(auth("courier"));
        expectStatus(res, 200, "courier order detail");
        const actions = res.body.data.allowedActions;
        assert(actions.includes("notify_arrival"));
        assert(actions.includes("fulfill"));
        assert(!actions.includes("cancel"), "courier should not see one-time order cancel");
      });
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

  console.log(`\nOrder delivery lifecycle fixes tests complete: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) {
    process.exit(1);
  }
})();
