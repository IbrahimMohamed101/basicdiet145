process.env.NODE_ENV = "test";

const assert = require("assert");

const Plan = require("../src/models/Plan");
const { listPlans, getPlan } = require("../src/controllers/planController");

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function viablePlan(overrides = {}) {
  return {
    _id: "6a615605e0807f6831d5befa",
    key: "custom_admin_plan_14_days",
    name: { ar: "باقة مخصصة", en: "Custom Package" },
    daysCount: 14,
    durationDays: 14,
    currency: "SAR",
    isActive: true,
    active: true,
    available: true,
    isAvailable: true,
    isDeleted: false,
    sortOrder: 5,
    gramsOptions: [
      {
        grams: 150,
        isActive: true,
        sortOrder: 0,
        mealsOptions: [
          {
            mealsPerDay: 2,
            priceHalala: 25000,
            compareAtHalala: 28000,
            isActive: true,
            sortOrder: 0,
          },
        ],
      },
    ],
    skipPolicy: { enabled: true, maxDays: 2 },
    freezePolicy: { enabled: true, maxDays: 7, maxTimes: 1 },
    ...overrides,
  };
}

async function run() {
  const originalFind = Plan.find;
  const originalFindOne = Plan.findOne;
  const originalGetSellableQuery = Plan.getSellableQuery;
  const originalIsViable = Plan.isViable;

  try {
    const expectedSellableQuery = {
      isActive: true,
      isDeleted: { $ne: true },
      isAvailable: { $ne: false },
    };
    let listQuery = null;
    let singleQuery = null;

    Plan.getSellableQuery = () => ({ ...expectedSellableQuery });
    Plan.isViable = (plan) => plan.key !== "broken_dynamic_plan";
    Plan.find = (query) => {
      listQuery = query;
      return {
        sort() {
          return this;
        },
        async lean() {
          return [
            viablePlan(),
            viablePlan({ key: "broken_dynamic_plan" }),
          ];
        },
      };
    };
    Plan.findOne = (query) => {
      singleQuery = query;
      return {
        async lean() {
          return viablePlan();
        },
      };
    };

    const listResponse = makeResponse();
    await listPlans({ headers: {}, query: {} }, listResponse);

    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.body.status, true);
    assert.deepEqual(
      listResponse.body.data.map((plan) => plan.key),
      ["custom_admin_plan_14_days"]
    );
    assert.deepEqual(listQuery, expectedSellableQuery);
    assert.equal(Object.prototype.hasOwnProperty.call(listQuery, "key"), false);

    const singleResponse = makeResponse();
    await getPlan(
      {
        headers: {},
        query: {},
        params: { id: "6a615605e0807f6831d5befa" },
      },
      singleResponse
    );

    assert.equal(singleResponse.statusCode, 200);
    assert.equal(singleResponse.body.data.key, "custom_admin_plan_14_days");
    assert.equal(singleQuery._id, "6a615605e0807f6831d5befa");
    assert.equal(Object.prototype.hasOwnProperty.call(singleQuery, "key"), false);
    for (const [key, value] of Object.entries(expectedSellableQuery)) {
      assert.deepEqual(singleQuery[key], value);
    }

    console.log("dynamic public plans contract passed");
  } finally {
    Plan.find = originalFind;
    Plan.findOne = originalFindOne;
    Plan.getSellableQuery = originalGetSellableQuery;
    Plan.isViable = originalIsViable;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
