process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { backfillTestWeightPricing } = require("../scripts/backfill-test-weight-pricing");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");

const silentLog = { log() {} };

function productPayload(categoryId, key, overrides = {}) {
  return {
    categoryId,
    key,
    name: { en: key, ar: key },
    itemType: "product",
    pricingModel: "fixed",
    priceHalala: 900,
    isActive: true,
    ...overrides,
  };
}

async function main() {
  const dbName = `test_weight_pricing_backfill_${Date.now()}`;
  const mongo = await MongoMemoryServer.create({ instance: { dbName } });

  try {
    await mongoose.connect(mongo.getUri(dbName));
    const [meals, drinks, sandwiches] = await MenuCategory.create([
      { key: `meals_${Date.now()}`, name: { en: "Meals", ar: "وجبات" } },
      { key: `drinks_${Date.now()}`, name: { en: "Drinks", ar: "مشروبات" } },
      { key: `sandwiches_${Date.now()}`, name: { en: "Sandwiches", ar: "ساندويتشات" } },
    ]);
    meals.key = "meals";
    await meals.save();

    await MenuProduct.create([
      productPayload(meals._id, `ready_meal_${Date.now()}`, { maxWeightGrams: 300 }),
      productPayload(meals._id, `builder_meal_${Date.now()}`, { itemType: "basic_meal" }),
      productPayload(sandwiches._id, `weighted_sandwich_${Date.now()}`, {
        itemType: "cold_sandwich",
        pricingModel: "per_100g",
      }),
      productPayload(sandwiches._id, `fixed_sandwich_${Date.now()}`, { itemType: "cold_sandwich" }),
      productPayload(drinks._id, `drink_${Date.now()}`, { itemType: "drink" }),
      productPayload(meals._id, `inactive_meal_${Date.now()}`, { isActive: false }),
    ]);

    const first = await backfillTestWeightPricing({ log: silentLog });
    assert.deepStrictEqual(
      { inspected: first.inspected, updated: first.updated, skipped: first.skipped, unchanged: first.unchanged },
      { inspected: 5, updated: 3, skipped: 2, unchanged: 0 }
    );
    assert.strictEqual(first.skippedProducts.length, 2);
    assert(first.skippedProducts.every((product) => product.key && product.reason));

    const products = await MenuProduct.find({}).lean();
    const readyMeal = products.find((product) => product.key.startsWith("ready_meal_"));
    const builderMeal = products.find((product) => product.key.startsWith("builder_meal_"));
    const fixedSandwich = products.find((product) => product.key.startsWith("fixed_sandwich_"));
    const drink = products.find((product) => product.key.startsWith("drink_"));
    const inactiveMeal = products.find((product) => product.key.startsWith("inactive_meal_"));

    for (const product of [readyMeal, builderMeal]) {
      assert.strictEqual(product.pricingModel, "per_100g");
      assert.strictEqual(product.priceHalala, 1900);
      assert.strictEqual(product.baseUnitGrams, 100);
      assert.strictEqual(product.defaultWeightGrams, 100);
      assert.strictEqual(product.minWeightGrams, 100);
      assert.strictEqual(product.weightStepGrams, 100);
      assert.strictEqual(product.weightStepPriceHalala, 500);
    }
    assert.strictEqual(readyMeal.maxWeightGrams, 300, "compatible maximum is preserved");
    assert.strictEqual(builderMeal.maxWeightGrams, 500, "missing maximum receives the test default");
    assert.strictEqual(fixedSandwich.priceHalala, 900);
    assert.strictEqual(drink.priceHalala, 900);
    assert.strictEqual(inactiveMeal.priceHalala, 900);

    const second = await backfillTestWeightPricing({ log: silentLog });
    assert.deepStrictEqual(
      { inspected: second.inspected, updated: second.updated, skipped: second.skipped, unchanged: second.unchanged },
      { inspected: 5, updated: 0, skipped: 2, unchanged: 3 }
    );

    console.log("✅ test weight-pricing backfill eligibility and idempotency");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
