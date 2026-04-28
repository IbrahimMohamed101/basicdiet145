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
const { sanitizeObject } = require("../../utils/encoding");

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";
const LARGE_SALAD_KEY = "large_salad";

const CUSTOM_PREMIUM_SALAD_NAMES = {
  ar: "سلطة مميزة",
  en: "Custom Premium Salad",
};

const PRESET_GROUPS = [
  { key: "vegetables", name: { ar: "خضروات", en: "Vegetables" }, minSelect: 0, maxSelect: 99 },
  { key: "addons", name: { ar: "إضافات", en: "Addons" }, minSelect: 0, maxSelect: 99 },
  { key: "fruits", name: { ar: "فواكه", en: "Fruits" }, minSelect: 0, maxSelect: 99 },
  { key: "nuts", name: { ar: "مكسرات", en: "Nuts" }, minSelect: 0, maxSelect: 99 },
  { key: "sauce", name: { ar: "الصوص", en: "Sauce" }, minSelect: 1, maxSelect: 1 },
];

const VALID_GROUP_KEYS = new Set(PRESET_GROUPS.map(g => g.key));

async function getMealPlannerCatalog({ lang }) {
  const [categories, proteins, carbs, saladIngredients] = await Promise.all([
    BuilderCategory.find({ isActive: true }).sort({ dimension: 1, sortOrder: 1, createdAt: -1 }).lean(),
    BuilderProtein.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    SaladIngredient.find({ isActive: true }).sort({ groupKey: 1, sortOrder: 1, createdAt: -1 }).lean(),
  ]);

  const largeSaladCarb = carbs.find(c => c.displayCategoryKey === LARGE_SALAD_KEY) || carbs[0] || null;
  const carbId = largeSaladCarb ? String(largeSaladCarb._id) : null;

  const groupKeySet = new Set();
  const validIngredients = [];
  const orphanIngredients = [];

  for (const ing of saladIngredients) {
    const ingGroupKey = String(ing.groupKey || "");
    if (!ingGroupKey || !VALID_GROUP_KEYS.has(ingGroupKey)) {
      orphanIngredients.push({
        id: String(ing._id),
        name: pickLang(ing.name, lang),
        groupKey: ingGroupKey || "(none)",
      });
      continue;
    }
    groupKeySet.add(ingGroupKey);
    validIngredients.push(ing);
  }

  const missingGroups = [];
  for (const preset of PRESET_GROUPS) {
    if (!groupKeySet.has(preset.key)) {
      missingGroups.push(preset.key);
    }
  }

  const customPremiumSalad = {
    enabled: true,
    id: CUSTOM_PREMIUM_SALAD_KEY,
    carbId,
    selectionType: CUSTOM_PREMIUM_SALAD_TYPE,
    name: lang === "ar" ? CUSTOM_PREMIUM_SALAD_NAMES.ar : CUSTOM_PREMIUM_SALAD_NAMES.en,
    extraFeeHalala: CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
    currency: "SAR",
    preset: {
      key: LARGE_SALAD_KEY,
      name: lang === "ar" ? CUSTOM_PREMIUM_SALAD_NAMES.ar : CUSTOM_PREMIUM_SALAD_NAMES.en,
      selectionType: CUSTOM_PREMIUM_SALAD_TYPE,
      fixedPriceHalala: CUSTOM_PREMIUM_SALAD_FIXED_PRICE_HALALA,
      currency: "SAR",
      groups: PRESET_GROUPS.map(g => ({
        key: g.key,
        name: lang === "ar" ? g.name.ar : g.name.en,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
      })),
    },
    ingredients: validIngredients.map((ing) => ({
      id: String(ing._id),
      groupKey: String(ing.groupKey || ""),
      name: pickLang(ing.name, lang),
      calories: Number(ing.calories || 0),
    })),
  };

  if (orphanIngredients.length > 0 || missingGroups.length > 0 || !carbId) {
    console.warn("[mealPlannerCatalog] customPremiumSalad data issues:", {
      orphanIngredients: orphanIngredients.length,
      orphanExamples: orphanIngredients.slice(0, 5),
      missingGroups,
      carbId,
    });
  }

  return sanitizeObject({
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
  });
}

module.exports = {
  getMealPlannerCatalog,
};
