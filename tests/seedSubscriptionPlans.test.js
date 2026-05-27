const assert = require("assert");
const mongoose = require("mongoose");

const Plan = require("../src/models/Plan");
const { resolvePlanCatalogEntry } = require("../src/utils/subscription/subscriptionCatalog");
const {
  EXPECTED_NESTED_PRICE_POINTS,
  EXPECTED_PLAN_COUNT,
  countNestedPricePoints,
  subscriptionPlanKeys,
  subscriptionPlanRows,
  wrongFlatPlanKeys,
} = require("../scripts/seed-subscription-plans");

function findMealOption(plan, grams, mealsPerDay) {
  const gramsOption = (plan.gramsOptions || []).find((option) => option.grams === grams);
  assert.ok(gramsOption, `missing ${grams}g option for ${plan.key}`);
  const mealOption = (gramsOption.mealsOptions || []).find((option) => option.mealsPerDay === mealsPerDay);
  assert.ok(mealOption, `missing ${mealsPerDay} meals/day option for ${plan.key}/${grams}g`);
  return mealOption;
}

function planForDuration(durationDays) {
  const plan = subscriptionPlanRows.find((row) => row.durationDays === durationDays);
  assert.ok(plan, `missing ${durationDays}-day plan`);
  return plan;
}

function assertPrice(durationDays, grams, mealsPerDay, expectedHalala) {
  const mealOption = findMealOption(planForDuration(durationDays), grams, mealsPerDay);
  assert.strictEqual(mealOption.priceHalala, expectedHalala);
}

function withId(plan) {
  return { ...plan, _id: new mongoose.Types.ObjectId() };
}

assert.strictEqual(subscriptionPlanRows.length, EXPECTED_PLAN_COUNT);
assert.deepStrictEqual(subscriptionPlanKeys, [
  "subscription_7_days",
  "subscription_26_days",
  "subscription_30_days",
]);
assert.strictEqual(countNestedPricePoints(), EXPECTED_NESTED_PRICE_POINTS);

for (const plan of subscriptionPlanRows) {
  assert.strictEqual(plan.gramsOptions.length, 3, `${plan.key} should have 3 gram options`);
  assert.deepStrictEqual(plan.gramsOptions.map((option) => option.grams), [100, 150, 200]);

  for (const gramsOption of plan.gramsOptions) {
    assert.strictEqual(gramsOption.mealsOptions.length, 3, `${plan.key}/${gramsOption.grams}g should have 3 meal options`);
    assert.deepStrictEqual(gramsOption.mealsOptions.map((option) => option.mealsPerDay), [1, 2, 3]);
  }
}

assertPrice(7, 100, 1, 11500);
assertPrice(7, 200, 3, 52500);
assertPrice(26, 200, 2, 118400);
assertPrice(30, 150, 3, 161900);
assertPrice(30, 200, 3, 189900);

const serializedPlans = subscriptionPlanRows.map((plan) => resolvePlanCatalogEntry(withId(plan), "en"));
assert.strictEqual(serializedPlans.length, 3);
for (const plan of serializedPlans) {
  assert.strictEqual(plan.gramsOptions.length, 3);
  assert.strictEqual(plan.weightOptions.length, 3);
  for (const gramsOption of plan.weightOptions) {
    assert.strictEqual(gramsOption.mealsOptions.length, 3);
    assert.strictEqual(gramsOption.mealOptions.length, 3);
  }
}

const wrongFlatPlans = wrongFlatPlanKeys.map((key) => ({
  _id: new mongoose.Types.ObjectId(),
  key,
  name: { ar: key, en: key },
  daysCount: 7,
  durationDays: 7,
  isActive: false,
  gramsOptions: [
    {
      grams: 100,
      mealsOptions: [{ mealsPerDay: 1, priceHalala: 1, compareAtHalala: 1 }],
    },
  ],
}));

const visibleCatalog = [...subscriptionPlanRows.map(withId), ...wrongFlatPlans]
  .filter((plan) => plan.isActive !== false && Plan.isViable(plan))
  .map((plan) => resolvePlanCatalogEntry(plan, "en"));

assert.strictEqual(visibleCatalog.length, 3);
assert.ok(!visibleCatalog.some((plan) => wrongFlatPlanKeys.includes(plan.key)));

console.log("seedSubscriptionPlans.test.js passed");
