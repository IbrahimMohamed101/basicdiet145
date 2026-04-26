const BuilderCategory = require("../../models/BuilderCategory");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const { pickLang } = require("../../utils/i18n");
const { getMealPlannerRules } = require("./mealSlotPlannerService");

async function getMealPlannerCatalog({ lang }) {
  const [categories, proteins, carbs] = await Promise.all([
    BuilderCategory.find({ isActive: true }).sort({ dimension: 1, sortOrder: 1, createdAt: -1 }).lean(),
    BuilderProtein.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true, availableForSubscription: { $ne: false } }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);

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
      isPremium: Boolean(protein.isPremium),
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
  };
}

module.exports = {
  getMealPlannerCatalog,
};
