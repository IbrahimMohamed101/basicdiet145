const Plan = require("../models/Plan");

const TARGET_PLANS = Object.freeze({
  7: {
    key: "subscription_7_days",
    pricesHalala: {
      100: [13800, 27600, 41400, 55200, 69000],
      150: [17400, 34800, 52200, 69600, 87000],
      200: [21000, 42000, 63000, 84000, 105000],
    },
  },
  26: {
    key: "subscription_26_days",
    historicalId: "6a621995f4f8d0974cebc472",
    pricesHalala: {
      100: [51600, 93500, 135500, 180600, 225700],
      150: [65900, 118600, 173200, 230900, 288600],
      200: [75000, 142100, 201200, 268300, 335400],
    },
  },
  30: {
    key: "subscription_30_days",
    pricesHalala: {
      100: [58700, 107900, 151100, 201400, 251800],
      150: [72000, 133100, 194300, 259000, 323800],
      200: [82800, 161900, 227900, 303800, 379800],
    },
  },
});

function assertPlanMatchesTarget(plan, definition, daysCount) {
  if (!plan) {
    const error = new Error("Commercial subscription plan " + daysCount + "-day was not resolved");
    error.code = "COMMERCIAL_PRICING_PLAN_MISSING";
    throw error;
  }

  if (Number(plan.daysCount) !== daysCount || Number(plan.durationDays) !== daysCount) {
    const error = new Error("Commercial subscription plan " + daysCount + "-day has invalid duration metadata");
    error.code = "COMMERCIAL_PRICING_PLAN_INVALID";
    error.details = {
      planId: String(plan._id),
      key: plan.key || null,
      daysCount: Number(plan.daysCount || 0),
      durationDays: Number(plan.durationDays || 0),
    };
    throw error;
  }

  for (const [gramsKey, targetPrices] of Object.entries(definition.pricesHalala)) {
    const grams = Number(gramsKey);
    const gramsOption = (Array.isArray(plan.gramsOptions) ? plan.gramsOptions : [])
      .find((option) => Number(option && option.grams) === grams && option.isActive !== false);

    if (!gramsOption) {
      const error = new Error("Commercial subscription plan " + daysCount + "-day is missing active " + grams + "g pricing");
      error.code = "COMMERCIAL_PRICING_GRAMS_MISSING";
      error.details = { planId: String(plan._id), daysCount, grams };
      throw error;
    }

    for (let index = 0; index < targetPrices.length; index += 1) {
      const mealsPerDay = index + 1;
      const mealOption = (Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [])
        .find((option) => Number(option && option.mealsPerDay) === mealsPerDay && option.isActive !== false);

      if (!mealOption || Number(mealOption.priceHalala) !== Number(targetPrices[index])) {
        const error = new Error(
          "Commercial subscription price mismatch for " + daysCount + "-day/" + grams + "g/" + mealsPerDay + " meals/day"
        );
        error.code = "COMMERCIAL_PRICING_MISMATCH";
        error.details = {
          planId: String(plan._id),
          daysCount,
          grams,
          mealsPerDay,
          expectedHalala: Number(targetPrices[index]),
          actualHalala: mealOption ? Number(mealOption.priceHalala) : null,
        };
        throw error;
      }

      if (Number(mealOption.compareAtHalala || 0) !== 0) {
        const error = new Error(
          "Commercial subscription compare-at price must be zero for " + daysCount + "-day/" + grams + "g/" + mealsPerDay + " meals/day"
        );
        error.code = "COMMERCIAL_PRICING_COMPARE_AT_PRESENT";
        error.details = { planId: String(plan._id), daysCount, grams, mealsPerDay };
        throw error;
      }
    }
  }

  return true;
}

function buildPriceRows(grams, gramsOption, targetPrices) {
  if (!gramsOption || !Array.isArray(targetPrices)) return [];

  const existingByMeals = new Map(
    (Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [])
      .map((mealOption) => [Number(mealOption.mealsPerDay), mealOption])
  );

  return targetPrices.map((priceHalala, index) => {
    const mealsPerDay = index + 1;
    const current = existingByMeals.get(mealsPerDay);

    return {
      ...(current ? (current.toObject ? current.toObject() : current) : {}),
      mealsPerDay,
      priceHalala,
      compareAtHalala: 0,
      isActive: current?.isActive === undefined ? true : Boolean(current.isActive),
      sortOrder: current?.sortOrder === undefined ? index + 1 : Number(current.sortOrder),
    };
  });
}

async function findTargetPlan(durationDays, definition) {
  if (definition.historicalId) {
    const historical = await Plan.findOne({
      _id: definition.historicalId,
      daysCount: durationDays,
    });

    if (historical) return historical;
  }

  return Plan.findOne({
    key: definition.key,
    daysCount: durationDays,
  });
}

async function normalizeCommercialSubscriptionPricing() {
  const summary = {
    status: "already_normalized",
    plans: [],
  };

  for (const [durationKey, definition] of Object.entries(TARGET_PLANS)) {
    const daysCount = Number(durationKey);
    const plan = await findTargetPlan(daysCount, definition);

    if (!plan) {
      const error = new Error("Commercial subscription plan " + daysCount + "-day is missing");
      error.code = "COMMERCIAL_PRICING_PLAN_MISSING";
      error.details = { daysCount, planKey: definition.key };
      throw error;
    }

    const targetId = String(plan._id);
    const currentGramsOptions = Array.isArray(plan.gramsOptions)
      ? plan.gramsOptions
      : [];

    let changed = false;
    const repairedRows = [];

    for (const [gramsKey, targetPrices] of Object.entries(definition.pricesHalala)) {
      const grams = Number(gramsKey);
      let gramsOption = currentGramsOptions.find(
        (option) => Number(option.grams) === grams
      );

      if (!gramsOption) {
        gramsOption = {
          grams,
          mealsOptions: [],
          isActive: true,
          sortOrder: currentGramsOptions.length + 1,
        };
        currentGramsOptions.push(gramsOption);
        changed = true;
      }

      const existingByMeals = new Map(
        (Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [])
          .map((mealOption) => [Number(mealOption.mealsPerDay), mealOption])
      );

      const nextMealsOptions = [
        ...(Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : []),
      ];

      targetPrices.forEach((priceHalala, index) => {
        const mealsPerDay = index + 1;
        const existing = existingByMeals.get(mealsPerDay);
        const existingPrice = Number(existing?.priceHalala);
        const existingCompareAt = Number(existing?.compareAtHalala || 0);

        if (
          !existing
          || existingPrice !== priceHalala
          || existingCompareAt !== 0
        ) {
          const row = {
            ...(existing ? (existing.toObject ? existing.toObject() : existing) : {}),
            mealsPerDay,
            priceHalala,
            compareAtHalala: 0,
            isActive: existing?.isActive === undefined
              ? true
              : Boolean(existing.isActive),
            sortOrder: existing?.sortOrder === undefined
              ? index + 1
              : Number(existing.sortOrder),
          };

          const existingIndex = nextMealsOptions.findIndex(
            (mealOption) => Number(mealOption.mealsPerDay) === mealsPerDay
          );

          if (existingIndex >= 0) {
            nextMealsOptions[existingIndex] = row;
          } else {
            nextMealsOptions.push(row);
          }

          repairedRows.push({
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

    if (plan.key !== definition.key) {
      plan.key = definition.key;
      changed = true;
    }

    plan.daysCount = daysCount;
    plan.durationDays = daysCount;
    plan.gramsOptions = currentGramsOptions;

    if (changed) {
      await plan.save();
    }

    assertPlanMatchesTarget(plan, definition, daysCount);

    summary.plans.push({
      daysCount,
      planId: targetId,
      planKey: definition.key,
      status: changed ? "updated" : "already_normalized",
      repairedRows,
    });

    if (changed) summary.status = "updated";
  }

  return summary;
}

module.exports = {
  TARGET_PLANS,
  assertPlanMatchesTarget,
  normalizeCommercialSubscriptionPricing,
};
