const Addon = require("../models/Addon");
const { getRequestLang } = require("../utils/i18n");
const { resolveAddonCatalogEntry } = require("../utils/subscription/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const {
  normalizeOptionalString,
  parseBooleanField,
  parseLocalizedFieldFromBody,
} = require("../utils/requestFields");

const SYSTEM_CURRENCY = "SAR";
const ADDON_IMAGE_FOLDER = "addons";
const ADDON_BILLING_MODES = new Set(["flat_once", "per_day", "per_meal"]);

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

function validateAddonPayloadOrThrow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }

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
  const type = payload.type && ["subscription", "one_time"].includes(payload.type)
    ? payload.type
    : "subscription";
  const rawBillingMode = payload.billingMode === undefined || payload.billingMode === null
    ? ""
    : normalizeOptionalString(payload.billingMode);
  if (rawBillingMode && !ADDON_BILLING_MODES.has(rawBillingMode)) {
    throw {
      status: 400,
      code: "INVALID",
      message: "billingMode must be one of: flat_once, per_day, per_meal",
    };
  }
  const billingMode = rawBillingMode || (type === "one_time" ? "flat_once" : "per_day");
  const normalizedType = billingMode === "flat_once" ? "one_time" : "subscription";

  return {
    name,
    description,
    imageUrl,
    priceHalala,
    price: priceHalala / 100,
    currency,
    isActive,
    sortOrder,
    type: normalizedType,
    billingMode,
  };
}

async function listAddons(req, res) {
  const lang = getRequestLang(req);
  const rows = await Addon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const mapped = rows.map((row) => resolveAddonCatalogEntry(row, lang));
  return res.status(200).json({ status: true, data: mapped });
}

async function listAddonsAdmin(_req, res) {
  const rows = await Addon.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ status: true, data: rows });
}

async function getAddonAdmin(req, res) {
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
  return res.status(200).json({ status: true, data: row });
}

async function createAddon(req, res) {
  try {
    const payload = validateAddonPayloadOrThrow(req.body || {});
    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: ADDON_IMAGE_FOLDER,
    });

    const row = await Addon.create({
      ...payload,
      imageUrl: imageState.imageUrl,
    });
    return res.status(201).json({ status: true, data: { id: row.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateAddon(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const payload = validateAddonPayloadOrThrow(req.body || {});
    const existing = await Addon.findById(id);
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

    return res.status(200).json({ status: true, data: { id: existing.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteAddon(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const deleted = await Addon.findByIdAndDelete(id).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  return res.status(200).json({ status: true });
}

async function toggleAddonActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await Addon.findById(id);
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Addon not found");
  }
  row.isActive = !row.isActive;
  await row.save();

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
    type: row.type,
  });

  const cloned = await Addon.create(payload);
  return res.status(201).json({ status: true, data: { id: cloned.id } });
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
  validateAddonPayloadOrThrow,
};
