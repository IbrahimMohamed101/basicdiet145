const MealIngredient = require("../models/MealIngredient");
const Setting = require("../models/Setting");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function resolveIngredientName(ingredient, lang) {
  const current = ingredient && ingredient.name;

  if (current && typeof current === "object" && !Array.isArray(current)) {
    if (current[lang]) return current[lang];
    return lang === "en" ? (current.ar || "") : (current.en || "");
  }
  if (typeof current === "string") return current;

  if (lang === "en") return ingredient.name_en || ingredient.name_ar || "";
  return ingredient.name_ar || ingredient.name_en || "";
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

async function buildCustomMealSnapshot(selections) {
  const map = normalizeSelections(selections);
  const ids = Array.from(map.keys());

  const ingredients = await MealIngredient.find({ _id: { $in: ids }, isActive: true }).lean();
  if (ingredients.length !== ids.length) {
    const err = new Error("One or more ingredients not found or inactive");
    err.code = "NOT_FOUND";
    throw err;
  }

  const basePriceSar = Number(await getSettingValue("custom_meal_base_price", 0));
  const basePrice = Math.round(basePriceSar * 100);

  let totalPrice = basePrice;
  const items = ingredients.map((ingredient) => {
    const qty = map.get(String(ingredient._id)) || 0;
    if (ingredient.maxQuantity && qty > ingredient.maxQuantity) {
      const err = new Error(`Quantity exceeds max for ingredient ${ingredient._id}`);
      err.code = "MAX_EXCEEDED";
      throw err;
    }

    const unitPriceSar = Number(ingredient.price || 0);
    const unitPrice = Math.round(unitPriceSar * 100);
    totalPrice += unitPrice * qty;

    return {
      ingredientId: ingredient._id,
      name_en: resolveIngredientName(ingredient, "en"),
      name_ar: resolveIngredientName(ingredient, "ar"),
      category: ingredient.category || "",
      unitPriceSar,
      unitPrice,
      quantity: qty,
      calories: ingredient.calories,
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

module.exports = { buildCustomMealSnapshot };
