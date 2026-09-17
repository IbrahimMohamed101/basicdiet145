const assert = require("assert");
const mongoose = require("mongoose");

const Plan = require("../src/models/Plan");
const { resolvePlanCatalogEntry } = require("../src/utils/subscription/subscriptionCatalog");
const {
  assertSubscriptionPlanRows,
  countNestedPricePoints,
  subscriptionPlanKeys,
  subscriptionPlanRows,
  wrongFlatPlanKeys,
} = require("../scripts/bootstrap/seed-subscription-plans");

function findMealOption(plan, grams, mealsPerDay) {
  const gramsOption = (plan.gramsOptions || []).find((option) => option.grams === grams);
  assert.ok(gramsOption, `missing ${grams}g option for ${plan.key}`);
  const mealOption = (gramsOption.mealsOptions || []).find((option) => option.mealsPerDay === mealsPerDay);
  assert.ok(mealOption, `missing ${mealsPerDay} meals/day option for ${plan.key}/${grams}g`);
  return mealOption;
}

function planForDuration(durationDays) {
  const plan = subscriptionPlanRows.find((row) => row.durationDays === durationDays);
  assert.ok(plan, `missing initial ${durationDays}-day demo plan`);
  return plan;
}

function assertPrice(durationDays, grams, mealsPerDay, expectedHalala) {
  const mealOption = findMealOption(planForDuration(durationDays), grams, mealsPerDay);
  assert.strictEqual(mealOption.priceHalala, expectedHalala);
}

function withId(plan) {
  return { ...plan, _id: new mongoose.Types.ObjectId() };
}

const shape = assertSubscriptionPlanRows(subscriptionPlanRows);
assert.strictEqual(shape.planCount, subscriptionPlanRows.length);
assert.strictEqual(shape.nestedPricePoints, countNestedPricePoints());
assert.strictEqual(new Set(subscriptionPlanKeys).size, subscriptionPlanKeys.length);
assert.ok(subscriptionPlanRows.length > 0, "initial plan data is not empty");
assert.deepStrictEqual(
  subscriptionPlanRows.map((row) => [row.daysCount, row.timelineExtraDays]),
  [[7, 1], [26, 4], [30, 5]],
  "canonical plans must declare timeline-only extra days"
);

for (const plan of subscriptionPlanRows) {
  assert.ok(Array.isArray(plan.gramsOptions) && plan.gramsOptions.length > 0, `${plan.key} has initial gram options`);
  for (const gramsOption of plan.gramsOptions) {
    assert.ok(Array.isArray(gramsOption.mealsOptions) && gramsOption.mealsOptions.length > 0, `${plan.key}/${gramsOption.grams}g has initial meal options`);
  }
}

// These assertions verify the current demo fixture values only. They are not
// platform rules and may be changed or removed with the initial data.
assertPrice(7, 100, 1, 13800);
assertPrice(7, 200, 5, 105000);
assertPrice(26, 150, 4, 230900);
assertPrice(26, 200, 2, 142100);
assertPrice(30, 150, 3, 194300);
assertPrice(30, 200, 5, 379800);

const serializedPlans = subscriptionPlanRows.map((plan) => resolvePlanCatalogEntry(withId(plan), "en"));
assert.strictEqual(serializedPlans.length, subscriptionPlanRows.length);
for (const [index, plan] of serializedPlans.entries()) {
  const source = subscriptionPlanRows[index];
  assert.strictEqual(plan.gramsOptions.length, source.gramsOptions.length);
  assert.strictEqual(plan.weightOptions.length, source.gramsOptions.length);
  for (const [gramsIndex, gramsOption] of plan.weightOptions.entries()) {
    const sourceMeals = source.gramsOptions[gramsIndex].mealsOptions;
    assert.strictEqual(gramsOption.mealsOptions.length, sourceMeals.length);
    assert.strictEqual(gramsOption.mealOptions.length, sourceMeals.length);
  }
}

const legacyDiscountedPlan = resolvePlanCatalogEntry(withId({
  key: "legacy_discounted_plan",
  name: { ar: "سعر قديم", en: "Legacy price" },
  daysCount: 7,
  durationDays: 7,
  currency: "SAR",
  isActive: true,
  gramsOptions: [{
    grams: 100,
    mealsOptions: [{
      mealsPerDay: 1,
      priceHalala: 11700,
      compareAtHalala: 13800,
      isActive: true,
    }],
  }],
}), "en");
const legacyMealOption = legacyDiscountedPlan.gramsOptions[0].mealsOptions[0];
assert.strictEqual(legacyMealOption.priceHalala, 13800, "the higher legacy value becomes the base plan price");
assert.strictEqual(legacyMealOption.compareAtHalala, 0, "static compare-at pricing is not public");
assert.strictEqual(legacyMealOption.savingsHalala, 0, "static savings are not public");
assert.strictEqual(legacyDiscountedPlan.pricing.startsFromHalala, 13800);
assert.strictEqual(legacyDiscountedPlan.pricing.compareAtStartsFromHalala, 0);
assert.strictEqual(legacyDiscountedPlan.pricing.savingsStartsFromHalala, 0);

const wrongFlatPlans = wrongFlatPlanKeys.map((key) => ({
  _id: new mongoose.Types.ObjectId(),
  key,
  name: { ar: key, en: key },
  daysCount: 7,
  durationDays: 7,
  isActive: false,
  gramsOptions: [{
    grams: 100,
    mealsOptions: [{ mealsPerDay: 1, priceHalala: 1, compareAtHalala: 1 }],
  }],
}));

const visibleCatalog = [...subscriptionPlanRows.map(withId), ...wrongFlatPlans]
  .filter((plan) => plan.isActive !== false && Plan.isViable(plan))
  .map((plan) => resolvePlanCatalogEntry(plan, "en"));

assert.strictEqual(visibleCatalog.length, subscriptionPlanRows.length);
assert.ok(!visibleCatalog.some((plan) => wrongFlatPlanKeys.includes(plan.key)));

console.log("seedSubscriptionPlans.test.js passed");
