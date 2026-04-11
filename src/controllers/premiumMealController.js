const PremiumMeal = require("../models/PremiumMeal");
const { getRequestLang } = require("../utils/i18n");
const { parseMealNutritionFromBody, withDefaultMealNutrition } = require("../utils/mealNutrition");
const { resolvePremiumMealCatalogEntry } = require("../utils/subscription/subscriptionCatalog");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const {
  normalizeOptionalString,
  parseBooleanField,
  parseLocalizedFieldFromBody,
} = require("../utils/requestFields");

const SYSTEM_CURRENCY = "SAR";
const PREMIUM_MEAL_IMAGE_FOLDER = "premium-meals";

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

  const extraFeeHalala = Number(payload.extraFeeHalala);
  if (!isNonNegativeInteger(extraFeeHalala)) {
    throw { status: 400, code: "INVALID", message: "extraFeeHalala must be an integer >= 0" };
  }
  const nutrition = parseMealNutritionFromBody(payload);

  const isActive = parseBooleanField(payload.isActive, "isActive", { defaultValue: true });
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");

  return {
    name,
    description,
    imageUrl,
    currency,
    extraFeeHalala,
    isActive,
    sortOrder,
    ...nutrition,
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
  return res.status(200).json({ ok: true, data: rows.map((row) => withDefaultMealNutrition(row)) });
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
  return res.status(200).json({ ok: true, data: withDefaultMealNutrition(row) });
}

async function createPremiumMeal(req, res) {
  try {
    const payload = validatePremiumMealPayloadOrThrow(req.body || {});
    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: PREMIUM_MEAL_IMAGE_FOLDER,
    });

    const row = await PremiumMeal.create({
      ...payload,
      imageUrl: imageState.imageUrl,
    });
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
    const existing = await PremiumMeal.findById(id);
    if (!existing) {
      return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
    }

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: PREMIUM_MEAL_IMAGE_FOLDER,
      currentImageUrl: existing.imageUrl,
    });

    existing.set({
      ...payload,
      imageUrl: imageState.imageUrl,
    });
    await existing.save();

    return res.status(200).json({ ok: true, data: { id: existing.id } });
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
    proteinGrams: row.proteinGrams,
    carbGrams: row.carbGrams,
    fatGrams: row.fatGrams,
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
