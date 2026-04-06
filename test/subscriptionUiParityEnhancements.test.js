"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const dateUtils = require("../src/utils/date");
const subscriptionController = require("../src/controllers/subscriptionController");
const {
  buildSubscriptionOperationsMeta,
  buildFreezePreview,
} = require("../src/services/subscriptionOperationsReadService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionModel = require("../src/models/Subscription");
const Setting = require("../src/models/Setting");
const ActivityLog = require("../src/models/ActivityLog");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({
  params = {},
  body = {},
  query = {},
  userId = objectId(),
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
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
  };
}

function createSubscriptionDoc({
  _id = objectId(),
  userId = objectId(),
  status = "active",
  deliveryMode = "delivery",
  remainingMeals = 12,
  selectedMealsPerDay = 2,
  deliveryAddress = null,
  deliveryWindow = "08:00 - 10:00",
  deliveryZoneId = objectId(),
  deliveryZoneName = "Current Zone",
  deliveryFeeHalala = 1500,
  pickupLocationId = "",
  endDate = new Date("2026-04-30T00:00:00+03:00"),
  validityEndDate = new Date("2026-05-03T00:00:00+03:00"),
  skipDaysUsed = 0,
  skipPolicy = { enabled: true, maxDays: 5 },
} = {}) {
  return {
    _id,
    id: String(_id),
    userId,
    planId: {
      _id: objectId(),
      freezePolicy: { enabled: true, maxDays: 31, maxTimes: 1 },
      skipPolicy,
    },
    status,
    startDate: new Date("2026-04-01T00:00:00+03:00"),
    endDate,
    validityEndDate,
    totalMeals: 60,
    remainingMeals,
    selectedMealsPerDay,
    selectedGrams: 1200,
    skippedCount: 0,
    skipDaysUsed,
    deliveryMode,
    deliveryAddress,
    deliveryWindow,
    deliveryZoneId,
    deliveryZoneName,
    deliveryFeeHalala,
    pickupLocationId,
    deliverySlot: {
      type: deliveryMode,
      window: deliveryWindow || "",
      slotId: "",
    },
    saveCallCount: 0,
    async save() {
      this.saveCallCount += 1;
      return this;
    },
    toObject() {
      return {
        _id: this._id,
        id: this.id,
        userId: this.userId,
        planId: this.planId,
        status: this.status,
        startDate: this.startDate,
        endDate: this.endDate,
        validityEndDate: this.validityEndDate,
        totalMeals: this.totalMeals,
        remainingMeals: this.remainingMeals,
        selectedMealsPerDay: this.selectedMealsPerDay,
        selectedGrams: this.selectedGrams,
        skippedCount: this.skippedCount,
        skipDaysUsed: this.skipDaysUsed,
        deliveryMode: this.deliveryMode,
        deliveryAddress: this.deliveryAddress,
        deliveryWindow: this.deliveryWindow,
        deliveryZoneId: this.deliveryZoneId,
        deliveryZoneName: this.deliveryZoneName,
        deliveryFeeHalala: this.deliveryFeeHalala,
        pickupLocationId: this.pickupLocationId,
        deliverySlot: this.deliverySlot,
      };
    },
  };
}

test("buildSubscriptionOperationsMeta exposes UI-safe operations metadata", async () => {
  const subscription = createSubscriptionDoc({
    endDate: new Date("2026-03-20T00:00:00+03:00"),
    validityEndDate: new Date("2026-03-22T00:00:00+03:00"),
    skipDaysUsed: 2,
  });

  const result = await buildSubscriptionOperationsMeta({
    subscriptionId: String(subscription._id),
    actor: { kind: "client", userId: String(subscription.userId) },
    runtime: {
      async findSubscriptionByIdWithPlan() {
        return subscription.toObject();
      },
      async findFrozenDays() {
        return [{ date: "2026-04-05" }, { date: "2026-04-06" }, { date: "2026-04-08" }];
      },
      getTodayKSADate() {
        return "2026-04-02";
      },
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.data.statusContext.storedStatus, "active");
  assert.equal(result.data.statusContext.effectiveStatus, "expired");
  assert.equal(result.data.operations.cancel.canSubmit, true);
  assert.equal(result.data.operations.freeze.usage.frozenDaysUsed, 3);
  assert.equal(result.data.operations.freeze.usage.frozenBlocksUsed, 2);
  assert.equal(result.data.operations.skip.policy.allowanceScope, "plan_policy_snapshot");
  assert.equal(result.data.operations.skip.policy.compensationMode, "validity_extension");
  assert.equal(result.data.operations.skip.usage.usedDays, 2);
  assert.equal(result.data.operations.skip.usage.remainingDays, 3);
  assert.equal(result.data.operations.paymentMethods.supported, false);
});

test("buildFreezePreview matches freeze write semantics without mutation", async () => {
  const subscription = createSubscriptionDoc();

  const result = await buildFreezePreview({
    subscriptionId: String(subscription._id),
    actor: { kind: "client", userId: String(subscription.userId) },
    startDate: "2026-04-05",
    days: "3",
    runtime: {
      async findSubscriptionByIdWithPlan() {
        return subscription.toObject();
      },
      async findFrozenDays() {
        return [{ date: "2026-04-05" }, { date: "2026-04-07" }];
      },
      async findTargetDays() {
        return [{ date: "2026-04-05", status: "frozen" }, { date: "2026-04-06", status: "open" }];
      },
      async getCutoffTime() {
        return "23:59";
      },
      getTodayKSADate() {
        return "2026-04-02";
      },
      getTomorrowKSADate() {
        return "2026-04-03";
      },
      isOnOrAfterTodayKSADate(value) {
        return dateUtils.isOnOrAfterKSADate(value, this.getTodayKSADate());
      },
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.data.current.frozenDaysTotal, 2);
  assert.deepEqual(result.data.preview.targetDates, ["2026-04-05", "2026-04-06", "2026-04-07"]);
  assert.deepEqual(result.data.preview.alreadyFrozenDates, ["2026-04-05", "2026-04-07"]);
  assert.deepEqual(result.data.preview.newlyFrozenDates, ["2026-04-06"]);
  assert.equal(result.data.preview.frozenDaysTotalAfter, 3);
  assert.equal(result.data.preview.extensionDaysAdded, 1);
});

test("getSubscriptionPaymentMethods returns capability response", async () => {
  const { req, res } = createReqRes();
  await subscriptionController.getSubscriptionPaymentMethods(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.supported, false);
  assert.equal(res.payload.data.reasonCode, "PROVIDER_TOKENIZATION_UNAVAILABLE");
});

test("skipRange accepts endDate in addition to legacy days", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalSubscriptionFindById = Subscription.findById;
  const originalSubscriptionFindOneAndUpdate = SubscriptionModel.findOneAndUpdate;
  const originalSettingFindOne = Setting.findOne;
  const originalSubscriptionDayFindOne = SubscriptionDay.findOne;
  const originalSubscriptionDayFind = SubscriptionDay.find;
  const originalSubscriptionDayCreate = SubscriptionDay.create;
  const originalSubscriptionDayInsertMany = SubscriptionDay.insertMany;
  const originalActivityLogCreate = ActivityLog.create;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubscriptionFindById;
    SubscriptionModel.findOneAndUpdate = originalSubscriptionFindOneAndUpdate;
    Setting.findOne = originalSettingFindOne;
    SubscriptionDay.findOne = originalSubscriptionDayFindOne;
    SubscriptionDay.find = originalSubscriptionDayFind;
    SubscriptionDay.create = originalSubscriptionDayCreate;
    SubscriptionDay.insertMany = originalSubscriptionDayInsertMany;
    ActivityLog.create = originalActivityLogCreate;
  });

  const tomorrow = dateUtils.getTomorrowKSADate();
  const endDate = dateUtils.addDaysToKSADateString(tomorrow, 1);
  const subscription = createSubscriptionDoc({
    status: "active",
    endDate: new Date("2026-05-10T00:00:00+03:00"),
    validityEndDate: new Date("2026-05-10T00:00:00+03:00"),
  });

  mongoose.startSession = async () => createSessionStub();
  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionModel.findOneAndUpdate = async (_query, update) => {
    subscription.skipDaysUsed = Number(subscription.skipDaysUsed || 0) + Number(update.$inc?.skipDaysUsed || 0);
    return {
      ...subscription,
      skipDaysUsed: subscription.skipDaysUsed,
    };
  };
  Setting.findOne = (query) => {
    if (query.key === "cutoff_time") {
      return createQueryStub({ key: "cutoff_time", value: "23:59" }, { leanResult: { key: "cutoff_time", value: "23:59" } });
    }
    return createQueryStub(null, { leanResult: null });
  };
  const dayStore = [];
  SubscriptionDay.findOne = (query) => createQueryStub(
    dayStore.find((day) => String(day.subscriptionId) === String(query.subscriptionId) && day.date === query.date) || null
  );
  SubscriptionDay.find = (query) => {
    const rows = dayStore.filter((day) => {
      if (String(day.subscriptionId) !== String(query.subscriptionId)) {
        return false;
      }
      if (query.$or) {
        return query.$or.some((condition) => (
          Object.entries(condition).every(([key, value]) => day[key] === value)
        ));
      }
      if (query.date && query.date.$gt !== undefined && query.date.$lte !== undefined) {
        return day.date > query.date.$gt && day.date <= query.date.$lte;
      }
      return true;
    });
    return createQueryStub(rows);
  };
  SubscriptionDay.create = async (rows) => rows.map((row) => {
    const created = { _id: objectId(), ...row };
    dayStore.push(created);
    return created;
  });
  SubscriptionDay.insertMany = async (rows) => rows.map((row) => {
    const created = { _id: objectId(), ...row };
    dayStore.push(created);
    return created;
  });
  ActivityLog.create = async () => ({});

  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    body: {
      startDate: tomorrow,
      endDate,
    },
    userId: subscription.userId,
  });

  await subscriptionController.skipRange(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(res.payload.data.requestedRange, {
    startDate: tomorrow,
    endDate,
    days: 2,
  });
  assert.equal(res.payload.data.requestedDays, 2);
  assert.equal(res.payload.data.appliedDays, 2);
  assert.equal(res.payload.data.compensatedDaysAdded, 2);
  assert.equal(res.payload.data.remainingSkipDays, 3);
  assert.deepEqual(res.payload.data.appliedDates, [tomorrow, endDate]);
});

test("skipDay accepts date from request body", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalSubscriptionFindById = Subscription.findById;
  const originalSubscriptionFindOneAndUpdate = SubscriptionModel.findOneAndUpdate;
  const originalSettingFindOne = Setting.findOne;
  const originalSubscriptionDayFindOne = SubscriptionDay.findOne;
  const originalSubscriptionDayFind = SubscriptionDay.find;
  const originalSubscriptionDayCreate = SubscriptionDay.create;
  const originalSubscriptionDayInsertMany = SubscriptionDay.insertMany;
  const originalActivityLogCreate = ActivityLog.create;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalSubscriptionFindById;
    SubscriptionModel.findOneAndUpdate = originalSubscriptionFindOneAndUpdate;
    Setting.findOne = originalSettingFindOne;
    SubscriptionDay.findOne = originalSubscriptionDayFindOne;
    SubscriptionDay.find = originalSubscriptionDayFind;
    SubscriptionDay.create = originalSubscriptionDayCreate;
    SubscriptionDay.insertMany = originalSubscriptionDayInsertMany;
    ActivityLog.create = originalActivityLogCreate;
  });

  const targetDate = dateUtils.getTomorrowKSADate();
  const subscription = createSubscriptionDoc({
    status: "active",
    endDate: new Date("2026-05-10T00:00:00+03:00"),
    validityEndDate: new Date("2026-05-10T00:00:00+03:00"),
  });

  mongoose.startSession = async () => createSessionStub();
  Subscription.findById = () => createQueryStub(subscription);
  SubscriptionModel.findOneAndUpdate = async (_query, update) => {
    subscription.skipDaysUsed = Number(subscription.skipDaysUsed || 0) + Number(update.$inc?.skipDaysUsed || 0);
    return {
      ...subscription,
      skipDaysUsed: subscription.skipDaysUsed,
    };
  };
  Setting.findOne = (query) => {
    if (query.key === "cutoff_time") {
      return createQueryStub({ key: "cutoff_time", value: "23:59" }, { leanResult: { key: "cutoff_time", value: "23:59" } });
    }
    return createQueryStub(null, { leanResult: null });
  };
  const dayStore = [];
  SubscriptionDay.findOne = (query) => createQueryStub(
    dayStore.find((day) => String(day.subscriptionId) === String(query.subscriptionId) && day.date === query.date) || null
  );
  SubscriptionDay.find = (query) => {
    const rows = dayStore.filter((day) => {
      if (String(day.subscriptionId) !== String(query.subscriptionId)) {
        return false;
      }
      if (query.$or) {
        return query.$or.some((condition) => (
          Object.entries(condition).every(([key, value]) => day[key] === value)
        ));
      }
      if (query.date && query.date.$gt !== undefined && query.date.$lte !== undefined) {
        return day.date > query.date.$gt && day.date <= query.date.$lte;
      }
      return true;
    });
    return createQueryStub(rows);
  };
  SubscriptionDay.create = async (rows) => rows.map((row) => {
    const created = { _id: objectId(), ...row };
    dayStore.push(created);
    return created;
  });
  SubscriptionDay.insertMany = async (rows) => rows.map((row) => {
    const created = { _id: objectId(), ...row };
    dayStore.push(created);
    return created;
  });
  ActivityLog.create = async () => ({});

  const { req, res } = createReqRes({
    params: { id: String(subscription._id) },
    body: { date: targetDate },
    userId: subscription.userId,
  });

  await subscriptionController.skipDay(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.day.date, targetDate);
  assert.equal(res.payload.data.appliedDays, 1);
  assert.equal(res.payload.data.remainingSkipDays, 4);
});

test("updateDeliveryDetails supports delivery zone updates and pickup location defaults", async (t) => {
  const originalSubscriptionFindById = Subscription.findById;
  const originalSubscriptionDayFindOne = SubscriptionDay.findOne;
  const originalSettingFindOne = Setting.findOne;
  const originalActivityLogCreate = ActivityLog.create;

  t.after(() => {
    Subscription.findById = originalSubscriptionFindById;
    SubscriptionDay.findOne = originalSubscriptionDayFindOne;
    Setting.findOne = originalSettingFindOne;
    ActivityLog.create = originalActivityLogCreate;
  });

  Setting.findOne = (query) => {
    if (query.key === "cutoff_time") {
      return createQueryStub({ key: "cutoff_time", value: "23:59" }, { leanResult: { key: "cutoff_time", value: "23:59" } });
    }
    return createQueryStub(null, { leanResult: null });
  };
  SubscriptionDay.findOne = () => createQueryStub(null, { leanResult: null });
  ActivityLog.create = async () => ({});

  await t.test("delivery mode accepts nested delivery payload", async () => {
    const subscription = createSubscriptionDoc({
      deliveryMode: "delivery",
      deliveryAddress: { city: "Old City" },
      deliveryWindow: "08:00 - 10:00",
    });
    Subscription.findById = () => createQueryStub(subscription);

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      userId: subscription.userId,
      body: {
        delivery: {
          type: "delivery",
          zoneId: String(objectId()),
          address: { city: "Dubai", district: "Marina" },
          slot: {
            type: "delivery",
            window: "10:00 - 12:00",
          },
        },
      },
    });

    await subscriptionController.updateDeliveryDetails(req, res, {
      async getDeliveryWindows() {
        return ["08:00 - 10:00", "10:00 - 12:00"];
      },
      async findZoneById(zoneId) {
        return {
          _id: zoneId,
          name: { en: "Dubai Marina", ar: "دبي مارينا" },
          isActive: true,
          deliveryFeeHalala: 2500,
        };
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(subscription.deliveryWindow, "10:00 - 12:00");
    assert.deepEqual(subscription.deliveryAddress, { city: "Dubai", district: "Marina" });
    assert.equal(subscription.deliveryZoneName, "دبي مارينا");
    assert.equal(subscription.deliveryFeeHalala, 2500);
  });

  await t.test("pickup mode accepts pickupLocationId", async () => {
    const subscription = createSubscriptionDoc({
      deliveryMode: "pickup",
      deliveryAddress: { line1: "Old Branch" },
      deliveryWindow: "",
      pickupLocationId: "old_branch",
    });
    Subscription.findById = () => createQueryStub(subscription);

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      userId: subscription.userId,
      body: {
        delivery: {
          type: "pickup",
          pickupLocationId: "new_branch",
        },
      },
    });

    await subscriptionController.updateDeliveryDetails(req, res, {
      async getPickupLocations() {
        return [{
          id: "new_branch",
          name: { en: "Marina Branch", ar: "فرع المارينا" },
          address: {
            line1: { en: "Marina Branch", ar: "فرع المارينا" },
            city: "Dubai",
          },
        }];
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(subscription.pickupLocationId, "new_branch");
    assert.equal(subscription.deliverySlot.type, "pickup");
    assert.equal(subscription.deliveryWindow, "");
    assert.equal(subscription.deliveryZoneName, "");
  });
});
