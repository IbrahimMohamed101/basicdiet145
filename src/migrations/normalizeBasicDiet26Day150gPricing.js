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
  // Canonical commercial identity wins over any historical ObjectId.
  const canonical = await Plan.findOne({
    key: TARGET_PLAN_KEY,
    daysCount: TARGET_DAYS,
  });
  if (canonical) return canonical;

  // Legacy fallback is only valid when it is actually the 26-day plan.
  const historical = await Plan.findById(TARGET_PLAN_ID);
  if (historical && Number(historical.daysCount) === TARGET_DAYS) {
    return historical;
  }

  return null;
}

async function normalizeBasicDiet26Day150gPricing() {
  const plans = await Plan.find({
    $or: [
      { key: TARGET_PLAN_KEY, daysCount: TARGET_DAYS },
      { _id: TARGET_PLAN_ID },
    ],
  });

  const targetPlans = plans.filter((plan) => (
    Number(plan.daysCount) === TARGET_DAYS
    && (
      plan.key === TARGET_PLAN_KEY
      || String(plan._id) === TARGET_PLAN_ID
    )
  ));

  if (targetPlans.length === 0) {
    return {
      status: "skipped",
      reason: "plan_not_found",
      planId: TARGET_PLAN_ID,
      planKey: TARGET_PLAN_KEY,
    };
  }

  let changed = false;
  const repairedPlans = [];

  for (const plan of targetPlans) {
    const gramsOption = (plan.gramsOptions || []).find(
      (option) => Number(option.grams) === TARGET_GRAMS
    );

    if (!gramsOption) {
      repairedPlans.push({
        planId: String(plan._id),
        planKey: plan.key || TARGET_PLAN_KEY,
        status: "150g_option_not_found",
      });
      continue;
    }

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

    if (repairedMeals.length > 0) {
      await plan.save();
    }

    repairedPlans.push({
      planId: String(plan._id),
      planKey: plan.key || TARGET_PLAN_KEY,
      status: repairedMeals.length > 0 ? "updated" : "already_normalized",
      grams: TARGET_GRAMS,
      repairedMeals,
    });
  }

  return {
    status: changed ? "updated" : "already_normalized",
    planId: repairedPlans[0]?.planId || null,
    planKey: TARGET_PLAN_KEY,
    grams: TARGET_GRAMS,
    repairedPlans,
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
