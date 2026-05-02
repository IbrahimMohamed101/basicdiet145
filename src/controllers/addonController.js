const Addon = require("../models/Addon");
const { getRequestLang } = require("../utils/i18n");
const { resolveAddonCatalogEntry } = require("../utils/subscription/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const { writeLog } = require("../utils/log");
const {
  normalizeOptionalString,
  parseBooleanField,
  parseLocalizedFieldFromBody,
} = require("../utils/requestFields");

const SYSTEM_CURRENCY = "SAR";
const ADDON_IMAGE_FOLDER = "addons";
const ADDON_BILLING_MODES = new Set(["flat_once", "per_day", "per_meal"]);
const ADDON_KINDS = new Set(["plan", "item"]);
const ADDON_CATEGORIES = new Set(["juice", "snack", "small_salad"]);
const PLAN_BILLING_MODES = new Set(["per_day", "per_meal"]);
const ITEM_BILLING_MODES = new Set(["flat_once"]);

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeName(input) {
  if (typeof input === "string") {
    const en = input.trim();
    if (!en) {
      throw { status: 400, code: "INVALID", message: "name must have at least one non-empty value in ar or en" };
    }
    return { ar: "", en };
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

function normalizeLocalizedOptional(input) {
  if (input === undefined || input === null) {
    return { ar: "", en: "" };
  }
  if (typeof input === "string") {
    return { ar: "", en: input.trim() };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw { status: 400, code: "INVALID", message: "description must be an object with ar/en or a string" };
  }
  return {
    ar: input.ar === undefined || input.ar === null ? "" : String(input.ar).trim(),
    en: input.en === undefined || input.en === null ? "" : String(input.en).trim(),
  };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

async function writeAddonActivityLogSafely(req, addon, action, meta = {}) {
  if (!req || !req.dashboardUserId || !addon || !addon._id) return;
  try {
    await writeLog({
      entityType: "addon",
      entityId: addon._id,
      action,
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta,
    });
  } catch (_err) {
    // Activity logging must not block catalog writes.
  }
}

function normalizeAddonKind(value, { forceKind = null } = {}) {
  if (forceKind && value !== undefined && value !== null && String(value).trim() && String(value).trim() !== forceKind) {
    throw { status: 400, code: "INVALID", message: `kind must be ${forceKind}` };
  }
  const raw = forceKind || value || "item";
  const kind = String(raw || "").trim();
  if (!ADDON_KINDS.has(kind)) {
    throw { status: 400, code: "INVALID", message: "kind must be one of: plan, item" };
  }
  return kind;
}

function normalizeAddonCategory(value) {
  const category = String(value || "").trim();
  if (!category) {
    throw { status: 400, code: "INVALID", message: "category is required" };
  }
  if (!ADDON_CATEGORIES.has(category)) {
    throw { status: 400, code: "INVALID", message: "category must be one of: juice, snack, small_salad" };
  }
  return category;
}

function resolveAddonBillingMode({ kind, rawBillingMode }) {
  const billingMode = rawBillingMode
    ? normalizeOptionalString(rawBillingMode)
    : kind === "plan"
      ? "per_day"
      : "flat_once";

  if (!ADDON_BILLING_MODES.has(billingMode)) {
    throw {
      status: 400,
      code: "INVALID",
      message: "billingMode must be one of: flat_once, per_day, per_meal",
    };
  }

  const allowedModes = kind === "plan" ? PLAN_BILLING_MODES : ITEM_BILLING_MODES;
  if (!allowedModes.has(billingMode)) {
    throw {
      status: 400,
      code: "INVALID",
      message:
        kind === "plan"
          ? "kind=plan supports billingMode per_day or per_meal"
          : "kind=item supports billingMode flat_once only",
    };
  }

  return billingMode;
}

function buildAddonDerivedBillingFields(billingMode) {
  if (billingMode === "flat_once") {
    return { type: "one_time", pricingModel: "one_time", billingUnit: "item" };
  }
  if (billingMode === "per_day") {
    return { type: "subscription", pricingModel: "subscription", billingUnit: "day" };
  }
  return { type: "subscription", pricingModel: "subscription", billingUnit: "meal" };
}

function validateAddonPayloadOrThrow(payload, { forceKind = null } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }

  const kind = normalizeAddonKind(payload.kind, { forceKind });
  const category = normalizeAddonCategory(payload.category);
  const name = normalizeName(parseLocalizedFieldFromBody(payload, "name", { allowString: true }) ?? payload.name);
  const description = normalizeLocalizedOptional(
    parseLocalizedFieldFromBody(payload, "description", { allowString: true }) ?? payload.description
  );
  const imageUrl = normalizeOptionalString(payload.imageUrl);

  const currency = payload.currency === undefined ? SYSTEM_CURRENCY : normalizeOptionalString(payload.currency).toUpperCase();
  if (!currency) {
    throw { status: 400, code: "INVALID", message: "currency must be a non-empty string" };
  }
  if (currency !== SYSTEM_CURRENCY) {
    throw { status: 400, code: "INVALID", message: `currency must be ${SYSTEM_CURRENCY}` };
  }

  const priceHalala = Number(payload.priceHalala);
  if (!isNonNegativeInteger(priceHalala)) {
    throw { status: 400, code: "INVALID", message: "priceHalala must be an integer >= 0" };
  }

  const isActive = parseBooleanField(payload.isActive, "isActive", { defaultValue: true });
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");
  const rawBillingMode = payload.billingMode === undefined || payload.billingMode === null
    ? ""
    : payload.billingMode;
  const billingMode = resolveAddonBillingMode({ kind, rawBillingMode });
  const derivedBillingFields = buildAddonDerivedBillingFields(billingMode);

  return {
    name,
    description,
    imageUrl,
    priceHalala,
    price: priceHalala / 100,
    priceSar: priceHalala / 100,
    priceLabel: `${priceHalala / 100} SAR`,
    currency,
    kind,
    category,
    isActive,
    sortOrder,
    ...derivedBillingFields,
    billingMode,
  };
}

function resolveAdminAddonFilters(query = {}, { forceKind = null } = {}) {
  const filters = {};
  const kind = forceKind || query.kind;
  if (kind !== undefined && kind !== null && String(kind).trim() !== "") {
    filters.kind = normalizeAddonKind(kind, { forceKind });
  }
  if (query.category !== undefined && query.category !== null && String(query.category).trim() !== "") {
    filters.category = normalizeAddonCategory(query.category);
  }
  if (query.billingMode !== undefined && query.billingMode !== null && String(query.billingMode).trim() !== "") {
    const billingMode = normalizeOptionalString(query.billingMode);
    if (!ADDON_BILLING_MODES.has(billingMode)) {
      throw { status: 400, code: "INVALID", message: "billingMode must be one of: flat_once, per_day, per_meal" };
    }
    filters.billingMode = billingMode;
  }
  if (query.isActive !== undefined && query.isActive !== null && String(query.isActive).trim() !== "") {
    filters.isActive = parseBooleanField(query.isActive, "isActive");
  }
  return filters;
}

async function listAddons(req, res) {
  const lang = getRequestLang(req);
  const rows = await Addon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const mapped = rows.map((row) => resolveAddonCatalogEntry(row, lang));
  return res.status(200).json({ status: true, data: mapped });
}

async function listAddonsAdmin(req, res, options = {}) {
  try {
    const filters = resolveAdminAddonFilters(req.query || {}, options);
    const rows = await Addon.find(filters).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return res.status(200).json({ status: true, data: rows, meta: { filters, totalCount: rows.length } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function getAddonAdmin(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const query = { _id: id };
  if (options.forceKind) query.kind = options.forceKind;
  const row = await Addon.findOne(query).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  return res.status(200).json({ status: true, data: row });
}

async function createAddon(req, res, options = {}) {
  try {
    const payload = validateAddonPayloadOrThrow(req.body || {}, options);
    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: ADDON_IMAGE_FOLDER,
    });

    const row = await Addon.create({
      ...payload,
      imageUrl: imageState.imageUrl,
    });
    await writeAddonActivityLogSafely(req, row, "addon_created_by_admin", {
      kind: row.kind,
      category: row.category,
      billingMode: row.billingMode,
    });
    return res.status(201).json({ status: true, data: { id: row.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateAddon(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const payload = validateAddonPayloadOrThrow(req.body || {}, options);
    const query = { _id: id };
    if (options.forceKind) query.kind = options.forceKind;
    const existing = await Addon.findOne(query);
    if (!existing) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
    }

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: ADDON_IMAGE_FOLDER,
      currentImageUrl: existing.imageUrl,
    });

    existing.set({
      ...payload,
      imageUrl: imageState.imageUrl,
    });
    await existing.save();

    await writeAddonActivityLogSafely(req, existing, "addon_updated_by_admin", {
      kind: existing.kind,
      category: existing.category,
      billingMode: existing.billingMode,
    });
    return res.status(200).json({ status: true, data: { id: existing.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteAddon(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const query = { _id: id };
  if (options.forceKind) query.kind = options.forceKind;
  const row = await Addon.findOneAndUpdate(query, { $set: { isActive: false } }, { new: true });
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  await writeAddonActivityLogSafely(req, row, "addon_soft_deleted_by_admin", {
    kind: row.kind,
    category: row.category,
  });
  return res.status(200).json({ status: true, data: { id: row.id, isActive: row.isActive } });
}

async function toggleAddonActive(req, res, options = {}) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const query = { _id: id };
  if (options.forceKind) query.kind = options.forceKind;
  const row = await Addon.findOne(query);
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  row.isActive = !row.isActive;
  await row.save();

  await writeAddonActivityLogSafely(req, row, "addon_toggled_by_admin", {
    kind: row.kind,
    category: row.category,
    isActive: row.isActive,
  });
  return res.status(200).json({ status: true, data: { id: row.id, isActive: row.isActive } });
}

async function updateAddonSortOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const row = await Addon.findByIdAndUpdate(id, { sortOrder }, { new: true, runValidators: true });
    if (!row) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
    }
    return res.status(200).json({ status: true, data: { id: row.id, sortOrder: row.sortOrder } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneAddon(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await Addon.findById(id).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }

  const payload = validateAddonPayloadOrThrow({
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    priceHalala: Number.isInteger(row.priceHalala) ? row.priceHalala : Math.max(0, Math.round(Number(row.price || 0) * 100)),
    currency: row.currency,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    kind: row.kind,
    category: row.category,
    billingMode: row.billingMode,
  });

  const cloned = await Addon.create(payload);
  await writeAddonActivityLogSafely(req, cloned, "addon_cloned_by_admin", {
    sourceAddonId: String(row._id),
    kind: cloned.kind,
    category: cloned.category,
  });
  return res.status(201).json({ status: true, data: { id: cloned.id } });
}

const forcePlanKind = { forceKind: "plan" };

async function listAddonPlansAdmin(req, res) {
  return listAddonsAdmin(req, res, forcePlanKind);
}

async function getAddonPlanAdmin(req, res) {
  return getAddonAdmin(req, res, forcePlanKind);
}

async function createAddonPlan(req, res) {
  return createAddon(req, res, forcePlanKind);
}

async function updateAddonPlan(req, res) {
  return updateAddon(req, res, forcePlanKind);
}

async function toggleAddonPlanActive(req, res) {
  return toggleAddonActive(req, res, forcePlanKind);
}

module.exports = {
  listAddons,
  listAddonsAdmin,
  getAddonAdmin,
  createAddon,
  updateAddon,
  deleteAddon,
  toggleAddonActive,
  updateAddonSortOrder,
  cloneAddon,
  listAddonPlansAdmin,
  getAddonPlanAdmin,
  createAddonPlan,
  updateAddonPlan,
  toggleAddonPlanActive,
  validateAddonPayloadOrThrow,
};
