const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const { processDailyCutoff } = require("../src/services/automationService");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Addon = require("../src/models/Addon");
const Setting = require("../src/models/Setting");
const Meal = require("../src/models/Meal");
const ActivityLog = require("../src/models/ActivityLog");
const User = require("../src/models/User");
const NotificationLog = require("../src/models/NotificationLog");
const { getTomorrowKSADate, toKSADateString } = require("../src/utils/date");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, body = {}, userId = objectId() } = {}) {
  const req = {
    params,
    body,
    userId,
    headers: {},
    get() {
      return undefined;
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

function createQueryStub(result) {
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
    lean() {
      return Promise.resolve(result);
    },
    select() {
      return query;
    },
    limit() {
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

function createSessionStub() {
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
    inTransaction() {
      return true;
    },
  };
}

function getFutureDate(daysAhead = 2) {
  const base = new Date(`${getTomorrowKSADate()}T00:00:00+03:00`);
  base.setDate(base.getDate() + (daysAhead - 1));
  return toKSADateString(base);
}

function buildActiveSubscriptionWindow() {
  const tomorrow = new Date(`${getTomorrowKSADate()}T00:00:00+03:00`);
  const startDate = new Date(tomorrow);
  startDate.setDate(startDate.getDate() - 31);
  const endDate = new Date(tomorrow);
  endDate.setDate(endDate.getDate() + 29);
  return { startDate, endDate, validityEndDate: endDate };
}

function createCanonicalSubscription(userId = objectId(), overrides = {}) {
  const { startDate, endDate, validityEndDate } = buildActiveSubscriptionWindow();
  return {
    _id: objectId(),
    userId,
    status: "active",
    startDate,
    endDate,
    validityEndDate,
    selectedMealsPerDay: 3,
    premiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
    addonSubscriptions: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
    ...overrides,
  };
}

function createLegacySubscription(userId = objectId(), overrides = {}) {
  return createCanonicalSubscription(userId, {
    contractVersion: undefined,
    contractMode: undefined,
    contractSnapshot: undefined,
    ...overrides,
  });
}

test("updateDaySelection replaces one-time add-on planning state and recomputes pending fields for canonical subscriptions", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  const originalLogCreate = ActivityLog.create;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
    ActivityLog.create = originalLogCreate;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const addonOneId = objectId();
  const addonTwoId = objectId();
  const targetDate = getFutureDate(2);
  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [],
    premiumSelections: [],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Old", category: "old" }],
    oneTimeAddonPendingCount: 9,
    oneTimeAddonPaymentStatus: "paid",
    addonsOneTime: [],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };

  SubscriptionDay.findOne = () => createQueryStub(dayDoc);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(dayDoc, update);
    return dayDoc;
  };
  Addon.find = () => createQueryStub([
    { _id: addonOneId, isActive: true, type: "one_time", category: "starter", name: { ar: "شوربة", en: "Soup" } },
    { _id: addonTwoId, isActive: true, type: "one_time", category: "dessert", name: { ar: "تحلية", en: "Dessert" } },
  ]);
  Setting.findOne = () => createQueryStub({ value: 20 });
  ActivityLog.create = async () => ({});

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: {
      selections: [objectId(), objectId(), objectId()],
      premiumSelections: [],
      oneTimeAddonSelections: [addonOneId, addonTwoId],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(dayDoc.oneTimeAddonSelections.length, 2);
  assert.equal(dayDoc.oneTimeAddonSelections[0].category, "starter");
  assert.equal(dayDoc.oneTimeAddonSelections[1].category, "dessert");
  assert.equal(dayDoc.oneTimeAddonPendingCount, 2);
  assert.equal(dayDoc.oneTimeAddonPaymentStatus, "pending");
  assert.equal(res.payload.data.oneTimeAddonSelections.length, 2);
});

test("updateDaySelection clears one-time add-on pending state when the final requested state is empty", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  const originalLogCreate = ActivityLog.create;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
    ActivityLog.create = originalLogCreate;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const targetDate = getFutureDate(2);
  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [],
    premiumSelections: [],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    addonsOneTime: [],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };

  SubscriptionDay.findOne = () => createQueryStub(dayDoc);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(dayDoc, update);
    return dayDoc;
  };
  Addon.find = () => createQueryStub([]);
  Setting.findOne = () => createQueryStub({ value: 20 });
  ActivityLog.create = async () => ({});

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: {
      selections: [objectId(), objectId(), objectId()],
      premiumSelections: [],
      oneTimeAddonSelections: [],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(dayDoc.oneTimeAddonSelections, []);
  assert.equal(dayDoc.oneTimeAddonPendingCount, 0);
  assert.equal(dayDoc.oneTimeAddonPaymentStatus, undefined);
});

test("updateDaySelection keeps legacy subscriptions unchanged even if oneTimeAddonSelections are provided", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalAddonFind = Addon.find;
  const originalSettingFindOne = Setting.findOne;
  const originalLogCreate = ActivityLog.create;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Addon.find = originalAddonFind;
    Setting.findOne = originalSettingFindOne;
    ActivityLog.create = originalLogCreate;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscription = createLegacySubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const targetDate = getFutureDate(2);
  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [],
    premiumSelections: [],
    addonsOneTime: [],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };

  SubscriptionDay.findOne = () => createQueryStub(dayDoc);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(dayDoc, update);
    return dayDoc;
  };
  Addon.find = () => createQueryStub([]);
  Setting.findOne = () => createQueryStub({ value: 20 });
  ActivityLog.create = async () => ({});

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: {
      selections: [objectId()],
      premiumSelections: [],
      oneTimeAddonSelections: [objectId()],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(dayDoc, "oneTimeAddonSelections"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(res.payload.data, "oneTimeAddonSelections"), false);
});

test("confirmDayPlanning validates meal count before premium overage and one-time add-ons", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();
  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub({
    _id: objectId(),
    subscriptionId: subscription._id,
    date: getFutureDate(2),
    status: "open",
    selections: [objectId()],
    premiumSelections: [],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    async save() { return this; },
    toObject() { return { ...this }; },
  });
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: getFutureDate(2) },
    userId,
  });

  await controller.confirmDayPlanning(req, res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.code, "PLANNING_INCOMPLETE");
});

test("confirmDayPlanning validates premium overage before one-time add-ons", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  const originalGenericFlag = process.env.PHASE2_GENERIC_PREMIUM_WALLET;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  process.env.PHASE2_GENERIC_PREMIUM_WALLET = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
    process.env.PHASE2_GENERIC_PREMIUM_WALLET = originalGenericFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();
  const userId = objectId();
  const subscription = createCanonicalSubscription(userId, {
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [],
    premiumRemaining: 0,
  });
  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub({
    _id: objectId(),
    subscriptionId: subscription._id,
    date: getFutureDate(2),
    status: "open",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    async save() { return this; },
    toObject() { return { ...this }; },
  });
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: getFutureDate(2) },
    userId,
  });

  await controller.confirmDayPlanning(req, res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.code, "PREMIUM_OVERAGE_PAYMENT_REQUIRED");
});

test("confirmDayPlanning blocks unpaid one-time add-ons after meal count and premium overage checks pass", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();
  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub({
    _id: objectId(),
    subscriptionId: subscription._id,
    date: getFutureDate(2),
    status: "open",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    async save() { return this; },
    toObject() { return { ...this }; },
  });
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: getFutureDate(2) },
    userId,
  });

  await controller.confirmDayPlanning(req, res);

  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.code, "ONE_TIME_ADDON_PAYMENT_REQUIRED");
});

test("automation fallback clears unpaid one-time add-ons while fulfillment snapshots stay stable", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalSubFindById = Subscription.findById;
  const originalSubUpdateOne = Subscription.updateOne;
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Subscription.findById = originalSubFindById;
    Subscription.updateOne = originalSubUpdateOne;
  });

  ActivityLog.create = async () => ({});
  NotificationLog.create = async () => ({});
  User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });

  const canonicalDay = {
    _id: objectId(),
    date: "2026-03-18",
    status: "open",
    selections: [],
    premiumSelections: [],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    addonsOneTime: [],
    customSalads: [],
    customMeals: [],
    subscriptionId: createCanonicalSubscription(),
    async save() {
      return this;
    },
  };

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([canonicalDay]);
    },
  });
  Meal.find = () => createQueryStub([]);

  await assert.rejects(
    () => processDailyCutoff(),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );

  assert.equal(canonicalDay.status, "open");
  assert.equal(canonicalDay.lockedSnapshot, undefined);
  assert.equal(canonicalDay.oneTimeAddonSelections.length, 1);
  assert.equal(canonicalDay.oneTimeAddonPendingCount, 1);
  assert.equal(canonicalDay.oneTimeAddonPaymentStatus, "pending");

  const fulfillmentDay = {
    _id: objectId(),
    subscriptionId: objectId(),
    status: "out_for_delivery",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    oneTimeAddonSelections: [{ addonId: objectId(), name: "Soup", category: "starter" }],
    oneTimeAddonPendingCount: 1,
    oneTimeAddonPaymentStatus: "pending",
    addonsOneTime: [],
    date: "2026-03-20",
    creditsDeducted: false,
  };
  let capturedUpdate = null;
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(fulfillmentDay);
    },
  });
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    capturedUpdate = update;
    return {
      ...fulfillmentDay,
      fulfilledSnapshot: update.$set.fulfilledSnapshot,
    };
  };
  Subscription.findById = () => createQueryStub(createCanonicalSubscription(objectId(), { _id: fulfillmentDay.subscriptionId }));
  Subscription.updateOne = async () => ({ modifiedCount: 1 });

  const result = await fulfillSubscriptionDay({
    subscriptionId: fulfillmentDay.subscriptionId,
    date: fulfillmentDay.date,
    session: {},
  });

  assert.equal(result.ok, true);
  assert.equal(capturedUpdate.$set.fulfilledSnapshot.oneTimeAddonSelections.length, 1);
  assert.equal(capturedUpdate.$set.fulfilledSnapshot.oneTimeAddonPendingCount, 1);
  assert.equal(capturedUpdate.$set.fulfilledSnapshot.oneTimeAddonPaymentStatus, "pending");
});

test("legacy lock and fulfillment snapshots remain unchanged when no one-time add-on planning state exists", async (t) => {
  const originalPlanningFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalPlanningFlag;
  });

  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalSubFindById = Subscription.findById;
  const originalSubUpdateOne = Subscription.updateOne;
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Subscription.findById = originalSubFindById;
    Subscription.updateOne = originalSubUpdateOne;
  });

  ActivityLog.create = async () => ({});
  NotificationLog.create = async () => ({});
  User.findById = () => createQueryStub({ _id: objectId(), fcmTokens: [] });

  const legacyDay = {
    _id: objectId(),
    date: "2026-03-18",
    status: "open",
    selections: [],
    premiumSelections: [],
    addonsOneTime: [],
    customSalads: [],
    customMeals: [],
    subscriptionId: createLegacySubscription(),
    async save() {
      return this;
    },
  };

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([legacyDay]);
    },
  });
  Meal.find = () => createQueryStub([
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
  ]);

  await processDailyCutoff();

  assert.ok(legacyDay.lockedSnapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyDay.lockedSnapshot, "oneTimeAddonSelections"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyDay.lockedSnapshot, "oneTimeAddonPendingCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyDay.lockedSnapshot, "oneTimeAddonPaymentStatus"), false);

  const fulfillmentDay = {
    _id: objectId(),
    subscriptionId: objectId(),
    status: "out_for_delivery",
    selections: [objectId(), objectId()],
    premiumSelections: [],
    addonsOneTime: [],
    date: "2026-03-20",
    creditsDeducted: false,
  };
  let capturedUpdate = null;
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(fulfillmentDay);
    },
  });
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    capturedUpdate = update;
    return {
      ...fulfillmentDay,
      fulfilledSnapshot: update.$set.fulfilledSnapshot,
    };
  };
  Subscription.findById = () => createQueryStub(createLegacySubscription(objectId(), { _id: fulfillmentDay.subscriptionId }));
  Subscription.updateOne = async () => ({ modifiedCount: 1 });

  const result = await fulfillSubscriptionDay({
    subscriptionId: fulfillmentDay.subscriptionId,
    date: fulfillmentDay.date,
    session: {},
  });

  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedUpdate.$set.fulfilledSnapshot, "oneTimeAddonSelections"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedUpdate.$set.fulfilledSnapshot, "oneTimeAddonPendingCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedUpdate.$set.fulfilledSnapshot, "oneTimeAddonPaymentStatus"), false);
});
