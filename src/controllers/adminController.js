const Plan = require("../models/Plan");
const Setting = require("../models/Setting");
const DashboardUser = require("../models/DashboardUser");
const ActivityLog = require("../models/ActivityLog");
const NotificationLog = require("../models/NotificationLog");
const { processDailyCutoff } = require("../services/automationService");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const {
  normalizeDashboardEmail,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("../services/dashboardPasswordService");

const MAX_PREMIUM_PRICE = 10000;
const DASHBOARD_ROLES = new Set(["superadmin", "admin", "kitchen", "courier"]);

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolvePagination(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  if (query.limit === undefined || query.limit === null || query.limit === "") {
    return { page, limit: 50 };
  }
  const parsedLimit = Number(query.limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return { error: { status: 400, code: "INVALID", message: "limit must be a positive number" } };
  }
  if (parsedLimit > 200) {
    return { error: { status: 400, code: "INVALID", message: "limit cannot exceed 200" } };
  }
  return { page, limit: Math.min(Math.floor(parsedLimit), 200) };
}

function parseDateFilterOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function isValidWindowRange(window) {
  if (typeof window !== "string") return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(window);
  if (!match) return false;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  return endMinutes > startMinutes;
}

async function createPlan(req, res) {
  const { name, daysCount, mealsPerDay, grams, price, skipAllowance } = req.body || {};
  const parsedDaysCount = Number(daysCount);
  const parsedMealsPerDay = Number(mealsPerDay);
  const parsedGrams = Number(grams);
  const parsedPrice = Number(price);
  const parsedSkipAllowance = skipAllowance === undefined ? 0 : Number(skipAllowance);
  // MEDIUM AUDIT FIX: Enforce positive integer constraints for plan numeric fields to block invalid/negative values.
  if (
    !isPositiveInteger(parsedDaysCount) ||
    !isPositiveInteger(parsedMealsPerDay) ||
    !isPositiveInteger(parsedGrams) ||
    !isPositiveInteger(parsedPrice)
  ) {
    return errorResponse(res, 400, "INVALID", "daysCount, mealsPerDay, grams, and price must be positive integers");
  }
  if (!Number.isInteger(parsedSkipAllowance) || parsedSkipAllowance < 0) {
    return errorResponse(res, 400, "INVALID", "skipAllowance must be an integer >= 0");
  }

  // Accept name as { ar, en } object or a plain string (backward compat)
  let nameObj;
  if (name && typeof name === "object" && !Array.isArray(name)) {
    if (!name.ar && !name.en) {
      return errorResponse(res, 400, "INVALID", "name must have at least one of: ar, en");
    }
    nameObj = { ar: name.ar || "", en: name.en || "" };
  } else if (name && typeof name === "string") {
    // Legacy: treat the string as the English name
    nameObj = { ar: "", en: name };
  } else {
    return errorResponse(res, 400, "INVALID", "Missing or invalid name");
  }

  const plan = await Plan.create({
    name: nameObj,
    daysCount: parsedDaysCount,
    mealsPerDay: parsedMealsPerDay,
    grams: parsedGrams,
    price: parsedPrice,
    skipAllowance: parsedSkipAllowance,
  });
  return res.status(201).json({ ok: true, data: { id: plan.id } });
}

async function updateSetting(key, value, res) {
  await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
  return res.status(200).json({ ok: true });
}

async function updateCutoff(req, res) {
  const { time } = req.body || {};
  if (!time) return errorResponse(res, 400, "INVALID", "Missing time");
  // SECURITY FIX: Validate strict HH:mm format and clock bounds before persisting cutoff setting.
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return errorResponse(res, 400, "INVALID", "Invalid time format, expected HH:mm");
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return errorResponse(res, 400, "INVALID", "Invalid time value");
  }
  return updateSetting("cutoff_time", time, res);
}

async function updateDeliveryWindows(req, res) {
  const { windows } = req.body || {};
  if (!windows || !Array.isArray(windows))
    return errorResponse(res, 400, "INVALID", "Missing windows array");
  // MEDIUM AUDIT FIX: Validate window format and dedupe entries to prevent ambiguous delivery slot configuration.
  const normalized = windows.map((window) => (typeof window === "string" ? window.trim() : window));
  if (!normalized.every((window) => isValidWindowRange(window))) {
    return errorResponse(res, 400, "INVALID", "Each window must match HH:mm-HH:mm");
  }
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    return errorResponse(res, 400, "INVALID", "Duplicate delivery windows are not allowed");
  }
  return updateSetting("delivery_windows", normalized, res);
}

async function updateSkipAllowance(req, res) {
  const { days, skipAllowance } = req.body || {};
  const rawValue = skipAllowance !== undefined ? skipAllowance : days;
  if (rawValue === undefined) {
    return errorResponse(res, 400, "INVALID", "Missing skipAllowance");
  }
  const parsedDays = Number(rawValue);
  // BUSINESS RULE: Admin-configured global skip allowance must be an integer >= 0; 0 disables all skips.
  if (!Number.isInteger(parsedDays) || parsedDays < 0) {
    return errorResponse(res, 400, "INVALID", "skipAllowance must be an integer >= 0");
  }
  await Setting.findOneAndUpdate(
    { key: "skipAllowance" },
    { value: parsedDays, skipAllowance: parsedDays },
    { upsert: true }
  );
  return res.status(200).json({ ok: true, data: { skipAllowance: parsedDays } });
}

async function updatePremiumPrice(req, res) {
  const { price } = req.body || {};
  if (price === undefined)
    return errorResponse(res, 400, "INVALID", "Missing price");
  const parsedPrice = Number(price);
  // MEDIUM AUDIT FIX: Premium price must be numeric, finite, positive, and bounded to avoid corrupt billing settings.
  if (!Number.isFinite(parsedPrice)) {
    return errorResponse(res, 400, "INVALID", "price must be a finite number");
  }
  if (parsedPrice <= 0) {
    return errorResponse(res, 400, "INVALID", "price must be greater than 0");
  }
  if (parsedPrice > MAX_PREMIUM_PRICE) {
    return errorResponse(res, 400, "INVALID", `price must be <= ${MAX_PREMIUM_PRICE}`);
  }
  return updateSetting("premium_price", parsedPrice, res);
}

async function listDashboardUsers(_req, res) {
  const users = await DashboardUser.find()
    .select("-passwordHash")
    .sort({ createdAt: -1 })
    .lean();
  return res.status(200).json({ ok: true, data: users });
}

async function createDashboardUser(req, res) {
  const { email, role, password, isActive } = req.body || {};
  const normalizedEmail = normalizeDashboardEmail(email);
  if (!normalizedEmail || !role || !password) {
    return errorResponse(res, 400, "INVALID", "Missing email, role, or password");
  }
  if (!isValidEmailFormat(normalizedEmail)) {
    return errorResponse(res, 400, "INVALID", "Invalid email format");
  }
  if (!DASHBOARD_ROLES.has(role)) {
    return errorResponse(res, 400, "INVALID", "role must be one of: superadmin, admin, kitchen, courier");
  }
  const passwordValidation = validateDashboardPassword(password);
  if (!passwordValidation.ok) {
    return errorResponse(res, 400, "INVALID", passwordValidation.message);
  }
  const existing = await DashboardUser.findOne({
    email: { $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i") },
  }).lean();
  if (existing) {
    return errorResponse(res, 409, "CONFLICT", "Dashboard user already exists");
  }
  const passwordHash = await hashDashboardPassword(password);
  const user = await DashboardUser.create({
    email: normalizedEmail,
    role,
    passwordHash,
    isActive: isActive === undefined ? true : Boolean(isActive),
    passwordChangedAt: new Date(),
  });
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
  } = req.query || {};

  const query = {};
  if (entityType) query.entityType = entityType;
  // MEDIUM AUDIT FIX: Validate filter ObjectIds/dates to avoid CastError and return controlled 400 responses.
  if (entityId) {
    try {
      validateObjectId(entityId, "entityId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.entityId = entityId;
  }
  if (action) query.action = action;
  if (byRole) query.byRole = byRole;
  const parsedFrom = from ? parseDateFilterOrNull(from) : null;
  if (from && !parsedFrom) {
    return errorResponse(res, 400, "INVALID", "from must be a valid date");
  }
  const parsedTo = to ? parseDateFilterOrNull(to) : null;
  if (to && !parsedTo) {
    return errorResponse(res, 400, "INVALID", "to must be a valid date");
  }
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    return errorResponse(res, 400, "INVALID", "from must be before or equal to to");
  }
  if (from || to) {
    query.createdAt = {};
    if (parsedFrom) query.createdAt.$gte = parsedFrom;
    if (parsedTo) query.createdAt.$lte = parsedTo;
  }

  const pagination = resolvePagination(req.query || {});
  if (pagination.error) {
    return errorResponse(res, pagination.error.status, pagination.error.code, pagination.error.message);
  }
  const skip = (pagination.page - 1) * pagination.limit;

  const [logs, total] = await Promise.all([
    ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    ActivityLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    },
  });
}

async function listNotificationLogs(req, res) {
  const { userId, entityId, from, to } = req.query || {};
  const query = {};
  if (userId) {
    try {
      validateObjectId(userId, "userId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.userId = userId;
  }
  // MEDIUM AUDIT FIX: Validate filter ObjectIds/dates to avoid CastError and return controlled 400 responses.
  if (entityId) {
    try {
      validateObjectId(entityId, "entityId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.entityId = entityId;
  }
  const parsedFrom = from ? parseDateFilterOrNull(from) : null;
  if (from && !parsedFrom) {
    return errorResponse(res, 400, "INVALID", "from must be a valid date");
  }
  const parsedTo = to ? parseDateFilterOrNull(to) : null;
  if (to && !parsedTo) {
    return errorResponse(res, 400, "INVALID", "to must be a valid date");
  }
  if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
    return errorResponse(res, 400, "INVALID", "from must be before or equal to to");
  }
  if (from || to) {
    query.createdAt = {};
    if (parsedFrom) query.createdAt.$gte = parsedFrom;
    if (parsedTo) query.createdAt.$lte = parsedTo;
  }

  const pagination = resolvePagination(req.query || {});
  if (pagination.error) {
    return errorResponse(res, pagination.error.status, pagination.error.code, pagination.error.message);
  }
  const skip = (pagination.page - 1) * pagination.limit;

  const [logs, total] = await Promise.all([
    NotificationLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).lean(),
    NotificationLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: { page: pagination.page, limit: pagination.limit, total, totalPages: Math.ceil(total / pagination.limit) },
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
      if (err && err.code === "JOB_RUNNING") {
        // MEDIUM AUDIT FIX: Surface cutoff lock contention as explicit 409 so callers can retry safely.
        return errorResponse(res, 409, "JOB_RUNNING", "Daily cutoff job is already running");
      }
      logger.error("adminController.triggerDailyCutoff failed", { error: err.message, stack: err.stack });
      return errorResponse(res, 500, "INTERNAL", "Cutoff processing failed");
    }
  }
};
