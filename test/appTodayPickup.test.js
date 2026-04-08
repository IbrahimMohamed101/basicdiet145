"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { getTodayPickup } = require("../src/controllers/appAuthController");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const dateUtils = require("../src/utils/date");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ userId = objectId() } = {}) {
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
    req: { userId },
    res,
  };
}

test("getTodayPickup returns current pickup payload shape", async (t) => {
  const originalGetToday = dateUtils.getTodayKSADate;
  const originalFindSubscription = Subscription.find;
  const originalFindDay = SubscriptionDay.find;

  t.after(() => {
    dateUtils.getTodayKSADate = originalGetToday;
    Subscription.find = originalFindSubscription;
    SubscriptionDay.find = originalFindDay;
  });

  const subId = objectId();
  const userId = objectId();
  dateUtils.getTodayKSADate = () => "2026-05-10";
  Subscription.find = () => ({
    select() {
      return this;
    },
    lean: async () => [{ _id: subId }],
  });
  SubscriptionDay.find = () => ({
    select() {
      return this;
    },
    lean: async () => ([
      {
        subscriptionId: subId,
        status: "ready_for_pickup",
        pickupCode: "123456",
        lockedSnapshot: {
          pickupLocationName: "فرع مدينة نصر",
          deliveryWindow: "2pm - 5pm",
        },
      },
    ]),
  });

  const { req, res } = createReqRes({ userId });
  await getTodayPickup(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.data, {
    status: "ready_for_pickup",
    branchName: "فرع مدينة نصر",
    pickupWindow: "2pm - 5pm",
    code: "123456",
  });
});

