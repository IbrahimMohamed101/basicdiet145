const SaladIngredient = require("../models/SaladIngredient");

async function listActiveIngredients(_req, res) {
  const items = await SaladIngredient.find({ isActive: true }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ ok: true, data: items });
}

async function createIngredient(req, res) {
  const { name_en, name_ar, price, calories, maxQuantity } = req.body || {};
  if (!name_en && !name_ar) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing ingredient name" } });
  }
  if (price === undefined || Number(price) < 0) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid price" } });
  }
  const ingredient = await SaladIngredient.create({
    name_en,
    name_ar,
    price: Number(price),
    calories: calories !== undefined ? Number(calories) : undefined,
    maxQuantity: maxQuantity !== undefined ? Number(maxQuantity) : undefined,
    isActive: true,
  });
  return res.status(201).json({ ok: true, data: ingredient });
}

async function updateIngredient(req, res) {
  const { id } = req.params;
  const { name_en, name_ar, price, calories, maxQuantity, isActive } = req.body || {};
  const update = {};
  if (name_en !== undefined) update.name_en = name_en;
  if (name_ar !== undefined) update.name_ar = name_ar;
  if (price !== undefined) {
    if (Number(price) < 0) {
      return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Invalid price" } });
    }
    update.price = Number(price);
  }
  if (calories !== undefined) update.calories = Number(calories);
  if (maxQuantity !== undefined) update.maxQuantity = maxQuantity === null ? undefined : Number(maxQuantity);
  if (isActive !== undefined) update.isActive = Boolean(isActive);

  const ingredient = await SaladIngredient.findByIdAndUpdate(id, update, { new: true });
  if (!ingredient) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Ingredient not found" } });
  }
  return res.status(200).json({ ok: true, data: ingredient });
}

async function toggleIngredient(req, res) {
  const { id } = req.params;
  const ingredient = await SaladIngredient.findById(id);
  if (!ingredient) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Ingredient not found" } });
  }
  ingredient.isActive = !ingredient.isActive;
  await ingredient.save();
  return res.status(200).json({ ok: true, data: ingredient });
}

module.exports = {
  listActiveIngredients,
  createIngredient,
  updateIngredient,
  toggleIngredient,
};
