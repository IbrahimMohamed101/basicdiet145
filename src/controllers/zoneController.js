const Zone = require("../models/Zone");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { writeLog } = require("../utils/log");

function normalizeLocalizedName(input) {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) {
      throw { status: 400, code: "INVALID", message: "name must be non-empty" };
    }
    return { ar: "", en: value };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw { status: 400, code: "INVALID", message: "name must be an object with ar/en or a non-empty string" };
  }
  const ar = input.ar === undefined || input.ar === null ? "" : String(input.ar).trim();
  const en = input.en === undefined || input.en === null ? "" : String(input.en).trim();
  if (!ar && !en) {
    throw { status: 400, code: "INVALID", message: "name must have at least one non-empty value in ar or en" };
  }
  return { ar, en };
}

function normalizeNonNegativeInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

function normalizeBoolean(value, fieldName, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  throw { status: 400, code: "INVALID", message: `${fieldName} must be a boolean` };
}

function validateZonePayloadOrThrow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }
  return {
    name: normalizeLocalizedName(payload.name),
    deliveryFeeHalala: normalizeNonNegativeInteger(payload.deliveryFeeHalala, "deliveryFeeHalala"),
    isActive: normalizeBoolean(payload.isActive, "isActive", true),
    sortOrder: payload.sortOrder === undefined ? 0 : normalizeNonNegativeInteger(payload.sortOrder, "sortOrder"),
  };
}

function buildZoneListQuery(query = {}) {
  const filter = {};
  if (query.isActive !== undefined && query.isActive !== null && String(query.isActive).trim() !== "") {
    filter.isActive = normalizeBoolean(query.isActive, "isActive");
  }
  if (query.q !== undefined && query.q !== null && String(query.q).trim()) {
    const regex = new RegExp(String(query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ "name.ar": regex }, { "name.en": regex }];
  }
  return filter;
}

async function writeZoneActivityLogSafely(req, zone, action, meta = {}) {
  if (!req || !req.dashboardUserId || !zone || !zone._id) return;
  try {
    await writeLog({
      entityType: "zone",
      entityId: zone._id,
      action,
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta,
    });
  } catch (_err) {
    // Do not block dashboard writes on logging failures.
  }
}

async function listZonesAdmin(req, res) {
  try {
    const filter = buildZoneListQuery(req.query || {});
    const rows = await Zone.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.status(200).json({ status: true, data: rows, meta: { filters: filter, totalCount: rows.length } });
  } catch (err) {
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

async function getZoneAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const row = await Zone.findById(id).lean();
  if (!row) return errorResponse(res, 404, "NOT_FOUND", "Zone not found");
  return res.status(200).json({ status: true, data: row });
}

async function createZoneAdmin(req, res) {
  try {
    const payload = validateZonePayloadOrThrow(req.body || {});
    const row = await Zone.create(payload);
    await writeZoneActivityLogSafely(req, row, "zone_created_by_admin", {
      deliveryFeeHalala: row.deliveryFeeHalala,
      isActive: row.isActive,
    });
    return res.status(201).json({ status: true, data: row });
  } catch (err) {
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

async function updateZoneAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
    const payload = validateZonePayloadOrThrow(req.body || {});
    const row = await Zone.findByIdAndUpdate(id, { $set: payload }, { new: true, runValidators: true });
    if (!row) return errorResponse(res, 404, "NOT_FOUND", "Zone not found");
    await writeZoneActivityLogSafely(req, row, "zone_updated_by_admin", {
      deliveryFeeHalala: row.deliveryFeeHalala,
      isActive: row.isActive,
    });
    return res.status(200).json({ status: true, data: row });
  } catch (err) {
    if (err && err.status) return errorResponse(res, err.status, err.code, err.message);
    throw err;
  }
}

async function toggleZoneActiveAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const row = await Zone.findById(id);
  if (!row) return errorResponse(res, 404, "NOT_FOUND", "Zone not found");
  row.isActive = !row.isActive;
  await row.save();
  await writeZoneActivityLogSafely(req, row, "zone_toggled_by_admin", { isActive: row.isActive });
  return res.status(200).json({ status: true, data: { id: row.id, isActive: row.isActive } });
}

async function deleteZoneAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const row = await Zone.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  if (!row) return errorResponse(res, 404, "NOT_FOUND", "Zone not found");
  await writeZoneActivityLogSafely(req, row, "zone_soft_deleted_by_admin", { isActive: false });
  return res.status(200).json({ status: true, data: { id: row.id, isActive: row.isActive } });
}

module.exports = {
  listZonesAdmin,
  getZoneAdmin,
  createZoneAdmin,
  updateZoneAdmin,
  toggleZoneActiveAdmin,
  deleteZoneAdmin,
  validateZonePayloadOrThrow,
};
