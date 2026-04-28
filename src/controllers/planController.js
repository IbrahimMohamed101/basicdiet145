const Plan = require("../models/Plan");
const { getRequestLang } = require("../utils/i18n");
const { resolvePlanCatalogEntry } = require("../utils/subscription/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

const { logger } = require("../utils/logger");
async function listPlans(req, res) {
  const lang = getRequestLang(req);
  const rawPlans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();

  const viablePlans = [];
  for (const plan of rawPlans) {
    if (Plan.isViable(plan)) {
      viablePlans.push(plan);
    } else {
      logger.warn(`Plan ${plan._id} is active but non-viable (missing/inactive options). Skipping in public catalog.`, {
        planId: plan._id,
        name: plan.name,
      });
    }
  }

  return res.status(200).json({ ok: true, data: viablePlans.map((plan) => resolvePlanCatalogEntry(plan, lang)) });
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

  if (!Plan.isViable(plan)) {
    logger.warn(`Plan ${plan._id} requested directly but is non-viable.`, { planId: plan._id });
    return errorResponse(res, 404, "NOT_FOUND", "Plan not available");
  }

  return res.status(200).json({ ok: true, data: resolvePlanCatalogEntry(plan, lang) });
}

module.exports = { listPlans, getPlan };
