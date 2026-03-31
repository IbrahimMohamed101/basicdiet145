const Meal = require("../models/Meal");
const MealCategory = require("../models/MealCategory");
const { getRequestLang, pickLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const {
  normalizeCategoryKey,
  buildMealCategoryMap,
  resolveMealCategoryForKey,
} = require("../utils/mealCategoryCatalog");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const { parseBooleanField, parseLocalizedFieldFromBody } = require("../utils/requestFields");

const MEAL_IMAGE_FOLDER = "meals";

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMeal(doc, lang, categoryMap = null) {
  const category = categoryMap ? resolveMealCategoryForKey(doc.category, categoryMap, lang) : null;
  const categoryKey = normalizeCategoryKey(doc.category);

  return {
    ...doc,
    id: String(doc._id),
    name: pickLang(doc.name, lang),
    description: pickLang(doc.description, lang),
    imageUrl: doc.imageUrl || "",
    category: categoryKey,
    categoryKey,
    categoryMeta: category,
    availableForOrder: doc.availableForOrder !== false,
    availableForSubscription: doc.availableForSubscription !== false,
    sortOrder: resolveSortValue(doc.sortOrder),
  };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

async function resolveValidatedCategoryKey(rawValue, { allowEmpty = true } = {}) {
  const categoryKey = normalizeCategoryKey(rawValue);
  if (!categoryKey) {
    if (allowEmpty) return "";
    throw { status: 400, code: "INVALID", message: "categoryKey must be a non-empty string" };
  }

  const category = await MealCategory.findOne({ key: categoryKey }).lean();
  if (!category) {
    throw { status: 400, code: "INVALID_CATEGORY", message: "Meal category not found" };
  }

  return categoryKey;
}

function assertRegularType(body) {
  if (body && body.type !== undefined && body.type !== "regular") {
    return { ok: false, message: "Only regular meals are supported by this endpoint" };
  }
  return { ok: true };
}

async function listMeals(req, res) {
  const lang = getRequestLang(req);
  const [meals, categories] = await Promise.all([
    Meal.find({ type: "regular", isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MealCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);
  const categoryMap = buildMealCategoryMap(categories, lang);
  return res.status(200).json({ ok: true, data: meals.map((meal) => resolveMeal(meal, lang, categoryMap)) });
}

async function listMealsAdmin(_req, res) {
  const meals = await Meal.find({ type: "regular" }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({
    ok: true,
    data: meals.map((meal) => ({
      ...meal,
      id: String(meal._id),
      categoryKey: normalizeCategoryKey(meal.category),
    })),
  });
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

  return res.status(200).json({
    ok: true,
    data: {
      ...meal,
      id: String(meal._id),
      categoryKey: normalizeCategoryKey(meal.category),
    },
  });
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
    const categoryKey = Object.prototype.hasOwnProperty.call(req.body || {}, "categoryKey")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "category")
      ? await resolveValidatedCategoryKey(
        Object.prototype.hasOwnProperty.call(req.body || {}, "categoryKey") ? req.body.categoryKey : req.body.category,
        { allowEmpty: true }
      )
      : "";

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: MEAL_IMAGE_FOLDER,
    });

    const meal = await Meal.create({
      name,
      description: parseLocalizedFieldFromBody(req.body || {}, "description", { allowString: true }) || { ar: "", en: "" },
      imageUrl: imageState.imageUrl,
      category: categoryKey,
      type: "regular",
      availableForOrder: parseBooleanField(req.body && req.body.availableForOrder, "availableForOrder", { defaultValue: true }),
      availableForSubscription: parseBooleanField(
        req.body && req.body.availableForSubscription,
        "availableForSubscription",
        { defaultValue: true }
      ),
      sortOrder: req.body && req.body.sortOrder !== undefined ? normalizeSortOrder(req.body.sortOrder) : 0,
      isActive: parseBooleanField(req.body && req.body.isActive, "isActive", { defaultValue: true }),
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
    const meal = await Meal.findOne({ _id: id, type: "regular" });
    if (!meal) {
      return errorResponse(res, 404, "NOT_FOUND", "Meal not found");
    }

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

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: MEAL_IMAGE_FOLDER,
      currentImageUrl: meal.imageUrl,
    });
    if (imageState.changed) {
      update.imageUrl = imageState.imageUrl;
    }
    if (req.body && (Object.prototype.hasOwnProperty.call(req.body, "categoryKey")
      || Object.prototype.hasOwnProperty.call(req.body, "category"))) {
      update.category = await resolveValidatedCategoryKey(
        Object.prototype.hasOwnProperty.call(req.body, "categoryKey") ? req.body.categoryKey : req.body.category,
        { allowEmpty: true }
      );
    }
    if (req.body && req.body.isActive !== undefined) {
      update.isActive = parseBooleanField(req.body.isActive, "isActive");
    }
    if (req.body && req.body.availableForOrder !== undefined) {
      update.availableForOrder = parseBooleanField(req.body.availableForOrder, "availableForOrder");
    }
    if (req.body && req.body.availableForSubscription !== undefined) {
      update.availableForSubscription = parseBooleanField(
        req.body.availableForSubscription,
        "availableForSubscription"
      );
    }
    if (req.body && req.body.sortOrder !== undefined) {
      update.sortOrder = normalizeSortOrder(req.body.sortOrder);
    }

    if (Object.keys(update).length === 0) {
      return errorResponse(
        res,
        400,
        "INVALID",
        "At least one of name, description, image file, removeImage, categoryKey, availability flags, sortOrder, or isActive is required"
      );
    }

    meal.set(update);
    await meal.save();

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
