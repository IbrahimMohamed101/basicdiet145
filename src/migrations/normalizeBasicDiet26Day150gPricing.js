const Plan = require("../models/Plan");

const TARGET_PLAN_ID = "6a621995f4f8d0974cebc472";
const TARGET_DAYS = 26;
const TARGET_GRAMS = 150;

const TARGET_PRICES_HALALA = new Map([
  [1, 65900],
  [2, 118600],
  [3, 173200],
  [4, 230900],
  [5, 288600],
]);

async function normalizeBasicDiet26Day150gPricing() {
  const plan = await Plan.findById(TARGET_PLAN_ID);
  if (!plan) {
    return { status: "skipped", reason: "plan_not_found" };
  }

  if (Number(plan.daysCount) !== TARGET_DAYS) {
    return {
      status: "skipped",
      reason: "unexpected_days_count",
      daysCount: plan.daysCount,
    };
  }

  const gramsOption = (plan.gramsOptions || []).find(
    (option) => Number(option.grams) === TARGET_GRAMS
  );

  if (!gramsOption) {
    return { status: "skipped", reason: "150g_option_not_found" };
  }

  let changed = false;

  for (const mealOption of gramsOption.mealsOptions || []) {
    const mealsPerDay = Number(mealOption.mealsPerDay);
    const targetPrice = TARGET_PRICES_HALALA.get(mealsPerDay);

    if (targetPrice === undefined) continue;

    if (Number(mealOption.priceHalala) !== targetPrice || Number(mealOption.compareAtHalala || 0) !== 0) {
      mealOption.priceHalala = targetPrice;
      mealOption.compareAtHalala = 0;
      changed = true;
    }
  }

  if (!changed) {
    return { status: "already_normalized" };
  }

  await plan.save();

  return {
    status: "updated",
    planId: TARGET_PLAN_ID,
    grams: TARGET_GRAMS,
    pricesSar: Object.fromEntries(
      Array.from(TARGET_PRICES_HALALA.entries()).map(([meals, halala]) => [
        meals,
        halala / 100,
      ])
    ),
  };
}

module.exports = {
  normalizeBasicDiet26Day150gPricing,
};
