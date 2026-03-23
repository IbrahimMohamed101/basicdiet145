const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Plan = require("../src/models/Plan");
const { createPlan, getPlanAdmin, listPlansAdmin } = require("../src/controllers/adminController");

function createReqRes({ body = {}, params = {}, query = {} } = {}) {
  const req = {
    body,
    params,
    query,
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

function buildPlanPayloadWithSarPrices() {
  return {
    name: {
      ar: "خطة شهرية",
      en: "Monthly Plan",
    },
    daysCount: 20,
    currency: "SAR",
    gramsOptions: [
      {
        grams: 1200,
        mealsOptions: [
          {
            mealsPerDay: 3,
            priceSar: 2599,
            compareAt: 2899,
          },
        ],
      },
    ],
  };
}

function buildStoredPlan() {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: {
      ar: "خطة شهرية",
      en: "Monthly Plan",
    },
    daysCount: 20,
    currency: "SAR",
    isActive: true,
    sortOrder: 0,
    gramsOptions: [
      {
        grams: 1200,
        isActive: true,
        sortOrder: 0,
        mealsOptions: [
          {
            mealsPerDay: 3,
            priceHalala: 259900,
            compareAtHalala: 289900,
            isActive: true,
            sortOrder: 0,
          },
        ],
      },
    ],
  };
}

test("createPlan stores meal prices in halala even when admin payload sends SAR fields", async (t) => {
  const originalCreate = Plan.create;
  let capturedPayload = null;

  Plan.create = async (payload) => {
    capturedPayload = payload;
    return { id: "plan-1" };
  };

  t.after(() => {
    Plan.create = originalCreate;
  });

  const { req, res } = createReqRes({
    body: buildPlanPayloadWithSarPrices(),
  });

  await createPlan(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.id, "plan-1");
  assert.ok(capturedPayload);
  assert.equal(capturedPayload.gramsOptions[0].mealsOptions[0].priceHalala, 259900);
  assert.equal(capturedPayload.gramsOptions[0].mealsOptions[0].compareAtHalala, 289900);
});

test("getPlanAdmin returns plan meal prices with SAR-compatible fields for display", async (t) => {
  const originalFindById = Plan.findById;
  const plan = buildStoredPlan();

  Plan.findById = () => ({
    lean: async () => plan,
  });

  t.after(() => {
    Plan.findById = originalFindById;
  });

  const { req, res } = createReqRes({
    params: { id: String(plan._id) },
  });

  await getPlanAdmin(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.pricing.startsFromHalala, 259900);
  assert.equal(res.payload.data.pricing.startsFromSar, 2599);

  const mealOption = res.payload.data.gramsOptions[0].mealsOptions[0];
  assert.equal(mealOption.priceHalala, 259900);
  assert.equal(mealOption.priceSar, 2599);
  assert.equal(mealOption.price, 2599);
  assert.equal(mealOption.compareAtHalala, 289900);
  assert.equal(mealOption.compareAtSar, 2899);
  assert.equal(mealOption.compareAt, 2899);
});

test("listPlansAdmin decorates admin plan rows with derived SAR pricing fields", async (t) => {
  const originalFind = Plan.find;
  const plan = buildStoredPlan();

  Plan.find = () => ({
    sort: () => ({
      lean: async () => [plan],
    }),
  });

  t.after(() => {
    Plan.find = originalFind;
  });

  const { req, res } = createReqRes();

  await listPlansAdmin(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.length, 1);
  assert.equal(res.payload.data[0].pricing.startsFromSar, 2599);
  assert.equal(res.payload.data[0].gramsOptions[0].mealsOptions[0].priceSar, 2599);
});
