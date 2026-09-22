const Plan = require("../models/Plan");

const TARGET_PLAN_ID = "6a621995f4f8d0974cebc472";
const TARGET_PLAN_KEY = "subscription_26_days";
const TARGET_DAYS = 26;

const TARGET_PRICES_HALALA = {
  100: [51600, 93500, 135500, 180600, 225700],
  150: [65900, 118600, 173200, 230900, 288600],
  200: [75000, 142100, 201200, 268300, 335400],
};

function findTargetPlanInMemory(plans) {
  return (
    plans.find((plan) => String(plan._id) === TARGET_PLAN_ID && Number(plan.daysCount) === TARGET_DAYS)
    || plans.find((plan) => plan.key === TARGET_PLAN_KEY && Number(plan.daysCount) === TARGET_DAYS)
    || null
  );
}

async function findTargetPlan() {
  const historical = await Plan.findOne({
    _id: TARGET_PLAN_ID,
    daysCount: TARGET_DAYS,
  });

  if (historical) return historical;

  return Plan.findOne({
    key: TARGET_PLAN_KEY,
    daysCount: TARGET_DAYS,
  });
}

function buildPriceRows(grams, gramsOption) {
  const targetPrices = TARGET_PRICES_HALALA[grams];
  if (!targetPrices || !gramsOption) return [];

  const existingByMeals = new Map(
    (Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [])
      .map((mealOption) => [Number(mealOption.mealsPerDay), mealOption])
  );

  return targetPrices.map((priceHalala, index) => {
    const mealsPerDay = index + 1;
    const current = existingByMeals.get(mealsPerDay);

    return {
      ...(current ? current.toObject ? current.toObject() : current : {}),
      mealsPerDay,
      priceHalala,
      compareAtHalala: 0,
      isActive: current?.isActive === undefined ? true : Boolean(current.isActive),
      sortOrder: current?.sortOrder === undefined ? index : Number(current.sortOrder),
    };
  });
}

async function normalizeBasicDiet26Day150gPricing() {
  const plans = await Plan.find({
    daysCount: TARGET_DAYS,
    isDeleted: { $ne: true },
    $or: [
      { _id: TARGET_PLAN_ID },
      { key: TARGET_PLAN_KEY },
    ],
  });

  const targetPlan = findTargetPlanInMemory(plans);

  if (!targetPlan) {
    return {
      status: "skipped",
      reason: "plan_not_found",
      planId: TARGET_PLAN_ID,
      planKey: TARGET_PLAN_KEY,
    };
  }

  const targetId = String(targetPlan._id);

  // The historical/admin-edited plan is the source of truth for the
  // 26-day commercial catalog. Remove the canonical key from any duplicate
  // 26-day record before assigning it to the target so the dashboard picker
  // cannot resolve the wrong price catalog.
  await Plan.updateMany(
    {
      daysCount: TARGET_DAYS,
      key: TARGET_PLAN_KEY,
      _id: { $ne: targetPlan._id },
    },
    {
      $unset: { key: "" },
    }
  );

  const currentGramsOptions = Array.isArray(targetPlan.gramsOptions)
    ? targetPlan.gramsOptions
    : [];

  let changed = false;
  const repairedGrams = [];

  for (const [gramsKey, targetPrices] of Object.entries(TARGET_PRICES_HALALA)) {
    const grams = Number(gramsKey);
    let gramsOption = currentGramsOptions.find((option) => Number(option.grams) === grams);

    if (!gramsOption) {
      gramsOption = {
        grams,
        mealsOptions: [],
        isActive: true,
        sortOrder: currentGramsOptions.length,
      };
      currentGramsOptions.push(gramsOption);
      changed = true;
    }

    const existingMealsByMeals = new Map(
      (Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [])
        .map((mealOption) => [Number(mealOption.mealsPerDay), mealOption])
    );

    const nextMealsOptions = [...(Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [])];

    targetPrices.forEach((priceHalala, index) => {
      const mealsPerDay = index + 1;
      const existing = existingMealsByMeals.get(mealsPerDay);
      const existingPrice = Number(existing?.priceHalala);
      const existingCompareAt = Number(existing?.compareAtHalala || 0);

      if (!existing || existingPrice !== priceHalala || existingCompareAt !== 0) {
        const row = {
          ...(existing ? (existing.toObject ? existing.toObject() : existing) : {}),
          mealsPerDay,
          priceHalala,
          compareAtHalala: 0,
          isActive: existing?.isActive === undefined ? true : Boolean(existing.isActive),
          sortOrder: existing?.sortOrder === undefined ? index : Number(existing.sortOrder),
        };

        const existingIndex = nextMealsOptions.findIndex(
          (mealOption) => Number(mealOption.mealsPerDay) === mealsPerDay
        );

        if (existingIndex >= 0) {
          nextMealsOptions[existingIndex] = row;
        } else {
          nextMealsOptions.push(row);
        }

        repairedGrams.push({
          grams,
          mealsPerDay,
          fromHalala: Number.isFinite(existingPrice) ? existingPrice : null,
          toHalala: priceHalala,
        });
        changed = true;
      }
    });

    gramsOption.mealsOptions = nextMealsOptions;
  }

  if (targetPlan.key !== TARGET_PLAN_KEY) {
    targetPlan.key = TARGET_PLAN_KEY;
    changed = true;
  }

  targetPlan.gramsOptions = currentGramsOptions;

  if (changed) {
    await targetPlan.save();
  }

  return {
    status: changed ? "updated" : "already_normalized",
    planId: targetId,
    planKey: TARGET_PLAN_KEY,
    grams: [100, 150, 200],
    pricesSar: Object.fromEntries(
      Object.entries(TARGET_PRICES_HALALA).map(([grams, prices]) => [
        grams,
        prices.map((halala) => halala / 100),
      ])
    ),
    repairedRows: repairedGrams,
  };
}

module.exports = {
  findTargetPlan,
  normalizeBasicDiet26Day150gPricing,
};
