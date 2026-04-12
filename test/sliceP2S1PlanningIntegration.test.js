const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Setting = require("../src/models/Setting");
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
  return {
    populate() {
      return Promise.resolve(result);
    },
    session() {
      return Promise.resolve(result);
    },
    sort() {
      return this;
    },
    lean() {
      return Promise.resolve(result);
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

function createSubscriptionDoc(userId, overrides = {}) {
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
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
    ...overrides,
  };
}

test("updateDaySelection stores canonical planning data for canonical subscriptions when the Phase 2 flag is enabled", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  const subscription = createSubscriptionDoc(userId);
  let subscriptionFindCount = 0;
  Subscription.findById = () => {
    subscriptionFindCount += 1;
    return createQueryStub(subscription);
  };

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

  SubscriptionDay.findOne = () => createQueryStub(null);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    dayDoc.selections = update.selections || [];
    dayDoc.premiumSelections = update.premiumSelections || [];
    return dayDoc;
  };
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: { selections: [objectId()], premiumSelections: [] },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(subscriptionFindCount >= 1, true);
  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.payload.data.selections), true);
  assert.equal(res.payload.data.selections.length, 1);
  assert.equal(res.payload.data.planning.version, "subscription_day_planning.v1");
  assert.equal(res.payload.data.planning.state, "draft");
  assert.equal(res.payload.data.planning.selectedTotalMealCount, 1);
  assert.equal(res.payload.data.planning.isExactCountSatisfied, false);
  assert.equal(res.payload.data.baseMealSlots.length, 1);
});

test("updateDaySelection accepts legacy meals payload as selections alias", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  const subscription = createSubscriptionDoc(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const targetDate = getFutureDate(3);
  const mealIdOne = objectId();
  const mealIdTwo = objectId();
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

  SubscriptionDay.findOne = () => createQueryStub(null);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    dayDoc.selections = update.selections || [];
    dayDoc.premiumSelections = update.premiumSelections || [];
    return dayDoc;
  };
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: { meals: [mealIdOne, mealIdTwo] },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.idempotent, undefined);
  assert.equal(res.payload.data.selections.length, 2);
  assert.deepEqual(
    res.payload.data.selections.map((value) => String(value)),
    [String(mealIdOne), String(mealIdTwo)]
  );
  assert.equal(res.payload.data.planning.selectedTotalMealCount, 2);
});

test("updateBulkDaySelections applies the same selections to multiple dates in request order", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  const subscription = createSubscriptionDoc(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const firstDate = getFutureDate(2);
  const secondDate = getFutureDate(3);
  const savedDates = [];
  const dayDocs = new Map();

  SubscriptionDay.findOne = ({ date }) => createQueryStub(dayDocs.get(String(date)) || null);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    const date = String(_query.date);
    const dayDoc = dayDocs.get(date) || {
      _id: objectId(),
      subscriptionId: subscription._id,
      date,
      status: "open",
      selections: [],
      premiumSelections: [],
      addonsOneTime: [],
      async save() {
        savedDates.push(this.date);
        return this;
      },
      toObject() {
        return { ...this };
      },
    };

    dayDoc.selections = update.selections || [];
    dayDoc.premiumSelections = update.premiumSelections || [];
    dayDocs.set(date, dayDoc);
    return dayDoc;
  };
  Setting.findOne = () => createQueryStub(null);

  const mealId = objectId();
  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    body: {
      dates: [firstDate, secondDate],
      selections: [mealId],
      premiumSelections: [],
      addonsOneTime: [],
    },
    userId,
  });

  await controller.updateBulkDaySelections(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(savedDates, [firstDate, secondDate]);
  assert.equal(res.payload.data.summary.totalDates, 2);
  assert.equal(res.payload.data.summary.updatedCount, 2);
  assert.equal(res.payload.data.summary.failedCount, 0);
  assert.equal(res.payload.data.results.length, 2);
  assert.equal(res.payload.data.results[0].date, firstDate);
  assert.equal(res.payload.data.results[1].date, secondDate);
  assert.equal(res.payload.data.results[0].data.planning.selectedTotalMealCount, 1);
  assert.equal(res.payload.data.results[1].data.planning.selectedTotalMealCount, 1);
});

test("updateBulkDaySelections accepts per-day selections in a single request", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

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
  const subscription = createSubscriptionDoc(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const firstDate = getFutureDate(2);
  const secondDate = getFutureDate(3);
  const dayDocs = new Map();

  SubscriptionDay.findOne = ({ date }) => createQueryStub(dayDocs.get(String(date)) || null);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    const date = String(_query.date);
    const dayDoc = dayDocs.get(date) || {
      _id: objectId(),
      subscriptionId: subscription._id,
      date,
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

    dayDoc.selections = update.selections || [];
    dayDoc.premiumSelections = update.premiumSelections || [];
    dayDocs.set(date, dayDoc);
    return dayDoc;
  };
  Setting.findOne = () => createQueryStub(null);

  const firstMeal = objectId();
  const secondMealOne = objectId();
  const secondMealTwo = objectId();
  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    body: {
      days: [
        {
          date: firstDate,
          selections: [firstMeal],
          premiumSelections: [],
          addonsOneTime: [],
        },
        {
          date: secondDate,
          selections: [secondMealOne, secondMealTwo],
          premiumSelections: [],
          addonsOneTime: [],
        },
      ],
    },
    userId,
  });

  await controller.updateBulkDaySelections(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.summary.totalDates, 2);
  assert.equal(res.payload.data.summary.updatedCount, 2);
  assert.equal(res.payload.data.results[0].date, firstDate);
  assert.equal(res.payload.data.results[1].date, secondDate);
  assert.deepEqual(
    res.payload.data.results[0].data.selections.map((value) => String(value)),
    [String(firstMeal)]
  );
  assert.deepEqual(
    res.payload.data.results[1].data.selections.map((value) => String(value)),
    [String(secondMealOne), String(secondMealTwo)]
  );
});

test("updateBulkDaySelections rejects duplicate dates", async () => {
  const { req, res } = createReqRes({
    params: { id: String(objectId()) },
    body: {
      dates: ["2026-04-15", "2026-04-15"],
      selections: [],
      premiumSelections: [],
    },
  });

  await controller.updateBulkDaySelections(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.error.code, "INVALID");
});

test("confirmDayPlanning confirms only exact-count canonical day plans", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
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
  const subscription = createSubscriptionDoc(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const targetDate = getFutureDate(2);
  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };
  SubscriptionDay.findOne = () => createQueryStub(dayDoc);
  Setting.findOne = () => createQueryStub(null);

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    userId,
  });

  await controller.confirmDayPlanning(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.planning.state, "confirmed");
  assert.equal(res.payload.data.planning.isExactCountSatisfied, true);
});

test("confirmDayPlanning rejects under-selected canonical days and getSubscriptionDay keeps planning additive", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  const originalStartSession = mongoose.startSession;
  const originalSettingFindOne = Setting.findOne;
  t.after(() => {
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
    mongoose.startSession = originalStartSession;
    Setting.findOne = originalSettingFindOne;
  });

  mongoose.startSession = async () => createSessionStub();

  const userId = objectId();
  const canonicalSubscription = createSubscriptionDoc(userId);
  const targetDate = getFutureDate(2);
  const incompleteDay = {
    _id: objectId(),
    subscriptionId: canonicalSubscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId()],
    premiumSelections: [],
    async save() {
      return this;
    },
    toObject() {
      return { ...this };
    },
  };

  let call = 0;
  Subscription.findById = () => {
    call += 1;
    return createQueryStub(canonicalSubscription);
  };
  SubscriptionDay.findOne = () => createQueryStub(incompleteDay);
  Setting.findOne = () => createQueryStub(null);

  const confirm = createReqRes({
    params: { id: String(canonicalSubscription._id), date: targetDate },
    userId,
  });
  await controller.confirmDayPlanning(confirm.req, confirm.res);
  assert.equal(confirm.res.statusCode, 422);
  assert.equal(confirm.res.payload.error.code, "PLANNING_INCOMPLETE");

  const detail = createReqRes({
    params: { id: String(canonicalSubscription._id), date: targetDate },
    userId,
  });
  await controller.getSubscriptionDay(detail.req, detail.res);
  assert.equal(detail.res.statusCode, 200);
  assert.equal(detail.res.payload.data.planning.version, "subscription_day_planning.v1");
  assert.equal(detail.res.payload.data.planning.state, "draft");
  assert.equal(detail.res.payload.data.planning.isExactCountSatisfied, false);
});

test("getSubscriptionDay keeps legacy subscriptions on legacy response shape during coexistence", async (t) => {
  const originalFlag = process.env.PHASE2_CANONICAL_DAY_PLANNING;
  process.env.PHASE2_CANONICAL_DAY_PLANNING = "true";
  t.after(() => {
    process.env.PHASE2_CANONICAL_DAY_PLANNING = originalFlag;
  });

  const originalFindById = Subscription.findById;
  const originalDayFindOne = SubscriptionDay.findOne;
  t.after(() => {
    Subscription.findById = originalFindById;
    SubscriptionDay.findOne = originalDayFindOne;
  });

  const userId = objectId();
  const legacySubscription = createSubscriptionDoc(userId, {
    contractVersion: undefined,
    contractMode: undefined,
    contractSnapshot: undefined,
  });
  const targetDate = getFutureDate(2);
  const legacyDay = {
    _id: objectId(),
    subscriptionId: legacySubscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId()],
    premiumSelections: [],
  };

  Subscription.findById = () => createQueryStub(legacySubscription);
  SubscriptionDay.findOne = () => createQueryStub(legacyDay);

  const { req, res } = createReqRes({
    params: { id: String(legacySubscription._id), date: targetDate },
    userId,
  });

  await controller.getSubscriptionDay(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal("planning" in res.payload.data, false);
});
