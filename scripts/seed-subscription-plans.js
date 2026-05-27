#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const Plan = require("../src/models/Plan");

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
const SYSTEM_CURRENCY = "SAR";
const EXPECTED_PLAN_COUNT = 3;
const EXPECTED_NESTED_PRICE_POINTS = 27;

function name(ar, en = ar) {
  return { ar, en };
}

function createPlanKey(durationDays) {
  return `subscription_${durationDays}_days`;
}

function createFlatPlanKey(mealsPerDay, durationDays, grams) {
  return `subscription_${mealsPerDay}_meal_${durationDays}_days_${grams}g`;
}

const priceMatrixHalala = {
  7: {
    100: { 1: 11500, 2: 23000, 3: 34500 },
    150: { 1: 14500, 2: 29000, 3: 43500 },
    200: { 1: 17500, 2: 35000, 3: 52500 },
  },
  26: {
    100: { 1: 43000, 2: 77900, 3: 112900 },
    150: { 1: 54900, 2: 98800, 3: 144300 },
    200: { 1: 62500, 2: 118400, 3: 167700 },
  },
  30: {
    100: { 1: 48900, 2: 89900, 3: 125900 },
    150: { 1: 60000, 2: 110900, 3: 161900 },
    200: { 1: 69000, 2: 134900, 3: 189900 },
  },
};

function buildSkipPolicy(durationDays) {
  if (durationDays === 7) return { enabled: true, maxDays: 1 };
  if (durationDays === 26) return { enabled: true, maxDays: 3 };
  return { enabled: true, maxDays: 4 };
}

function buildFreezePolicy(durationDays) {
  if (durationDays === 7) return { enabled: true, maxDays: 7, maxTimes: 1 };
  if (durationDays === 26) return { enabled: true, maxDays: 14, maxTimes: 2 };
  return { enabled: true, maxDays: 21, maxTimes: 2 };
}

function buildSubscriptionPlanRows() {
  return Object.keys(priceMatrixHalala).map(Number).sort((a, b) => a - b).map((durationDays, durationIndex) => {
    const gramsOptions = Object.keys(priceMatrixHalala[durationDays]).map(Number).sort((a, b) => a - b).map((grams, gramsIndex) => ({
      grams,
      sortOrder: gramsIndex + 1,
      isActive: true,
      mealsOptions: Object.keys(priceMatrixHalala[durationDays][grams]).map(Number).sort((a, b) => a - b).map((mealsPerDay, mealIndex) => {
        const priceHalala = priceMatrixHalala[durationDays][grams][mealsPerDay];
        return {
          mealsPerDay,
          priceHalala,
          compareAtHalala: priceHalala,
          isActive: true,
          sortOrder: mealIndex + 1,
        };
      }),
    }));

    return {
      key: createPlanKey(durationDays),
      daysCount: durationDays,
      durationDays,
      sortOrder: durationIndex + 1,
      name: name(`اشتراك ${durationDays} ${durationDays === 7 ? "أيام" : "يوم"}`, `${durationDays}-Day Subscription`),
      description: name(
        `اشتراك لمدة ${durationDays} ${durationDays === 7 ? "أيام" : "يوم"} بخيارات 100 و150 و200 جرام.`,
        `${durationDays}-day subscription with 100g, 150g, and 200g portion options.`
      ),
      currency: SYSTEM_CURRENCY,
      skipPolicy: buildSkipPolicy(durationDays),
      freezePolicy: buildFreezePolicy(durationDays),
      gramsOptions,
      active: true,
      available: true,
      isAvailable: true,
      isActive: true,
    };
  });
}

const subscriptionPlanRows = buildSubscriptionPlanRows();
const subscriptionPlanKeys = subscriptionPlanRows.map((row) => row.key);
const wrongFlatPlanKeys = Object.keys(priceMatrixHalala).map(Number).flatMap((durationDays) => (
  Object.keys(priceMatrixHalala[durationDays]).map(Number).flatMap((grams) => (
    Object.keys(priceMatrixHalala[durationDays][grams]).map(Number).map((mealsPerDay) => (
      createFlatPlanKey(mealsPerDay, durationDays, grams)
    ))
  ))
));

function countNestedPricePoints(rows = subscriptionPlanRows) {
  return rows.reduce((total, row) => (
    total + (row.gramsOptions || []).reduce((gramsTotal, gramsOption) => (
      gramsTotal + (gramsOption.mealsOptions || []).length
    ), 0)
  ), 0);
}

function assertSubscriptionPlanRows() {
  if (subscriptionPlanRows.length !== EXPECTED_PLAN_COUNT) {
    throw new Error(`Expected ${EXPECTED_PLAN_COUNT} subscription plans, got ${subscriptionPlanRows.length}`);
  }

  const uniqueKeys = new Set(subscriptionPlanKeys);
  if (uniqueKeys.size !== EXPECTED_PLAN_COUNT) {
    throw new Error(`Expected ${EXPECTED_PLAN_COUNT} unique subscription plan keys, got ${uniqueKeys.size}`);
  }

  const nestedPricePoints = countNestedPricePoints();
  if (nestedPricePoints !== EXPECTED_NESTED_PRICE_POINTS) {
    throw new Error(`Expected ${EXPECTED_NESTED_PRICE_POINTS} nested price points, got ${nestedPricePoints}`);
  }

  for (const row of subscriptionPlanRows) {
    if ((row.gramsOptions || []).length !== 3) {
      throw new Error(`Expected 3 grams options for ${row.key}`);
    }

    for (const gramsOption of row.gramsOptions) {
      if ((gramsOption.mealsOptions || []).length !== 3) {
        throw new Error(`Expected 3 meals options for ${row.key}/${gramsOption.grams}g`);
      }

      for (const mealOption of gramsOption.mealsOptions) {
        const expectedPrice = priceMatrixHalala[row.durationDays]?.[gramsOption.grams]?.[mealOption.mealsPerDay];
        if (mealOption.priceHalala !== expectedPrice) {
          throw new Error(`Invalid price for ${row.key}/${gramsOption.grams}g/${mealOption.mealsPerDay} meals: expected ${expectedPrice}, got ${mealOption.priceHalala}`);
        }
      }
    }
  }
}

async function deactivateWrongFlatPlans({ log = console } = {}) {
  const result = await Plan.updateMany(
    { key: { $in: wrongFlatPlanKeys } },
    {
      $set: {
        active: false,
        isActive: false,
        available: false,
        isAvailable: false,
      },
    },
    { runValidators: true }
  );

  const matched = Number(result.matchedCount || result.n || 0);
  const modified = Number(result.modifiedCount || result.nModified || 0);
  log.log(`Wrong flat subscription plans matched for deactivation: ${matched}`);
  log.log(`Wrong flat subscription plans deactivated: ${modified}`);
  return { matched, modified };
}

async function seedSubscriptionPlans({ cleanupFlatPlans = true, log = console } = {}) {
  assertSubscriptionPlanRows();

  let created = 0;
  let updated = 0;

  for (const row of subscriptionPlanRows) {
    const existing = await Plan.findOne({ key: row.key }).select("_id").lean();
    await Plan.updateOne(
      { key: row.key },
      {
        $set: row,
        $unset: {
          mealSizeGrams: "",
          mealsPerDay: "",
        },
      },
      { upsert: true, runValidators: true }
    );

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  let cleanup = { matched: 0, modified: 0 };
  if (cleanupFlatPlans) {
    cleanup = await deactivateWrongFlatPlans({ log });
  } else {
    log.log("Wrong flat subscription plans cleanup skipped.");
  }

  const foundCount = await Plan.countDocuments({ key: { $in: subscriptionPlanKeys }, isActive: true });
  const samplePlan = await Plan.findOne({ key: subscriptionPlanKeys[0] }).lean();

  log.log(`Subscription top-level plans created: ${created}`);
  log.log(`Subscription top-level plans updated: ${updated}`);
  log.log(`Expected active seeded subscription plan count: ${EXPECTED_PLAN_COUNT}`);
  log.log(`Found active seeded subscription plan count: ${foundCount}`);
  log.log(`Expected nested subscription price points: ${EXPECTED_NESTED_PRICE_POINTS}`);

  if (foundCount !== EXPECTED_PLAN_COUNT) {
    throw new Error(`Seeded subscription plan count mismatch: expected ${EXPECTED_PLAN_COUNT}, found ${foundCount}`);
  }

  return {
    expectedCount: EXPECTED_PLAN_COUNT,
    expectedNestedPricePoints: EXPECTED_NESTED_PRICE_POINTS,
    foundCount,
    nestedPricePoints: countNestedPricePoints(subscriptionPlanRows),
    created,
    updated,
    cleanup,
    keys: subscriptionPlanKeys,
    samplePlan,
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    cleanupFlatPlans: !argv.includes("--skip-flat-plan-cleanup"),
  };
}

async function main() {
  if (!uri) throw new Error("MONGO_URI or MONGODB_URI is required");
  const args = parseArgs();

  await mongoose.connect(uri);
  console.log("Connected to MongoDB for subscription plans seeding.");

  try {
    const result = await seedSubscriptionPlans({ cleanupFlatPlans: args.cleanupFlatPlans });
    const sampleGramsOption = result.samplePlan.gramsOptions[0];
    const sampleMealOption = sampleGramsOption.mealsOptions[0];
    console.log("Sample seeded plan:", {
      key: result.samplePlan.key,
      daysCount: result.samplePlan.daysCount,
      durationDays: result.samplePlan.durationDays,
      grams: sampleGramsOption.grams,
      mealsPerDay: sampleMealOption.mealsPerDay,
      priceHalala: sampleMealOption.priceHalala,
    });
    console.log("Subscription plans seed complete.");
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_NESTED_PRICE_POINTS,
  EXPECTED_PLAN_COUNT,
  countNestedPricePoints,
  createFlatPlanKey,
  createPlanKey,
  deactivateWrongFlatPlans,
  priceMatrixHalala,
  seedSubscriptionPlans,
  subscriptionPlanKeys,
  subscriptionPlanRows,
  wrongFlatPlanKeys,
};
