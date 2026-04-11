const Meal = require("../models/Meal");
const MealCategory = require("../models/MealCategory");
const mongoose = require("mongoose");
const { getRequestLang, pickLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { parseMealNutritionFromBody, withDefaultMealNutrition } = require("../utils/mealNutrition");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const { parseBooleanField, parseLocalizedFieldFromBody } = require("../utils/requestFields");

const MEAL_IMAGE_FOLDER = "meals";

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveMeal(doc, lang, categoryMap = null) {
  const normalizedDoc = withDefaultMealNutrition(doc);
  const categoryId = normalizedDoc.categoryId ? String(normalizedDoc.categoryId) : null;
  const categoryDoc = categoryMap && categoryId ? categoryMap.get(categoryId) : null;
  const category = categoryDoc
    ? {
      id: String(categoryDoc._id),
      name: pickLang(categoryDoc.name, lang) || "",
      slug: String(categoryDoc.key || "").trim().toLowerCase(),
      sortOrder: Number.isFinite(Number(categoryDoc.sortOrder)) ? Number(categoryDoc.sortOrder) : 0,
      isActive: categoryDoc.isActive !== false,
    }
    : null;

  return {
    ...normalizedDoc,
    id: String(normalizedDoc._id),
    name: pickLang(normalizedDoc.name, lang),
    description: pickLang(normalizedDoc.description, lang),
    imageUrl: normalizedDoc.imageUrl || "",
    categoryId,
    categoryMeta: category,
    availableForOrder: normalizedDoc.availableForOrder !== false,
    availableForSubscription: normalizedDoc.availableForSubscription !== false,
    sortOrder: resolveSortValue(normalizedDoc.sortOrder),
  };
}

function buildCategoryLookupMaps(categories = []) {
  const categoryMapById = new Map();

  for (const category of categories) {
    if (!category || !category._id) continue;
    categoryMapById.set(String(category._id), category);
  }

  return { categoryMapById };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

async function resolveValidatedCategoryId(rawValue, { allowEmpty = true } = {}) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    if (allowEmpty) return null;
    throw { status: 400, code: "INVALID", message: "categoryId must be a non-empty ObjectId" };
  }

  const value = String(rawValue).trim();
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw { status: 400, code: "INVALID", message: "categoryId must be a valid ObjectId" };
  }

  const category = await MealCategory.findById(value).lean();
  if (!category) {
    throw { status: 400, code: "INVALID_CATEGORY", message: "Meal category not found" };
  }

  return String(category._id);
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
  const { categoryMapById } = buildCategoryLookupMaps(categories);
  const data = meals.map((meal) => resolveMeal(meal, lang, categoryMapById));
  return res.status(200).json({ ok: true, data });
}

async function listMealsAdmin(_req, res) {
  const meals = await Meal.find({ type: "regular" }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  return res.status(200).json({
    ok: true,
    data: meals.map((meal) => {
      const normalizedMeal = withDefaultMealNutrition(meal);
      return {
        ...normalizedMeal,
        id: String(normalizedMeal._id),
        categoryId: normalizedMeal.categoryId ? String(normalizedMeal.categoryId) : null,
      };
    }),
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
      ...withDefaultMealNutrition(meal),
      id: String(meal._id),
      categoryId: meal.categoryId ? String(meal.categoryId) : null,
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

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "categoryKey")
    || Object.prototype.hasOwnProperty.call(req.body || {}, "category")) {
    return errorResponse(
      res,
      400,
      "INVALID",
      "categoryKey/category is deprecated for writes. Use categoryId instead."
    );
  }

  try {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "categoryId")) {
      return errorResponse(res, 400, "INVALID", "categoryId is required");
    }
    const categoryId = await resolveValidatedCategoryId(req.body.categoryId, { allowEmpty: false });

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: MEAL_IMAGE_FOLDER,
    });
    const nutrition = parseMealNutritionFromBody(req.body || {});

    const meal = await Meal.create({
      name,
      description: parseLocalizedFieldFromBody(req.body || {}, "description", { allowString: true }) || { ar: "", en: "" },
      imageUrl: imageState.imageUrl,
      categoryId,
      type: "regular",
      availableForOrder: parseBooleanField(req.body && req.body.availableForOrder, "availableForOrder", { defaultValue: true }),
      availableForSubscription: parseBooleanField(
        req.body && req.body.availableForSubscription,
        "availableForSubscription",
        { defaultValue: true }
      ),
      sortOrder: req.body && req.body.sortOrder !== undefined ? normalizeSortOrder(req.body.sortOrder) : 0,
      isActive: parseBooleanField(req.body && req.body.isActive, "isActive", { defaultValue: true }),
      ...nutrition,
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

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "categoryKey")
    || Object.prototype.hasOwnProperty.call(req.body || {}, "category")) {
    return errorResponse(
      res,
      400,
      "INVALID",
      "categoryKey/category is deprecated for writes. Use categoryId instead."
    );
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
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "categoryId")) {
      const categoryId = await resolveValidatedCategoryId(req.body.categoryId, { allowEmpty: true });
      update.categoryId = categoryId;
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
    const nutrition = parseMealNutritionFromBody(req.body || {}, { preserveMissing: true });
    if (nutrition) {
      Object.assign(update, nutrition);
    }

    if (Object.keys(update).length === 0) {
      return errorResponse(
        res,
        400,
        "INVALID",
        "At least one of name, description, image file, removeImage, categoryId, availability flags, sortOrder, isActive, or nutrition fields is required"
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

async function listCategoriesWithMeals(req, res) {
  const lang = getRequestLang(req);

  const categories = await MealCategory.aggregate([
    { $match: { isActive: true } },
    { $sort: { sortOrder: 1, createdAt: -1 } },
    {
      $lookup: {
        from: "meals",
        let: { catId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$categoryId", "$$catId"] },
                  { $eq: ["$isActive", true] },
                ],
              },
            },
          },
          { $sort: { sortOrder: 1, createdAt: -1 } },
        ],
        as: "categoryMeals",
      },
    },
    { $match: { categoryMeals: { $ne: [] } } },
  ]);

  const data = categories.map((category) => ({
    id: String(category._id),
    name: pickLang(category.name, lang) || "",
    slug: String(category.key || "").trim().toLowerCase(),
    sortOrder: resolveSortValue(category.sortOrder),
    meals: category.categoryMeals.map((meal) => ({
      id: String(meal._id),
      categoryId: String(meal.categoryId),
      name: pickLang(meal.name, lang) || "",
      description: pickLang(meal.description, lang) || "",
      imageUrl: meal.imageUrl || "",
      price: Number(meal.price) || 0,
      calories: Number(meal.calories) || 0,
      proteinGrams: Number(meal.proteinGrams) || 33,
      carbGrams: Number(meal.carbGrams) || 37,
      fatGrams: Number(meal.fatGrams) || 19,
      availableForOrder: meal.availableForOrder !== false,
      availableForSubscription: meal.availableForSubscription !== false,
      type: meal.type || "regular",
      sortOrder: resolveSortValue(meal.sortOrder),
    })),
  }));

  return res.status(200).json({ status: true, data });
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
  listCategoriesWithMeals,
};
