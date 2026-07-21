const assert = require("assert");

const Addon = require("../src/models/Addon");
const {
  listAddons,
  resolvePublicAddonFilters,
} = require("../src/controllers/addonController");

function makeLocalized(ar, en = ar) {
  return { ar, en };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    req: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function makeAddonQuery(rows, onFind) {
  return (filters) => {
    onFind(filters);
    return {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      lean() {
        return Promise.resolve(rows.filter((row) => matchesFilter(row, filters)));
      },
    };
  };
}

function matchesCondition(row, condition) {
  return Object.entries(condition).every(([key, expected]) => {
    const value = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (Array.isArray(expected.$in)) return expected.$in.includes(value);
      if (expected.hasOwnProperty('$ne')) return value !== expected.$ne;
    }
    return value === expected;
  });
}

function matchesFilter(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") {
      return Array.isArray(expected) && expected.some((condition) => matchesCondition(row, condition));
    }
    return matchesCondition(row, { [key]: expected });
  });
}

async function withMockedAddonFind(rows, fn) {
  const originalFind = Addon.find;
  const calls = [];
  Addon.find = makeAddonQuery(rows, (filters) => calls.push(filters));
  try {
    await fn(calls);
  } finally {
    Addon.find = originalFind;
  }
}

async function invokeListAddons({ query = {}, rows = [] } = {}) {
  const res = makeResponse();
  let findCalls = [];
  await withMockedAddonFind(rows, async (calls) => {
    findCalls = calls;
    await listAddons({ query, headers: { "accept-language": "en" } }, res);
  });
  return { res, findCalls };
}

const addonRows = {
  juicePlan: {
    _id: "507f191e810c19729de861001",
    name: makeLocalized("اشتراك العصير", "Juice Subscription"),
    category: "juice",
    kind: "plan",
    billingMode: "per_day",
    priceHalala: 1100,
    currency: "SAR",
    isActive: true,
  },
  snackPlan: {
    _id: "507f191e810c19729de861002",
    name: makeLocalized("اشتراك السناك", "Snack Subscription"),
    category: "snack",
    kind: "plan",
    pricingModel: "daily_recurring",
    billingMode: "per_day",
    priceHalala: 1200,
    currency: "SAR",
    isActive: true,
  },
  smallSaladPlan: {
    _id: "507f191e810c19729de861003",
    name: makeLocalized("اشتراك السلطة الصغيرة", "Small Salad Subscription"),
    category: "small_salad",
    kind: "plan",
    type: "subscription",
    billingMode: "per_day",
    priceHalala: 1200,
    currency: "SAR",
    isActive: true,
  },
  juiceItem: {
    _id: "507f191e810c19729de861004",
    name: makeLocalized("كلاسيك جرين", "Classic Green"),
    category: "juice",
    kind: "item",
    type: "one_time",
    billingMode: "flat_once",
    priceHalala: 1100,
    currency: "SAR",
    isActive: true,
  },
  snackItem: {
    _id: "507f191e810c19729de861005",
    name: makeLocalized("براونيز داكن", "Dark Brownies"),
    category: "snack",
    kind: "item",
    type: "one_time",
    billingMode: "flat_once",
    priceHalala: 1300,
    currency: "SAR",
    isActive: true,
  },
};

async function run() {
  const allRows = [
    addonRows.juicePlan,
    addonRows.snackPlan,
    addonRows.smallSaladPlan,
    addonRows.juiceItem,
    addonRows.snackItem,
  ];

  assert.deepStrictEqual(resolvePublicAddonFilters({}), { isActive: true, isArchived: { $ne: true } });
  assert.strictEqual(resolvePublicAddonFilters({ type: "subscription" }).isActive, true);
  assert(resolvePublicAddonFilters({ type: "subscription" }).$or.some((condition) => condition.kind === "plan"));
  assert(resolvePublicAddonFilters({ type: "subscription" }).$or.some((condition) => condition.billingMode));
  assert.strictEqual(resolvePublicAddonFilters({ type: "one_time" }).isActive, true);
  assert(resolvePublicAddonFilters({ type: "one_time" }).$or.some((condition) => condition.kind === "item"));
  assert(resolvePublicAddonFilters({ type: "one_time" }).$or.some((condition) => condition.billingMode === "flat_once"));
  assert(resolvePublicAddonFilters({ kind: "plan" }).$or.some((condition) => condition.kind === "plan"));
  assert(resolvePublicAddonFilters({ kind: "item" }).$or.some((condition) => condition.kind === "item"));
  assert.throws(
    () => resolvePublicAddonFilters({ type: "subscription", kind: "item" }),
    (err) => err && err.message === "type and kind filters are incompatible"
  );
  assert.strictEqual(
    resolvePublicAddonFilters({ category: "delivery" }).category,
    "delivery",
    "public add-on categories are dynamic normalized keys, not a fixed allowlist"
  );
  assert.throws(
    () => resolvePublicAddonFilters({ category: "###" }),
    (err) => err && err.code === "INVALID_ADDON_CATEGORY"
  );

  const subscriptionResult = await invokeListAddons({
    query: { type: "subscription" },
    rows: allRows,
  });
  assert.strictEqual(subscriptionResult.findCalls[0].isActive, true);
  assert(subscriptionResult.findCalls[0].$or.some((condition) => condition.kind === "plan"));
  assert.strictEqual(subscriptionResult.res.statusCode, 200);
  assert.strictEqual(subscriptionResult.res.body.status, true);
  assert.strictEqual(subscriptionResult.res.body.data.length, 3);
  assert.deepStrictEqual(
    subscriptionResult.res.body.data.map((addon) => addon.category).sort(),
    ["juice", "small_salad", "snack"]
  );
  assert(subscriptionResult.res.body.data.every((addon) => addon.type === "subscription"));
  assert(subscriptionResult.res.body.data.every((addon) => addon.kind === "plan"));
  assert(subscriptionResult.res.body.data.every((addon) => addon.billingUnit === "day"));
  assert(!subscriptionResult.res.body.data.some((addon) => addon.type === "one_time"));
  assert(subscriptionResult.res.body.data.every((addon) => typeof addon.priceHalala === "number"));
  assert(subscriptionResult.res.body.data.every((addon) => typeof addon.priceSar === "number"));
  assert(subscriptionResult.res.body.data.every((addon) => addon.ui && typeof addon.ui === "object"));

  const oneTimeResult = await invokeListAddons({
    query: { type: "one_time" },
    rows: allRows,
  });
  assert.strictEqual(oneTimeResult.findCalls[0].isActive, true);
  assert(oneTimeResult.findCalls[0].$or.some((condition) => condition.kind === "item"));
  assert.strictEqual(oneTimeResult.res.statusCode, 200);
  assert(oneTimeResult.res.body.data.every((addon) => addon.type === "one_time"));
  assert(oneTimeResult.res.body.data.every((addon) => addon.kind === "item"));
  assert(oneTimeResult.res.body.data.every((addon) => addon.billingUnit === "item"));
  assert(!oneTimeResult.res.body.data.some((addon) => addon.type === "subscription"));
  assert(!oneTimeResult.res.body.data.some((addon) => addon.name === "Juice Subscription"));

  const legacyResult = await invokeListAddons({
    query: {},
    rows: allRows,
  });
  assert.deepStrictEqual(legacyResult.findCalls[0], { isActive: true, isArchived: { $ne: true } });
  assert.strictEqual(legacyResult.res.body.data.length, 5);

  const invalidResult = await invokeListAddons({
    query: { type: "delivery" },
    rows: [],
  });
  assert.strictEqual(invalidResult.res.statusCode, 400);
  assert.strictEqual(invalidResult.res.body.error.code, "INVALID");
  assert.strictEqual(invalidResult.findCalls.length, 0);
}

run()
  .then(() => {
    console.log("addonPublicContract.test.js passed");
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
