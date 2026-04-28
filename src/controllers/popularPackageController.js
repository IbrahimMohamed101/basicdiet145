const Plan = require("../models/Plan");
const { getRequestLang } = require("../utils/i18n");
const { resolvePlanCatalogEntry } = require("../utils/subscription/subscriptionCatalog");

function resolvePopularPackage(plan, lang) {
  const resolvedPlan = resolvePlanCatalogEntry(plan, lang);
  const gramsOption = Array.isArray(resolvedPlan.gramsOptions) ? resolvedPlan.gramsOptions[0] : null;
  const mealsOption = gramsOption && Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions[0] : null;
  if (!gramsOption || !mealsOption) return null;

  return {
    id: resolvedPlan.id,
    planId: resolvedPlan.id,
    name: resolvedPlan.name,
    daysCount: resolvedPlan.daysCount,
    daysLabel: resolvedPlan.daysLabel,
    mealsPerDay: mealsOption.mealsPerDay,
    grams: gramsOption.grams,
    oldPrice: mealsOption.compareAtSar,
    newPrice: mealsOption.priceSar,
    moneySave: mealsOption.savingsSar,
    currency: resolvedPlan.currency,
    pricing: resolvedPlan.pricing,
    defaultSelection: resolvedPlan.defaultSelection,
    ui: resolvedPlan.ui,
  };
}

async function listPopularPackages(req, res) {
  const lang = getRequestLang(req);
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const data = plans.map((plan) => resolvePopularPackage(plan, lang)).filter(Boolean).slice(0, 3);

  return res.status(200).json({ status: true, data });
}

module.exports = { listPopularPackages };
