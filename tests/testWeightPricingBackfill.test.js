process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { backfillTestWeightPricing } = require("../scripts/backfill-test-weight-pricing");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");

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
    const [meals, drinks, sandwiches, customOrder] = await MenuCategory.create([
      { key: `meals_${Date.now()}`, name: { en: "Meals", ar: "وجبات" } },
      { key: `drinks_${Date.now()}`, name: { en: "Drinks", ar: "مشروبات" } },
      { key: `sandwiches_${Date.now()}`, name: { en: "Sandwiches", ar: "ساندويتشات" } },
      { key: "custom_order", name: { en: "Custom Order", ar: "اطلب" } },
    ]);
    meals.key = "meals";
    await meals.save();

    const createdProducts = await MenuProduct.create([
      productPayload(meals._id, `ready_meal_${Date.now()}`, { maxWeightGrams: 300 }),
      productPayload(meals._id, `builder_meal_${Date.now()}`, { itemType: "basic_meal" }),
      productPayload(sandwiches._id, `weighted_sandwich_${Date.now()}`, {
        itemType: "cold_sandwich",
        pricingModel: "per_100g",
      }),
      productPayload(sandwiches._id, `fixed_sandwich_${Date.now()}`, { itemType: "cold_sandwich" }),
      productPayload(drinks._id, `drink_${Date.now()}`, { itemType: "drink" }),
      productPayload(meals._id, `inactive_meal_${Date.now()}`, { isActive: false }),
      productPayload(customOrder._id, `legacy_builder_meal_${Date.now()}`),
    ]);
    const carbsGroup = await MenuOptionGroup.create({
      key: `carbs_${Date.now()}`,
      name: { en: "Carbs", ar: "كارب" },
    });
    carbsGroup.key = "carbs";
    await carbsGroup.save();
    await ProductOptionGroup.create({
      productId: createdProducts[6]._id,
      groupId: carbsGroup._id,
      minSelections: 1,
      maxSelections: 2,
    });

    const first = await backfillTestWeightPricing({ log: silentLog });
    assert.deepStrictEqual(
      { inspected: first.inspected, updated: first.updated, skipped: first.skipped, unchanged: first.unchanged },
      { inspected: 6, updated: 4, skipped: 2, unchanged: 0 }
    );
    assert.strictEqual(first.skippedProducts.length, 2);
    assert(first.skippedProducts.every((product) => product.key && product.reason));

    const products = await MenuProduct.find({}).lean();
    const readyMeal = products.find((product) => product.key.startsWith("ready_meal_"));
    const builderMeal = products.find((product) => product.key.startsWith("builder_meal_"));
    const weightedSandwich = products.find((product) => product.key.startsWith("weighted_sandwich_"));
    const fixedSandwich = products.find((product) => product.key.startsWith("fixed_sandwich_"));
    const drink = products.find((product) => product.key.startsWith("drink_"));
    const inactiveMeal = products.find((product) => product.key.startsWith("inactive_meal_"));
    const legacyBuilderMeal = products.find((product) => product.key.startsWith("legacy_builder_meal_"));

    for (const product of [readyMeal, builderMeal, weightedSandwich, legacyBuilderMeal]) {
      assert.strictEqual(product.pricingModel, "per_100g");
      assert.strictEqual(product.priceHalala, 1900);
      assert.strictEqual(product.baseUnitGrams, 100);
      assert.strictEqual(product.defaultWeightGrams, 100);
      assert.strictEqual(product.minWeightGrams, 100);
      assert.strictEqual(product.maxWeightGrams, 250);
      assert.strictEqual(product.weightStepGrams, 50);
      assert.strictEqual(product.weightStepPriceHalala, 500);
    }
    assert.strictEqual(fixedSandwich.priceHalala, 900);
    assert.strictEqual(drink.priceHalala, 900);
    assert.strictEqual(inactiveMeal.priceHalala, 900);

    const second = await backfillTestWeightPricing({ log: silentLog });
    assert.deepStrictEqual(
      { inspected: second.inspected, updated: second.updated, skipped: second.skipped, unchanged: second.unchanged },
      { inspected: 6, updated: 0, skipped: 2, unchanged: 4 }
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
