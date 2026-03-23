const MealIngredient = require("../models/MealIngredient");
const Setting = require("../models/Setting");
const { createLocalizedError } = require("../utils/errorLocalization");

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
    throw createLocalizedError({
      code: "INVALID",
      key: "errors.ingredients.required",
      fallbackMessage: "Ingredients are required",
    });
  }

  const map = new Map();
  for (const item of selections) {
    if (!item || !item.ingredientId) {
      throw createLocalizedError({
        code: "INVALID",
        key: "errors.ingredients.ingredientIdRequired",
        fallbackMessage: "Each ingredient must include ingredientId",
      });
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
    throw createLocalizedError({
      code: "NOT_FOUND",
      key: "errors.ingredients.notFoundOrInactive",
      fallbackMessage: "One or more ingredients not found or inactive",
    });
  }

  const basePriceSar = Number(await getSettingValue("custom_meal_base_price", 0));
  const basePrice = Math.round(basePriceSar * 100);

  let totalPrice = basePrice;
  const items = ingredients.map((ingredient) => {
    const qty = map.get(String(ingredient._id)) || 0;
    if (ingredient.maxQuantity && qty > ingredient.maxQuantity) {
      throw createLocalizedError({
        code: "MAX_EXCEEDED",
        key: "errors.ingredients.maxExceeded",
        params: { ingredientId: String(ingredient._id) },
        fallbackMessage: `Quantity exceeds max for ingredient ${ingredient._id}`,
      });
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
