const Meal = require("../models/Meal");
const { getRequestLang, pickLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");

function resolveMeal(doc, lang) {
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

function assertRegularType(body) {
  if (body && body.type !== undefined && body.type !== "regular") {
    return { ok: false, message: "Only regular meals are supported by this endpoint" };
  }
  return { ok: true };
}

async function listMeals(req, res) {
  const lang = getRequestLang(req);
  const meals = await Meal.find({ type: "regular", isActive: true }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: meals.map((meal) => resolveMeal(meal, lang)) });
}

async function listMealsAdmin(_req, res) {
  const meals = await Meal.find({ type: "regular" }).sort({ createdAt: -1 }).lean();
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

  const name = parseNameFromBody(req.body || {});
  if (!name || (!name.ar && !name.en)) {
    return errorResponse(res, 400, "INVALID", "Missing meal name (provide name.ar and/or name.en)");
  }

  const meal = await Meal.create({
    name,
    type: "regular",
    isActive: req.body && req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
  });

  return res.status(201).json({ ok: true, data: { id: meal.id } });
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

  const update = {};
  const name = parseNameFromBody(req.body || {}, { preserveMissing: true });
  if (name) {
    if (Object.prototype.hasOwnProperty.call(name, "ar")) update["name.ar"] = name.ar;
    if (Object.prototype.hasOwnProperty.call(name, "en")) update["name.en"] = name.en;
  }
  if (req.body && req.body.isActive !== undefined) {
    update.isActive = Boolean(req.body.isActive);
  }

  if (Object.keys(update).length === 0) {
    return errorResponse(res, 400, "INVALID", "At least one of name or isActive is required");
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
