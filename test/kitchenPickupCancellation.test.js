"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const kitchenController = require("../src/controllers/kitchenController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const ActivityLog = require("../src/models/ActivityLog");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, userId = objectId(), userRole = "kitchen" } = {}) {
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
      userId,
      userRole,
    },
    res,
  };
}

test("cancelAtBranch restores deducted pickup credits and marks the day canceled at branch", async (t) => {
  const originalStartSession = mongoose.startSession;
  const originalFindSubscription = Subscription.findById;
  const originalUpdateSubscription = Subscription.updateOne;
  const originalFindDay = SubscriptionDay.findOne;
  const originalActivityLogCreate = ActivityLog.create;

  t.after(() => {
    mongoose.startSession = originalStartSession;
    Subscription.findById = originalFindSubscription;
    Subscription.updateOne = originalUpdateSubscription;
    SubscriptionDay.findOne = originalFindDay;
    ActivityLog.create = originalActivityLogCreate;
  });

  const session = {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    endSession() {},
  };

  const subscriptionId = objectId();
  const dayId = objectId();
  const subscription = {
    _id: subscriptionId,
    deliveryMode: "pickup",
    selectedMealsPerDay: 2,
  };
  const day = {
    _id: dayId,
    date: "2026-05-10",
    status: "ready_for_pickup",
    pickupRequested: true,
    creditsDeducted: true,
    lockedSnapshot: { mealsPerDay: 2 },
    async save() {
      return this;
    },
  };

  let capturedSubscriptionUpdate = null;

  mongoose.startSession = async () => session;
  Subscription.findById = () => ({
    session: () => ({
      lean: async () => subscription,
    }),
  });
  Subscription.updateOne = async (query, update) => {
    capturedSubscriptionUpdate = { query, update };
    return { modifiedCount: 1 };
  };
  SubscriptionDay.findOne = () => ({
    session: async () => day,
  });
  ActivityLog.create = async () => ({ _id: objectId() });

  const { req, res } = createReqRes({
    params: { id: String(subscriptionId), date: "2026-05-10" },
  });

  await kitchenController.cancelAtBranch(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(day.status, "canceled_at_branch");
  assert.equal(day.pickupRequested, false);
  assert.equal(day.creditsDeducted, false);
  assert.deepEqual(capturedSubscriptionUpdate.update, { $inc: { remainingMeals: 2 } });
  assert.equal(res.payload.restoredCredits, 2);
});
