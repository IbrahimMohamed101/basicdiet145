const Plan = require("../models/Plan");

async function listPlans(_req, res) {
  const plans = await Plan.find({ isActive: true }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ ok: true, data: plans });
}

async function getPlan(req, res) {
  const plan = await Plan.findById(req.params.id).lean();
  if (!plan) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Plan not found" } });
  }
  return res.status(200).json({ ok: true, data: plan });
}

module.exports = { listPlans, getPlan };
