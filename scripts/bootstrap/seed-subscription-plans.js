#!/usr/bin/env node

require("dotenv").config();
const mongoose = require("mongoose");

const Plan = require("../../src/models/Plan");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

const SYSTEM_CURRENCY = "SAR";

function name(ar, en = ar) {
  return { ar, en };
}

function createPlanKey(durationDays) {
  return `subscription_${durationDays}_days`;
}

function createFlatPlanKey(mealsPerDay, durationDays, grams) {
  return `subscription_${mealsPerDay}_meal_${durationDays}_days_${grams}g`;
}

/**
 * Initial/demo commercial data only.
 *
 * This matrix is not a business-rule whitelist. Add, remove, or change plans,
 * gram sizes, meal counts, and prices without changing seeder logic.
 */
const priceMatrixHalala = {
  7: {
    100: { 1: 13800, 2: 27600, 3: 41400, 4: 55200, 5: 69000 },
    150: { 1: 17400, 2: 34800, 3: 52200, 4: 69600, 5: 87000 },
    200: { 1: 21000, 2: 42000, 3: 63000, 4: 84000, 5: 105000 },
  },
  26: {
    100: { 1: 51600, 2: 93500, 3: 135500, 4: 180600, 5: 225700 },
    150: { 1: 65900, 2: 118600, 3: 173200, 4: 230900, 5: 288600 },
    200: { 1: 75000, 2: 142100, 3: 201200, 4: 268300, 5: 335400 },
  },
  30: {
    100: { 1: 58700, 2: 107900, 3: 151100, 4: 201400, 5: 251800 },
    150: { 1: 72000, 2: 133100, 3: 194300, 4: 259000, 5: 323800 },
    200: { 1: 82800, 2: 161900, 3: 227900, 4: 303800, 5: 379800 },
  },
};

const timelineExtraDaysByDuration = Object.freeze({
  7: 1,
  26: 4,
  30: 5,
});

function buildSkipPolicy(durationDays) {
  if (durationDays <= 7) return { enabled: true, maxDays: 1 };
  if (durationDays <= 26) return { enabled: true, maxDays: 3 };
  return { enabled: true, maxDays: 4 };
}

function buildFreezePolicy(durationDays) {
  if (durationDays <= 7) return { enabled: true, maxDays: 7, maxTimes: 1 };
  if (durationDays <= 26) return { enabled: true, maxDays: 14, maxTimes: 2 };
  return { enabled: true, maxDays: 21, maxTimes: 2 };
}

function buildSubscriptionPlanRows(matrix = priceMatrixHalala) {
  return Object.keys(matrix).map(Number).sort((a, b) => a - b).map((durationDays, durationIndex) => {
    const gramValues = Object.keys(matrix[durationDays]).map(Number).sort((a, b) => a - b);
    const gramsOptions = gramValues.map((grams, gramsIndex) => ({
      grams,
      sortOrder: gramsIndex + 1,
      isActive: true,
      mealsOptions: Object.keys(matrix[durationDays][grams]).map(Number).sort((a, b) => a - b).map((mealsPerDay, mealIndex) => {
        const priceHalala = matrix[durationDays][grams][mealsPerDay];
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
      timelineExtraDays: timelineExtraDaysByDuration[durationDays] || 0,
      durationDays,
      sortOrder: durationIndex + 1,
      name: name(`إشتراك وجبات لمدة ${durationDays} أيام`, `${durationDays}-Day Meal Subscription`),
      description: name(
        `بيانات بداية لاشتراك لمدة ${durationDays} ${durationDays === 7 ? "أيام" : "يوم"}.`,
        `Initial ${durationDays}-day subscription data.`
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

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${path} must be a positive integer`);
}

function assertSubscriptionPlanRows(rows = subscriptionPlanRows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("At least one initial subscription plan row is required");

  const planKeys = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new Error("Each subscription plan must be an object");
    if (!row.key || planKeys.has(row.key)) throw new Error(`Subscription plan key must be unique: ${row.key || "<missing>"}`);
    planKeys.add(row.key);
    assertPositiveInteger(Number(row.daysCount), `${row.key}.daysCount`);
    assertPositiveInteger(Number(row.durationDays), `${row.key}.durationDays`);

    if (!Array.isArray(row.gramsOptions) || row.gramsOptions.length === 0) {
      throw new Error(`${row.key}.gramsOptions must contain at least one initial option`);
    }

    const gramsSeen = new Set();
    let viablePaths = 0;
    for (const gramsOption of row.gramsOptions) {
      assertPositiveInteger(Number(gramsOption.grams), `${row.key}.grams`);
      if (gramsSeen.has(Number(gramsOption.grams))) throw new Error(`${row.key} contains duplicate grams ${gramsOption.grams}`);
      gramsSeen.add(Number(gramsOption.grams));

      if (!Array.isArray(gramsOption.mealsOptions) || gramsOption.mealsOptions.length === 0) {
        throw new Error(`${row.key}/${gramsOption.grams}g must contain at least one meals option`);
      }

      const mealsSeen = new Set();
      for (const mealOption of gramsOption.mealsOptions) {
        assertPositiveInteger(Number(mealOption.mealsPerDay), `${row.key}/${gramsOption.grams}g.mealsPerDay`);
        if (mealsSeen.has(Number(mealOption.mealsPerDay))) {
          throw new Error(`${row.key}/${gramsOption.grams}g contains duplicate mealsPerDay ${mealOption.mealsPerDay}`);
        }
        mealsSeen.add(Number(mealOption.mealsPerDay));
        if (!Number.isInteger(mealOption.priceHalala) || mealOption.priceHalala < 0) {
          throw new Error(`${row.key}/${gramsOption.grams}g/${mealOption.mealsPerDay} priceHalala must be an integer >= 0`);
        }
        if (gramsOption.isActive !== false && mealOption.isActive !== false) viablePaths += 1;
      }
    }

    if (row.isActive !== false && viablePaths === 0) throw new Error(`${row.key} is active but has no active sellable path`);
  }

  return { planCount: rows.length, nestedPricePoints: countNestedPricePoints(rows) };
}

async function deactivateWrongFlatPlans({ log = console } = {}) {
  const result = await Plan.updateMany(
    { key: { $in: wrongFlatPlanKeys } },
    { $set: { active: false, isActive: false, available: false, isAvailable: false } },
    { runValidators: true }
  );
  const matched = Number(result.matchedCount || result.n || 0);
  const modified = Number(result.modifiedCount || result.nModified || 0);
  log.log(`Legacy flat subscription plans matched for deactivation: ${matched}`);
  log.log(`Legacy flat subscription plans deactivated: ${modified}`);
  return { matched, modified };
}

async function deactivatePollutedCustomerPlans({ log = console } = {}) {
  const pollutionQuery = {
    $and: [
      {
        $or: [
          { key: /^dash-contract-/ },
          { key: /^postman-home-delivery-cycle-/ },
          { key: /^test-/ },
          { key: null, $or: [{ "name.en": /test|dev|dash-contract|postman|empty/i }, { "name.ar": /test|dev|dash-contract|postman|empty/i }] },
        ],
      },
      { isActive: true },
      { key: { $nin: subscriptionPlanKeys } },
    ],
  };
  const result = await Plan.updateMany(
    pollutionQuery,
    { $set: { active: false, isActive: false, available: false, isAvailable: false } },
    { runValidators: true }
  );
  const matched = Number(result.matchedCount || result.n || 0);
  const modified = Number(result.modifiedCount || result.nModified || 0);
  if (matched > 0) {
    log.log(`Explicit QA/test subscription plans matched for deactivation: ${matched}`);
    log.log(`Explicit QA/test subscription plans deactivated: ${modified}`);
  }
  return { matched, modified };
}

async function seedSubscriptionPlans({ cleanupFlatPlans = false, sync = false, log = console } = {}) {
  const seedShape = assertSubscriptionPlanRows();
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const row of subscriptionPlanRows) {
    const existing = await Plan.findOne({ key: row.key });
    if (existing) {
      skipped += 1;
      if (sync) {
        await Plan.updateOne(
          { key: row.key },
          { $set: row, $unset: { mealSizeGrams: "", mealsPerDay: "" } },
          { runValidators: true }
        );
        updated += 1;
      }
    } else {
      await Plan.create(row);
      created += 1;
    }
  }

  let cleanup = { matched: 0, modified: 0 };
  if (cleanupFlatPlans) {
    cleanup = await deactivateWrongFlatPlans({ log });
    const pollutedCleanup = await deactivatePollutedCustomerPlans({ log });
    cleanup.matched += pollutedCleanup.matched;
    cleanup.modified += pollutedCleanup.modified;
  } else {
    log.log("Legacy/test plan cleanup skipped. Initial seed data is non-authoritative.");
  }

  const foundCount = await Plan.countDocuments({ key: { $in: subscriptionPlanKeys } });
  const activeCount = await Plan.countDocuments({ key: { $in: subscriptionPlanKeys }, isActive: true });
  const samplePlan = subscriptionPlanKeys.length ? await Plan.findOne({ key: subscriptionPlanKeys[0] }).lean() : null;

  log.log(`Subscription plans mode: ${sync ? "sync-initial-rows" : "create-missing-only"}`);
  log.log(`Initial subscription plans declared: ${seedShape.planCount}`);
  log.log(`Initial nested price points declared: ${seedShape.nestedPricePoints}`);
  log.log(`Subscription top-level plans created: ${created}`);
  log.log(`Subscription top-level plans skipped existing: ${skipped}`);
  log.log(`Subscription top-level plans updated: ${updated}`);
  log.log(`Seeded plan keys currently found: ${foundCount}`);
  log.log(`Seeded plan keys currently active: ${activeCount}`);
  log.log("Additional dashboard-created plans are allowed and are not treated as errors.");

  if (foundCount !== seedShape.planCount) {
    throw new Error(`Initial seeded plan key mismatch: declared ${seedShape.planCount}, found ${foundCount}`);
  }

  return {
    declaredCount: seedShape.planCount,
    declaredNestedPricePoints: seedShape.nestedPricePoints,
    foundCount,
    activeCount,
    nestedPricePoints: seedShape.nestedPricePoints,
    created,
    skipped,
    updated,
    cleanup,
    keys: subscriptionPlanKeys,
    samplePlan,
  };
}

function isTruthy(value) {
  return ["1", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseArgs(argv = process.argv.slice(2)) {
  const sync = argv.includes("--sync") || isTruthy(process.env.BOOTSTRAP_SYNC);
  const cleanupRequested = argv.includes("--cleanup-legacy-plans");
  const cleanupAllowed = isTruthy(process.env.ALLOW_BOOTSTRAP_PLAN_CLEANUP);
  if (cleanupRequested && !cleanupAllowed) {
    throw new Error("Refusing plan cleanup. Set ALLOW_BOOTSTRAP_PLAN_CLEANUP=true with --cleanup-legacy-plans.");
  }
  return { sync, cleanupFlatPlans: cleanupRequested && cleanupAllowed };
}

async function main() {
  const uri = resolveMongoUri();
  const args = parseArgs();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB for subscription plans seeding.");
  try {
    const result = await seedSubscriptionPlans({ cleanupFlatPlans: args.cleanupFlatPlans, sync: args.sync });
    const sampleGramsOption = result.samplePlan?.gramsOptions?.[0];
    const sampleMealOption = sampleGramsOption?.mealsOptions?.[0];
    console.log("Sample seeded plan:", {
      key: result.samplePlan?.key,
      daysCount: result.samplePlan?.daysCount,
      durationDays: result.samplePlan?.durationDays,
      grams: sampleGramsOption?.grams,
      mealsPerDay: sampleMealOption?.mealsPerDay,
      priceHalala: sampleMealOption?.priceHalala,
    });
    console.log("Subscription plans seed complete.");
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  assertSubscriptionPlanRows,
  buildSubscriptionPlanRows,
  countNestedPricePoints,
  createFlatPlanKey,
  createPlanKey,
  deactivatePollutedCustomerPlans,
  deactivateWrongFlatPlans,
  main,
  parseArgs,
  priceMatrixHalala,
  seedSubscriptionPlans,
  subscriptionPlanKeys,
  subscriptionPlanRows,
  wrongFlatPlanKeys,
};
