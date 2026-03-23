const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const controller = require("../src/controllers/subscriptionController");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createReqRes({ params = {}, userId = objectId() } = {}) {
  const req = {
    params,
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

test("getSubscriptionRenewalSeed returns a renewal seed for a canonical previous subscription owned by the user", async () => {
  const userId = objectId();
  const subscriptionId = objectId();
  const planId = objectId();
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
  });

  await controller.getSubscriptionRenewalSeed(req, res, {
    async findSubscriptionById(id) {
      assert.equal(String(id), String(subscriptionId));
      return {
        _id: subscriptionId,
        userId,
        planId,
        contractSnapshot: {
          plan: {
            planId: String(planId),
            selectedGrams: 150,
            mealsPerDay: 3,
            daysCount: 10,
          },
          delivery: {
            mode: "delivery",
            address: { city: "Riyadh" },
            slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
          },
        },
      };
    },
    async findActivePlanById(id) {
      assert.equal(String(id), String(planId));
      return {
        _id: planId,
        isActive: true,
        daysCount: 10,
        gramsOptions: [
          {
            grams: 150,
            isActive: true,
            mealsOptions: [{ mealsPerDay: 3, isActive: true }],
          },
        ],
      };
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.seed.planId, String(planId));
  assert.equal(res.payload.data.seed.deliveryPreference.seedOnly, true);
});

test("getSubscriptionRenewalSeed forbids access to another user's subscription", async () => {
  const ownerId = objectId();
  const requesterId = objectId();
  const subscriptionId = objectId();
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId: requesterId,
  });

  await controller.getSubscriptionRenewalSeed(req, res, {
    async findSubscriptionById() {
      return {
        _id: subscriptionId,
        userId: ownerId,
        planId: objectId(),
      };
    },
    async findActivePlanById() {
      throw new Error("findActivePlanById should not be reached");
    },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error.code, "FORBIDDEN");
});

test("getSubscriptionRenewalSeed returns renewal unavailable when safe legacy fields are insufficient", async () => {
  const userId = objectId();
  const subscriptionId = objectId();
  const planId = objectId();
  const { req, res } = createReqRes({
    params: { id: String(subscriptionId) },
    userId,
  });

  await controller.getSubscriptionRenewalSeed(req, res, {
    async findSubscriptionById() {
      return {
        _id: subscriptionId,
        userId,
        planId,
        selectedGrams: null,
        selectedMealsPerDay: 3,
      };
    },
    async findActivePlanById() {
      return {
        _id: planId,
        isActive: true,
        daysCount: 10,
        gramsOptions: [],
      };
    },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.error.code, "RENEWAL_UNAVAILABLE");
});
