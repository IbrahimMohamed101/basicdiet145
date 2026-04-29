#!/usr/bin/env node

const mongoose = require("mongoose");
require("dotenv").config();

const { connectDb } = require("../src/db");
const Addon = require("../src/models/Addon");
const Plan = require("../src/models/Plan");

const MENU_PLAN_QUERY = { isActive: true };
const MENU_ADDON_QUERY = { isActive: true, kind: "plan", billingMode: "per_day" };
const MENU_MEAL_PLANNER_ADDON_QUERY = { isActive: true, kind: "item", billingMode: "flat_once" };

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function bucketValue(value, fallback = "(missing)") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function pickName(name) {
  if (!name || typeof name !== "object") return "";
  const en = String(name.en || "").trim();
  const ar = String(name.ar || "").trim();
  return en || ar || "";
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = bucketValue(selector(row));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function describePlanViability(plan) {
  const reasons = [];
  const gramsOptions = Array.isArray(plan && plan.gramsOptions) ? plan.gramsOptions : [];
  const activeGramsOptions = gramsOptions.filter((option) => option && option.isActive !== false);

  if (activeGramsOptions.length === 0) {
    reasons.push("no active gramsOptions");
  }

  for (const gramsOption of activeGramsOptions) {
    const activeMealsOptions = Array.isArray(gramsOption && gramsOption.mealsOptions)
      ? gramsOption.mealsOptions.filter((mealOption) => mealOption && mealOption.isActive !== false)
      : [];

    if (activeMealsOptions.length === 0) {
      reasons.push(`grams ${Number(gramsOption.grams) || 0} has no active mealsOptions`);
      continue;
    }

    const invalidPriceMeals = activeMealsOptions.filter(
      (mealOption) => !Number.isInteger(mealOption.priceHalala) || mealOption.priceHalala <= 0
    );

    if (invalidPriceMeals.length > 0) {
      const invalidMealsSummary = invalidPriceMeals
        .map(
          (mealOption) =>
            `${Number(mealOption.mealsPerDay) || 0} meals/day => priceHalala=${mealOption.priceHalala}`
        )
        .join(", ");
      reasons.push(
        `grams ${Number(gramsOption.grams) || 0} has ${invalidPriceMeals.length} active mealsOptions with invalid price (${invalidMealsSummary})`
      );
    }
  }

  return reasons;
}

function summarizeActivePlan(plan) {
  const gramsOptions = Array.isArray(plan && plan.gramsOptions) ? plan.gramsOptions : [];
  const activeGramsOptions = gramsOptions.filter((option) => option && option.isActive !== false);
  const activeMealsOptions = activeGramsOptions.flatMap((option) =>
    Array.isArray(option.mealsOptions)
      ? option.mealsOptions.filter((mealOption) => mealOption && mealOption.isActive !== false)
      : []
  );
  const positivePriceMealsCount = activeMealsOptions.filter(
    (mealOption) => Number.isInteger(mealOption.priceHalala) && mealOption.priceHalala > 0
  ).length;
  const isViable = Plan.isViable(plan);
  const reasons = isViable ? [] : describePlanViability(plan);

  return {
    id: String(plan._id),
    name: pickName(plan.name),
    isActive: Boolean(plan.isActive),
    gramsOptionsCount: gramsOptions.length,
    activeGramsCount: activeGramsOptions.length,
    activeMealsCount: activeMealsOptions.length,
    positivePriceMealsCount,
    isViable,
    reason: reasons.length > 0 ? reasons.join(" | ") : "",
  };
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

async function run() {
  let connection;

  try {
    connection = await connectDb();

    printSection("Connection");
    console.log(`mongoose.connection.name: ${mongoose.connection.name || "(empty)"}`);
    console.log(`mongoose.connection.host: ${mongoose.connection.host || "(empty)"}`);

    printSection("GET /api/subscriptions/menu Queries");
    console.log(`Route handler: src/controllers/menuController.js -> getSubscriptionMenu`);
    console.log(
      `plans query: Plan.find(${JSON.stringify(MENU_PLAN_QUERY)}).sort({ sortOrder: 1, createdAt: -1 }).lean()`
    );
    console.log(
      `addons query: Addon.find(${JSON.stringify(MENU_ADDON_QUERY)}).sort({ sortOrder: 1, createdAt: -1 }).lean()`
    );
    console.log(
      `mealPlanner add-ons query: Addon.find(${JSON.stringify(MENU_MEAL_PLANNER_ADDON_QUERY)}).sort({ sortOrder: 1, createdAt: -1 }).lean()`
    );
    console.log(
      "Implementation note: current getSubscriptionMenu does not filter plans with Plan.isViable(); it returns all active plans."
    );

    const [allAddons, allPlans] = await Promise.all([
      Addon.find({})
        .select("name kind category billingMode isActive sortOrder createdAt")
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean(),
      Plan.find({})
        .select("name isActive gramsOptions sortOrder createdAt")
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean(),
    ]);

    const matchingCheckoutAddons = allAddons.filter(
      (addon) =>
        addon &&
        addon.isActive === true &&
        addon.kind === MENU_ADDON_QUERY.kind &&
        addon.billingMode === MENU_ADDON_QUERY.billingMode
    );

    const matchingMealPlannerAddons = allAddons.filter(
      (addon) =>
        addon &&
        addon.isActive === true &&
        addon.kind === MENU_MEAL_PLANNER_ADDON_QUERY.kind &&
        addon.billingMode === MENU_MEAL_PLANNER_ADDON_QUERY.billingMode
    );

    const activePlans = allPlans.filter((plan) => plan && plan.isActive === true);
    const viablePlans = allPlans.filter((plan) => Plan.isViable(plan));
    const activeViablePlans = activePlans.filter((plan) => Plan.isViable(plan));

    printSection("Addon Diagnostics");
    console.log(`total Addon count: ${allAddons.length}`);
    console.log(`count by kind: ${formatJson(countBy(allAddons, (addon) => addon.kind))}`);
    console.log(`count by category: ${formatJson(countBy(allAddons, (addon) => addon.category))}`);
    console.log(`count by billingMode: ${formatJson(countBy(allAddons, (addon) => addon.billingMode))}`);
    console.log(`count by isActive: ${formatJson(countBy(allAddons, (addon) => addon.isActive))}`);
    console.log(
      `count matching checkout filter (isActive=true, kind=\"plan\", billingMode=\"per_day\"): ${matchingCheckoutAddons.length}`
    );
    console.log(
      `count matching mealPlanner filter (isActive=true, kind=\"item\", billingMode=\"flat_once\"): ${matchingMealPlannerAddons.length}`
    );
    console.log(
      `sample records: ${formatJson(
        allAddons.slice(0, 10).map((addon) => ({
          id: String(addon._id),
          name: pickName(addon.name),
          kind: addon.kind,
          category: addon.category,
          billingMode: addon.billingMode,
          isActive: addon.isActive,
        }))
      )}`
    );

    const activePlanSummaries = activePlans.map(summarizeActivePlan);

    printSection("Plan Diagnostics");
    console.log(`total Plan count: ${allPlans.length}`);
    console.log(`active Plan count: ${activePlans.length}`);
    console.log(`count passing Plan.isViable(): ${viablePlans.length}`);
    console.log(`active plans passing Plan.isViable(): ${activeViablePlans.length}`);
    console.log(`active plan details: ${formatJson(activePlanSummaries)}`);

    printSection("Menu Result Explanation");
    console.log(`addons query match count: ${matchingCheckoutAddons.length}`);
    if (matchingCheckoutAddons.length === 0) {
      console.log(
        "Why addons is []: no Addon documents match isActive=true + kind=\"plan\" + billingMode=\"per_day\"."
      );
    } else {
      console.log(
        "Why addons is not expected to be []: there are Addon documents matching isActive=true + kind=\"plan\" + billingMode=\"per_day\"."
      );
    }

    console.log(`plans query match count: ${activePlans.length}`);
    if (activePlans.length === 0) {
      console.log("Why plans is []: no Plan documents match isActive=true.");
    } else {
      console.log(
        "Why plans is not expected to be [] in the current code: getSubscriptionMenu returns every active plan and does not apply Plan.isViable() as a filter."
      );
      if (activeViablePlans.length === 0) {
        console.log(
          "Viability note: all active plans are non-viable, but that alone should not make data.plans empty in this implementation."
        );
      }
      console.log(
        "If deployed /api/subscriptions/menu still returns plans: [], then the deployed code likely differs from this workspace or the deployment is pointed at a different database/environment."
      );
    }
  } catch (error) {
    console.error("\nSubscription menu diagnosis failed.");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    if (connection || mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
  }
}

run();
