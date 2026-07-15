process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");

const {
  assertSubscriptionPlanRows,
  buildSubscriptionPlanRows,
  countNestedPricePoints,
  parseArgs,
} = require("../scripts/bootstrap/seed-subscription-plans");
const {
  BOOTSTRAP_KEY,
  isBootstrapOwned,
} = require("../scripts/bootstrap/seed-meal-builder");

function testPlansAcceptDynamicCounts() {
  const customMatrix = {
    5: {
      120: { 1: 1000 },
    },
    14: {
      150: { 2: 2500, 4: 4500 },
      250: { 3: 5000 },
    },
    45: {
      300: { 1: 7000, 2: 12000, 6: 30000 },
    },
    60: {
      400: { 2: 40000 },
    },
  };

  const rows = buildSubscriptionPlanRows(customMatrix);
  const result = assertSubscriptionPlanRows(rows);

  assert.strictEqual(rows.length, 4, "arbitrary initial plan count is accepted");
  assert.strictEqual(result.planCount, 4);
  assert.strictEqual(result.nestedPricePoints, 8, "arbitrary nested price-point count is derived from data");
  assert.strictEqual(countNestedPricePoints(rows), 8);
}

function testPlanValidationIsStructural() {
  const validRows = buildSubscriptionPlanRows({
    10: {
      175: { 2: 12345 },
    },
  });
  assert.doesNotThrow(() => assertSubscriptionPlanRows(validRows));

  const duplicateMeals = JSON.parse(JSON.stringify(validRows));
  duplicateMeals[0].gramsOptions[0].mealsOptions.push({
    ...duplicateMeals[0].gramsOptions[0].mealsOptions[0],
  });
  assert.throws(
    () => assertSubscriptionPlanRows(duplicateMeals),
    /duplicate mealsPerDay/,
    "invalid structure still fails without enforcing a fixed count"
  );
}

function testCleanupRequiresExplicitOptIn() {
  const previous = process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
  delete process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
  try {
    assert.deepStrictEqual(parseArgs(["--sync"]), { sync: true, cleanupFlatPlans: false });
    assert.throws(
      () => parseArgs(["--cleanup-legacy-plans"]),
      /ALLOW_BOOTSTRAP_PLAN_CLEANUP/,
      "sync must not silently deactivate plans"
    );
  } finally {
    if (previous === undefined) delete process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP;
    else process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP = previous;
  }
}

function testMealBuilderOwnershipProtection() {
  assert.strictEqual(isBootstrapOwned({
    source: "bootstrap",
    createdBySystem: true,
    bootstrapKey: BOOTSTRAP_KEY,
  }), true);

  assert.strictEqual(isBootstrapOwned({
    source: "dashboard",
    createdBySystem: false,
    bootstrapKey: BOOTSTRAP_KEY,
  }), false, "dashboard-owned config must be protected from bootstrap sync");

  assert.strictEqual(isBootstrapOwned({
    source: "bootstrap",
    createdBySystem: true,
    bootstrapKey: "another_seed",
  }), false, "a different bootstrap owner must not be overwritten");
}

function run() {
  testPlansAcceptDynamicCounts();
  testPlanValidationIsStructural();
  testCleanupRequiresExplicitOptIn();
  testMealBuilderOwnershipProtection();
  console.log("✅ bootstrap initial-data semantics tests passed");
}

run();