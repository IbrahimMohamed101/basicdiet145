const BuilderProtein = require("../models/BuilderProtein");
const BuilderCategory = require("../models/BuilderCategory");
const { getRequestLang } = require("../utils/i18n");
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
const ALLOWED_PROTEIN_FAMILIES = new Set(["chicken", "beef", "seafood", "other"]);

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";
const CUSTOM_PREMIUM_SALAD_PRICE_HALALA = 3000;
const PREMIUM_PROTEIN_SELECTION_TYPE = "premium_protein";
const PREMIUM_PROTEIN_TYPE = "premium_protein";

function buildCustomPremiumSaladEntry(lang) {
  // This endpoint intentionally preserves the legacy premium-meals catalog contract.
  // The planner uses selectionType "premium_large_salad"; /builder/premium-meals
  // keeps "custom_premium_salad" for backward-compatible catalog consumers.
  const names = {
    ar: "سلطة مميزة",
    en: "Custom Premium Salad",
  };
  const descriptions = {
    ar: "سلطة كبيرة مع بروتين",
    en: "Large salad with protein",
  };
  const name = names[lang] || names.en;
  const description = descriptions[lang] || descriptions.en;

  return {
    id: CUSTOM_PREMIUM_SALAD_KEY,
    premiumKey: CUSTOM_PREMIUM_SALAD_KEY,
    selectionType: CUSTOM_PREMIUM_SALAD_KEY,
    type: CUSTOM_PREMIUM_SALAD_KEY,
    name,
    description,
    imageUrl: "",
    currency: "SAR",
    extraFeeHalala: CUSTOM_PREMIUM_SALAD_PRICE_HALALA,
    extraFeeSar: 30,
    priceHalala: CUSTOM_PREMIUM_SALAD_PRICE_HALALA,
    priceSar: 30,
    priceLabel: "30 SAR",
    ui: {
      title: name,
      subtitle: description,
      ctaLabel: lang === "ar" ? "اصنع" : "Build",
      selectionStyle: "builder",
    },
  };
}

function mapBuilderProteinToPremiumMealEntry(row, lang) {
  const nutrition = row && row.nutrition && typeof row.nutrition === "object" ? row.nutrition : {};
  return resolvePremiumMealCatalogEntry({
    _id: row._id,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl || "",
    currency: row.currency || SYSTEM_CURRENCY,
    extraFeeHalala: Number(row.extraFeeHalala || 0),
    proteinGrams: Number(nutrition.proteinGrams || 0),
    carbGrams: Number(nutrition.carbGrams || 0),
    fatGrams: Number(nutrition.fatGrams || 0),
    premiumKey: row.premiumKey || null,
    isPremium: row.isPremium,
  }, lang);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeLocalizedRequired(input, fieldName) {
  const parsed = parseLocalizedFieldFromBody(input, fieldName, { allowString: true })
    ?? input[fieldName];

  if (typeof parsed === "string") {
    const en = parsed.trim();
    if (!en) {
      throw { status: 400, code: "INVALID", message: `${fieldName} must have at least one non-empty value in ar or en` };
    }
    return { ar: "", en };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an object with ar/en or a non-empty string` };
  }

  const ar = parsed.ar === undefined || parsed.ar === null ? "" : String(parsed.ar).trim();
  const en = parsed.en === undefined || parsed.en === null ? "" : String(parsed.en).trim();
  if (!ar && !en) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must have at least one non-empty value in ar or en` };
  }
  return { ar, en };
}

function normalizeLocalizedOptional(input, fieldName) {
  const parsed = parseLocalizedFieldFromBody(input, fieldName, { allowString: true })
    ?? input[fieldName];

  if (parsed === undefined || parsed === null) {
    return { ar: "", en: "" };
  }

  if (typeof parsed === "string") {
    return { ar: "", en: parsed.trim() };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an object with ar/en or a string` };
  }

  return {
    ar: parsed.ar === undefined || parsed.ar === null ? "" : String(parsed.ar).trim(),
    en: parsed.en === undefined || parsed.en === null ? "" : String(parsed.en).trim(),
  };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

function normalizeProteinFamilyKey(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (!ALLOWED_PROTEIN_FAMILIES.has(normalized)) {
    throw { status: 400, code: "INVALID", message: "proteinFamilyKey must be one of: chicken, beef, seafood, other" };
  }
  return normalized;
}

function normalizeRuleTags(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  let tags = value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      tags = parsed;
    } catch (_err) {
      tags = value.split(",");
    }
  }

  if (!Array.isArray(tags)) {
    throw { status: 400, code: "INVALID", message: "ruleTags must be an array of strings" };
  }

  return tags
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeNutrition(payload) {
  const source = payload && payload.nutrition && typeof payload.nutrition === "object"
    ? payload.nutrition
    : payload || {};

  const calories = Number(source.calories ?? 0);
  const proteinGrams = Number(source.proteinGrams ?? 0);
  const carbGrams = Number(source.carbGrams ?? 0);
  const fatGrams = Number(source.fatGrams ?? 0);

  const values = { calories, proteinGrams, carbGrams, fatGrams };
  for (const [key, raw] of Object.entries(values)) {
    if (!Number.isFinite(raw) || raw < 0) {
      throw { status: 400, code: "INVALID", message: `${key} must be a number >= 0` };
    }
  }

  return values;
}

async function resolveValidatedDisplayCategory(input) {
  const id = normalizeOptionalString(input);
  if (!id) {
    throw { status: 400, code: "INVALID", message: "displayCategoryId is required" };
  }
  validateObjectId(id, "displayCategoryId");

  const category = await BuilderCategory.findById(id).lean();
  if (!category) {
    throw { status: 400, code: "INVALID_CATEGORY", message: "Builder category not found" };
  }
  if (category.dimension !== "protein") {
    throw { status: 400, code: "INVALID_CATEGORY", message: "displayCategoryId must reference a protein builder category" };
  }

  return {
    displayCategoryId: String(category._id),
    displayCategoryKey: String(category.key || "").trim().toLowerCase(),
  };
}

async function validatePremiumMealPayloadOrThrow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }

  const name = normalizeLocalizedRequired(payload, "name");
  const description = normalizeLocalizedOptional(payload, "description");
  const { displayCategoryId, displayCategoryKey } = await resolveValidatedDisplayCategory(payload.displayCategoryId);
  const proteinFamilyKey = normalizeProteinFamilyKey(payload.proteinFamilyKey);
  const currency = payload.currency === undefined ? SYSTEM_CURRENCY : normalizeOptionalString(payload.currency).toUpperCase();
  if (!currency) {
    throw { status: 400, code: "INVALID", message: "currency must be a non-empty string" };
  }
  if (currency !== SYSTEM_CURRENCY) {
    throw { status: 400, code: "INVALID", message: `currency must be ${SYSTEM_CURRENCY}` };
  }

  const premiumCreditCost = Number(payload.premiumCreditCost ?? 0);
  if (!isNonNegativeInteger(premiumCreditCost)) {
    throw { status: 400, code: "INVALID", message: "premiumCreditCost must be an integer >= 0" };
  }

  const extraFeeHalala = Number(payload.extraFeeHalala ?? 0);
  if (!isNonNegativeInteger(extraFeeHalala)) {
    throw { status: 400, code: "INVALID", message: "extraFeeHalala must be an integer >= 0" };
  }

  const availableForSubscription = parseBooleanField(
    payload.availableForSubscription,
    "availableForSubscription",
    { defaultValue: true }
  );
  const isActive = parseBooleanField(payload.isActive, "isActive", { defaultValue: true });
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");
  const ruleTags = normalizeRuleTags(payload.ruleTags);
  const nutrition = normalizeNutrition(payload);

  return {
    name,
    description,
    displayCategoryId,
    displayCategoryKey,
    proteinFamilyKey,
    ruleTags,
    isPremium: true,
    premiumCreditCost,
    extraFeeHalala,
    currency,
    availableForSubscription,
    isActive,
    sortOrder,
    nutrition,
  };
}

async function listBuilderPremiumMeals(req, res) {
  const lang = getRequestLang(req);
  const rows = await BuilderProtein.find({ isActive: true, isPremium: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const mapped = rows.map((row) => mapBuilderProteinToPremiumMealEntry(row, lang));
  
  const customSaladEntry = buildCustomPremiumSaladEntry(lang);
  const allEntries = [...mapped, customSaladEntry];
  
  return res.status(200).json({ ok: true, data: allEntries });
}

async function listBuilderPremiumMealsAdmin(_req, res) {
  const rows = await BuilderProtein.find({ isPremium: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return res.status(200).json({
    ok: true,
    data: rows.map((row) => ({
      ...row,
      id: String(row._id),
      displayCategoryId: row.displayCategoryId ? String(row.displayCategoryId) : null,
      imageUrl: row.imageUrl || "",
    })),
  });
}

async function getBuilderPremiumMealAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await BuilderProtein.findOne({ _id: id, isPremium: true }).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  return res.status(200).json({
    ok: true,
    data: {
      ...row,
      id: String(row._id),
      displayCategoryId: row.displayCategoryId ? String(row.displayCategoryId) : null,
      imageUrl: row.imageUrl || "",
    },
  });
}

async function createBuilderPremiumMeal(req, res) {
  try {
    const payload = await validatePremiumMealPayloadOrThrow(req.body || {});
    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: PREMIUM_MEAL_IMAGE_FOLDER,
    });

    const row = await BuilderProtein.create({
      ...payload,
      imageUrl: imageState.imageUrl,
    });

    return res.status(201).json({ ok: true, data: { id: row.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    throw err;
  }
}

async function updateBuilderPremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const payload = await validatePremiumMealPayloadOrThrow(req.body || {});
    const existing = await BuilderProtein.findOne({ _id: id, isPremium: true });
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
      isPremium: true,
    });
    await existing.save();

    return res.status(200).json({ ok: true, data: { id: existing.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    throw err;
  }
}

async function deleteBuilderPremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const deleted = await BuilderProtein.findOneAndDelete({ _id: id, isPremium: true }).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }
  return res.status(200).json({ ok: true });
}

async function toggleBuilderPremiumMealActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await BuilderProtein.findOne({ _id: id, isPremium: true });
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  row.isActive = !row.isActive;
  await row.save();

  return res.status(200).json({ ok: true, data: { id: row.id, isActive: row.isActive } });
}

async function updateBuilderPremiumMealSortOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const row = await BuilderProtein.findOneAndUpdate(
      { _id: id, isPremium: true },
      { sortOrder },
      { new: true, runValidators: true }
    );
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

async function cloneBuilderPremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await BuilderProtein.findOne({ _id: id, isPremium: true }).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  const cloned = await BuilderProtein.create({
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl || "",
    displayCategoryId: row.displayCategoryId,
    displayCategoryKey: row.displayCategoryKey,
    proteinFamilyKey: row.proteinFamilyKey,
    ruleTags: Array.isArray(row.ruleTags) ? row.ruleTags : [],
    isPremium: true,
    premiumCreditCost: Number(row.premiumCreditCost || 0),
    extraFeeHalala: Number(row.extraFeeHalala || 0),
    currency: row.currency || SYSTEM_CURRENCY,
    availableForSubscription: row.availableForSubscription !== false,
    isActive: row.isActive !== false,
    sortOrder: Number(row.sortOrder || 0),
    nutrition: row.nutrition || {},
  });

  return res.status(201).json({ ok: true, data: { id: cloned.id } });
}

module.exports = {
  listBuilderPremiumMeals,
  listBuilderPremiumMealsAdmin,
  getBuilderPremiumMealAdmin,
  createBuilderPremiumMeal,
  updateBuilderPremiumMeal,
  deleteBuilderPremiumMeal,
  toggleBuilderPremiumMealActive,
  updateBuilderPremiumMealSortOrder,
  cloneBuilderPremiumMeal,
  validatePremiumMealPayloadOrThrow,
};
