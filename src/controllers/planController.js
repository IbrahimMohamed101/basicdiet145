const Plan = require("../models/Plan");
const { getRequestLang, pickLang } = require("../utils/i18n");
const errorResponse = require("../utils/errorResponse");

/**
 * Resolve a Plan document for the mobile client:
 *  - `name` becomes a plain resolved string based on Accept-Language
 */
function resolvePlan(doc, lang) {
  return {
    ...doc,
    name: pickLang(doc.name, lang),
  };
}

async function listPlans(req, res) {
  const lang = getRequestLang(req);
  const plans = await Plan.find({ isActive: true }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ ok: true, data: plans.map((p) => resolvePlan(p, lang)) });
}

async function getPlan(req, res) {
  const lang = getRequestLang(req);
  const plan = await Plan.findById(req.params.id).lean();
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  return res.status(200).json({ ok: true, data: resolvePlan(plan, lang) });
}

module.exports = { listPlans, getPlan };
