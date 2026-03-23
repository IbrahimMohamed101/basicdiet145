"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildRoutingReadModel, buildKitchenBatchReadModel } = require("../src/services/deliveryOperationsService");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("Production Operations / Phase B Smoke Tests", async (t) => {
  const originalDayFind = SubscriptionDay.find;

  t.after(() => {
    SubscriptionDay.find = originalDayFind;
  });

  await t.test("should securely fetch kitchen batching read model without mutating domain", async () => {
    SubscriptionDay.find = () => ({
      session: () => ({
        lean: () => Promise.resolve([
          { date: "2026-05-10", status: "locked", lockedSnapshot: { planning: { baseMealSlots: [{ mealId: "meal1" }, { mealId: "meal2" }] } } },
          { date: "2026-05-10", status: "fulfilled", baseMealSlots: [{ mealId: "meal1" }] }
        ])
      })
    });

    const res = await buildKitchenBatchReadModel("2026-05-10");
    assert.ok(res);
    assert.equal(res.date, "2026-05-10");
    assert.equal(res.meals["meal1"], 2);
    assert.equal(res.meals["meal2"], 1);
  });

  await t.test("should securely fetch routing read model directly from locked state", async () => {
    SubscriptionDay.find = () => ({
      populate: () => ({
        session: () => ({
          lean: () => Promise.resolve([
            {
              _id: objectId(),
              subscriptionId: { _id: objectId(), contractSnapshot: { delivery: { type: "delivery", zoneId: "zone1" } } },
              date: "2026-05-10",
              status: "open",
              selections: ["meal1"],
            }
          ])
        })
      })
    });

    const res = await buildRoutingReadModel("2026-05-10", { zoneId: "zone1" });
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 1);
    assert.equal(res[0].zoneId, "zone1");
    assert.equal(res[0].deliveryType, "delivery");
  });
});
