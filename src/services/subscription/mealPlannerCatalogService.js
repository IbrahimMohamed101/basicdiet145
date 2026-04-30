const BuilderCategory = require("../../models/BuilderCategory");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const SaladIngredient = require("../../models/SaladIngredient");
const Sandwich = require("../../models/Sandwich");
const Meal = require("../../models/Meal");
const MealCategory = require("../../models/MealCategory");
const { pickLang } = require("../../utils/i18n");
const { sanitizeObject } = require("../../utils/encoding");
const { logger } = require("../../utils/logger");
const {
  LARGE_SALAD_CATEGORY_KEY,
  MEAL_SELECTION_TYPES,
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PREMIUM_LARGE_SALAD_PRESET_KEY,
  PROTEIN_DISPLAY_GROUPS,
  SALAD_SELECTION_GROUPS,
  SANDWICH_CATEGORY_KEYS,
  SYSTEM_CURRENCY,
  getMealPlannerCategoryDefinition,
  getMealPlannerRules,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
} = require("../../config/mealPlannerContract");

function buildCategoryPayload(category, lang) {
  const canonical = getMealPlannerCategoryDefinition({
    key: String(category.key || "").trim().toLowerCase(),
    dimension: String(category.dimension || "").trim().toLowerCase(),
  });

  return {
    id: String(category._id),
    key: category.key,
    dimension: category.dimension,
    name: pickLang(category.name, lang) || pickLang(canonical && canonical.name, lang),
    description: pickLang(category.description, lang) || pickLang(canonical && canonical.description, lang),
    sortOrder: Number(category.sortOrder ?? canonical?.sortOrder ?? 0),
    rules: canonical ? { ...(canonical.rules || {}) } : (category.rules || {}),
  };
}

function buildProteinPayload(protein, lang) {
  const displayCategoryKey = normalizeProteinDisplayCategoryKey(protein.displayCategoryKey, {
    isPremium: Boolean(protein.isPremium),
    proteinFamilyKey: protein.proteinFamilyKey,
  });
  const proteinFamilyKey = normalizeProteinFamilyKey(protein.proteinFamilyKey);

  return {
    id: String(protein._id),
    displayCategoryKey,
    name: pickLang(protein.name, lang),
    description: pickLang(protein.description, lang),
    proteinFamilyKey,
    ruleTags: Array.isArray(protein.ruleTags) ? protein.ruleTags : [],
    sortOrder: Number(protein.sortOrder || 0),
    isPremium: Boolean(protein.isPremium),
    premiumKey: protein.premiumKey || null,
    extraFeeHalala: Number(protein.extraFeeHalala || 0),
    currency: protein.currency || SYSTEM_CURRENCY,
    calories: Number((protein.nutrition && protein.nutrition.calories) || 0),
  };
}

function buildCarbPayload(carb, lang) {
  return {
    id: String(carb._id),
    displayCategoryKey: carb.displayCategoryKey,
    name: pickLang(carb.name, lang),
    description: pickLang(carb.description, lang),
    sortOrder: Number(carb.sortOrder || 0),
  };
}

function buildSaladGroupPayload(group, lang) {
  return {
    key: group.key,
    name: pickLang(group.name, lang),
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
  };
}

async function getMealPlannerCatalog({ lang }) {
  const [
    categories,
    allProteins,
    carbs,
    saladIngredients,
    sandwiches,
    mealCategories,
    legacyMeals,
  ] = await Promise.all([
    BuilderCategory.find({ isActive: true }).sort({ dimension: 1, sortOrder: 1, createdAt: -1 }).lean(),
    BuilderProtein.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    SaladIngredient.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Sandwich.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MealCategory.find({ isActive: true }).lean(),
    Meal.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);

  const sandwichCategoryIds = new Set(
    mealCategories
      .filter((category) => SANDWICH_CATEGORY_KEYS.includes(String(category.key || "").toLowerCase().trim()))
      .map((category) => String(category._id))
  );
  const legacySandwiches = legacyMeals.filter((meal) => sandwichCategoryIds.has(String(meal.categoryId || "")));

  const normalizedProteins = allProteins.map((protein) => buildProteinPayload(protein, lang));
  const proteins = normalizedProteins.filter((protein) => !protein.isPremium);
  const premiumProteins = normalizedProteins.filter((protein) => protein.isPremium);

  const largeSaladCarb = carbs.find(
    (carb) => String(carb.displayCategoryKey || "").trim().toLowerCase() === LARGE_SALAD_CATEGORY_KEY
  );
  const selectableCarbs = carbs.filter(
    (carb) => String(carb.displayCategoryKey || "").trim().toLowerCase() !== LARGE_SALAD_CATEGORY_KEY
  );

  if (!largeSaladCarb) {
    logger.error("Meal planner catalog missing required large_salad carb identity");
    throw new Error("Meal planner catalog missing required large_salad carb identity");
  }

  const saladGroupOrder = new Map(SALAD_SELECTION_GROUPS.map((group) => [group.key, group.sortOrder]));
  const filteredSaladIngredients = [];

  for (const ingredient of saladIngredients) {
    const groupKey = normalizeSaladIngredientGroupKey(ingredient.groupKey);
    if (!groupKey) {
      logger.warn("Ignoring salad ingredient with unknown groupKey", {
        ingredientId: String(ingredient._id),
        rawGroupKey: ingredient.groupKey,
      });
      continue;
    }

    filteredSaladIngredients.push({
      id: String(ingredient._id),
      groupKey,
      name: pickLang(ingredient.name, lang),
      calories: Number(ingredient.calories || 0),
      sortOrder: Number(ingredient.sortOrder || 0),
    });
  }

  filteredSaladIngredients.sort((left, right) => (
    (saladGroupOrder.get(left.groupKey) || 0) - (saladGroupOrder.get(right.groupKey) || 0)
    || left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name)
  ));

  const proteinDisplaySortOrder = new Map(PROTEIN_DISPLAY_GROUPS.map((group) => [group.key, group.sortOrder]));
  const saladProteinOptions = normalizedProteins
    .map((protein) => ({
      id: protein.id,
      groupKey: "protein",
      name: protein.name,
      calories: protein.calories,
      displayCategoryKey: protein.displayCategoryKey,
      proteinFamilyKey: protein.proteinFamilyKey,
      isPremium: protein.isPremium,
      premiumKey: protein.premiumKey,
      extraFeeHalala: protein.extraFeeHalala,
      sortOrder: protein.sortOrder,
    }))
    .sort((left, right) => (
      (proteinDisplaySortOrder.get(left.displayCategoryKey) || 0) - (proteinDisplaySortOrder.get(right.displayCategoryKey) || 0)
      || left.sortOrder - right.sortOrder
      || left.name.localeCompare(right.name)
    ));

  const saladGroups = SALAD_SELECTION_GROUPS.map((group) => buildSaladGroupPayload(group, lang));
  const saladName = pickLang(
    { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
    lang
  );

  const saladConfig = {
    id: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
    enabled: true,
    carbId: String(largeSaladCarb._id),
    premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
    selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
    presetKey: PREMIUM_LARGE_SALAD_PRESET_KEY,
    name: saladName,
    extraFeeHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
    currency: SYSTEM_CURRENCY,
    preset: {
      key: PREMIUM_LARGE_SALAD_PRESET_KEY,
      name: saladName,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      fixedPriceHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
      currency: SYSTEM_CURRENCY,
      groups: saladGroups,
    },
    groups: saladGroups,
    ingredients: filteredSaladIngredients.concat(saladProteinOptions),
  };

  return sanitizeObject({
    categories: categories.map((category) => buildCategoryPayload(category, lang)),
    proteins: proteins.map((protein) => ({
      id: protein.id,
      displayCategoryKey: protein.displayCategoryKey,
      name: protein.name,
      description: protein.description,
      proteinFamilyKey: protein.proteinFamilyKey,
      ruleTags: protein.ruleTags,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      isPremium: false,
      sortOrder: protein.sortOrder,
    })),
    premiumProteins: premiumProteins.map((protein) => ({
      id: protein.id,
      displayCategoryKey: protein.displayCategoryKey,
      name: protein.name,
      description: protein.description,
      proteinFamilyKey: protein.proteinFamilyKey,
      ruleTags: protein.ruleTags,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL,
      isPremium: true,
      premiumKey: protein.premiumKey,
      extraFeeHalala: protein.extraFeeHalala,
      sortOrder: protein.sortOrder,
    })),
    carbs: selectableCarbs.map((carb) => buildCarbPayload(carb, lang)),
    sandwiches: sandwiches.map((sandwich) => ({
      id: String(sandwich._id),
      name: pickLang(sandwich.name, lang),
      description: pickLang(sandwich.description, lang),
      imageUrl: sandwich.imageUrl,
      calories: Number(sandwich.calories || 0),
      selectionType: MEAL_SELECTION_TYPES.SANDWICH,
      categoryKey: "sandwich",
      pricingModel: "included",
      priceHalala: 0,
      proteinFamilyKey: sandwich.proteinFamilyKey,
      sortOrder: Number(sandwich.sortOrder || 0),
    })).concat(legacySandwiches.map((sandwich) => ({
      id: String(sandwich._id),
      name: pickLang(sandwich.name, lang),
      description: pickLang(sandwich.description, lang),
      imageUrl: sandwich.imageUrl,
      calories: Number(sandwich.calories || 0),
      selectionType: MEAL_SELECTION_TYPES.SANDWICH,
      categoryKey: "sandwich",
      pricingModel: "included",
      priceHalala: 0,
      proteinFamilyKey: "other",
      sortOrder: Number(sandwich.sortOrder || 0),
    }))),
    premiumLargeSalad: saladConfig,
    rules: getMealPlannerRules(),
  });
}

async function invalidateMealPlannerCatalogCache() {
  return true;
}

module.exports = {
  getMealPlannerCatalog,
  invalidateMealPlannerCatalogCache,
};
