const Meal = require("../models/Meal");
const { getRequestLang, pickLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMeal(doc, lang) {
  return {
    ...doc,
    id: String(doc._id),
    name: pickLang(doc.name, lang),
    description: pickLang(doc.description, lang),
    imageUrl: doc.imageUrl || "",
    availableForOrder: doc.availableForOrder !== false,
    availableForSubscription: doc.availableForSubscription !== false,
    sortOrder: resolveSortValue(doc.sortOrder),
  };
}

function parseLocalizedFieldFromBody(body, fieldName, { preserveMissing = false, allowString = false } = {}) {
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const directValue = body ? body[fieldName] : undefined;

  if (allowString && typeof directValue === "string") {
    const value = directValue.trim();
    return value ? { ar: "", en: value } : { ar: "", en: "" };
  }

  if (directValue && typeof directValue === "object" && !Array.isArray(directValue)) {
    const parsed = {};
    if (hasOwn(directValue, "ar")) parsed.ar = directValue.ar || "";
    if (hasOwn(directValue, "en")) parsed.en = directValue.en || "";

    if (!preserveMissing) {
      if (!hasOwn(parsed, "ar")) parsed.ar = "";
      if (!hasOwn(parsed, "en")) parsed.en = "";
    }

    return Object.keys(parsed).length ? parsed : null;
  }

  const flatArKey = `${fieldName}_ar`;
  const flatEnKey = `${fieldName}_en`;
  if (body && (body[flatArKey] !== undefined || body[flatEnKey] !== undefined)) {
    const parsed = {};
    if (body[flatArKey] !== undefined) parsed.ar = body[flatArKey] || "";
    if (body[flatEnKey] !== undefined) parsed.en = body[flatEnKey] || "";

    if (!preserveMissing) {
      if (!hasOwn(parsed, "ar")) parsed.ar = "";
      if (!hasOwn(parsed, "en")) parsed.en = "";
    }

    return Object.keys(parsed).length ? parsed : null;
  }

  return null;
}

function normalizeImageUrl(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

function assertRegularType(body) {
  if (body && body.type !== undefined && body.type !== "regular") {
    return { ok: false, message: "Only regular meals are supported by this endpoint" };
  }
  return { ok: true };
}

async function listMeals(req, res) {
  const lang = getRequestLang(req);
  const meals = await Meal.find({ type: "regular", isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: meals.map((meal) => resolveMeal(meal, lang)) });
}

async function listMealsAdmin(_req, res) {
  const meals = await Meal.find({ type: "regular" }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: meals });
}

async function getMealAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const meal = await Meal.findOne({ _id: id, type: "regular" }).lean();
  if (!meal) {
    return errorResponse(res, 404, "NOT_FOUND", "Meal not found");
  }

  return res.status(200).json({ ok: true, data: meal });
}

async function createMeal(req, res) {
  const typeCheck = assertRegularType(req.body || {});
  if (!typeCheck.ok) {
    return errorResponse(res, 400, "INVALID", typeCheck.message);
  }

  const name = parseLocalizedFieldFromBody(req.body || {}, "name", { allowString: true });
  if (!name || (!name.ar && !name.en)) {
    return errorResponse(res, 400, "INVALID", "Missing meal name (provide name.ar and/or name.en)");
  }

  try {
    const meal = await Meal.create({
      name,
      description: parseLocalizedFieldFromBody(req.body || {}, "description", { allowString: true }) || { ar: "", en: "" },
      imageUrl: normalizeImageUrl(req.body && req.body.imageUrl),
      type: "regular",
      availableForOrder:
        req.body && req.body.availableForOrder !== undefined ? Boolean(req.body.availableForOrder) : true,
      availableForSubscription:
        req.body && req.body.availableForSubscription !== undefined
          ? Boolean(req.body.availableForSubscription)
          : true,
      sortOrder: req.body && req.body.sortOrder !== undefined ? normalizeSortOrder(req.body.sortOrder) : 0,
      isActive: req.body && req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
    });

    return res.status(201).json({ ok: true, data: { id: meal.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const typeCheck = assertRegularType(req.body || {});
  if (!typeCheck.ok) {
    return errorResponse(res, 400, "INVALID", typeCheck.message);
  }

  try {
    const update = {};
    const name = parseLocalizedFieldFromBody(req.body || {}, "name", { preserveMissing: true, allowString: true });
    if (name) {
      if (Object.prototype.hasOwnProperty.call(name, "ar")) update["name.ar"] = name.ar;
      if (Object.prototype.hasOwnProperty.call(name, "en")) update["name.en"] = name.en;
    }

    const description = parseLocalizedFieldFromBody(req.body || {}, "description", {
      preserveMissing: true,
      allowString: true,
    });
    if (description) {
      if (Object.prototype.hasOwnProperty.call(description, "ar")) update["description.ar"] = description.ar;
      if (Object.prototype.hasOwnProperty.call(description, "en")) update["description.en"] = description.en;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "imageUrl")) {
      update.imageUrl = normalizeImageUrl(req.body.imageUrl);
    }
    if (req.body && req.body.isActive !== undefined) {
      update.isActive = Boolean(req.body.isActive);
    }
    if (req.body && req.body.availableForOrder !== undefined) {
      update.availableForOrder = Boolean(req.body.availableForOrder);
    }
    if (req.body && req.body.availableForSubscription !== undefined) {
      update.availableForSubscription = Boolean(req.body.availableForSubscription);
    }
    if (req.body && req.body.sortOrder !== undefined) {
      update.sortOrder = normalizeSortOrder(req.body.sortOrder);
    }

    if (Object.keys(update).length === 0) {
      return errorResponse(
        res,
        400,
        "INVALID",
        "At least one of name, description, imageUrl, availability flags, sortOrder, or isActive is required"
      );
    }

    const meal = await Meal.findOneAndUpdate(
      { _id: id, type: "regular" },
      update,
      { new: true, runValidators: true }
    );
    if (!meal) {
      return errorResponse(res, 404, "NOT_FOUND", "Meal not found");
    }

    return res.status(200).json({ ok: true, data: { id: meal.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const deleted = await Meal.findOneAndDelete({ _id: id, type: "regular" }).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Meal not found");
  }

  return res.status(200).json({ ok: true });
}

async function toggleMealActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const meal = await Meal.findOne({ _id: id, type: "regular" });
  if (!meal) {
    return errorResponse(res, 404, "NOT_FOUND", "Meal not found");
  }

  meal.isActive = !meal.isActive;
  await meal.save();

  return res.status(200).json({ ok: true, data: { id: meal.id, isActive: meal.isActive } });
}

module.exports = {
  listMeals,
  listMealsAdmin,
  getMealAdmin,
  createMeal,
  updateMeal,
  deleteMeal,
  toggleMealActive,
};
