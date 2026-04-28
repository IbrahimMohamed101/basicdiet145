const BuilderCategory = require("../../models/BuilderCategory");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const SaladIngredient = require("../../models/SaladIngredient");
const Meal = require("../../models/Meal");
const MealCategory = require("../../models/MealCategory");
const { pickLang } = require("../../utils/i18n");
const { 
  getMealPlannerRules, 
  CANONICAL_PREMIUM_SALAD_KEY,
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA 
} = require("./mealSlotPlannerService");
const { NEW_TYPES } = require("../../utils/subscription/mealTypeMapper");
const { sanitizeObject } = require("../../utils/encoding");

const LARGE_SALAD_KEY = "large_salad";

const SALAD_GROUPS = [
  { key: "leafy_greens", name: { ar: "ورقيات", en: "Leafy Greens" }, minSelect: 0, maxSelect: 99 },
  { key: "vegetables", name: { ar: "خضار", en: "Vegetables" }, minSelect: 0, maxSelect: 99 },
  { key: "fruits", name: { ar: "فواكه", en: "Fruits" }, minSelect: 0, maxSelect: 99 },
  { key: "protein", name: { ar: "بروتينات", en: "Protein" }, minSelect: 1, maxSelect: 1 },
  { key: "cheese_nuts", name: { ar: "جبن ومكسرات", en: "Cheese & Nuts" }, minSelect: 0, maxSelect: 99 },
  { key: "sauce", name: { ar: "صوصات", en: "Sauce" }, minSelect: 1, maxSelect: 1 },
];

async function getMealPlannerCatalog({ lang }) {
  const [categories, allProteins, carbs, saladIngredients, mealCategories, allMeals] = await Promise.all([
    BuilderCategory.find({ isActive: true }).sort({ dimension: 1, sortOrder: 1, createdAt: -1 }).lean(),
    BuilderProtein.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    SaladIngredient.find({ isActive: true }).sort({ groupKey: 1, sortOrder: 1, createdAt: -1 }).lean(),
    MealCategory.find({ isActive: true }).lean(),
    Meal.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1 }).lean(),
  ]);

  const sandwichCategory = mealCategories.find(c => c.key === "sandwich");
  const sandwiches = sandwichCategory 
    ? allMeals.filter(m => String(m.categoryId) === String(sandwichCategory._id))
    : [];

  const proteins = allProteins.filter(p => !p.isPremium);
  const premiumProteins = allProteins.filter(p => p.isPremium);

  const saladConfig = {
    enabled: true,
    premiumKey: CANONICAL_PREMIUM_SALAD_KEY,
    selectionType: NEW_TYPES.PREMIUM_LARGE_SALAD,
    extraFeeHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
    groups: SALAD_GROUPS.map(g => ({
      key: g.key,
      name: pickLang(g.name, lang),
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
    })),
    ingredients: saladIngredients.map(ing => ({
      id: String(ing._id),
      groupKey: ing.groupKey,
      name: pickLang(ing.name, lang),
      calories: ing.calories || 0,
    })),
  };

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
    proteins: proteins.map((p) => ({
      id: String(p._id),
      displayCategoryKey: p.displayCategoryKey,
      name: pickLang(p.name, lang),
      description: pickLang(p.description, lang),
      proteinFamilyKey: p.proteinFamilyKey,
      ruleTags: p.ruleTags || [],
      selectionType: NEW_TYPES.STANDARD_MEAL,
      isPremium: false,
      sortOrder: p.sortOrder || 0,
    })),
    premiumProteins: premiumProteins.map((p) => ({
      id: String(p._id),
      displayCategoryKey: p.displayCategoryKey,
      name: pickLang(p.name, lang),
      description: pickLang(p.description, lang),
      proteinFamilyKey: p.proteinFamilyKey,
      ruleTags: p.ruleTags || [],
      selectionType: NEW_TYPES.PREMIUM_MEAL,
      isPremium: true,
      premiumKey: p.premiumKey,
      extraFeeHalala: p.extraFeeHalala || 0,
      sortOrder: p.sortOrder || 0,
    })),
    carbs: carbs.map((carb) => ({
      id: String(carb._id),
      displayCategoryKey: carb.displayCategoryKey,
      name: pickLang(carb.name, lang),
      description: pickLang(carb.description, lang),
      sortOrder: carb.sortOrder || 0,
    })),
    sandwiches: sandwiches.map(s => ({
      id: String(s._id),
      name: pickLang(s.name, lang),
      description: pickLang(s.description, lang),
      imageUrl: s.imageUrl,
      calories: s.calories,
      selectionType: NEW_TYPES.SANDWICH,
    })),
    premiumLargeSalad: saladConfig,
    rules: getMealPlannerRules(),
  });
}

module.exports = {
  getMealPlannerCatalog,
};
