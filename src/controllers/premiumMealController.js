const PremiumMeal = require("../models/PremiumMeal");
const { getRequestLang } = require("../utils/i18n");
const { resolvePremiumMealCatalogEntry } = require("../utils/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

const SYSTEM_CURRENCY = "SAR";

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

function validatePremiumMealPayloadOrThrow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }

  const name = normalizeName(payload.name);
  const description = normalizeLocalizedOptional(payload.description);
  const imageUrl = payload.imageUrl === undefined || payload.imageUrl === null ? "" : String(payload.imageUrl).trim();

  const currency = payload.currency === undefined
    ? SYSTEM_CURRENCY
    : String(payload.currency).trim().toUpperCase();
  if (!currency) {
    throw { status: 400, code: "INVALID", message: "currency must be a non-empty string" };
  }
  if (currency !== SYSTEM_CURRENCY) {
    throw { status: 400, code: "INVALID", message: `currency must be ${SYSTEM_CURRENCY}` };
  }

  const extraFeeHalala = Number(payload.extraFeeHalala);
  if (!isNonNegativeInteger(extraFeeHalala)) {
    throw { status: 400, code: "INVALID", message: "extraFeeHalala must be an integer >= 0" };
  }

  const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive);
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");

  return {
    name,
    description,
    imageUrl,
    currency,
    extraFeeHalala,
    isActive,
    sortOrder,
  };
}

async function listPremiumMeals(req, res) {
  const lang = getRequestLang(req);
  const rows = await PremiumMeal.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const mapped = rows.map((row) => resolvePremiumMealCatalogEntry(row, lang));
  return res.status(200).json({ ok: true, data: mapped });
}

async function listPremiumMealsAdmin(_req, res) {
  const rows = await PremiumMeal.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: rows });
}

async function getPremiumMealAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const row = await PremiumMeal.findById(id).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }
  return res.status(200).json({ ok: true, data: row });
}

async function createPremiumMeal(req, res) {
  try {
    const payload = validatePremiumMealPayloadOrThrow(req.body || {});
    const row = await PremiumMeal.create(payload);
    return res.status(201).json({ ok: true, data: { id: row.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updatePremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const payload = validatePremiumMealPayloadOrThrow(req.body || {});
    const updated = await PremiumMeal.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
    if (!updated) {
      return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
    }
    return res.status(200).json({ ok: true, data: { id: updated.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deletePremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const deleted = await PremiumMeal.findByIdAndDelete(id).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }
  return res.status(200).json({ ok: true });
}

async function togglePremiumMealActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const row = await PremiumMeal.findById(id);
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }
  row.isActive = !row.isActive;
  await row.save();
  return res.status(200).json({ ok: true, data: { id: row.id, isActive: row.isActive } });
}

async function updatePremiumMealSortOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const row = await PremiumMeal.findByIdAndUpdate(id, { sortOrder }, { new: true, runValidators: true });
    if (!row) {
      return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
    }
    return res.status(200).json({ ok: true, data: { id: row.id, sortOrder: row.sortOrder } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function clonePremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const row = await PremiumMeal.findById(id).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  const payload = validatePremiumMealPayloadOrThrow({
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    currency: row.currency,
    extraFeeHalala: row.extraFeeHalala,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  });
  const cloned = await PremiumMeal.create(payload);
  return res.status(201).json({ ok: true, data: { id: cloned.id } });
}

module.exports = {
  listPremiumMeals,
  listPremiumMealsAdmin,
  getPremiumMealAdmin,
  createPremiumMeal,
  updatePremiumMeal,
  deletePremiumMeal,
  togglePremiumMealActive,
  updatePremiumMealSortOrder,
  clonePremiumMeal,
  validatePremiumMealPayloadOrThrow,
};
