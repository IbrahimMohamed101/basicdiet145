const assert = require("assert");

const {
  assertValidWeightPricingConfiguration,
  buildWeightPricingDescriptor,
  buildWeightPricingSnapshot,
  computeProductBasePrice,
  resolveWeightGrams,
} = require("../src/services/orders/weightPricingService");

const results = { passed: 0, failed: 0 };

function test(name, fn) {
  try {
    fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

const product = {
  pricingModel: "per_100g",
  priceHalala: 1900,
  baseUnitGrams: 100,
  defaultWeightGrams: 100,
  minWeightGrams: 100,
  maxWeightGrams: 250,
  weightStepGrams: 50,
  weightStepPriceHalala: 500,
};

test("accepts a valid base-plus-step configuration", () => {
  assert.strictEqual(assertValidWeightPricingConfiguration(product), product);
});

test("calculates 100g at the base price", () => {
  assert.strictEqual(computeProductBasePrice(product, 100), 1900);
});

test("calculates 150g as one paid step", () => {
  assert.strictEqual(computeProductBasePrice(product, 150), 2400);
});

test("calculates 200g as two paid steps", () => {
  assert.strictEqual(computeProductBasePrice(product, 200), 2900);
});

test("calculates 250g as three paid steps", () => {
  assert.strictEqual(computeProductBasePrice(product, 250), 3400);
});

test("publishes canonical choices for Flutter", () => {
  const descriptor = buildWeightPricingDescriptor(product);
  assert.strictEqual(descriptor.contractVersion, "weight_pricing.v1");
  assert.strictEqual(descriptor.strategy, "base_plus_steps");
  assert.strictEqual(descriptor.requiresWeightSelection, true);
  assert.deepStrictEqual(descriptor.choices, [
    { weightGrams: 100, priceHalala: 1900 },
    { weightGrams: 150, priceHalala: 2400 },
    { weightGrams: 200, priceHalala: 2900 },
    { weightGrams: 250, priceHalala: 3400 },
  ]);
  assert.strictEqual(descriptor.choices.length, 4);
  assert(!descriptor.choices.some((choice) => choice.weightGrams === 300));
});

test("validates steps and configured bounds", () => {
  assert.strictEqual(resolveWeightGrams({ weightGrams: 150 }, product), 150);
  assert.throws(
    () => resolveWeightGrams({ weightGrams: 125 }, product),
    (err) => err && err.code === "INVALID_WEIGHT_GRAMS"
  );
  assert.throws(
    () => resolveWeightGrams({ weightGrams: 50 }, product),
    (err) => err && err.code === "INVALID_WEIGHT_GRAMS"
  );
  assert.throws(
    () => resolveWeightGrams({ weightGrams: 175 }, product),
    (err) => err && err.code === "INVALID_WEIGHT_GRAMS"
  );
  assert.throws(
    () => resolveWeightGrams({ weightGrams: 300 }, product),
    (err) => err && err.code === "INVALID_WEIGHT_GRAMS"
  );
});

test("rejects a range that does not divide evenly by the step", () => {
  assert.throws(
    () => assertValidWeightPricingConfiguration({ ...product, maxWeightGrams: 275 }),
    (err) => err && err.code === "INVALID_WEIGHT_PRICING_CONFIGURATION"
  );
});

test("rejects a minimum that differs from the base price weight", () => {
  assert.throws(
    () => assertValidWeightPricingConfiguration({ ...product, minWeightGrams: 150 }),
    (err) => err && err.code === "INVALID_WEIGHT_PRICING_CONFIGURATION"
  );
});

test("keeps legacy per-unit pricing for unmigrated products", () => {
  const legacy = { ...product };
  delete legacy.weightStepPriceHalala;
  assert.strictEqual(computeProductBasePrice(legacy, 150), 3800);
  assert.strictEqual(buildWeightPricingDescriptor(legacy).strategy, "legacy_per_unit");
});

test("stores an auditable pricing snapshot", () => {
  assert.deepStrictEqual(buildWeightPricingSnapshot(product, 250, 3400), {
    contractVersion: "weight_pricing.v1",
    strategy: "base_plus_steps",
    selectedWeightGrams: 250,
    baseWeightGrams: 100,
    basePriceHalala: 1900,
    stepGrams: 50,
    stepPriceHalala: 500,
    stepCount: 3,
    calculatedPriceHalala: 3400,
  });
});

if (results.failed > 0) {
  console.error(`\n${results.failed} weight pricing test(s) failed`);
  process.exit(1);
}

console.log(`\n${results.passed}/${results.passed} weight pricing tests passed`);
