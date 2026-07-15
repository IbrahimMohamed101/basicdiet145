process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  reconcileAddonInclusions,
} = require("../src/services/subscription/subscriptionSelectionService");
const {
  buildDayCommercialState,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");

function objectId(index) {
  return Number(index).toString(16).padStart(24, "0");
}

const PRODUCTS = {
  juiceA: objectId(101),
  juiceB: objectId(102),
  juiceC: objectId(103),
  snackA: objectId(201),
  snackB: objectId(202),
  premiumA: objectId(301),
};
const PLANS = {
  juice: objectId(901),
  snack: objectId(902),
  premium: objectId(903),
};
const PRODUCT_CATALOG = new Map([
  [PRODUCTS.juiceA, { addonCategory: "juice", priceHalala: 1000 }],
  [PRODUCTS.juiceB, { addonCategory: "juice", priceHalala: 1200 }],
  [PRODUCTS.juiceC, { addonCategory: "juice", priceHalala: 1400 }],
  [PRODUCTS.snackA, { addonCategory: "snack", priceHalala: 1500 }],
  [PRODUCTS.snackB, { addonCategory: "snack", priceHalala: 1700 }],
  [PRODUCTS.premiumA, { addonCategory: "premium_meal", priceHalala: 2500 }],
]);

async function resolveChoiceProductById(id) {
  const row = PRODUCT_CATALOG.get(String(id));
  if (!row) return null;
  return {
    addonCategory: row.addonCategory,
    product: {
      _id: String(id),
      name: { ar: String(id), en: String(id) },
      priceHalala: row.priceHalala,
      currency: "SAR",
    },
  };
}

function subscription(userKey, rows) {
  return {
    _id: objectId(4000 + userKey),
    userId: objectId(5000 + userKey),
    status: "active",
    addonSubscriptions: rows.map((row) => ({
      addonId: row.planId,
      addonPlanId: row.planId,
      category: row.category,
      menuProductIds: row.products,
    })),
    addonBalance: rows.map((row) => ({
      _id: objectId(Number.parseInt(row.planId.slice(-4), 16) + 2000),
      addonId: row.planId,
      addonPlanId: row.planId,
      category: row.category,
      includedTotalQty: row.total,
      remainingQty: row.remaining,
      consumedQty: row.total - row.remaining,
      reservedQty: 0,
    })),
  };
}

function commercialSummary(day, sub) {
  const state = buildDayCommercialState({
    status: "open",
    addonSelections: day.addonSelections,
  }, { subscription: sub });
  return {
    selectedCount: day.addonSelections.length,
    inclusiveCount: day.addonSelections.filter((row) => row.source === "subscription").length,
    pendingPaymentCount: day.addonSelections.filter((row) => row.source === "pending_payment").length,
    totalExtraHalala: state.paymentRequirement.amountHalala,
    requiresPayment: state.paymentRequirement.requiresPayment,
    blockingReason: state.paymentRequirement.blockingReason || null,
  };
}

async function validate(sub, requestedIds, existingSelections = []) {
  const day = { addonSelections: existingSelections.map((row) => ({ ...row })) };
  await reconcileAddonInclusions(sub, day, requestedIds, { resolveChoiceProductById });
  return { day, summary: commercialSummary(day, sub) };
}

function stableAllocationResult(result) {
  return {
    summary: result.summary,
    selections: result.day.addonSelections.map((row) => {
      const { consumedAt, ...stable } = row;
      return stable;
    }),
  };
}

async function run() {
  const users = [
    subscription(1, [{ category: "juice", planId: PLANS.juice, products: [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC], remaining: 7, total: 7 }]),
    subscription(2, [{ category: "juice", planId: PLANS.juice, products: [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC], remaining: 2, total: 14 }]),
    subscription(3, [{ category: "snack", planId: PLANS.snack, products: [PRODUCTS.snackA, PRODUCTS.snackB], remaining: 3, total: 14 }]),
    subscription(4, [
      { category: "juice", planId: PLANS.juice, products: [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC], remaining: 2, total: 14 },
      { category: "snack", planId: PLANS.snack, products: [PRODUCTS.snackA, PRODUCTS.snackB], remaining: 1, total: 14 },
    ]),
    subscription(5, [{ category: "premium_meal", planId: PLANS.premium, products: [PRODUCTS.premiumA], remaining: 0, total: 7 }]),
  ];
  const before = users.map((sub) => JSON.stringify(sub));
  const results = await Promise.all([
    validate(users[0], [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC]),
    validate(users[1], [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC]),
    validate(users[2], [PRODUCTS.snackA, PRODUCTS.snackB]),
    validate(users[3], [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.snackA, PRODUCTS.snackB]),
    validate(users[4], [PRODUCTS.premiumA]),
  ]);

  assert.deepStrictEqual(results[0].summary, {
    selectedCount: 3,
    inclusiveCount: 3,
    pendingPaymentCount: 0,
    totalExtraHalala: 0,
    requiresPayment: false,
    blockingReason: "PLANNING_INCOMPLETE",
  });
  assert.strictEqual(results[1].summary.inclusiveCount, 2);
  assert.strictEqual(results[1].summary.pendingPaymentCount, 1);
  assert.strictEqual(results[1].summary.totalExtraHalala, 1400);
  assert.strictEqual(results[1].summary.blockingReason, "ADDON_PAYMENT_REQUIRED");
  assert.strictEqual(results[2].summary.inclusiveCount, 2);
  assert.strictEqual(results[2].summary.pendingPaymentCount, 0);
  assert.strictEqual(results[3].summary.inclusiveCount, 3);
  assert.strictEqual(results[3].summary.pendingPaymentCount, 1);
  assert.strictEqual(results[3].summary.totalExtraHalala, 1700);
  assert.deepStrictEqual(
    results[3].day.addonSelections.map((row) => `${row.category}:${row.source}`),
    ["juice:subscription", "juice:subscription", "snack:subscription", "snack:pending_payment"]
  );
  assert.strictEqual(results[4].summary.inclusiveCount, 0);
  assert.strictEqual(results[4].summary.pendingPaymentCount, 1);
  assert.strictEqual(results[4].summary.totalExtraHalala, 2500);

  users.forEach((sub, index) => assert.strictEqual(JSON.stringify(sub), before[index]));
  const repeated = await validate(users[1], [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC]);
  assert.deepStrictEqual(stableAllocationResult(repeated), stableAllocationResult(results[1]));

  const editSub = subscription(6, [{
    category: "juice",
    planId: PLANS.juice,
    products: [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC],
    remaining: 1,
    total: 7,
  }]);
  const savedSelections = [PRODUCTS.juiceA, PRODUCTS.juiceB].map((addonId) => ({
    addonId,
    addonPlanId: PLANS.juice,
    category: "juice",
    source: "subscription",
    priceHalala: 0,
  }));
  const edited = await validate(editSub, [PRODUCTS.juiceA, PRODUCTS.juiceB, PRODUCTS.juiceC], savedSelections);
  assert.strictEqual(edited.summary.inclusiveCount, 3);
  assert.strictEqual(edited.summary.pendingPaymentCount, 0);
  assert.strictEqual(edited.summary.totalExtraHalala, 0);

  for (const result of results) {
    for (const row of result.day.addonSelections) {
      assert.strictEqual(typeof row.addonId, "string");
      assert.strictEqual(typeof row.addonPlanId, "string");
      assert.strictEqual(typeof row.category, "string");
      assert(["subscription", "pending_payment"].includes(row.source));
      assert(Number.isInteger(row.priceHalala) && row.priceHalala >= 0);
    }
    assert.strictEqual(typeof result.summary.selectedCount, "number");
    assert.strictEqual(typeof result.summary.inclusiveCount, "number");
    assert.strictEqual(typeof result.summary.pendingPaymentCount, "number");
    assert.strictEqual(typeof result.summary.totalExtraHalala, "number");
    assert.strictEqual(typeof result.summary.requiresPayment, "boolean");
  }
  console.log("multi-user add-on hard matrix tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
