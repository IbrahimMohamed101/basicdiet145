const BuilderCategory = require("../../models/BuilderCategory");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const SaladIngredient = require("../../models/SaladIngredient");
const { pickLang } = require("../../utils/i18n");
const { 
  getMealPlannerRules, 
  CUSTOM_PREMIUM_SALAD_TYPE,
  CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA 
} = require("./mealSlotPlannerService");

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";

const CUSTOM_PREMIUM_SALAD_NAMES = {
  ar: "سلطة مميزة",
  en: "Custom Premium Salad",
};

async function getMealPlannerCatalog({ lang }) {
  const [categories, proteins, carbs, saladIngredients] = await Promise.all([
    BuilderCategory.find({ isActive: true }).sort({ dimension: 1, sortOrder: 1, createdAt: -1 }).lean(),
    BuilderProtein.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    SaladIngredient.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
  ]);

  const saladGroups = {};
  for (const ing of saladIngredients) {
    const groupKey = String(ing.name && (ing.name.ar || ing.name.en) || "");
    const key = groupKey.toLowerCase().trim();
    if (!saladGroups[key]) {
      saladGroups[key] = {
        key,
        name: { ar: groupKey, en: groupKey },
        minSelect: 0,
        maxSelect: 1,
      };
    }
  }

  const customPremiumSalad = {
    enabled: true,
    id: CUSTOM_PREMIUM_SALAD_KEY,
    carbId: null,
    selectionType: CUSTOM_PREMIUM_SALAD_TYPE,
    name: lang === "ar" ? CUSTOM_PREMIUM_SALAD_NAMES.ar : CUSTOM_PREMIUM_SALAD_NAMES.en,
    extraFeeHalala: CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
    currency: "SAR",
    preset: {
      key: CUSTOM_PREMIUM_SALAD_KEY,
      name: lang === "ar" ? CUSTOM_PREMIUM_SALAD_NAMES.ar : CUSTOM_PREMIUM_SALAD_NAMES.en,
      selectionType: CUSTOM_PREMIUM_SALAD_TYPE,
      fixedPriceHalala: CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
      currency: "SAR",
      groups: Object.values(saladGroups).slice(0, 5),
    },
    ingredients: saladIngredients.map((ing) => ({
      id: String(ing._id),
      groupKey: String(ing.name && (ing.name.ar || ing.name.en) || ""),
      name: pickLang(ing.name, lang),
      calories: Number(ing.calories || 0),
    })),
  };

  return {
    categories: categories.map((category) => ({
      id: String(category._id),
      key: category.key,
      dimension: category.dimension,
      name: pickLang(category.name, lang),
      description: pickLang(category.description, lang),
      sortOrder: Number(category.sortOrder || 0),
      rules: category.rules || {},
    })),
    proteins: proteins.map((protein) => ({
      id: String(protein._id),
      displayCategoryId: String(protein.displayCategoryId),
      displayCategoryKey: protein.displayCategoryKey,
      name: pickLang(protein.name, lang),
      description: pickLang(protein.description, lang),
      proteinFamilyKey: protein.proteinFamilyKey,
      ruleTags: Array.isArray(protein.ruleTags) ? protein.ruleTags : [],
      selectionType: protein.isPremium ? null : 'standard_combo',
      isFullMealReplacement: false,
      isPremium: Boolean(protein.isPremium),
      premiumKey: protein.premiumKey || null,
      premiumCreditCost: Number(protein.premiumCreditCost || 0),
      extraFeeHalala: Number(protein.extraFeeHalala || 0),
      currency: protein.currency || "SAR",
      sortOrder: Number(protein.sortOrder || 0),
    })),
    carbs: carbs.map((carb) => ({
      id: String(carb._id),
      displayCategoryId: String(carb.displayCategoryId),
      displayCategoryKey: carb.displayCategoryKey,
      name: pickLang(carb.name, lang),
      description: pickLang(carb.description, lang),
      sortOrder: Number(carb.sortOrder || 0),
    })),
    rules: getMealPlannerRules(),
    customPremiumSalad,
  };
}

module.exports = {
  getMealPlannerCatalog,
};
