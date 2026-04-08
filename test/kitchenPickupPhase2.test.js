"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const kitchenController = require("../src/controllers/kitchenController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const ActivityLog = require("../src/models/ActivityLog");
const User = require("../src/models/User");
const NotificationLog = require("../src/models/NotificationLog");
const Setting = require("../src/models/Setting");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({
  params = {},
  body = {},
  userId = objectId(),
  userRole = "kitchen",
  dashboardUserId = userId,
} = {}) {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  return {
    req: {
      params,
      body,
      userId,
      userRole,
      dashboardUserId,
    },
    res,
  };
}

function createSession() {
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
  };
}

test("transitionDay issues a six-digit pickup code when a pickup day becomes ready", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindSubscription = Subscription.findById;
  const originalFindDay = SubscriptionDay.findOne;
  const originalFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalActivityLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindSubscription;
    SubscriptionDay.findOne = originalFindDay;
    SubscriptionDay.findOneAndUpdate = originalFindOneAndUpdate;
    ActivityLog.create = originalActivityLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
  });

  const subscriptionId = objectId();
  const userId = objectId();
  const day = {
    _id: objectId(),
    subscriptionId,
    date: "2026-05-10",
    status: "in_preparation",
    pickupCode: null,
    async save() {
      return this;
    },
  };
  const subscription = {
    _id: subscriptionId,
    userId,
    deliveryMode: "pickup",
  };

  mongoose.startSession = async () => createSession();
  Subscription.findById = () => ({
    session() {
      return {
        lean: async () => subscription,
      };
    },
  });
  SubscriptionDay.findOne = () => ({
    session: async () => day,
  });
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(day, update.$set);
    return day;
  };
  ActivityLog.create = async () => ({ _id: objectId() });
  User.findById = () => ({
    lean: async () => ({ _id: userId, fcmTokens: [] }),
  });
  NotificationLog.create = async () => ({ _id: objectId() });

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId), date: "2026-05-10" },
  });

  await kitchenController.transitionDay(req, res, "ready_for_pickup");

  assert.equal(res.statusCode, 200);
  assert.equal(day.status, "ready_for_pickup");
  assert.match(String(day.pickupCode), /^\d{6}$/);
  assert.equal(res.payload.data.pickupCode, day.pickupCode);
});

test("listPickupsByDate returns a snapshot-backed pickup queue", async (t) => {
  const originalFind = SubscriptionDay.find;

  t.after(() => {
    SubscriptionDay.find = originalFind;
  });

  const pickupDayId = objectId();
  const filteredOutDayId = objectId();

  SubscriptionDay.find = () => ({
    populate() {
      return this;
    },
    async lean() {
      return [
        {
          _id: pickupDayId,
          status: "ready_for_pickup",
          pickupCode: "123456",
          pickupVerifiedAt: null,
          lockedSnapshot: {
            deliveryMode: "pickup",
            customerName: "Islam",
            deliveryWindow: "10:00 - 12:00",
            pickupLocationId: "branch-1",
            pickupLocationName: "Nasr City",
            pickupAddress: { line1: "Branch Address" },
            planning: {
              baseMealSlots: [{ slotKey: "base_slot_1", mealId: objectId() }],
            },
            premiumSelections: [objectId()],
          },
        },
        {
          _id: filteredOutDayId,
          status: "ready_for_pickup",
          pickupCode: "654321",
          lockedSnapshot: {
            deliveryMode: "delivery",
            customerName: "Should Be Hidden",
          },
          subscriptionId: { deliveryMode: "delivery" },
        },
      ];
    },
  });

  const { req, res } = createReqRes({
    params: { date: "2026-05-10" },
  });

  await kitchenController.listPickupsByDate(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.length, 1);
  assert.equal(res.payload.data[0].subscriptionDayId, String(pickupDayId));
  assert.equal(res.payload.data[0].customerName, "Islam");
  assert.equal(res.payload.data[0].isReady, true);
  assert.equal(res.payload.data[0].pickupCode, "123456");
  assert.equal(res.payload.data[0].verified, false);
  assert.equal(res.payload.data[0].meals.length, 2);
});

test("verifyPickup validates the code and fulfills the day", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindSubscription = Subscription.findById;
  const originalFindDayById = SubscriptionDay.findById;
  const originalFindDay = SubscriptionDay.findOne;
  const originalUpdateDay = SubscriptionDay.findOneAndUpdate;
  const originalActivityLogCreate = ActivityLog.create;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindSubscription;
    SubscriptionDay.findById = originalFindDayById;
    SubscriptionDay.findOne = originalFindDay;
    SubscriptionDay.findOneAndUpdate = originalUpdateDay;
    ActivityLog.create = originalActivityLogCreate;
  });

  const subscriptionId = objectId();
  const day = {
    _id: objectId(),
    subscriptionId,
    date: "2026-05-10",
    status: "ready_for_pickup",
    pickupCode: "123456",
    pickupRequested: true,
    creditsDeducted: true,
    pickupVerifiedAt: null,
    pickupVerifiedByDashboardUserId: null,
    async save() {
      return this;
    },
  };
  const subscription = {
    _id: subscriptionId,
    deliveryMode: "pickup",
    remainingMeals: 8,
  };

  mongoose.startSession = async () => createSession();
  SubscriptionDay.findById = () => ({
    session: async () => day,
  });
  SubscriptionDay.findOne = () => ({
    session: async () => day,
  });
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(day, update.$set);
    return day;
  };
  Subscription.findById = () => ({
    populate() {
      return this;
    },
    session() {
      return this;
    },
    async lean() {
      return subscription;
    },
    then(resolve, reject) {
      return Promise.resolve(subscription).then(resolve, reject);
    },
  });
  ActivityLog.create = async () => ({ _id: objectId() });

  const actorId = objectId();
  const { req, res } = createReqRes({
    params: { dayId: String(day._id) },
    body: { code: "123456" },
    userId: actorId,
    dashboardUserId: actorId,
  });

  await kitchenController.verifyPickup(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(day.status, "fulfilled");
  assert.equal(day.pickupRequested, false);
  assert.ok(day.pickupVerifiedAt instanceof Date);
  assert.equal(String(day.pickupVerifiedByDashboardUserId), String(actorId));
  assert.equal(res.payload.verified, true);
});

test("fulfillPickup blocks direct completion when pickup verification is still pending", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindSubscription = Subscription.findById;
  const originalFindDay = SubscriptionDay.findOne;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindSubscription;
    SubscriptionDay.findOne = originalFindDay;
  });

  const subscriptionId = objectId();
  const day = {
    _id: objectId(),
    subscriptionId,
    date: "2026-05-10",
    status: "ready_for_pickup",
    pickupCode: "123456",
    pickupVerifiedAt: null,
  };
  const subscription = {
    _id: subscriptionId,
    deliveryMode: "pickup",
  };

  mongoose.startSession = async () => createSession();
  Subscription.findById = () => ({
    session() {
      return {
        lean: async () => subscription,
      };
    },
  });
  SubscriptionDay.findOne = () => ({
    session: async () => day,
  });

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId), date: "2026-05-10" },
  });

  await kitchenController.fulfillPickup(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.error.code, "PICKUP_VERIFICATION_REQUIRED");
});

test("markPickupNoShow applies the configured restore-credits policy", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindSubscription = Subscription.findById;
  const originalUpdateSubscription = Subscription.updateOne;
  const originalFindDayById = SubscriptionDay.findById;
  const originalActivityLogCreate = ActivityLog.create;
  const originalFindSetting = Setting.findOne;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindSubscription;
    Subscription.updateOne = originalUpdateSubscription;
    SubscriptionDay.findById = originalFindDayById;
    ActivityLog.create = originalActivityLogCreate;
    Setting.findOne = originalFindSetting;
  });

  const subscriptionId = objectId();
  const day = {
    _id: objectId(),
    subscriptionId,
    date: "2026-05-10",
    status: "ready_for_pickup",
    pickupRequested: true,
    creditsDeducted: true,
    lockedSnapshot: { mealsPerDay: 2 },
    async save() {
      return this;
    },
  };
  const subscription = {
    _id: subscriptionId,
    deliveryMode: "pickup",
    selectedMealsPerDay: 2,
  };
  let capturedSubscriptionUpdate = null;

  mongoose.startSession = async () => createSession();
  Setting.findOne = () => ({
    lean: async () => ({ value: true }),
  });
  Subscription.findById = () => ({
    session() {
      return {
        lean: async () => subscription,
      };
    },
  });
  Subscription.updateOne = async (query, update) => {
    capturedSubscriptionUpdate = { query, update };
    return { modifiedCount: 1 };
  };
  SubscriptionDay.findById = () => ({
    session: async () => day,
  });
  ActivityLog.create = async () => ({ _id: objectId() });

  const { req, res } = createReqRes({
    params: { dayId: String(day._id) },
  });

  await kitchenController.markPickupNoShow(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(day.status, "no_show");
  assert.equal(day.pickupRequested, false);
  assert.equal(day.creditsDeducted, false);
  assert.deepEqual(capturedSubscriptionUpdate.update, { $inc: { remainingMeals: 2 } });
  assert.equal(res.payload.restoredCredits, 2);
  assert.equal(res.payload.restoreCreditsPolicy, true);
});
