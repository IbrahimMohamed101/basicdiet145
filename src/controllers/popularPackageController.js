const Plan = require("../models/Plan");
const { getRequestLang, pickLang } = require("../utils/i18n");

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listActiveGramsOptions(plan) {
  return Array.isArray(plan && plan.gramsOptions)
    ? plan.gramsOptions
      .filter((option) => option && option.isActive !== false)
      .sort((a, b) => {
        const orderDiff = resolveSortValue(a.sortOrder) - resolveSortValue(b.sortOrder);
        if (orderDiff !== 0) return orderDiff;
        return Number(a.grams) - Number(b.grams);
      })
    : [];
}

function listActiveMealsOptions(gramsOption) {
  return Array.isArray(gramsOption && gramsOption.mealsOptions)
    ? gramsOption.mealsOptions
      .filter((option) => option && option.isActive !== false)
      .sort((a, b) => {
        const orderDiff = resolveSortValue(a.sortOrder) - resolveSortValue(b.sortOrder);
        if (orderDiff !== 0) return orderDiff;
        return Number(a.mealsPerDay) - Number(b.mealsPerDay);
      })
    : [];
}

function parseMoneyValue(halala) {
  const normalized = Number(halala);
  return Number.isFinite(normalized) ? normalized / 100 : 0;
}

function resolvePopularPackage(plan, lang) {
  const gramsOption = listActiveGramsOptions(plan)[0];
  if (!gramsOption) return null;

  const mealsOption = listActiveMealsOptions(gramsOption)[0];
  if (!mealsOption) return null;

  const oldPrice = parseMoneyValue(mealsOption.compareAtHalala);
  const newPrice = parseMoneyValue(mealsOption.priceHalala);

  return {
    id: String(plan._id),
    planId: String(plan._id),
    name: pickLang(plan.name, lang),
    daysCount: Number(plan.daysCount || 0),
    mealsPerDay: Number(mealsOption.mealsPerDay || 0),
    grams: Number(gramsOption.grams || 0),
    oldPrice,
    newPrice,
    moneySave: Math.max(0, oldPrice - newPrice),
    currency: plan.currency || "SAR",
  };
}

async function listPopularPackages(req, res) {
  const lang = getRequestLang(req);
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const data = plans.map((plan) => resolvePopularPackage(plan, lang)).filter(Boolean).slice(0, 3);

  return res.status(200).json({ ok: true, data });
}

module.exports = { listPopularPackages };
