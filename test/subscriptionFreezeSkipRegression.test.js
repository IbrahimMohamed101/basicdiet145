"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Setting = require("../src/models/Setting");
const ActivityLog = require("../src/models/ActivityLog");
const { addDaysToKSADateString, getTomorrowKSADate } = require("../src/utils/date");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, body = {}, query = {}, userId = objectId(), headers = {} } = {}) {
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
    select() {
      return query;
    },
    lean() {
      return Promise.resolve(result);
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
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

function getFutureDate(daysAhead = 2) {
  return addDaysToKSADateString(getTomorrowKSADate(), daysAhead - 1);
}

test("subscription freeze/skip controller regressions", async (t) => {
  await t.test("freezeSubscription enforces canonical snapshot freeze policy inside the transaction", async () => {
    const originalFlag = process.env.PHASE1_SNAPSHOT_FIRST_READS;
    const originalStartSession = mongoose.startSession;
    const originalSubFindById = Subscription.findById;
    const originalDayFind = SubscriptionDay.find;
    const originalSettingFindOne = Setting.findOne;

    process.env.PHASE1_SNAPSHOT_FIRST_READS = "true";

    t.after(() => {
      process.env.PHASE1_SNAPSHOT_FIRST_READS = originalFlag;
      mongoose.startSession = originalStartSession;
      Subscription.findById = originalSubFindById;
      SubscriptionDay.find = originalDayFind;
      Setting.findOne = originalSettingFindOne;
    });

    mongoose.startSession = async () => createSessionStub();
    Setting.findOne = () => createQueryStub({ key: "cutoff_time", value: "23:59" });

    const userId = objectId();
    const startDate = getFutureDate(10);
    const endDate = new Date(`${addDaysToKSADateString(startDate, 9)}T00:00:00+03:00`);
    const subscription = {
      _id: objectId(),
      id: String(objectId()),
      userId,
      status: "active",
      startDate: new Date(`${startDate}T00:00:00+03:00`),
      endDate,
      validityEndDate: endDate,
      planId: {
        freezePolicy: { enabled: true, maxDays: 31, maxTimes: 31 },
      },
      contractVersion: "subscription_contract.v1",
      contractMode: "canonical",
      contractSnapshot: {
        policySnapshot: {
          freezePolicy: { enabled: true, maxDays: 2, maxTimes: 1 },
        },
      },
      async save() {
        return this;
      },
    };

    Subscription.findById = () => createQueryStub(subscription);
    SubscriptionDay.find = () => createQueryStub([]);

    const { req, res } = createReqRes({
      params: { id: String(subscription._id) },
      body: { startDate, days: 3 },
      userId,
    });

    await controller.freezeSubscription(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.error.code, "FREEZE_LIMIT_REACHED");
  });

  await t.test("unskipDay clears canonicalDayActionType from both persistence update and response payload", async () => {
    const originalStartSession = mongoose.startSession;
    const originalSubFindById = Subscription.findById;
    const originalSubFindOneAndUpdate = Subscription.findOneAndUpdate;
    const originalDayFindOne = SubscriptionDay.findOne;
    const originalDayUpdateOne = SubscriptionDay.updateOne;
    const originalSettingFindOne = Setting.findOne;
    const originalLogCreate = ActivityLog.create;

    t.after(() => {
      mongoose.startSession = originalStartSession;
      Subscription.findById = originalSubFindById;
      Subscription.findOneAndUpdate = originalSubFindOneAndUpdate;
      SubscriptionDay.findOne = originalDayFindOne;
      SubscriptionDay.updateOne = originalDayUpdateOne;
      Setting.findOne = originalSettingFindOne;
      ActivityLog.create = originalLogCreate;
    });

    mongoose.startSession = async () => createSessionStub();
    ActivityLog.create = async () => ({});
    Setting.findOne = () => createQueryStub(null);

    const userId = objectId();
    const targetDate = getFutureDate(4);
    const endDate = new Date(`${addDaysToKSADateString(targetDate, 5)}T00:00:00+03:00`);
    const subscription = {
      _id: objectId(),
      id: String(objectId()),
      userId,
      status: "active",
      endDate,
      validityEndDate: endDate,
      totalMeals: 30,
      selectedMealsPerDay: 1,
    };
    const skippedDay = {
      _id: objectId(),
      subscriptionId: subscription._id,
      date: targetDate,
      status: "skipped",
      skippedByUser: true,
      creditsDeducted: true,
      canonicalDayActionType: "skip",
      toObject() {
        return { ...this };
      },
    };

    let capturedUpdate = null;
    Subscription.findById = () => createQueryStub(subscription);
    Subscription.findOneAndUpdate = async () => ({ ...subscription, remainingMeals: 10, skippedCount: 0 });
    SubscriptionDay.findOne = () => createQueryStub(skippedDay);
    SubscriptionDay.updateOne = async (_query, update) => {
      capturedUpdate = update;
      return { modifiedCount: 1 };
    };

    const { req, res } = createReqRes({
      params: { id: String(subscription._id), date: targetDate },
      userId,
    });

    await controller.unskipDay(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(capturedUpdate && capturedUpdate.$unset && capturedUpdate.$unset.canonicalDayActionType, 1);
    assert.equal(res.payload.data.status, "open");
    assert.equal("canonicalDayActionType" in res.payload.data, false);
  });
});
