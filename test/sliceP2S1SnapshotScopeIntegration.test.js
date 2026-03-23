const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const kitchenController = require("../src/controllers/kitchenController");
const { processDailyCutoff } = require("../src/services/automationService");
const { fulfillSubscriptionDay } = require("../src/services/fulfillmentService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Meal = require("../src/models/Meal");
const ActivityLog = require("../src/models/ActivityLog");
const User = require("../src/models/User");
const NotificationLog = require("../src/models/NotificationLog");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, body = {}, userId = objectId(), userRole = "kitchen" } = {}) {
  const req = { params, body, userId, userRole };
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

function createCanonicalSubscription(overrides = {}) {
  return {
    _id: objectId(),
    userId: objectId(),
    status: "active",
    selectedMealsPerDay: 3,
    planId: { daysCount: 5, freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 } },
    premiumBalance: [],
    addonBalance: [],
    premiumSelections: [],
    addonSelections: [],
    addonSubscriptions: [],
    deliveryAddress: { city: "Riyadh" },
    deliveryWindow: "8 AM - 11 AM",
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
    ...overrides,
  };
}

function createLegacySubscription(overrides = {}) {
  return createCanonicalSubscription({
    contractVersion: undefined,
    contractMode: undefined,
    contractSnapshot: undefined,
    ...overrides,
  });
}

test("kitchen assignMeals keeps canonical planning synchronized for canonical subscriptions", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

  const originalStartSession = mongoose.startSession;
  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalDayCreate = SubscriptionDay.create;
  const originalMealFind = Meal.find;
  const originalLogCreate = ActivityLog.create;
  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    SubscriptionDay.create = originalDayCreate;
    Meal.find = originalMealFind;
    ActivityLog.create = originalLogCreate;
  });

  mongoose.startSession = async () => createSessionStub();
  ActivityLog.create = async () => ({});

  const subscription = createCanonicalSubscription();
  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionDay.findOne = () => createQueryStub(null);

  let createdDay = null;
  SubscriptionDay.create = async (payload) => {
    createdDay = {
      ...payload[0],
      addonsOneTime: [],
      async save() {
        return this;
      },
    };
    return [createdDay];
  };
  Meal.find = () => ({
    select() {
      return this;
    },
    session() {
      return this;
    },
    lean() {
      return Promise.resolve([
        { _id: objectId(), type: "regular" },
        { _id: objectId(), type: "regular" },
      ]);
    },
  });

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: "2026-03-20" },
    body: { selections: [objectId(), objectId()], premiumSelections: [] },
  });

  await kitchenController.assignMeals(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(createdDay);
  assert.equal(createdDay.planningVersion, "subscription_day_planning.v1");
  assert.equal(createdDay.planningState, "draft");
  assert.equal(createdDay.baseMealSlots.length, 2);
  assert.equal(createdDay.planningMeta.selectedBaseMealCount, 2);
  assert.equal(createdDay.planningMeta.requiredMealCount, 3);
});

test("automation lock snapshot includes planning only for canonical subscriptions when the flag is enabled", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  assert.ok(canonicalDay.lockedSnapshot.planning);
  assert.equal(canonicalDay.lockedSnapshot.planning.version, "subscription_day_planning.v1");
  assert.ok(legacyDay.lockedSnapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(legacyDay.lockedSnapshot, "planning"), false);
});

test("automation lock snapshot keeps legacy behavior unchanged when the flag is off", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  delete process.env.PHASE2_CANONICAL_DAY_PLANNING;
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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

  SubscriptionDay.find = () => ({
    populate() {
      return Promise.resolve([canonicalDay]);
    },
  });
  Meal.find = () => createQueryStub([
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
    { _id: objectId(), type: "regular" },
  ]);

  await processDailyCutoff();

  assert.ok(canonicalDay.lockedSnapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(canonicalDay.lockedSnapshot, "planning"), false);
});

test("fulfilled snapshots include planning only for canonical subscriptions when the flag is enabled", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  let dayFindCount = 0;
  SubscriptionDay.findOne = () => ({
    session() {
      dayFindCount += 1;
      return Promise.resolve(canonicalDay);
    },
  });
  let capturedUpdate = null;
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    capturedUpdate = update;
    return {
      ...canonicalDay,
      fulfilledSnapshot: update.$set.fulfilledSnapshot,
    };
  };
  Subscription.findById = () => createQueryStub(createCanonicalSubscription({ _id: canonicalDay.subscriptionId }));
  Subscription.updateOne = async () => ({ modifiedCount: 1 });

  const result = await fulfillSubscriptionDay({
    subscriptionId: canonicalDay.subscriptionId,
    date: canonicalDay.date,
    session: {},
  });

  assert.equal(dayFindCount >= 1, true);
  assert.equal(result.ok, true);
  assert.ok(capturedUpdate.$set.fulfilledSnapshot.planning);
  assert.equal(capturedUpdate.$set.fulfilledSnapshot.planning.version, "subscription_day_planning.v1");
});

test("fulfilled snapshots keep legacy behavior unchanged when the flag is off", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  delete process.env.PHASE2_CANONICAL_DAY_PLANNING;
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  SubscriptionDay.findOne = () => ({
    session() {
      return Promise.resolve(legacyDay);
    },
  });
  let capturedUpdate = null;
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    capturedUpdate = update;
    return {
      ...legacyDay,
      fulfilledSnapshot: update.$set.fulfilledSnapshot,
    };
  };
  Subscription.findById = () => createQueryStub(createLegacySubscription({ _id: legacyDay.subscriptionId }));
  Subscription.updateOne = async () => ({ modifiedCount: 1 });

  const result = await fulfillSubscriptionDay({
    subscriptionId: legacyDay.subscriptionId,
    date: legacyDay.date,
    session: {},
  });

  assert.equal(result.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedUpdate.$set.fulfilledSnapshot, "planning"), false);
});
