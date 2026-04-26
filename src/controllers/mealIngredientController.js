const MealIngredient = require("../models/MealIngredient");
const { getRequestLang, pickLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

function resolveIngredient(doc, lang) {
  return {
    ...doc,
    name: pickLang(doc.name, lang),
  };
}

function parseNameFromBody(body, { preserveMissing = false } = {}) {
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  if (body.name && typeof body.name === "object" && !Array.isArray(body.name)) {
    const parsed = {};
    if (hasOwn(body.name, "ar")) parsed.ar = body.name.ar || "";
    if (hasOwn(body.name, "en")) parsed.en = body.name.en || "";

    if (!preserveMissing) {
      if (!hasOwn(parsed, "ar")) parsed.ar = "";
      if (!hasOwn(parsed, "en")) parsed.en = "";
    }

    return Object.keys(parsed).length ? parsed : null;
  }

  if (body.name_ar !== undefined || body.name_en !== undefined) {
    const parsed = {};
    if (body.name_ar !== undefined) parsed.ar = body.name_ar || "";
    if (body.name_en !== undefined) parsed.en = body.name_en || "";

    if (!preserveMissing) {
      if (!hasOwn(parsed, "ar")) parsed.ar = "";
      if (!hasOwn(parsed, "en")) parsed.en = "";
    }

    return Object.keys(parsed).length ? parsed : null;
  }

  return null;
}

function parsePositivePrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function listActiveIngredients(req, res) {
  const lang = getRequestLang(req);
  const items = await MealIngredient.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const resolved = items.map((item) => resolveIngredient(item, lang));
  return res.status(200).json({ ok: true, data: resolved });
}

async function listIngredientsAdmin(_req, res) {
  const items = await MealIngredient.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: items });
}

async function createIngredient(req, res) {
  try {
    const { price, calories, maxQuantity, category, sortOrder } = req.body || {};
    const name = parseNameFromBody(req.body || {});
    if (!name || (!name.ar && !name.en)) {
      return errorResponse(res, 400, "INVALID", "Missing ingredient name (provide name.ar and/or name.en)");
    }
    const parsedPrice = parsePositivePrice(price);
    if (price === undefined || parsedPrice === null) {
      return errorResponse(res, 400, "INVALID", "price must be a finite number greater than 0");
    }

    const ingredient = await MealIngredient.create({
      name,
      category: category !== undefined ? String(category || "").trim() : "",
      price: parsedPrice,
      calories: calories !== undefined ? Number(calories) : undefined,
      maxQuantity: maxQuantity !== undefined ? Number(maxQuantity) : undefined,
      sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      isActive: true,
    });
    return res.status(201).json({ ok: true, data: ingredient });
  } catch (_err) {
    return errorResponse(res, 400, "INVALID", "Invalid ingredient payload");
  }
}

async function updateIngredient(req, res) {
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "ingredientId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const { price, calories, maxQuantity, isActive, category, sortOrder } = req.body || {};
    const update = {};

    const name = parseNameFromBody(req.body || {}, { preserveMissing: true });
    if (name) {
      if (Object.prototype.hasOwnProperty.call(name, "ar")) update["name.ar"] = name.ar;
      if (Object.prototype.hasOwnProperty.call(name, "en")) update["name.en"] = name.en;
    }
    if (price !== undefined) {
      const parsedPrice = parsePositivePrice(price);
      if (parsedPrice === null) {
        return errorResponse(res, 400, "INVALID", "price must be a finite number greater than 0");
      }
      update.price = parsedPrice;
    }
    if (category !== undefined) update.category = String(category || "").trim();
    if (calories !== undefined) update.calories = Number(calories);
    if (maxQuantity !== undefined) update.maxQuantity = maxQuantity === null ? undefined : Number(maxQuantity);
    if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
    if (isActive !== undefined) update.isActive = Boolean(isActive);

    const ingredient = await MealIngredient.findByIdAndUpdate(id, update, { new: true });
    if (!ingredient) {
      return errorResponse(res, 404, "NOT_FOUND", "Ingredient not found");
    }
    return res.status(200).json({ ok: true, data: ingredient });
  } catch (_err) {
    return errorResponse(res, 400, "INVALID", "Invalid ingredient update request");
  }
}

async function toggleIngredient(req, res) {
  try {
    const { id } = req.params;
    try {
      validateObjectId(id, "ingredientId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }

    const ingredient = await MealIngredient.findById(id);
    if (!ingredient) {
      return errorResponse(res, 404, "NOT_FOUND", "Ingredient not found");
    }
    ingredient.isActive = !ingredient.isActive;
    await ingredient.save();
    return res.status(200).json({ ok: true, data: ingredient });
  } catch (_err) {
    return errorResponse(res, 400, "INVALID", "Invalid ingredient toggle request");
  }
}

module.exports = {
  listActiveIngredients,
  listIngredientsAdmin,
  createIngredient,
  updateIngredient,
  toggleIngredient,
};
