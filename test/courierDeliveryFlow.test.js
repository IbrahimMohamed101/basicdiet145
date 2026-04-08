"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const courierController = require("../src/controllers/courierController");
const orderCourierController = require("../src/controllers/orderCourierController");
const orderKitchenController = require("../src/controllers/orderKitchenController");
const kitchenController = require("../src/controllers/kitchenController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Order = require("../src/models/Order");
const Delivery = require("../src/models/Delivery");
const ActivityLog = require("../src/models/ActivityLog");
const User = require("../src/models/User");
const NotificationLog = require("../src/models/NotificationLog");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({
  params = {},
  body = {},
  userId = objectId(),
  userRole = "courier",
  dashboardUserId = null,
} = {}) {
  const req = {
    params,
    body,
    userId,
    userRole,
    dashboardUserId,
  };

  const res = {
    statusCode: 200,
    payload: null,
    req,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  return { req, res };
}

function createSessionStub() {
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
    inTransaction() {
      return false;
    },
  };
}

function stubNotificationSideEffects(t) {
  const originalActivityLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  const originalNotificationLogUpdateOne = NotificationLog.updateOne;
  const originalNotificationLogFindOne = NotificationLog.findOne;

  ActivityLog.create = async () => ({ _id: objectId() });
  User.findById = () => ({
    lean: async () => null,
  });
  NotificationLog.create = async () => ({ _id: objectId() });
  NotificationLog.updateOne = async () => ({ modifiedCount: 1 });
  NotificationLog.findOne = () => ({
    select: () => ({
      lean: async () => null,
    }),
  });

  t.after(() => {
    ActivityLog.create = originalActivityLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
    NotificationLog.updateOne = originalNotificationLogUpdateOne;
    NotificationLog.findOne = originalNotificationLogFindOne;
  });
}

test("courier shared queue lists today's subscription deliveries without courier scoping", async (t) => {
  const originalFindDays = SubscriptionDay.find;
  const originalFindDeliveries = Delivery.find;

  t.after(() => {
    SubscriptionDay.find = originalFindDays;
    Delivery.find = originalFindDeliveries;
  });

  const dayId = objectId();
  let capturedDeliveryQuery = null;

  SubscriptionDay.find = () => ({
    select: () => ({
      lean: async () => [{ _id: dayId }],
    }),
  });
  Delivery.find = (query) => {
    capturedDeliveryQuery = query;
    return {
      sort: () => ({
        lean: async () => [{ _id: objectId(), dayId }],
      }),
    };
  };

  const { req, res } = createReqRes();
  await courierController.listTodayDeliveries(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(capturedDeliveryQuery, { dayId: { $in: [dayId] } });
  assert.equal(res.payload.data.length, 1);
});

test("subscription arriving-soon remains a reminder event and does not rewrite delivery status", async (t) => {
  const originalFindById = Delivery.findById;
  const originalFindOneAndUpdate = Delivery.findOneAndUpdate;
  const originalFindSubscription = Subscription.findById;

  stubNotificationSideEffects(t);

  t.after(() => {
    Delivery.findById = originalFindById;
    Delivery.findOneAndUpdate = originalFindOneAndUpdate;
    Subscription.findById = originalFindSubscription;
  });

  const deliveryId = objectId();
  const delivery = {
    _id: deliveryId,
    status: "out_for_delivery",
    arrivingSoonReminderSentAt: null,
    subscriptionId: objectId(),
  };
  let capturedUpdate = null;

  Delivery.findById = async () => delivery;
  Delivery.findOneAndUpdate = async (_query, update) => {
    capturedUpdate = update;
    return {
      ...delivery,
      arrivingSoonReminderSentAt: new Date("2026-04-08T08:00:00.000Z"),
    };
  };
  Subscription.findById = () => ({
    lean: async () => null,
  });

  const { req, res } = createReqRes({
    params: { id: String(deliveryId) },
  });

  await courierController.markArrivingSoon(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(capturedUpdate);
  assert.ok(capturedUpdate.$set.arrivingSoonReminderSentAt instanceof Date);
  assert.ok(!Object.prototype.hasOwnProperty.call(capturedUpdate.$set, "status"));
  assert.equal(res.payload.data.status, "out_for_delivery");
});

test("subscription delivery cancel requires a reason", async (t) => {
  const originalFindDelivery = Delivery.findById;
  t.after(() => {
    Delivery.findById = originalFindDelivery;
  });

  Delivery.findById = async () => ({
    _id: objectId(),
    status: "out_for_delivery",
  });

  const { req, res } = createReqRes({
    params: { id: String(objectId()) },
    body: {},
  });

  await courierController.markCancelled(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "CANCELLATION_REASON_REQUIRED");
});

test("subscription delivery cancel marks day as delivery_canceled without skip compensation side effects", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindDelivery = Delivery.findById;
  const originalFindSubscription = Subscription.findById;
  const originalFindDay = SubscriptionDay.findById;

  stubNotificationSideEffects(t);

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Delivery.findById = originalFindDelivery;
    Subscription.findById = originalFindSubscription;
    SubscriptionDay.findById = originalFindDay;
  });

  mongoose.startSession = async () => createSessionStub();

  const subscriptionId = objectId();
  const dayId = objectId();
  const delivery = {
    _id: objectId(),
    subscriptionId,
    dayId,
    status: "out_for_delivery",
    async save() {
      return this;
    },
  };
  const subscription = {
    _id: subscriptionId,
    userId: objectId(),
  };
  const day = {
    _id: dayId,
    status: "out_for_delivery",
    creditsDeducted: false,
    operationAuditLog: [],
    cancellationReason: null,
    cancellationCategory: null,
    cancellationNote: null,
    canceledBy: null,
    canceledAt: null,
    async save() {
      return this;
    },
  };

  Delivery.findById = async () => delivery;
  Subscription.findById = () => ({
    session: () => ({
      lean: async () => subscription,
    }),
  });
  SubscriptionDay.findById = () => ({
    session: async () => day,
  });

  const { req, res } = createReqRes({
    params: { id: String(delivery._id) },
    body: { reason: "customer_not_answering", note: "No answer on phone" },
    dashboardUserId: String(objectId()),
  });

  await courierController.markCancelled(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(day.status, "delivery_canceled");
  assert.equal(delivery.status, "canceled");
  assert.equal(delivery.cancellationReason, "customer_not_answering");
  assert.equal(delivery.cancellationCategory, "customer_issue");
  assert.equal(delivery.cancellationNote, "No answer on phone");
  assert.equal(day.cancellationReason, "customer_not_answering");
  assert.equal(day.cancellationCategory, "customer_issue");
  assert.equal(day.cancellationNote, "No answer on phone");
  assert.ok(day.canceledAt instanceof Date);
  assert.ok(typeof day.canceledBy === "string" && day.canceledBy.length > 0);
  assert.equal(day.creditsDeducted, false);
  assert.equal(day.operationAuditLog[0].action, "delivery_canceled");
  assert.equal(res.payload.data.subscriptionDayStatus, "delivery_canceled");
  assert.equal(res.payload.data.cancellationCategory, "customer_issue");
});

test("shared one-time delivery queue includes only dispatched orders with delivery records", async (t) => {
  const originalFindOrders = Order.find;
  const originalFindDeliveries = Delivery.find;

  t.after(() => {
    Order.find = originalFindOrders;
    Delivery.find = originalFindDeliveries;
  });

  const orderOneId = objectId();
  const orderTwoId = objectId();
  let capturedOrderQuery = null;

  Order.find = (query) => {
    capturedOrderQuery = query;
    return {
      sort: () => ({
        lean: async () => [
          { _id: orderOneId, status: "out_for_delivery", deliveryMode: "delivery" },
          { _id: orderTwoId, status: "canceled", deliveryMode: "delivery" },
        ],
      }),
    };
  };
  Delivery.find = () => ({
    lean: async () => [
      { _id: objectId(), orderId: orderOneId, status: "out_for_delivery" },
    ],
  });

  const { req, res } = createReqRes();
  await orderCourierController.listTodayOrders(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(capturedOrderQuery.status, { $in: ["out_for_delivery", "fulfilled", "canceled"] });
  assert.equal(res.payload.data.length, 1);
  assert.equal(String(res.payload.data[0]._id), String(orderOneId));
  assert.equal(res.payload.data[0].delivery.status, "out_for_delivery");
});

test("one-time order delivery cancel stores required reason on shared queue item", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindOrder = Order.findById;
  const originalFindDelivery = Delivery.findOne;

  stubNotificationSideEffects(t);

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Order.findById = originalFindOrder;
    Delivery.findOne = originalFindDelivery;
  });

  mongoose.startSession = async () => createSessionStub();

  const order = {
    _id: objectId(),
    userId: objectId(),
    status: "out_for_delivery",
    deliveryMode: "delivery",
    canceledAt: null,
    async save() {
      return this;
    },
  };
  const delivery = {
    _id: objectId(),
    orderId: order._id,
    status: "out_for_delivery",
    canceledAt: null,
    async save() {
      return this;
    },
  };

  Order.findById = () => ({
    session: async () => order,
  });
  Delivery.findOne = () => ({
    session: async () => delivery,
  });

  const { req, res } = createReqRes({
    params: { id: String(order._id) },
    body: { reason: "operational_delay", note: "Courier delayed at dispatch hub" },
    dashboardUserId: String(objectId()),
  });

  await orderCourierController.markCancelled(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(order.status, "canceled");
  assert.equal(delivery.status, "canceled");
  assert.equal(delivery.cancellationReason, "operational_delay");
  assert.equal(delivery.cancellationCategory, "delivery_issue");
  assert.equal(delivery.cancellationNote, "Courier delayed at dispatch hub");
  assert.equal(res.payload.data.deliveryStatus, "canceled");
  assert.equal(res.payload.data.cancellationCategory, "delivery_issue");
});

test("one-time order delivered endpoint is idempotent after fulfillment", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindOrder = Order.findById;
  const originalFindDelivery = Delivery.findOne;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Order.findById = originalFindOrder;
    Delivery.findOne = originalFindDelivery;
  });

  mongoose.startSession = async () => createSessionStub();

  const fulfilledAt = new Date("2026-04-08T10:00:00.000Z");
  const order = {
    _id: objectId(),
    status: "fulfilled",
    deliveryMode: "delivery",
    fulfilledAt,
  };
  const delivery = {
    _id: objectId(),
    orderId: order._id,
    status: "delivered",
    deliveredAt: fulfilledAt,
  };

  Order.findById = () => ({
    session: async () => order,
  });
  Delivery.findOne = () => ({
    session: async () => delivery,
  });

  const { req, res } = createReqRes({
    params: { id: String(order._id) },
  });

  await orderCourierController.markDelivered(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.idempotent, true);
  assert.equal(res.payload.data.deliveryStatus, "delivered");
});

test("kitchen cannot directly complete delivery subscription days", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindDay = SubscriptionDay.findOne;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    SubscriptionDay.findOne = originalFindDay;
  });

  mongoose.startSession = async () => createSessionStub();
  SubscriptionDay.findOne = () => ({
    session: async () => ({
      _id: objectId(),
      status: "out_for_delivery",
      subscriptionId: objectId(),
      date: "2026-04-08",
    }),
  });

  const { req, res } = createReqRes({
    params: { id: String(objectId()), date: "2026-04-08" },
    userRole: "kitchen",
  });

  await kitchenController.transitionDay(req, res, "fulfilled");

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error.code, "PICKUP_VERIFICATION_REQUIRED");
});

test("kitchen cannot directly complete delivery one-time orders", async (t) => {
  const originalFindOrder = Order.findById;

  t.after(() => {
    Order.findById = originalFindOrder;
  });

  Order.findById = async () => ({
    _id: objectId(),
    status: "out_for_delivery",
    deliveryMode: "delivery",
  });

  const { req, res } = createReqRes({
    params: { id: String(objectId()) },
    userRole: "kitchen",
  });

  await orderKitchenController.transitionOrder(req, res, "fulfilled");

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error.code, "INVALID");
});

test("delivery status naming is standardized to canceled", () => {
  const statusEnum = Delivery.schema.path("status").enumValues;
  assert.ok(statusEnum.includes("canceled"));
  assert.ok(!statusEnum.includes("cancelled"));
});
