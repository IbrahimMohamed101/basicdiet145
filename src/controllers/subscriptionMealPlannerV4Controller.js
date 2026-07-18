const mealPlannerService = require("../services/subscription/dynamicMealPlannerService");
const errorResponse = require("../utils/errorResponse");
const { getRequestLang } = require("../utils/i18n");

function noStore(res) {
  res.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

async function getMealPlannerMenu(req, res) {
  try {
    const contract = await mealPlannerService.buildPublishedContract({ lang: getRequestLang(req) });
    noStore(res);
    res.set("ETag", `"${contract.catalogHash}"`);
    res.set("X-Meal-Planner-Catalog-Hash", contract.catalogHash);
    return res.status(200).json({ status: true, data: contract });
  } catch (err) {
    noStore(res);
    if (err?.status && err?.code) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    console.error("SubscriptionMealPlannerV4Controller error:", err);
    return errorResponse(res, 500, "MEAL_PLANNER_INTERNAL_ERROR", "Unable to build Meal Planner catalog");
  }
}

module.exports = { getMealPlannerMenu };
