"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const kitchenController = require("../src/controllers/kitchenController");
const SubscriptionDay = require("../src/models/SubscriptionDay");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {} } = {}) {
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

  return { req: { params }, res };
}

test("kitchen listDailyOrders exposes deliveryNotes from client input", async () => {
  const originalFind = SubscriptionDay.find;

  const dayId = objectId();
  const subscriptionId = objectId();

  const mockedSub = {
    _id: subscriptionId,
    deliveryMode: "delivery",
    deliveryAddress: null,
    deliveryWindow: null,
    premiumSelections: [],
    addonSelections: [],
    selectedMealsPerDay: 2,
  };

  const day = {
    _id: dayId,
    subscriptionId: mockedSub,
    date: "2026-05-10",
    status: "locked",
    lockedSnapshot: null,
    fulfilledSnapshot: null,
    customSalads: [],
    customMeals: [],
    addonsOneTime: [],
    // Client provided data (what kitchen UI must show)
    deliveryAddressOverride: {
      line1: "street 1",
      notes: "ملاحظة العميل",
    },
    deliveryWindowOverride: "2pm - 5pm",
  };

  SubscriptionDay.find = () => ({
    populate() {
      return this;
    },
    lean: async () => [day],
  });

  try {
    const { req, res } = createReqRes({ params: { date: "2026-05-10" } });
    await kitchenController.listDailyOrders(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.data.length, 1);

    assert.equal(res.payload.data[0].deliveryNotes, "ملاحظة العميل");
    assert.equal(res.payload.data[0].effectiveAddress.notes, "ملاحظة العميل");
    assert.equal(res.payload.data[0].effectiveWindow, "2pm - 5pm");
  } finally {
    SubscriptionDay.find = originalFind;
  }
});

