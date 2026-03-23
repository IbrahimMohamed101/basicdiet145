const SaladIngredient = require("../models/SaladIngredient");
const Setting = require("../models/Setting");
const { createLocalizedError } = require("../utils/errorLocalization");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function resolveIngredientName(ingredient, lang) {
  const current = ingredient && ingredient.name;

  // Fix: prefer new multilingual shape, but keep legacy flat-field fallback during transition.
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

async function buildCustomSaladSnapshot(selections) {
  const map = normalizeSelections(selections);
  const ids = Array.from(map.keys());

  const ingredients = await SaladIngredient.find({ _id: { $in: ids }, isActive: true }).lean();
  if (ingredients.length !== ids.length) {
    throw createLocalizedError({
      code: "NOT_FOUND",
      key: "errors.ingredients.notFoundOrInactive",
      fallbackMessage: "One or more ingredients not found or inactive",
    });
  }

  const basePriceSar = Number(await getSettingValue("custom_salad_base_price", 0));
  const basePrice = Math.round(basePriceSar * 100);

  let totalPrice = basePrice;
  const items = ingredients.map((ing) => {
    const qty = map.get(String(ing._id)) || 0;
    if (ing.maxQuantity && qty > ing.maxQuantity) {
      throw createLocalizedError({
        code: "MAX_EXCEEDED",
        key: "errors.ingredients.maxExceeded",
        params: { ingredientId: String(ing._id) },
        fallbackMessage: `Quantity exceeds max for ingredient ${ing._id}`,
      });
    }
    const unitPriceSar = Number(ing.price || 0);
    const unitPrice = Math.round(unitPriceSar * 100);
    totalPrice += unitPrice * qty;
    return {
      ingredientId: ing._id,
      name_en: resolveIngredientName(ing, "en"),
      name_ar: resolveIngredientName(ing, "ar"),
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
