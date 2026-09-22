const Plan = require("../models/Plan");

const TARGET_PLAN_ID = "6a621995f4f8d0974cebc472";
const TARGET_PLAN_KEY = "subscription_26_days";
const TARGET_DAYS = 26;
const TARGET_GRAMS = 150;

const TARGET_PRICES_HALALA = new Map([
  [1, 65900],
  [2, 118600],
  [3, 173200],
  [4, 230900],
  [5, 288600],
]);

async function findTargetPlan() {
  const byId = await Plan.findById(TARGET_PLAN_ID);
  if (byId) return byId;

  return Plan.findOne({
    key: TARGET_PLAN_KEY,
    daysCount: TARGET_DAYS,
  });
}

async function normalizeBasicDiet26Day150gPricing() {
  // Prefer the historical plan id, but fall back to the canonical commercial
  // key so the migration repairs production even if the plan id was recreated.
  const plan = await findTargetPlan();
  if (!plan) {
    return {
      status: "skipped",
      reason: "plan_not_found",
      planId: TARGET_PLAN_ID,
      planKey: TARGET_PLAN_KEY,
    };
  }

  if (Number(plan.daysCount) !== TARGET_DAYS) {
    return {
      status: "skipped",
      reason: "unexpected_days_count",
      planId: String(plan._id),
      planKey: plan.key || TARGET_PLAN_KEY,
      daysCount: plan.daysCount,
    };
  }

  const gramsOption = (plan.gramsOptions || []).find(
    (option) => Number(option.grams) === TARGET_GRAMS
  );

  if (!gramsOption) {
    return {
      status: "skipped",
      reason: "150g_option_not_found",
      planId: String(plan._id),
      planKey: plan.key || TARGET_PLAN_KEY,
    };
  }

  let changed = false;
  const repairedMeals = [];

  for (const mealOption of gramsOption.mealsOptions || []) {
    const mealsPerDay = Number(mealOption.mealsPerDay);
    const targetPrice = TARGET_PRICES_HALALA.get(mealsPerDay);

    if (targetPrice === undefined) continue;

    const currentPrice = Number(mealOption.priceHalala);
    const currentCompareAt = Number(mealOption.compareAtHalala || 0);

    if (currentPrice !== targetPrice || currentCompareAt !== 0) {
      mealOption.priceHalala = targetPrice;
      mealOption.compareAtHalala = 0;
      changed = true;
      repairedMeals.push({
        mealsPerDay,
        fromHalala: Number.isFinite(currentPrice) ? currentPrice : null,
        toHalala: targetPrice,
      });
    }
  }

  if (!changed) {
    return {
      status: "already_normalized",
      planId: String(plan._id),
      planKey: plan.key || TARGET_PLAN_KEY,
      grams: TARGET_GRAMS,
      pricesSar: Object.fromEntries(
        Array.from(TARGET_PRICES_HALALA.entries()).map(([meals, halala]) => [
          meals,
          halala / 100,
        ])
      ),
    };
  }

  await plan.save();

  return {
    status: "updated",
    planId: String(plan._id),
    planKey: plan.key || TARGET_PLAN_KEY,
    grams: TARGET_GRAMS,
    repairedMeals,
    pricesSar: Object.fromEntries(
      Array.from(TARGET_PRICES_HALALA.entries()).map(([meals, halala]) => [
        meals,
        halala / 100,
      ])
    ),
  };
}

module.exports = {
  findTargetPlan,
  normalizeBasicDiet26Day150gPricing,
};
