"use strict";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../src/models/Plan");
const {
  TARGET_PLANS,
  assertPlanMatchesTarget,
  normalizeCommercialSubscriptionPricing,
} = require("../src/migrations/normalizeCommercialSubscriptionPricing");
const {
  resolvePlanCatalogEntry,
} = require("../src/utils/subscription/subscriptionCatalog");

let mongoServer;

function buildPlan(daysCount, definition, { historical = false } = {}) {
  const gramsOptions = Object.entries(definition.pricesHalala).map(([gramsKey, prices]) => ({
    grams: Number(gramsKey),
    isActive: true,
    sortOrder: Number(gramsKey),
    mealsOptions: prices.map((priceHalala, index) => ({
      mealsPerDay: index + 1,
      // Deliberately corrupted values. The migration must overwrite them.
      priceHalala: priceHalala + 111,
      compareAtHalala: priceHalala + 222,
      isActive: true,
      sortOrder: index + 1,
    })),
  }));

  const payload = {
    key: definition.key,
    name: {
      ar: `اشتراك ${daysCount}`,
      en: `${daysCount}-Day Subscription`,
    },
    daysCount,
    durationDays: daysCount,
    currency: "SAR",
    gramsOptions,
    active: true,
    available: true,
    isAvailable: true,
    isActive: true,
    isDeleted: false,
  };

  if (historical) {
    payload._id = new mongoose.Types.ObjectId(definition.historicalId);
  }

  return payload;
}

function expectedPrice(daysCount, grams, mealsPerDay) {
  return TARGET_PLANS[daysCount].pricesHalala[grams][mealsPerDay - 1];
}

async function assertFullCatalog() {
  const plans = await Plan.find({
    key: {
      $in: Object.values(TARGET_PLANS).map((definition) => definition.key),
    },
  }).lean();

  assert.strictEqual(plans.length, 3, "all 3 commercial plans must exist");

  for (const plan of plans) {
    const daysCount = Number(plan.daysCount);
    const definition = TARGET_PLANS[daysCount];
    assert.ok(definition, `unexpected commercial duration ${daysCount}`);
    assert.strictEqual(plan.key, definition.key);
    assert.strictEqual(plan.durationDays, daysCount);
    assertPlanMatchesTarget(plan, definition, daysCount);

    const catalog = resolvePlanCatalogEntry(plan, "en");
    assert.strictEqual(catalog.daysCount, daysCount);
    assert.strictEqual(catalog.timelineDays, daysCount + (daysCount === 7 ? 1 : daysCount === 26 ? 4 : 5));
    assert.deepStrictEqual(
      catalog.gramsOptions.map((option) => option.grams),
      [100, 150, 200],
      `${daysCount}-day catalog exposes all gram options`
    );

    for (const gramsOption of catalog.gramsOptions) {
      assert.deepStrictEqual(
        gramsOption.mealsOptions.map((option) => option.mealsPerDay),
        [1, 2, 3, 4, 5],
        `${daysCount}-day/${gramsOption.grams}g exposes all meal options`
      );

      for (const mealOption of gramsOption.mealsOptions) {
        assert.strictEqual(
          mealOption.priceHalala,
          expectedPrice(daysCount, gramsOption.grams, mealOption.mealsPerDay),
          `${daysCount}-day/${gramsOption.grams}g/${mealOption.mealsPerDay} price`
        );
        assert.strictEqual(mealOption.compareAtHalala, 0);
      }
    }
  }
}

async function run() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`commercial_subscription_pricing_${Date.now()}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    await Plan.create(
      buildPlan(7, TARGET_PLANS[7])
    );
    await Plan.create(
      buildPlan(26, TARGET_PLANS[26], { historical: true })
    );
    await Plan.create(
      buildPlan(30, TARGET_PLANS[30])
    );

    const first = await normalizeCommercialSubscriptionPricing();
    assert.strictEqual(first.status, "updated");
    assert.strictEqual(first.plans.length, 3);
    await assertFullCatalog();

    const second = await normalizeCommercialSubscriptionPricing();
    assert.strictEqual(second.status, "already_normalized");
    assert(second.plans.every((row) => row.status === "already_normalized"));
    await assertFullCatalog();

    await Plan.deleteOne({ key: TARGET_PLANS[30].key });
    await assert.rejects(
      () => normalizeCommercialSubscriptionPricing(),
      (error) => error && error.code === "COMMERCIAL_PRICING_PLAN_MISSING"
    );

    console.log("commercialSubscriptionPricingNormalization.test.js passed");
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => {});
  }
  if (mongoServer) {
    await mongoServer.stop().catch(() => {});
  }
  process.exit(1);
});
