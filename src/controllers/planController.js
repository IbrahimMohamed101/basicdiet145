const Plan = require("../models/Plan");
const { getRequestLang, pickLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveFreezePolicy(freezePolicy) {
  const source = freezePolicy && typeof freezePolicy === "object" ? freezePolicy : {};
  return {
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    maxDays: Number.isInteger(source.maxDays) && source.maxDays >= 1 ? source.maxDays : 31,
    maxTimes: Number.isInteger(source.maxTimes) && source.maxTimes >= 0 ? source.maxTimes : 1,
  };
}

function resolveMealsOption(mealOption) {
  const priceHalala = Number(mealOption.priceHalala) || 0;
  const compareAtHalala = Number(mealOption.compareAtHalala) || 0;

  return {
    mealsPerDay: mealOption.mealsPerDay,
    priceHalala,
    compareAtHalala,
    priceSar: priceHalala / 100,
    compareAtSar: compareAtHalala / 100,
  };
}

function resolvePlan(doc, lang) {
  const gramsOptions = Array.isArray(doc.gramsOptions)
    ? doc.gramsOptions
      .filter((gramsOption) => gramsOption && gramsOption.isActive !== false)
      .sort((a, b) => {
        const orderDiff = resolveSortValue(a.sortOrder) - resolveSortValue(b.sortOrder);
        if (orderDiff !== 0) return orderDiff;
        return Number(a.grams) - Number(b.grams);
      })
      .map((gramsOption) => {
        const mealsOptions = Array.isArray(gramsOption.mealsOptions)
          ? gramsOption.mealsOptions
            .filter((mealOption) => mealOption && mealOption.isActive !== false)
            .sort((a, b) => {
              const orderDiff = resolveSortValue(a.sortOrder) - resolveSortValue(b.sortOrder);
              if (orderDiff !== 0) return orderDiff;
              return Number(a.mealsPerDay) - Number(b.mealsPerDay);
            })
            .map(resolveMealsOption)
          : [];

        return {
          grams: gramsOption.grams,
          mealsOptions,
        };
      })
    : [];

  return {
    id: String(doc._id),
    name: pickLang(doc.name, lang),
    daysCount: doc.daysCount,
    currency: doc.currency || "SAR",
    isActive: Boolean(doc.isActive),
    skipAllowanceCompensatedDays:
      Number.isInteger(doc.skipAllowanceCompensatedDays) && doc.skipAllowanceCompensatedDays >= 0
        ? doc.skipAllowanceCompensatedDays
        : 0,
    freezePolicy: resolveFreezePolicy(doc.freezePolicy),
    gramsOptions,
  };
}

async function listPlans(req, res) {
  const lang = getRequestLang(req);
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: plans.map((plan) => resolvePlan(plan, lang)) });
}

async function getPlan(req, res) {
  const lang = getRequestLang(req);

  try {
    validateObjectId(req.params.id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const plan = await Plan.findOne({ _id: req.params.id, isActive: true }).lean();
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }

  return res.status(200).json({ ok: true, data: resolvePlan(plan, lang) });
}

module.exports = { listPlans, getPlan };
