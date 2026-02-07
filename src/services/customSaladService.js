const SaladIngredient = require("../models/SaladIngredient");
const Setting = require("../models/Setting");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function normalizeSelections(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    const err = new Error("Ingredients are required");
    err.code = "INVALID";
    throw err;
  }

  const map = new Map();
  for (const item of selections) {
    if (!item || !item.ingredientId) {
      const err = new Error("Each ingredient must include ingredientId");
      err.code = "INVALID";
      throw err;
    }
    const rawQty = parseInt(item.quantity || 1, 10);
    const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
    const key = String(item.ingredientId);
    map.set(key, (map.get(key) || 0) + qty);
  }
  return map;
}

async function buildCustomSaladSnapshot(selections) {
  const map = normalizeSelections(selections);
  const ids = Array.from(map.keys());

  const ingredients = await SaladIngredient.find({ _id: { $in: ids }, isActive: true }).lean();
  if (ingredients.length !== ids.length) {
    const err = new Error("One or more ingredients not found or inactive");
    err.code = "NOT_FOUND";
    throw err;
  }

  const basePriceSar = Number(await getSettingValue("custom_salad_base_price", 0));
  const basePrice = Math.round(basePriceSar * 100);

  let totalPrice = basePrice;
  const items = ingredients.map((ing) => {
    const qty = map.get(String(ing._id)) || 0;
    if (ing.maxQuantity && qty > ing.maxQuantity) {
      const err = new Error(`Quantity exceeds max for ingredient ${ing._id}`);
      err.code = "MAX_EXCEEDED";
      throw err;
    }
    const unitPriceSar = Number(ing.price || 0);
    const unitPrice = Math.round(unitPriceSar * 100);
    totalPrice += unitPrice * qty;
    return {
      ingredientId: ing._id,
      name_en: ing.name_en,
      name_ar: ing.name_ar,
      unitPriceSar,
      unitPrice,
      quantity: qty,
      calories: ing.calories,
    };
  });

  const totalPriceSar = totalPrice / 100;

  return {
    items,
    basePriceSar,
    basePrice,
    totalPriceSar,
    totalPrice,
    currency: "SAR",
  };
}

module.exports = { buildCustomSaladSnapshot };
