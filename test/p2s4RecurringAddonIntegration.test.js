const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const { processDailyCutoff } = require("../src/services/automationService");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const { getTomorrowKSADate, toKSADateString } = require("../src/utils/date");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Setting = require("../src/models/Setting");
const Meal = require("../src/models/Meal");
const ActivityLog = require("../src/models/ActivityLog");
const User = require("../src/models/User");
const NotificationLog = require("../src/models/NotificationLog");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createQueryStub(result) {
  return {
    populate() {
      return this;
    },
    select() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
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

function addKsaDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00+03:00`);
  date.setDate(date.getDate() + days);
  return toKSADateString(date);
}

function getFutureDate(daysAhead = 2) {
  return addKsaDays(getTomorrowKSADate(), daysAhead - 1);
}

function toKsaDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+03:00`);
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

function createRecurringEntitlement(overrides = {}) {
  return {
    addonId: objectId(),
    name: "Soup",
    price: 3,
    type: "subscription",
    category: "starter",
    entitlementMode: "daily_recurring",
    maxPerDay: 1,
    ...overrides,
  };
}

function createCanonicalSubscription(userId = objectId(), overrides = {}) {
  const baseStartDate = addKsaDays(getTomorrowKSADate(), -14);
  const baseEndDate = addKsaDays(getTomorrowKSADate(), 30);
  return {
    _id: objectId(),
    userId,
    status: "active",
    startDate: toKsaDate(baseStartDate),
    endDate: toKsaDate(baseEndDate),
    validityEndDate: toKsaDate(baseEndDate),
    selectedMealsPerDay: 3,
    premiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
    addonSubscriptions: [createRecurringEntitlement()],
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

test("updateDaySelection projects recurring add-ons from subscription entitlements and ignores day-level input", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);
  const dayDate = getFutureDate(2);

  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: dayDate,
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

  SubscriptionDay.findOne = () => createQueryStub(null);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    dayDoc.selections = update.selections || [];
    dayDoc.premiumSelections = update.premiumSelections || [];
    return dayDoc;
  };
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: dayDoc.date },
    body: {
      selections: [objectId()],
      premiumSelections: [],
      recurringAddons: [{ addonId: objectId(), name: "Injected" }],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(dayDoc.recurringAddons.length, 1);
  assert.equal(dayDoc.recurringAddons[0].name, "Soup");
  assert.equal(res.payload.data.recurringAddons.length, 1);
  assert.equal(res.payload.data.recurringAddons[0].category, "starter");
  assert.equal(res.payload.data.recurringAddons[0].name, "Soup");
});

test("getSubscriptionDay keeps legacy subscriptions unchanged without recurring add-on projection", async (t) => {
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  t.after(() => {
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
  });

  const userId = objectId();
  const subscription = createLegacySubscription(userId);
  const dayDate = getFutureDate(2);
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: dayDate,
    status: "open",
    selections: [],
    premiumSelections: [],
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub(day);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: day.date },
    userId,
  });

  await controller.getSubscriptionDay(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Object.prototype.hasOwnProperty.call(res.payload.data, "recurringAddons"), false);
});

test("getSubscriptionDay prefers locked recurring add-on snapshot over recomputing from changed subscription state", async (t) => {
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  t.after(() => {
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
  });

  const userId = objectId();
  const subscription = createCanonicalSubscription(userId, {
    addonSubscriptions: [createRecurringEntitlement({ name: "Dessert", category: "dessert" })],
  });
  const dayDate = getFutureDate(2);
  const day = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: dayDate,
    status: "locked",
    selections: [],
    premiumSelections: [],
    lockedSnapshot: {
      recurringAddons: [
        {
          addonId: objectId(),
          name: "Soup",
          category: "starter",
          entitlementMode: "daily_recurring",
          maxPerDay: 1,
        },
      ],
    },
  };

  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub(day);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: day.date },
    userId,
  });

  await controller.getSubscriptionDay(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.recurringAddons.length, 1);
  assert.equal(res.payload.data.recurringAddons[0].name, "Soup");
  assert.equal(res.payload.data.recurringAddons[0].category, "starter");
});

test("automation lock snapshots include recurring add-ons only for canonical subscriptions", async (t) => {
  const originalDayFind = SubscriptionDay.find;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  const originalUserFindById = User.findById;
  const originalNotificationLogCreate = NotificationLog.create;
  t.after(() => {
    SubscriptionDay.find = originalDayFind;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
    User.findById = originalUserFindById;
    NotificationLog.create = originalNotificationLogCreate;
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
    addonsOneTime: [],
    customSalads: [],
    customMeals: [],
    subscriptionId: createCanonicalSubscription(),
    async save() {
      return this;
    },
  };
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
      return Promise.resolve([canonicalDay, legacyDay]);
    },
  });
  Meal.find = () => createQueryStub([
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
  ]);

  await processDailyCutoff();

  assert.ok(canonicalDay.lockedSnapshot);
  assert.equal(canonicalDay.lockedSnapshot.recurringAddons.length, 1);
  assert.equal(canonicalDay.lockedSnapshot.recurringAddons[0].category, "starter");
  assert.ok(legacyDay.lockedSnapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyDay.lockedSnapshot, "recurringAddons"), false);
});

test("fulfilled snapshots include recurring add-ons only for canonical subscriptions", async (t) => {
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
  const originalSubFindById = Subscription.findById;
  const originalSubUpdateOne = Subscription.updateOne;
  t.after(() => {
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.findOneAndUpdate = originalDayFindOneAndUpdate;
    Subscription.findById = originalSubFindById;
    Subscription.updateOne = originalSubUpdateOne;
  });

  const canonicalDay = {
    _id: objectId(),
    subscriptionId: objectId(),
    status: "out_for_delivery",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    addonsOneTime: [],
    date: "2026-03-20",
    creditsDeducted: false,
  };
  let canonicalUpdate = null;
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(canonicalDay);
    },
  });
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    canonicalUpdate = update;
    return { ...canonicalDay, fulfilledSnapshot: update.$set.fulfilledSnapshot };
  };
  Subscription.findById = () => createQueryStub(createCanonicalSubscription(objectId(), { _id: canonicalDay.subscriptionId }));
  Subscription.updateOne = async () => ({ modifiedCount: 1 });

  const canonicalResult = await fulfillSubscriptionDay({
    subscriptionId: canonicalDay.subscriptionId,
    date: canonicalDay.date,
    session: {},
  });

  assert.equal(canonicalResult.ok, true);
  assert.equal(canonicalUpdate.$set.fulfilledSnapshot.recurringAddons.length, 1);

  const legacyDay = {
    _id: objectId(),
    subscriptionId: objectId(),
    status: "out_for_delivery",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    addonsOneTime: [],
    date: "2026-03-20",
    creditsDeducted: false,
  };
  let legacyUpdate = null;
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(legacyDay);
    },
  });
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    legacyUpdate = update;
    return { ...legacyDay, fulfilledSnapshot: update.$set.fulfilledSnapshot };
  };
  Subscription.findById = () => createQueryStub(createLegacySubscription(objectId(), { _id: legacyDay.subscriptionId }));
  Subscription.updateOne = async () => ({ modifiedCount: 1 });

  const legacyResult = await fulfillSubscriptionDay({
    subscriptionId: legacyDay.subscriptionId,
    date: legacyDay.date,
    session: {},
  });

  assert.equal(legacyResult.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyUpdate.$set.fulfilledSnapshot, "recurringAddons"), false);
});
