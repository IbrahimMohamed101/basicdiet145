const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const { pickLang } = require("../../utils/i18n");
const { sanitizeObject } = require("../../utils/encoding");
const {
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  MEAL_SELECTION_TYPES,
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PREMIUM_LARGE_SALAD_PRESET_KEY,
  PROTEIN_DISPLAY_GROUPS,
  SALAD_SELECTION_GROUPS,
  SYSTEM_CURRENCY,
  getMealPlannerCategoryDefinition,
  getMealPlannerRules,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
} = require("../../config/mealPlannerContract");

const MENU_PROTEIN_GROUP_KEY = "proteins";
const MENU_CARB_GROUP_KEY = "carbs";
const PREMIUM_LARGE_SALAD_PRODUCT_KEY = "basic_salad";
const SANDWICH_ITEM_TYPES = ["cold_sandwich", "sourdough"];

const MENU_SALAD_GROUP_ALIASES = Object.freeze({
  vegetables_legumes: "vegetables",
  sauces: "sauce",
  proteins: "protein",
});

function localized(value, lang) {
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function activeCatalogQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function availableForChannelQuery(channel) {
  return {
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: channel },
    ],
  };
}

function sortByCatalogOrder(left, right) {
  const leftSort = Number(left?.sortOrder || 0);
  const rightSort = Number(right?.sortOrder || 0);
  const leftName = String(left?.name || "");
  const rightName = String(right?.name || "");
  
  return leftSort - rightSort || leftName.localeCompare(rightName);
}

function buildCategoryPayload(definition, lang) {
  const canonical = getMealPlannerCategoryDefinition({
    key: definition.key,
    dimension: definition.dimension,
  }) || definition;

  return {
    id: `${definition.dimension}:${definition.key}`,
    key: definition.key,
    dimension: definition.dimension,
    name: localized(definition.name || canonical.name, lang),
    description: localized(definition.description || canonical.description, lang),
    sortOrder: Number(definition.sortOrder ?? canonical.sortOrder ?? 0),
    rules: canonical ? { ...(canonical.rules || {}) } : {},
  };
}

function inferProteinFamilyKey(option) {
  const explicit = normalizeProteinFamilyKey(option.proteinFamilyKey, "");
  if (explicit) return explicit;
  return normalizeProteinFamilyKey(option.displayCategoryKey || option.key);
}

function buildProteinPayload(option, lang, { isPremium }) {
  const proteinFamilyKey = inferProteinFamilyKey(option);
  const displayCategoryKey = normalizeProteinDisplayCategoryKey(option.displayCategoryKey, {
    isPremium,
    proteinFamilyKey,
  });
  // Use extraFeeHalala (new shared field) or fallback to extraPriceHalala
  const extraFeeHalala = Number(option.extraFeeHalala ?? option.extraPriceHalala ?? 0);
  const premiumKey = String(option.premiumKey || option.key || "").trim() || null;

  return {
    id: String(option._id),
    displayCategoryKey,
    name: localized(option.name, lang),
    description: localized(option.description, lang),
    proteinFamilyKey,
    ruleTags: Array.isArray(option.ruleTags) ? option.ruleTags : [],
    sortOrder: Number(option.sortOrder || 0),
    isPremium,
    premiumKey,
    extraFeeHalala,
    currency: option.currency || SYSTEM_CURRENCY,
    calories: Number((option.nutrition && option.nutrition.calories) || 0),
  };
}

function buildCarbPayload(option, lang) {
  return {
    id: String(option._id),
    displayCategoryKey: String(option.displayCategoryKey || "standard_carbs").trim() || "standard_carbs",
    name: localized(option.name, lang),
    description: localized(option.description, lang),
    sortOrder: Number(option.sortOrder || 0),
  };
}

function buildSaladGroupPayload(group, lang) {
  return {
    key: group.key,
    name: localized(group.name, lang),
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
  };
}

function buildSandwichPayload(product, lang) {
  return {
    id: String(product._id),
    name: localized(product.name, lang),
    description: localized(product.description, lang),
    imageUrl: product.imageUrl || "",
    calories: Number(product.calories || 0),
    selectionType: MEAL_SELECTION_TYPES.SANDWICH,
    categoryKey: "sandwich",
    pricingModel: product.pricingModel || "included",
    priceHalala: 0,
    proteinFamilyKey: product.proteinFamilyKey || "other",
    sortOrder: Number(product.sortOrder || 0),
  };
}

async function getGroupOptions(groupKey) {
  const group = await MenuOptionGroup.findOne(activeCatalogQuery({ key: groupKey })).lean();
  if (!group) return [];

  return MenuOption.find(activeCatalogQuery({
    groupId: group._id,
    availableForSubscription: { $ne: false },
    ...availableForChannelQuery("subscription"),
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
}

async function getPremiumLargeSaladIngredients({ product, normalizedProteins, lang }) {
  if (!product) return [];

  const groupRelations = await ProductOptionGroup.find(activeCatalogQuery({ productId: product._id }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const groupIds = groupRelations.map((relation) => relation.groupId);
  const groups = await MenuOptionGroup.find(activeCatalogQuery({ _id: { $in: groupIds } })).lean();
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const allowedGroupIds = new Set(groups.map((group) => String(group._id)));

  const optionRelations = await ProductGroupOption.find(activeCatalogQuery({
    productId: product._id,
    groupId: { $in: [...allowedGroupIds] },
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const optionIds = optionRelations.map((relation) => relation.optionId);
  const options = await MenuOption.find(activeCatalogQuery({
    _id: { $in: optionIds },
    availableForSubscription: { $ne: false },
    ...availableForChannelQuery("subscription"),
  })).lean();
  const optionsById = new Map(options.map((option) => [String(option._id), option]));

  const ingredients = [];
  for (const relation of optionRelations) {
    const group = groupsById.get(String(relation.groupId));
    const option = optionsById.get(String(relation.optionId));
    if (!group || !option) continue;

    const rawGroupKey = MENU_SALAD_GROUP_ALIASES[group.key] || group.key;
    const groupKey = normalizeSaladIngredientGroupKey(rawGroupKey) || (rawGroupKey === "protein" ? "protein" : "");
    if (!groupKey) continue;
    if (groupKey === "protein") continue;

    ingredients.push({
      id: String(option._id),
      groupKey,
      name: localized(option.name, lang),
      calories: Number((option.nutrition && option.nutrition.calories) || 0),
      sortOrder: Number(relation.sortOrder || option.sortOrder || 0),
    });
  }

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

  return (ingredients.concat(saladProteinOptions) || []).sort((left, right) => sortByCatalogOrder(left, right));
}

async function getSubscriptionBuilderCatalog({ lang = "en" } = {}) {
  const [proteinOptions, carbOptions, sandwiches, premiumLargeSaladProductPrimary] = await Promise.all([
    getGroupOptions(MENU_PROTEIN_GROUP_KEY),
    getGroupOptions(MENU_CARB_GROUP_KEY),
    MenuProduct.find(activeCatalogQuery({
      itemType: { $in: SANDWICH_ITEM_TYPES },
      ...availableForChannelQuery("subscription"),
    }))
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    MenuProduct.findOne(activeCatalogQuery({
      key: "premium_large_salad",
      ...availableForChannelQuery("subscription"),
    })).lean(),
  ]);

  let premiumLargeSaladProduct = premiumLargeSaladProductPrimary;
  if (!premiumLargeSaladProduct) {
    console.warn("[CatalogService] premium_large_salad not found, falling back to basic_salad");
    premiumLargeSaladProduct = await MenuProduct.findOne(activeCatalogQuery({
      key: "basic_salad",
      ...availableForChannelQuery("subscription"),
    })).lean();
  }

  const normalizedProteins = proteinOptions
    .map((option) => {
      const resolvedPrice = Number(option.extraFeeHalala ?? option.extraPriceHalala ?? 0);
      return buildProteinPayload(option, lang, { 
        isPremium: resolvedPrice > 0 
      });
    })
    .sort(sortByCatalogOrder);
  const proteins = normalizedProteins.filter((protein) => !protein.isPremium);
  const premiumProteins = normalizedProteins.filter((protein) => protein.isPremium);

  const selectableCarbs = carbOptions
    .map((option) => buildCarbPayload(option, lang))
    .filter((carb) => String(carb.displayCategoryKey || "").trim().toLowerCase() !== "large_salad")
    .sort(sortByCatalogOrder);

  const saladGroups = SALAD_SELECTION_GROUPS.map((group) => buildSaladGroupPayload(group, lang));
  const saladName = localized(
    (premiumLargeSaladProduct && premiumLargeSaladProduct.name) || { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
    lang
  );
  const saladIngredients = await getPremiumLargeSaladIngredients({
    product: premiumLargeSaladProduct,
    normalizedProteins,
    lang,
  });

  const premiumLargeSalad = {
    id: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
    enabled: Boolean(premiumLargeSaladProduct),
    carbId: premiumLargeSaladProduct ? String(premiumLargeSaladProduct._id) : null,
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
    ingredients: saladIngredients,
  };

  return sanitizeObject({
    categories: MEAL_PLANNER_CATEGORY_DEFINITIONS.map((definition) => buildCategoryPayload(definition, lang)),
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
    carbs: selectableCarbs,
    sandwiches: sandwiches.map((sandwich) => buildSandwichPayload(sandwich, lang)).sort(sortByCatalogOrder),
    premiumLargeSalad,
    rules: getMealPlannerRules(),
  });
}

module.exports = {
  getSubscriptionBuilderCatalog,
};
