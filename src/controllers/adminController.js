const Plan = require("../models/Plan");
const Setting = require("../models/Setting");
const DashboardUser = require("../models/DashboardUser");
const ActivityLog = require("../models/ActivityLog");
const NotificationLog = require("../models/NotificationLog");
const { processDailyCutoff } = require("../services/automationService");
const { logger } = require("../utils/logger");

async function createPlan(req, res) {
  const { name, daysCount, mealsPerDay, grams, price, skipAllowance } = req.body || {};
  if (!name || !daysCount || !mealsPerDay || !grams || !price) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing fields" } });
  }

  const plan = await Plan.create({ name, daysCount, mealsPerDay, grams, price, skipAllowance });
  return res.status(201).json({ ok: true, data: { id: plan.id } });
}

async function updateSetting(key, value, res) {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
  return res.status(200).json({ ok: true });
}

async function updateCutoff(req, res) {
  const { time } = req.body || {};
  if (!time) return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing time" } });
  return updateSetting("cutoff_time", time, res);
}

async function updateDeliveryWindows(req, res) {
  const { windows } = req.body || {};
  if (!windows || !Array.isArray(windows))
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing windows array" } });
  return updateSetting("delivery_windows", windows, res);
}

async function updateSkipAllowance(req, res) {
  const { days } = req.body || {};
  if (days === undefined)
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing days" } });
  return updateSetting("skip_allowance", days, res);
}

async function updatePremiumPrice(req, res) {
  const { price } = req.body || {};
  if (price === undefined)
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing price" } });
  return updateSetting("premium_price", price, res);
}

async function listDashboardUsers(_req, res) {
  const users = await DashboardUser.find().sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: users });
}

async function createDashboardUser(req, res) {
  const { email, role } = req.body || {};
  if (!email || !role) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing email or role" } });
  }
  const user = await DashboardUser.create({ email, role });
  return res.status(201).json({ ok: true, data: { id: user.id } });
}

async function listActivityLogs(req, res) {
  const {
    entityType,
    entityId,
    action,
    from,
    to,
    byRole,
    page = 1,
    limit = 50,
  } = req.query || {};

  const query = {};
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (action) query.action = action;
  if (byRole) query.byRole = byRole;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const safeLimit = Math.min(Number(limit) || 50, 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [logs, total] = await Promise.all([
    ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ActivityLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  });
}

async function listNotificationLogs(req, res) {
  const { userId, from, to, page = 1, limit = 50 } = req.query || {};
  const query = {};
  if (userId) query.userId = userId;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const safeLimit = Math.min(Number(limit) || 50, 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [logs, total] = await Promise.all([
    NotificationLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    NotificationLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
  });
}

module.exports = {
  createPlan,
  updateCutoff,
  updateDeliveryWindows,
  updateSkipAllowance,
  updatePremiumPrice,
  listDashboardUsers,
  createDashboardUser,
  listActivityLogs,
  listNotificationLogs,
  triggerDailyCutoff: async (req, res) => {
    try {
      await processDailyCutoff();
      return res.status(200).json({ ok: true, message: "Cutoff processed successfully" });
    } catch (err) {
      logger.error("Cutoff trigger error", { error: err.message, stack: err.stack });
      return res.status(500).json({ ok: false, message: "Cutoff processing failed" });
    }
  }
};
