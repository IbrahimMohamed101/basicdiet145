const DashboardUser = require("../models/DashboardUser");
const errorResponse = require("../utils/errorResponse");
const validateObjectId = require("../utils/validateObjectId");
const {
  normalizeDashboardEmail,
  buildDashboardEmailQuery,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
  sanitizeDashboardUser,
} = require("../services/dashboardPasswordService");

// New operational accounts use the unified restaurant role. Kitchen and cashier
// remain valid authentication roles only so existing accounts and tokens do not
// break during migration.
const ASSIGNABLE_ROLES = Object.freeze(["admin", "restaurant", "courier"]);
const LEGACY_STAFF_ROLES = Object.freeze(["kitchen", "cashier"]);
const STAFF_FILTER_ROLES = Object.freeze([...ASSIGNABLE_ROLES, ...LEGACY_STAFF_ROLES]);

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function assertRoleFromList(role, allowedRoles) {
  const normalized = normalizeRole(role);
  if (!allowedRoles.includes(normalized)) {
    const err = new Error(`role must be one of: ${allowedRoles.join(", ")}`);
    err.status = 400;
    err.code = "INVALID_DASHBOARD_ROLE";
    throw err;
  }
  return normalized;
}

function assertAssignableRole(role) {
  return assertRoleFromList(role, ASSIGNABLE_ROLES);
}

function assertStaffFilterRole(role) {
  return assertRoleFromList(role, STAFF_FILTER_ROLES);
}

function parsePagination(query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

async function listStaffUsers(req, res) {
  const { page, limit, skip } = parsePagination(req.query);
  const q = String(req.query.q || "").trim();
  const role = String(req.query.role || "").trim().toLowerCase();
  const status = String(req.query.status || "").trim().toLowerCase();

  const filter = { role: { $ne: "superadmin" } };
  if (q) filter.email = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (role) filter.role = assertStaffFilterRole(role);
  if (status === "active") filter.isActive = true;
  if (status === "inactive") filter.isActive = false;

  const [rows, total] = await Promise.all([
    DashboardUser.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    DashboardUser.countDocuments(filter),
  ]);

  return res.status(200).json({
    status: true,
    data: rows.map(sanitizeDashboardUser),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    assignableRoles: ASSIGNABLE_ROLES,
  });
}

async function createStaffUser(req, res) {
  try {
    const email = normalizeDashboardEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || "");
    const role = assertAssignableRole(req.body && req.body.role);

    if (!isValidEmailFormat(email)) {
      return errorResponse(res, 400, "INVALID_EMAIL", "Invalid email format");
    }
    const passwordValidation = validateDashboardPassword(password);
    if (!passwordValidation.ok) {
      return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);
    }
    const existing = await DashboardUser.findOne(buildDashboardEmailQuery(email)).lean();
    if (existing) {
      return errorResponse(res, 409, "DASHBOARD_USER_EXISTS", "Dashboard user already exists");
    }

    const created = await DashboardUser.create({
      email,
      passwordHash: await hashDashboardPassword(password),
      role,
      isActive: req.body && req.body.isActive === false ? false : true,
      passwordChangedAt: new Date(),
      createdBy: req.dashboardUserId,
      updatedBy: req.dashboardUserId,
    });

    return res.status(201).json({ status: true, data: sanitizeDashboardUser(created) });
  } catch (err) {
    if (err && err.code === 11000) {
      return errorResponse(res, 409, "DASHBOARD_USER_EXISTS", "Dashboard user already exists");
    }
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

async function updateStaffUser(req, res) {
  try {
    validateObjectId(req.params.id, "id");
    const user = await DashboardUser.findById(req.params.id);
    if (!user) return errorResponse(res, 404, "DASHBOARD_USER_NOT_FOUND", "Dashboard user not found");
    if (user.role === "superadmin") {
      return errorResponse(res, 403, "SUPERADMIN_PROTECTED", "Superadmin account cannot be modified here");
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const email = normalizeDashboardEmail(req.body.email);
      if (!isValidEmailFormat(email)) return errorResponse(res, 400, "INVALID_EMAIL", "Invalid email format");
      const duplicate = await DashboardUser.findOne({ ...buildDashboardEmailQuery(email), _id: { $ne: user._id } }).lean();
      if (duplicate) return errorResponse(res, 409, "DASHBOARD_USER_EXISTS", "Dashboard user already exists");
      user.email = email;
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "role")) user.role = assertAssignableRole(req.body.role);
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "isActive")) user.isActive = Boolean(req.body.isActive);
    user.updatedBy = req.dashboardUserId;
    await user.save();

    return res.status(200).json({ status: true, data: sanitizeDashboardUser(user) });
  } catch (err) {
    if (err && err.code === 11000) return errorResponse(res, 409, "DASHBOARD_USER_EXISTS", "Dashboard user already exists");
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

async function resetStaffPassword(req, res) {
  try {
    validateObjectId(req.params.id, "id");
    const password = String((req.body && req.body.password) || "");
    const passwordValidation = validateDashboardPassword(password);
    if (!passwordValidation.ok) return errorResponse(res, 400, "WEAK_PASSWORD", passwordValidation.message);

    const user = await DashboardUser.findById(req.params.id);
    if (!user) return errorResponse(res, 404, "DASHBOARD_USER_NOT_FOUND", "Dashboard user not found");
    if (user.role === "superadmin") return errorResponse(res, 403, "SUPERADMIN_PROTECTED", "Superadmin password cannot be reset here");

    user.passwordHash = await hashDashboardPassword(password);
    user.passwordChangedAt = new Date();
    user.failedAttempts = 0;
    user.lockUntil = null;
    user.updatedBy = req.dashboardUserId;
    await user.save();

    return res.status(200).json({ status: true, data: sanitizeDashboardUser(user) });
  } catch (err) {
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

module.exports = {
  ASSIGNABLE_ROLES,
  LEGACY_STAFF_ROLES,
  STAFF_FILTER_ROLES,
  listStaffUsers,
  createStaffUser,
  updateStaffUser,
  resetStaffPassword,
};
