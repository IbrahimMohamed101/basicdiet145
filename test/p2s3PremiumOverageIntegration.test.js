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

function createCanonicalGenericSubscription(userId, overrides = {}) {
  return {
    _id: objectId(),
    userId,
    status: "active",
    startDate: new Date("2026-03-10T21:00:00.000Z"),
    endDate: new Date("2026-04-10T21:00:00.000Z"),
    validityEndDate: new Date("2026-04-10T21:00:00.000Z"),
    selectedMealsPerDay: 3,
    premiumWalletMode: "generic_v1",
    genericPremiumBalance: [],
    premiumRemaining: 0,
    premiumSelections: [],
    addonSelections: [],
    addonBalance: [],
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    async save() {
      return this;
    },
    ...overrides,
  };
}

test("updateDaySelection allows canonical generic premium overage and stores pending day overage state", async (t) => {
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
  const premiumMealOne = objectId();
  const premiumMealTwo = objectId();
  const subscription = createCanonicalGenericSubscription(userId, {
    genericPremiumBalance: [{
      _id: objectId(),
      purchasedQty: 1,
      remainingQty: 1,
      unitCreditPriceHalala: 500,
      currency: "SAR",
      purchasedAt: new Date("2026-03-18T08:00:00.000Z"),
    }],
    premiumRemaining: 1,
  });
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

  SubscriptionDay.findOne = () => createQueryStub(null);
  SubscriptionDay.findOneAndUpdate = async (_query, update) => {
    Object.assign(dayDoc, update);
    return dayDoc;
  };
  Setting.findOne = () => createQueryStub({ value: 20 });

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: {
      selections: [objectId()],
      premiumSelections: [premiumMealOne, premiumMealTwo],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.premiumSelections.length, 2);
  assert.equal(res.payload.data.premiumOverageCount, 1);
  assert.equal(res.payload.data.premiumOverageStatus, "pending");
  assert.equal(subscription.premiumSelections.length, 1);
  assert.equal(subscription.genericPremiumBalance[0].remainingQty, 0);
  assert.equal(subscription.premiumRemaining, 0);
});

test("updateDaySelection recomputes final premium overage state on same requested selections after credits become available", async (t) => {
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
  const premiumMealOne = objectId();
  const premiumMealTwo = objectId();
  const consumedWalletRowId = objectId();
  const availableWalletRowId = objectId();
  const targetDate = getFutureDate(2);
  const dayId = objectId();
  const subscription = createCanonicalGenericSubscription(userId, {
    genericPremiumBalance: [
      {
        _id: consumedWalletRowId,
        purchasedQty: 1,
        remainingQty: 0,
        unitCreditPriceHalala: 500,
        currency: "SAR",
        purchasedAt: new Date("2026-03-18T08:00:00.000Z"),
      },
      {
        _id: availableWalletRowId,
        purchasedQty: 1,
        remainingQty: 1,
        unitCreditPriceHalala: 500,
        currency: "SAR",
        purchasedAt: new Date("2026-03-19T08:00:00.000Z"),
      },
    ],
    premiumRemaining: 1,
    premiumSelections: [{
      _id: objectId(),
      dayId,
      date: targetDate,
      baseSlotKey: "legacy_day_premium_slot_0",
      premiumMealId: premiumMealOne,
      unitExtraFeeHalala: 500,
      currency: "SAR",
      premiumWalletMode: "generic_v1",
      premiumWalletRowId: String(consumedWalletRowId),
      consumedAt: new Date("2026-03-18T08:00:00.000Z"),
    }],
  });
  Subscription.findById = () => createQueryStub(subscription);

  const dayDoc = {
    _id: dayId,
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId()],
    premiumSelections: [premiumMealOne, premiumMealTwo],
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
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
  Setting.findOne = () => createQueryStub({ value: 20 });

  const { req, res } = createReqRes({
    params: { id: String(subscription._id), date: targetDate },
    body: {
      selections: dayDoc.selections,
      premiumSelections: [premiumMealOne, premiumMealTwo],
    },
    userId,
  });

  await controller.updateDaySelection(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.idempotent, undefined);
  assert.equal(res.payload.data.premiumOverageCount, 0);
  assert.equal(res.payload.data.premiumOverageStatus, undefined);
  assert.equal(subscription.premiumSelections.length, 2);
  assert.equal(subscription.genericPremiumBalance[1].remainingQty, 0);
  assert.equal(subscription.premiumRemaining, 0);
});

test("confirmDayPlanning blocks canonical generic days with unpaid premium overage", async (t) => {
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
  const subscription = createCanonicalGenericSubscription(userId);
  Subscription.findById = () => createQueryStub(subscription);

  const targetDate = getFutureDate(2);
  const dayDoc = {
    _id: objectId(),
    subscriptionId: subscription._id,
    date: targetDate,
    status: "open",
    selections: [objectId()],
    premiumSelections: [objectId(), objectId()],
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
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

  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.code, "PREMIUM_OVERAGE_PAYMENT_REQUIRED");
});
