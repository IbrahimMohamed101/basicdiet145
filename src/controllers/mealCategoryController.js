const MealCategory = require("../models/MealCategory");
const Meal = require("../models/Meal");
const errorResponse = require("../utils/errorResponse");
const validateObjectId = require("../utils/validateObjectId");
const {
  UNCATEGORIZED_MEAL_SECTION_KEY,
  normalizeCategoryKey,
  resolveMealCategoryEntry,
} = require("../utils/mealCategoryCatalog");
const { getRequestLang } = require("../utils/i18n");

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function createControlledError(status, code, message) {
  return { status, code, message };
}

function normalizeLocalizedRequired(input, fieldName = "name") {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) {
      throw createControlledError(400, "INVALID", `${fieldName} must have at least one non-empty value in ar or en`);
    }
    return { ar: "", en: value };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be an object with ar/en or a non-empty string`);
  }

  const ar = input.ar === undefined || input.ar === null ? "" : String(input.ar).trim();
  const en = input.en === undefined || input.en === null ? "" : String(input.en).trim();

  if (!ar && !en) {
    throw createControlledError(400, "INVALID", `${fieldName} must have at least one non-empty value in ar or en`);
  }

  return { ar, en };
}

function normalizeLocalizedOptional(input, fieldName = "description") {
  if (input === undefined || input === null) return { ar: "", en: "" };

  if (typeof input === "string") {
    return { ar: "", en: input.trim() };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be an object with ar/en or a string`);
  }

  return {
    ar: input.ar === undefined || input.ar === null ? "" : String(input.ar).trim(),
    en: input.en === undefined || input.en === null ? "" : String(input.en).trim(),
  };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be an integer >= 0`);
  }
  return parsed;
}

function assertValidCategoryKeyOrThrow(value) {
  const key = normalizeCategoryKey(value);
  if (!key) {
    throw createControlledError(400, "INVALID", "key must be a non-empty string");
  }
  if (key === UNCATEGORIZED_MEAL_SECTION_KEY) {
    throw createControlledError(400, "INVALID", "key is reserved");
  }
  return key;
}

async function ensureUniqueKeyOrThrow(key, { excludeId = null } = {}) {
  const query = { key };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const existing = await MealCategory.findOne(query).lean();
  if (existing) {
    throw createControlledError(409, "CONFLICT", "Meal category key already exists");
  }
}

function serializeCategoryAdmin(doc) {
  return {
    ...doc,
    id: String(doc._id),
    key: normalizeCategoryKey(doc.key),
  };
}

async function listMealCategoriesAdmin(req, res) {
  const lang = getRequestLang(req);
  const rows = await MealCategory.find().sort({ sortOrder: 1, createdAt: -1 }).lean();

  return res.status(200).json({
    ok: true,
    data: rows.map((row) => ({
      ...serializeCategoryAdmin(row),
      localized: resolveMealCategoryEntry(row, lang),
    })),
  });
}

async function getMealCategoryAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await MealCategory.findById(id).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Meal category not found");
  }

  return res.status(200).json({ ok: true, data: serializeCategoryAdmin(row) });
}

async function createMealCategory(req, res) {
  try {
    const name = normalizeLocalizedRequired(req.body && req.body.name, "name");
    const description = normalizeLocalizedOptional(req.body && req.body.description, "description");
    const rawKey = hasOwn(req.body || {}, "key")
      ? req.body.key
      : hasOwn(req.body || {}, "categoryKey")
        ? req.body.categoryKey
        : name.en || name.ar;
    const key = assertValidCategoryKeyOrThrow(rawKey);

    await ensureUniqueKeyOrThrow(key);

    const row = await MealCategory.create({
      key,
      name,
      description,
      isActive: req.body && req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
      sortOrder: req.body && req.body.sortOrder !== undefined ? normalizeSortOrder(req.body.sortOrder) : 0,
    });

    return res.status(201).json({ ok: true, data: { id: row.id, key: row.key } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateMealCategory(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const row = await MealCategory.findById(id);
    if (!row) {
      return errorResponse(res, 404, "NOT_FOUND", "Meal category not found");
    }

    if (hasOwn(req.body, "name")) {
      row.name = normalizeLocalizedRequired(req.body.name, "name");
    }
    if (hasOwn(req.body, "description")) {
      row.description = normalizeLocalizedOptional(req.body.description, "description");
    }
    if (hasOwn(req.body, "key") || hasOwn(req.body, "categoryKey")) {
      const nextKey = assertValidCategoryKeyOrThrow(
        hasOwn(req.body, "key") ? req.body.key : req.body.categoryKey
      );

      if (nextKey !== normalizeCategoryKey(row.key)) {
        await ensureUniqueKeyOrThrow(nextKey, { excludeId: row._id });
        await Meal.updateMany(
          { category: normalizeCategoryKey(row.key) },
          { $set: { category: nextKey } }
        );
        row.key = nextKey;
      }
    }
    if (hasOwn(req.body, "isActive")) {
      row.isActive = Boolean(req.body.isActive);
    }
    if (hasOwn(req.body, "sortOrder")) {
      row.sortOrder = normalizeSortOrder(req.body.sortOrder);
    }

    await row.save();
    return res.status(200).json({ ok: true, data: { id: row.id, key: row.key } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteMealCategory(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await MealCategory.findById(id).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Meal category not found");
  }

  const categoryKey = normalizeCategoryKey(row.key);
  const assignedMealsCount = await Meal.countDocuments({ category: categoryKey });
  if (assignedMealsCount > 0) {
    return errorResponse(res, 409, "CATEGORY_IN_USE", "Meal category is assigned to one or more meals");
  }

  await MealCategory.deleteOne({ _id: id });
  return res.status(200).json({ ok: true });
}

async function toggleMealCategoryActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const row = await MealCategory.findById(id);
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Meal category not found");
  }

  row.isActive = !row.isActive;
  await row.save();

  return res.status(200).json({ ok: true, data: { id: row.id, isActive: row.isActive } });
}

async function updateMealCategorySortOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder);
    const row = await MealCategory.findByIdAndUpdate(id, { sortOrder }, { new: true, runValidators: true });
    if (!row) {
      return errorResponse(res, 404, "NOT_FOUND", "Meal category not found");
    }

    return res.status(200).json({ ok: true, data: { id: row.id, sortOrder: row.sortOrder } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

module.exports = {
  listMealCategoriesAdmin,
  getMealCategoryAdmin,
  createMealCategory,
  updateMealCategory,
  deleteMealCategory,
  toggleMealCategoryActive,
  updateMealCategorySortOrder,
};
