const Plan = require("../models/Plan");
const { getRequestLang } = require("../utils/i18n");
const { resolvePlanCatalogEntry } = require("../utils/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

async function listPlans(req, res) {
  const lang = getRequestLang(req);
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: plans.map((plan) => resolvePlanCatalogEntry(plan, lang)) });
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

  return res.status(200).json({ ok: true, data: resolvePlanCatalogEntry(plan, lang) });
}

module.exports = { listPlans, getPlan };
