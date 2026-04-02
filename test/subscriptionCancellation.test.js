"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const adminController = require("../src/controllers/adminController");
const subscriptionController = require("../src/controllers/subscriptionController");
const { cancelSubscriptionDomain } = require("../src/services/subscriptionCancellationService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const Plan = require("../src/models/Plan");
const PremiumMeal = require("../src/models/PremiumMeal");
const Addon = require("../src/models/Addon");
const ActivityLog = require("../src/models/ActivityLog");
const dateUtils = require("../src/utils/date");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({
  params = {},
  body = {},
  query = {},
  userId = objectId(),
  dashboardUserId = objectId(),
  dashboardUserRole = "admin",
  headers = {},
} = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );

  const req = {
    params,
    body,
    query,
    userId,
    dashboardUserId,
    dashboardUserRole,
    headers: normalizedHeaders,
    get(name) {
      return normalizedHeaders[String(name || "").toLowerCase()];
    },
  };

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

  return { req, res };
}

function createQueryStub(result, { leanResult } = {}) {
  const query = {
    populate() {
      return query;
    },
    session() {
      return query;
    },
    sort() {
      return query;
    },
    select() {
      return query;
    },
    skip() {
      return query;
    },
    limit() {
      return query;
    },
    lean() {
      if (typeof leanResult === "function") {
        return Promise.resolve(leanResult());
      }
      if (leanResult !== undefined) {
        return Promise.resolve(leanResult);
      }
      return Promise.resolve(typeof result === "function" ? result() : result);
    },
    then(resolve, reject) {
      return Promise.resolve(typeof result === "function" ? result() : result).then(resolve, reject);
    },
  };
  return query;
}

function createSessionStub() {
  let active = false;
  return {
    startTransaction() {
      active = true;
    },
    async commitTransaction() {
      active = false;
    },
    async abortTransaction() {
      active = false;
    },
    endSession() {},
    inTransaction() {
      return active;
    },
  };
}

function createSubscriptionDoc({
  _id = objectId(),
  userId = objectId(),
  status = "active",
  remainingMeals = 12,
  selectedMealsPerDay = 2,
  canceledAt = null,
} = {}) {
  const doc = {
    _id,
    userId,
    planId: objectId(),
    status,
    startDate: new Date("2026-04-01T00:00:00+03:00"),
    endDate: new Date("2026-04-30T00:00:00+03:00"),
    validityEndDate: new Date("2026-04-30T00:00:00+03:00"),
    totalMeals: 60,
    remainingMeals,
    premiumRemaining: 0,
    selectedMealsPerDay,
    selectedGrams: 1200,
    deliveryMode: "delivery",
    deliveryWindow: "08:00 - 10:00",
    deliveryAddress: null,
    addonSubscriptions: [],
    premiumBalance: [],
    genericPremiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
    canceledAt,
    saveCallCount: 0,
    async save() {
      this.saveCallCount += 1;
      return this;
    },
    toObject() {
      return {
        _id: this._id,
        userId: this.userId,
        planId: this.planId,
        status: this.status,
        startDate: this.startDate,
        endDate: this.endDate,
        validityEndDate: this.validityEndDate,
        totalMeals: this.totalMeals,
        remainingMeals: this.remainingMeals,
        premiumRemaining: this.premiumRemaining,
        selectedMealsPerDay: this.selectedMealsPerDay,
        selectedGrams: this.selectedGrams,
        deliveryMode: this.deliveryMode,
        deliveryWindow: this.deliveryWindow,
        deliveryAddress: this.deliveryAddress,
        addonSubscriptions: this.addonSubscriptions,
        premiumBalance: this.premiumBalance,
        genericPremiumBalance: this.genericPremiumBalance,
        addonBalance: this.addonBalance,
        premiumSelections: this.premiumSelections,
        addonSelections: this.addonSelections,
        canceledAt: this.canceledAt,
      };
    },
  };
  return doc;
}

function stubSerializerCatalogLookups() {
  const originalPlanFind = Plan.find;
  const originalPremiumMealFind = PremiumMeal.find;
  const originalAddonFind = Addon.find;

  Plan.find = () => createQueryStub([]);
  PremiumMeal.find = () => createQueryStub([]);
  Addon.find = () => createQueryStub([]);

  return () => {
    Plan.find = originalPlanFind;
    PremiumMeal.find = originalPremiumMealFind;
    Addon.find = originalAddonFind;
  };
}

test("admin cancel characterization preserves current behavior", async (t) => {
  await t.test("active subscription cancel cleans future open/frozen days and preserves committed credits", async (t) => {
    const originalStartSession = mongoose.startSession;
    const originalSubFindById = Subscription.findById;
    const originalDayCountDocuments = SubscriptionDay.countDocuments;
    const originalDayDeleteMany = SubscriptionDay.deleteMany;
    const originalUserFindById = User.findById;
    const originalActivityLogCreate = ActivityLog.create;
    const restoreCatalogStubs = stubSerializerCatalogLookups();

    t.after(() => {
      mongoose.startSession = originalStartSession;
      Subscription.findById = originalSubFindById;
      SubscriptionDay.countDocuments = originalDayCountDocuments;
      SubscriptionDay.deleteMany = originalDayDeleteMany;
      User.findById = originalUserFindById;
      ActivityLog.create = originalActivityLogCreate;
      restoreCatalogStubs();
    });

    const today = dateUtils.getTodayKSADate();
    const userId = objectId();
    const subscription = createSubscriptionDoc({
      userId,
      status: "active",
      remainingMeals: 12,
      selectedMealsPerDay: 2,
    });
    const user = { _id: userId, name: "Client User", phone: "+966500000000", email: "client@example.com" };

    let capturedCountQuery = null;
    let capturedDeleteQuery = null;
    let capturedLogPayload = null;

    mongoose.startSession = async () => createSessionStub();
    Subscription.findById = () => createQueryStub(() => subscription, { leanResult: () => subscription.toObject() });
    SubscriptionDay.countDocuments = (query) => {
      capturedCountQuery = query;
      return createQueryStub(2);
    };
    SubscriptionDay.deleteMany = (query) => {
      capturedDeleteQuery = query;
      return createQueryStub({ deletedCount: 4 });
    };
    User.findById = () => createQueryStub(user, { leanResult: user });
    ActivityLog.create = async (payload) => {
      capturedLogPayload = payload;
      return payload;
    };

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      dashboardUserId: objectId(),
      dashboardUserRole: "admin",
    });

    await adminController.cancelSubscriptionAdmin(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.data.status, "canceled");
    assert.equal(subscription.status, "canceled");
    assert.equal(subscription.remainingMeals, 4);
    assert.ok(subscription.canceledAt instanceof Date);
    assert.equal(subscription.saveCallCount, 1);
    assert.deepEqual(capturedCountQuery, {
      subscriptionId: subscription._id,
      status: { $in: ["locked", "in_preparation", "out_for_delivery", "ready_for_pickup"] },
      creditsDeducted: { $ne: true },
    });
    assert.deepEqual(capturedDeleteQuery, {
      subscriptionId: subscription._id,
      date: { $gte: today },
      status: { $in: ["open", "frozen"] },
    });
    assert.equal(capturedLogPayload.action, "subscription_canceled_by_admin");
    assert.equal(capturedLogPayload.meta.removedFutureDays, 4);
    assert.equal(capturedLogPayload.meta.preservedCredits, 4);
    assert.equal(capturedLogPayload.meta.previousStatus, "active");
  });

  await t.test("pending_payment subscription cancel zeros remaining meals without deleting future days", async (t) => {
    const originalStartSession = mongoose.startSession;
    const originalSubFindById = Subscription.findById;
    const originalDayCountDocuments = SubscriptionDay.countDocuments;
    const originalDayDeleteMany = SubscriptionDay.deleteMany;
    const originalUserFindById = User.findById;
    const originalActivityLogCreate = ActivityLog.create;
    const restoreCatalogStubs = stubSerializerCatalogLookups();

    t.after(() => {
      mongoose.startSession = originalStartSession;
      Subscription.findById = originalSubFindById;
      SubscriptionDay.countDocuments = originalDayCountDocuments;
      SubscriptionDay.deleteMany = originalDayDeleteMany;
      User.findById = originalUserFindById;
      ActivityLog.create = originalActivityLogCreate;
      restoreCatalogStubs();
    });

    const userId = objectId();
    const subscription = createSubscriptionDoc({
      userId,
      status: "pending_payment",
      remainingMeals: 7,
      selectedMealsPerDay: 2,
    });
    const user = { _id: userId, name: "Pending User", phone: "+966511111111", email: "pending@example.com" };

    let deleteCalled = false;
    let countCalled = false;
    let capturedLogPayload = null;

    mongoose.startSession = async () => createSessionStub();
    Subscription.findById = () => createQueryStub(() => subscription, { leanResult: () => subscription.toObject() });
    SubscriptionDay.countDocuments = () => {
      countCalled = true;
      return createQueryStub(0);
    };
    SubscriptionDay.deleteMany = () => {
      deleteCalled = true;
      return createQueryStub({ deletedCount: 0 });
    };
    User.findById = () => createQueryStub(user, { leanResult: user });
    ActivityLog.create = async (payload) => {
      capturedLogPayload = payload;
      return payload;
    };

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      dashboardUserId: objectId(),
      dashboardUserRole: "admin",
    });

    await adminController.cancelSubscriptionAdmin(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.status, "canceled");
    assert.equal(subscription.remainingMeals, 0);
    assert.equal(subscription.saveCallCount, 1);
    assert.equal(countCalled, false);
    assert.equal(deleteCalled, false);
    assert.equal(capturedLogPayload.meta.removedFutureDays, 0);
    assert.equal(capturedLogPayload.meta.preservedCredits, 0);
    assert.equal(capturedLogPayload.meta.previousStatus, "pending_payment");
  });

  await t.test("already canceled subscription returns idempotent success", async (t) => {
    const originalStartSession = mongoose.startSession;
    const originalSubFindById = Subscription.findById;
    const originalUserFindById = User.findById;
    const originalActivityLogCreate = ActivityLog.create;
    const restoreCatalogStubs = stubSerializerCatalogLookups();

    t.after(() => {
      mongoose.startSession = originalStartSession;
      Subscription.findById = originalSubFindById;
      User.findById = originalUserFindById;
      ActivityLog.create = originalActivityLogCreate;
      restoreCatalogStubs();
    });

    const userId = objectId();
    const canceledAt = new Date("2026-04-05T10:30:00.000Z");
    const subscription = createSubscriptionDoc({
      userId,
      status: "canceled",
      remainingMeals: 3,
      canceledAt,
    });
    const user = { _id: userId, name: "Canceled User", phone: "+966522222222", email: "canceled@example.com" };

    let logCalled = false;

    mongoose.startSession = async () => createSessionStub();
    Subscription.findById = () => createQueryStub(() => subscription, { leanResult: () => subscription.toObject() });
    User.findById = () => createQueryStub(user, { leanResult: user });
    ActivityLog.create = async () => {
      logCalled = true;
      return {};
    };

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      dashboardUserId: objectId(),
      dashboardUserRole: "admin",
    });

    await adminController.cancelSubscriptionAdmin(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.idempotent, true);
    assert.equal(res.payload.data.status, "canceled");
    assert.equal(subscription.saveCallCount, 0);
    assert.equal(logCalled, false);
  });

  await t.test("expired subscription returns INVALID_TRANSITION", async (t) => {
    const originalStartSession = mongoose.startSession;
    const originalSubFindById = Subscription.findById;

    t.after(() => {
      mongoose.startSession = originalStartSession;
      Subscription.findById = originalSubFindById;
    });

    const subscription = createSubscriptionDoc({
      status: "expired",
      remainingMeals: 2,
    });

    mongoose.startSession = async () => createSessionStub();
    Subscription.findById = () => createQueryStub(subscription);

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      dashboardUserId: objectId(),
      dashboardUserRole: "admin",
    });

    await adminController.cancelSubscriptionAdmin(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error.code, "INVALID_TRANSITION");
    assert.equal(subscription.saveCallCount, 0);
  });
});

test("cancelSubscriptionDomain enforces client ownership and invalid transitions", async (t) => {
  await t.test("client actor gets forbidden for another user's subscription", async (t) => {
    const subscription = createSubscriptionDoc({
      userId: objectId(),
      status: "active",
    });

    const result = await cancelSubscriptionDomain({
      subscriptionId: String(subscription._id),
      actor: { kind: "client", userId: String(objectId()) },
      runtime: {
        startSession: async () => createSessionStub(),
        findSubscriptionById: async () => subscription,
      },
    });

    assert.deepEqual(result, { outcome: "forbidden" });
    assert.equal(subscription.saveCallCount, 0);
  });

  await t.test("expired subscription returns invalid_transition without mutation", async (t) => {
    const subscription = createSubscriptionDoc({
      status: "expired",
      remainingMeals: 8,
    });

    const result = await cancelSubscriptionDomain({
      subscriptionId: String(subscription._id),
      actor: { kind: "admin", dashboardUserId: String(objectId()), dashboardUserRole: "admin" },
      runtime: {
        startSession: async () => createSessionStub(),
        findSubscriptionById: async () => subscription,
      },
    });

    assert.deepEqual(result, {
      outcome: "invalid_transition",
      currentStatus: "expired",
    });
    assert.equal(subscription.saveCallCount, 0);
    assert.equal(subscription.status, "expired");
  });
});

test("app cancel controller maps shared domain outcomes to client-facing responses", async (t) => {
  await t.test("cancelSubscription returns idempotent 200 with serialized payload when already canceled", async (t) => {
    const subscription = createSubscriptionDoc({
      status: "canceled",
      canceledAt: new Date("2026-04-05T10:30:00.000Z"),
    });

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      userId: subscription.userId,
    });

    await subscriptionController.cancelSubscription(req, res, {
      cancelSubscriptionDomain: async () => ({
        outcome: "already_canceled",
        subscriptionId: String(subscription._id),
        mutation: {
          canceledAt: subscription.canceledAt.toISOString(),
        },
      }),
      findSubscriptionById: () => createQueryStub(subscription.toObject()),
      serializeSubscriptionForClient: async (doc) => ({
        id: String(doc._id),
        status: doc.status,
        canceledAt: doc.canceledAt,
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.idempotent, true);
    assert.equal(res.payload.data.status, "canceled");
  });

  await t.test("cancelSubscription returns 403 when shared domain service returns forbidden", async (t) => {
    const { req, res } = createReqRes({
      params: { id: String(objectId()) },
      userId: objectId(),
    });

    await subscriptionController.cancelSubscription(req, res, {
      cancelSubscriptionDomain: async () => ({ outcome: "forbidden" }),
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error.code, "FORBIDDEN");
  });

  await t.test("cancelSubscription returns 409 for invalid transitions", async (t) => {
    const { req, res } = createReqRes({
      params: { id: String(objectId()) },
      userId: objectId(),
    });

    await subscriptionController.cancelSubscription(req, res, {
      cancelSubscriptionDomain: async () => ({
        outcome: "invalid_transition",
        currentStatus: "expired",
      }),
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.error.code, "INVALID_TRANSITION");
  });
});
