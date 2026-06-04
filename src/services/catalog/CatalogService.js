const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const MenuCategory = require("../../models/MenuCategory");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const { pickLang } = require("../../utils/i18n");
const { sanitizeObject } = require("../../utils/encoding");
const {
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  MEAL_SELECTION_TYPES,
  CUSTOMER_VISIBLE_CARB_KEYS,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  PREMIUM_LARGE_SALAD_PRESET_KEY,
  PREMIUM_MEAL_PROTEIN_KEYS,
  PROTEIN_DISPLAY_GROUPS,
  SALAD_SELECTION_GROUPS,
  SYSTEM_CURRENCY,
  SUBSCRIPTION_COLD_SANDWICH_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS,
  STANDARD_MEAL_EXTENDED_PROTEIN_KEY_SET,
  buildProteinOptionSections,
  getProteinFamilyNameI18n,
  getMealPlannerCategoryDefinition,
  getMealPlannerRules,
  resolveProteinVisualFamilyKey,
  normalizeProteinDisplayCategoryKey,
  normalizeProteinFamilyKey,
  normalizeSaladIngredientGroupKey,
} = require("../../config/mealPlannerContract");
const {
  resolvePremiumLargeSaladPricing,
} = require("./premiumLargeSaladPricingService");
const {
  inferCardVariantFromKey,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
  normalizeUiMetadata,
} = require("./catalogKeyUiHelpers");
const {
  filterGloballyAvailable,
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalogAvailabilityService");

const BUILDER_CATALOG_V2_VERSION = "meal_planner_menu.v2";
const MENU_PROTEIN_GROUP_KEY = "proteins";
const MENU_CARB_GROUP_KEY = "carbs";
const MENU_SALAD_EXTRA_PROTEIN_GROUP_KEY = "extra_protein_50g";
const CUSTOMER_VISIBLE_CARB_KEY_SET = new Set(CUSTOMER_VISIBLE_CARB_KEYS);
const PREMIUM_MEAL_PROTEIN_KEY_SET = new Set(PREMIUM_MEAL_PROTEIN_KEYS);
const PREMIUM_MEAL_EXTRA_FEE_HALALA_BY_KEY = Object.freeze({
  beef_steak: 2000,
  shrimp: 2000,
  salmon: 2000,
});
const SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEY_SET = new Set(SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEYS);
const SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEY_SET = new Set(SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS);

const MENU_SALAD_GROUP_ALIASES = Object.freeze({
  vegetables_legumes: "vegetables",
  sauces: "sauce",
  proteins: "protein",
});

function localized(value, lang) {
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function localizedPair(value) {
  return {
    ar: pickLang(value, "ar") || "",
    en: pickLang(value, "en") || "",
  };
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

function activeRelationQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
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

function hasRuleTag(option, tag) {
  return Array.isArray(option?.ruleTags) && option.ruleTags.includes(tag);
}

function isCustomerVisibleCarb(option) {
  return CUSTOMER_VISIBLE_CARB_KEY_SET.has(option?.key) && !hasRuleTag(option, "missing_external");
}

function isSubscriptionPremiumLargeSaladProtein(option) {
  const key = String(option?.key || option?.premiumKey || "").trim().toLowerCase();
  return SUBSCRIPTION_PREMIUM_LARGE_SALAD_PROTEIN_KEY_SET.has(key) && !option?.isPremium;
}

function normalizeMenuSaladGroupKey(groupKey) {
  const raw = String(groupKey || "").trim().toLowerCase();
  if (raw === MENU_SALAD_EXTRA_PROTEIN_GROUP_KEY) return raw;
  return normalizeSaladIngredientGroupKey(raw) || (raw === "protein" ? "protein" : "");
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
    ui: normalizeUiMetadata(
      definition.ui
      || canonical.ui
      || { cardVariant: inferCardVariantFromKey(definition.key) }
    ),
  };
}

function inferProteinFamilyKey(option) {
  const explicit = normalizeProteinFamilyKey(option.proteinFamilyKey, "");
  if (explicit) return explicit;
  return normalizeProteinFamilyKey(option.displayCategoryKey || option.key);
}

function isPremiumMealProtein(option) {
  const premiumKey = String(option?.premiumKey || "").trim().toLowerCase();
  if (premiumKey && PREMIUM_MEAL_PROTEIN_KEY_SET.has(premiumKey)) return true;
  const key = String(option?.key || "").trim().toLowerCase();
  return PREMIUM_MEAL_PROTEIN_KEY_SET.has(key);
}

function resolvePremiumMealExtraFeeHalala(option) {
  const key = String(option?.key || option?.premiumKey || "").trim().toLowerCase();
  if (PREMIUM_MEAL_EXTRA_FEE_HALALA_BY_KEY[key] !== undefined) {
    return PREMIUM_MEAL_EXTRA_FEE_HALALA_BY_KEY[key];
  }
  return Number(option?.extraFeeHalala ?? option?.extraPriceHalala ?? 0);
}

function buildProteinPayload(option, lang, { isPremium }) {
  const proteinFamilyKey = inferProteinFamilyKey(option);
  const displayCategoryKey = normalizeProteinDisplayCategoryKey(option.displayCategoryKey, {
    isPremium,
    proteinFamilyKey,
  });
  const extraFeeHalala = isPremium ? resolvePremiumMealExtraFeeHalala(option) : 0;
  const premiumKey = String(option.premiumKey || option.key || "").trim() || null;

  return {
    id: String(option._id),
    key: option.key || "",
    displayCategoryKey,
    name: localized(option.name, lang),
    description: localized(option.description, lang),
    proteinFamilyKey,
    proteinFamilyNameI18n: getProteinFamilyNameI18n(proteinFamilyKey),
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
    key: option.key || "",
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
    key: product.key || "",
    name: localized(product.name, lang),
    description: localized(product.description, lang),
    imageUrl: product.imageUrl || "",
    calories: Number(product.calories || 0),
    selectionType: MEAL_SELECTION_TYPES.SANDWICH,
    categoryKey: "sandwich",
    pricingModel: product.pricingModel || "included",
    priceHalala: Number(product.priceHalala || 0),
    proteinFamilyKey: product.proteinFamilyKey || "other",
    sortOrder: Number(product.sortOrder || 0),
  };
}

async function getGroupOptionsWithGroup(groupKey) {
  const group = await MenuOptionGroup.findOne(activeCatalogQuery({ key: groupKey })).lean();
  if (!group) return { group: null, options: [] };

  const rows = await MenuOption.find(activeCatalogQuery({
    groupId: group._id,
    availableForSubscription: { $ne: false },
    ...availableForChannelQuery("subscription"),
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  const options = filterGloballyAvailable(rows, catalogItemsById);

  return { group, options };
}

async function getGroupOptions(groupKey) {
  const result = await getGroupOptionsWithGroup(groupKey);
  return result.options;
}

async function getPremiumLargeSaladIngredients({ product, normalizedProteins, lang }) {
  if (!product) return [];

  const groupRelations = await ProductOptionGroup.find(activeRelationQuery({ productId: product._id }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const groupIds = groupRelations.map((relation) => relation.groupId);
  const groups = await MenuOptionGroup.find(activeCatalogQuery({ _id: { $in: groupIds } })).lean();
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const allowedGroupIds = new Set(groups.map((group) => String(group._id)));

  const optionRelations = await ProductGroupOption.find(activeRelationQuery({
    productId: product._id,
    groupId: { $in: [...allowedGroupIds] },
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const optionIds = optionRelations.map((relation) => relation.optionId);
  const optionRows = await MenuOption.find(activeCatalogQuery({
    _id: { $in: optionIds },
    availableForSubscription: { $ne: false },
    ...availableForChannelQuery("subscription"),
  })).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(optionRows);
  const options = filterGloballyAvailable(optionRows, catalogItemsById);
  const optionsById = new Map(options.map((option) => [String(option._id), option]));

  const ingredients = [];
  const saladProteinOptions = [];
  for (const relation of optionRelations) {
    const group = groupsById.get(String(relation.groupId));
    const option = optionsById.get(String(relation.optionId));
    if (!group || !option) continue;

    const rawGroupKey = MENU_SALAD_GROUP_ALIASES[group.key] || group.key;
    const groupKey = normalizeMenuSaladGroupKey(rawGroupKey);
    if (!groupKey) continue;
    if (groupKey === "protein") {
      const extraFeeHalala = Number(relation.extraPriceHalala ?? option.extraPriceHalala ?? 0);
      saladProteinOptions.push({
        ...buildProteinPayload(option, lang, { isPremium: extraFeeHalala > 0 }),
        groupKey: "protein",
        extraFeeHalala,
        sortOrder: Number(relation.sortOrder || option.sortOrder || 0),
      });
      continue;
    }

    ingredients.push({
      id: String(option._id),
      groupKey,
      name: localized(option.name, lang),
      calories: Number((option.nutrition && option.nutrition.calories) || 0),
      extraFeeHalala: Number(relation.extraPriceHalala ?? option.extraPriceHalala ?? 0),
      sortOrder: Number(relation.sortOrder || option.sortOrder || 0),
    });
  }

  const proteinDisplaySortOrder = new Map(PROTEIN_DISPLAY_GROUPS.map((group) => [group.key, group.sortOrder]));
  const fallbackProteinOptions = normalizedProteins
    .map((protein) => ({
      id: protein.id,
      groupKey: "protein",
      name: protein.name,
      calories: protein.calories,
      displayCategoryKey: protein.displayCategoryKey,
      proteinFamilyKey: protein.proteinFamilyKey,
      proteinFamilyNameI18n: protein.proteinFamilyNameI18n,
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

  return (ingredients.concat(saladProteinOptions.length ? saladProteinOptions : fallbackProteinOptions) || [])
    .sort((left, right) => sortByCatalogOrder(left, right));
}

function normalizeV2Option(row = {}, lang = "en", overrides = {}) {
  const id = row.id || row.optionId || row._id;
  const extraFeeHalala = row.extraFeeHalala === undefined || row.extraFeeHalala === null
    ? row.extraPriceHalala
    : row.extraFeeHalala;
  const proteinFamilyKey = resolveProteinVisualFamilyKey(row) || row.proteinFamilyKey || "";

  return sanitizeObject({
    id: id ? String(id) : "",
    optionId: row.optionId || row._id ? String(row.optionId || row._id) : (id ? String(id) : ""),
    key: row.key || row.premiumKey || overrides.key || "",
    name: row.name !== undefined && typeof row.name !== "object" ? row.name : localized(row.name, lang),
    nameI18n: row.nameI18n || localizedPair(row.name),
    description: row.description !== undefined && typeof row.description !== "object" ? row.description : localized(row.description, lang),
    descriptionI18n: row.descriptionI18n || localizedPair(row.description),
    imageUrl: row.imageUrl || "",
    sortOrder: Number(row.sortOrder || 0),
    displayCategoryKey: row.displayCategoryKey || proteinFamilyKey || "",
    proteinFamilyKey,
    proteinFamilyNameI18n: proteinFamilyKey ? getProteinFamilyNameI18n(proteinFamilyKey) : undefined,
    premiumKey: row.premiumKey || null,
    extraFeeHalala: extraFeeHalala === undefined || extraFeeHalala === null ? undefined : Number(extraFeeHalala || 0),
    extraPriceHalala: row.extraPriceHalala === undefined || row.extraPriceHalala === null ? undefined : Number(row.extraPriceHalala || 0),
    selectionType: row.selectionType || overrides.selectionType || "",
    isPremium: row.isPremium === undefined ? undefined : Boolean(row.isPremium),
    ui: row.ui && typeof row.ui === "object" && !Array.isArray(row.ui) ? row.ui : {},
    ...overrides,
  });
}

function buildV2Group({
  id,
  sourceKey,
  key,
  name,
  nameI18n,
  relation = {},
  sortOrder = 0,
  ui = {},
  rules = {},
  options = [],
  lang = "en",
}) {
  const minSelections = relation.minSelections ?? relation.minSelect ?? 0;
  const maxSelections = relation.maxSelections ?? relation.maxSelect ?? null;
  const payload = {
    id: id ? String(id) : `virtual:${key}`,
    groupId: id ? String(id) : undefined,
    key,
    sourceKey: sourceKey && sourceKey !== key ? sourceKey : sourceKey,
    name,
    nameI18n,
    minSelections: Number(minSelections || 0),
    maxSelections: maxSelections === null || maxSelections === undefined ? null : Number(maxSelections),
    isRequired: Boolean(relation.isRequired ?? Number(minSelections || 0) > 0),
    sortOrder: Number(sortOrder || relation.sortOrder || 0),
    ui,
    rules,
    options,
  };

  if (sourceKey === MENU_PROTEIN_GROUP_KEY || key === MENU_PROTEIN_GROUP_KEY || key === "protein") {
    const optionSections = buildProteinOptionSections(options, lang);
    if (optionSections.length) payload.optionSections = optionSections;
  }

  return sanitizeObject(payload);
}

function buildVirtualBuilderProduct({ selectionType, cardVariant, optionGroups }) {
  return {
    id: `virtual:${selectionType}`,
    key: selectionType,
    type: "virtual_builder_product",
    isVirtual: true,
    selectionType,
    ui: normalizeProductUiMetadata({ cardVariant }),
    optionGroups,
  };
}

function buildMealBuilderSection({ key, name, cardVariant, optionGroups }) {
  return {
    id: `section:${key}`,
    key,
    type: "meal_builder",
    name,
    ui: normalizeUiMetadata({ cardVariant }),
    products: [
      buildVirtualBuilderProduct({
        selectionType: key,
        cardVariant,
        optionGroups,
      }),
    ],
  };
}

function buildProteinGroupV2({ group, sourceOptions, key, selectionType, rules = {}, lang }) {
  const options = (sourceOptions || [])
    .map((option) => normalizeV2Option(option, lang, {
      selectionType,
      isPremium: selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL,
    }))
    .sort(sortByCatalogOrder);

  return buildV2Group({
    id: group?._id || group?.id,
    sourceKey: MENU_PROTEIN_GROUP_KEY,
    key,
    name: group ? localized(group.name, lang) : (lang === "ar" ? "بروتين" : "Protein"),
    nameI18n: group ? localizedPair(group.name) : { ar: "بروتين", en: "Protein" },
    relation: { minSelections: 1, maxSelections: 1, isRequired: true },
    sortOrder: group?.sortOrder || 0,
    ui: normalizeGroupUiMetadata(group?.ui),
    rules,
    options,
    lang,
  });
}

function buildCarbGroupV2({ group, sourceOptions, rules = {}, lang }) {
  const options = (sourceOptions || [])
    .map((option) => normalizeV2Option(option, lang, {
      selectionType: "",
      isPremium: false,
    }))
    .filter((option) => String(option.displayCategoryKey || "").trim().toLowerCase() !== "large_salad")
    .filter((option) => isCustomerVisibleCarb(option))
    .sort(sortByCatalogOrder);

  return buildV2Group({
    id: group?._id || group?.id,
    sourceKey: MENU_CARB_GROUP_KEY,
    key: "carb",
    name: group ? localized(group.name, lang) : (lang === "ar" ? "كربوهيدرات" : "Carbs"),
    nameI18n: group ? localizedPair(group.name) : { ar: "كربوهيدرات", en: "Carbs" },
    relation: { minSelections: 1, maxSelections: rules.maxTypes || 2, isRequired: true },
    sortOrder: group?.sortOrder || 0,
    ui: normalizeGroupUiMetadata(group?.ui),
    rules,
    options,
  });
}

function buildV2ProductFromMenuProduct(product, lang, overrides = {}) {
  return sanitizeObject({
    id: String(product._id),
    key: product.key || "",
    type: "menu_product",
    isVirtual: false,
    selectionType: overrides.selectionType || product.selectionType || "",
    name: localized(product.name, lang),
    nameI18n: localizedPair(product.name),
    description: localized(product.description, lang),
    descriptionI18n: localizedPair(product.description),
    imageUrl: product.imageUrl || "",
    itemType: product.itemType || "",
    pricingModel: product.pricingModel || "fixed",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
    sortOrder: Number(product.sortOrder || 0),
    ui: normalizeProductUiMetadata(product.ui),
    optionGroups: overrides.optionGroups || [],
    ...overrides,
  });
}

async function getPremiumLargeSaladOptionGroups({ product, normalizedProteins, lang }) {
  if (!product) return [];

  const groupRelations = await ProductOptionGroup.find(activeRelationQuery({ productId: product._id }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const groupIds = groupRelations.map((relation) => relation.groupId);
  const groups = await MenuOptionGroup.find(activeCatalogQuery({ _id: { $in: groupIds } })).lean();
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const allowedGroupIds = new Set(groups.map((group) => String(group._id)));
  const optionRelations = await ProductGroupOption.find(activeRelationQuery({
    productId: product._id,
    groupId: { $in: [...allowedGroupIds] },
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const optionIds = optionRelations.map((relation) => relation.optionId);
  const optionRows = await MenuOption.find(activeCatalogQuery({
    _id: { $in: optionIds },
    availableForSubscription: { $ne: false },
    ...availableForChannelQuery("subscription"),
  })).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(optionRows);
  const options = filterGloballyAvailable(optionRows, catalogItemsById);
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const optionRelationsByGroup = new Map();
  optionRelations.forEach((relation) => {
    const groupId = String(relation.groupId);
    if (!optionRelationsByGroup.has(groupId)) optionRelationsByGroup.set(groupId, []);
    optionRelationsByGroup.get(groupId).push(relation);
  });

  const proteinDisplaySortOrder = new Map(PROTEIN_DISPLAY_GROUPS.map((group) => [group.key, group.sortOrder]));
  const fallbackProteinOptions = (normalizedProteins || [])
    .filter(isSubscriptionPremiumLargeSaladProtein)
    .map((protein) => normalizeV2Option(protein, lang, {
      id: protein.id,
      optionId: protein.id,
      key: protein.key || protein.premiumKey || protein.id,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      isPremium: false,
    }))
    .sort((left, right) => (
      (proteinDisplaySortOrder.get(left.displayCategoryKey) || 0) - (proteinDisplaySortOrder.get(right.displayCategoryKey) || 0)
      || sortByCatalogOrder(left, right)
    ));
  const proteinOptionsByRelation = [];
  for (const relation of optionRelations) {
    const group = groupsById.get(String(relation.groupId));
    const option = optionsById.get(String(relation.optionId));
    if (!group || !option || group.key !== MENU_PROTEIN_GROUP_KEY) continue;
    const extraFeeHalala = Number(relation.extraPriceHalala ?? option.extraPriceHalala ?? 0);
    proteinOptionsByRelation.push(normalizeV2Option(option, lang, {
      extraPriceHalala: extraFeeHalala,
      extraFeeHalala,
      isPremium: extraFeeHalala > 0,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
    }));
  }
  const proteinOptions = (proteinOptionsByRelation.length ? proteinOptionsByRelation : fallbackProteinOptions)
    .sort(sortByCatalogOrder);

  const groupsPayload = groupRelations
    .map((relation) => {
      const group = groupsById.get(String(relation.groupId));
      if (!group) return null;

      const sourceKey = group.key;
      const aliasKey = MENU_SALAD_GROUP_ALIASES[sourceKey] || sourceKey;
      const canonicalKey = normalizeMenuSaladGroupKey(aliasKey);
      if (!canonicalKey) return null;
      if (SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEY_SET.has(canonicalKey)) return null;

      const rule = SALAD_SELECTION_GROUPS.find((item) => item.key === canonicalKey);
      const relationForGroup = {
        minSelections: rule ? rule.minSelect : relation.minSelections,
        maxSelections: rule ? rule.maxSelect : relation.maxSelections,
        isRequired: rule ? Number(rule.minSelect || 0) > 0 : relation.isRequired,
        sortOrder: relation.sortOrder,
      };
      const groupOptions = canonicalKey === "protein"
        ? proteinOptions
        : (optionRelationsByGroup.get(String(relation.groupId)) || [])
          .map((optionRelation) => {
            const option = optionsById.get(String(optionRelation.optionId));
            if (!option) return null;
            return normalizeV2Option(option, lang, {
              extraPriceHalala: optionRelation.extraPriceHalala ?? option.extraPriceHalala,
              extraFeeHalala: optionRelation.extraPriceHalala ?? option.extraFeeHalala ?? option.extraPriceHalala,
            });
          })
          .filter(Boolean)
          .sort(sortByCatalogOrder);

      return buildV2Group({
        id: group._id,
        sourceKey,
        key: canonicalKey,
        name: rule ? localized(rule.name, lang) : localized(group.name, lang),
        nameI18n: rule ? localizedPair(rule.name) : localizedPair(group.name),
        relation: relationForGroup,
        sortOrder: rule ? rule.sortOrder : relation.sortOrder,
        ui: normalizeGroupUiMetadata(group.ui),
        rules: rule ? { minSelect: rule.minSelect, maxSelect: rule.maxSelect, source: rule.source } : {},
        options: groupOptions,
        lang,
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (!groupsPayload.some((group) => group.key === "protein")) {
    const proteinRule = SALAD_SELECTION_GROUPS.find((item) => item.key === "protein");
    groupsPayload.push(buildV2Group({
      id: "virtual:premium_large_salad:protein",
      sourceKey: MENU_PROTEIN_GROUP_KEY,
      key: "protein",
      name: proteinRule ? localized(proteinRule.name, lang) : (lang === "ar" ? "بروتين" : "Protein"),
      nameI18n: proteinRule ? localizedPair(proteinRule.name) : { ar: "بروتين", en: "Protein" },
      relation: {
        minSelections: proteinRule ? proteinRule.minSelect : 1,
        maxSelections: proteinRule ? proteinRule.maxSelect : 1,
        isRequired: true,
        sortOrder: proteinRule ? proteinRule.sortOrder : 30,
      },
      sortOrder: proteinRule ? proteinRule.sortOrder : 30,
      ui: normalizeGroupUiMetadata({ displayStyle: "radio_cards" }),
      rules: proteinRule ? { minSelect: proteinRule.minSelect, maxSelect: proteinRule.maxSelect, source: proteinRule.source } : {},
      options: proteinOptions,
      lang,
    }));
  }

  return groupsPayload.sort((left, right) => left.sortOrder - right.sortOrder);
}

async function buildSubscriptionBuilderCatalogV2({ builderCatalog, context = {}, lang = "en" } = {}) {
  const rules = builderCatalog?.rules || getMealPlannerRules();
  const proteinGroup = context.proteinGroup || null;
  const carbGroup = context.carbGroup || null;

  const standardProteinGroup = buildProteinGroupV2({
    group: proteinGroup,
    sourceOptions: builderCatalog?.proteins || [],
    key: "protein",
    selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
    rules: rules.beef ? { beef: rules.beef } : {},
    lang,
  });
  const standardCarbGroup = buildCarbGroupV2({
    group: carbGroup,
    sourceOptions: builderCatalog?.carbs || [],
    rules: rules.standardCarbs || {},
    lang,
  });
  const premiumProteinGroup = buildProteinGroupV2({
    group: proteinGroup,
    sourceOptions: builderCatalog?.premiumProteins || [],
    key: "protein",
    selectionType: MEAL_SELECTION_TYPES.PREMIUM_MEAL,
    rules: {},
    lang,
  });
  const premiumCarbGroup = buildCarbGroupV2({
    group: carbGroup,
    sourceOptions: builderCatalog?.carbs || [],
    rules: rules.premiumCarbs || rules.standardCarbs || {},
    lang,
  });

  const sandwichProducts = (context.sandwiches || [])
    .map((product) => buildV2ProductFromMenuProduct(product, lang, {
      selectionType: MEAL_SELECTION_TYPES.SANDWICH,
      optionGroups: [],
    }))
    .sort(sortByCatalogOrder);

  const premiumLargeSaladProduct = context.premiumLargeSaladProduct || null;
  const premiumLargeSaladPricing = context.premiumLargeSaladPricing || {};
  const premiumLargeSaladOptionGroups = await getPremiumLargeSaladOptionGroups({
    product: premiumLargeSaladProduct,
    normalizedProteins: context.normalizedProteins || [],
    lang,
  });
  const premiumLargeSaladV1 = builderCatalog?.premiumLargeSalad || {};
  const premiumLargeSaladProductPayload = premiumLargeSaladPricing.isCatalogUnavailable
    ? null
    : premiumLargeSaladProduct
    ? buildV2ProductFromMenuProduct(premiumLargeSaladProduct, lang, {
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      premiumKey: premiumLargeSaladV1.premiumKey || PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      presetKey: premiumLargeSaladV1.presetKey || PREMIUM_LARGE_SALAD_PRESET_KEY,
      priceHalala: Number(premiumLargeSaladPricing.priceHalala ?? premiumLargeSaladV1.priceHalala ?? 0),
      extraFeeHalala: Number(premiumLargeSaladPricing.extraFeeHalala ?? premiumLargeSaladV1.extraFeeHalala ?? 0),
      priceSource: premiumLargeSaladPricing.source || premiumLargeSaladV1.priceSource || "",
      optionGroups: premiumLargeSaladOptionGroups,
    })
    : {
      id: "virtual:premium_large_salad",
      key: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      type: "virtual_builder_product",
      isVirtual: true,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      premiumKey: premiumLargeSaladV1.premiumKey || PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      presetKey: premiumLargeSaladV1.presetKey || PREMIUM_LARGE_SALAD_PRESET_KEY,
      name: premiumLargeSaladV1.name || localized({ ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" }, lang),
      priceHalala: Number(premiumLargeSaladPricing.priceHalala ?? premiumLargeSaladV1.priceHalala ?? 0),
      extraFeeHalala: Number(premiumLargeSaladPricing.extraFeeHalala ?? premiumLargeSaladV1.extraFeeHalala ?? 0),
      priceSource: premiumLargeSaladPricing.source || premiumLargeSaladV1.priceSource || "",
      currency: premiumLargeSaladPricing.currency || premiumLargeSaladV1.currency || SYSTEM_CURRENCY,
      ui: normalizeProductUiMetadata({ cardVariant: "large_salad" }),
      optionGroups: premiumLargeSaladOptionGroups,
    };

  return sanitizeObject({
    catalogVersion: BUILDER_CATALOG_V2_VERSION,
    currency: SYSTEM_CURRENCY,
    sections: [
      buildMealBuilderSection({
        key: MEAL_SELECTION_TYPES.STANDARD_MEAL,
        name: lang === "ar" ? "وجبة عادية" : "Standard Meal",
        cardVariant: "standard",
        optionGroups: [standardProteinGroup, standardCarbGroup],
      }),
      buildMealBuilderSection({
        key: MEAL_SELECTION_TYPES.PREMIUM_MEAL,
        name: lang === "ar" ? "وجبة مميزة" : "Premium Meal",
        cardVariant: "premium",
        optionGroups: [premiumProteinGroup, premiumCarbGroup],
      }),
      {
        id: "section:sandwich",
        key: MEAL_SELECTION_TYPES.SANDWICH,
        type: "product_list",
        name: lang === "ar" ? "ساندويتشات" : "Sandwiches",
        ui: normalizeUiMetadata({ cardVariant: "standard" }),
        products: sandwichProducts,
      },
      {
        id: "section:premium_large_salad",
        key: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
        type: "configurable_product",
        name: premiumLargeSaladV1.name || (lang === "ar" ? "سلطة كبيرة مميزة" : "Premium Large Salad"),
        ui: normalizeUiMetadata({ cardVariant: "large_salad" }),
        products: premiumLargeSaladProductPayload ? [premiumLargeSaladProductPayload] : [],
      },
    ],
    rules,
  });
}

async function buildSubscriptionBuilderCatalogBundle({ lang = "en", includeV2 = true } = {}) {
  const coldSandwichCategory = await MenuCategory.findOne(activeCatalogQuery({ key: "cold_sandwiches" })).lean();
  const [proteinGroupData, carbGroupData, sandwichRows, premiumLargeSaladPricing] = await Promise.all([
    getGroupOptionsWithGroup(MENU_PROTEIN_GROUP_KEY),
    getGroupOptionsWithGroup(MENU_CARB_GROUP_KEY),
    coldSandwichCategory
      ? MenuProduct.find(activeCatalogQuery({
        categoryId: coldSandwichCategory._id,
        itemType: "cold_sandwich",
        key: { $in: SUBSCRIPTION_COLD_SANDWICH_KEYS },
      }))
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean()
      : [],
    resolvePremiumLargeSaladPricing(),
  ]);
  const sandwichCatalogItemsById = await loadCatalogItemsByIdForDocs(sandwichRows);
  const sandwiches = filterGloballyAvailable(sandwichRows, sandwichCatalogItemsById);

  const proteinOptions = proteinGroupData.options;
  const carbOptions = carbGroupData.options;
  const premiumLargeSaladProduct = premiumLargeSaladPricing.product
    && isLinkedDocGloballyAvailable(
      premiumLargeSaladPricing.product,
      await loadCatalogItemsByIdForDocs([premiumLargeSaladPricing.product])
    )
    ? premiumLargeSaladPricing.product
    : null;
  if (premiumLargeSaladPricing.source === "menu_product_basic_salad_fallback") {
    console.warn("[CatalogService] premium_large_salad not found, falling back to basic_salad");
  }

  const normalizedProteins = proteinOptions
    .map((option) => {
      return buildProteinPayload(option, lang, { 
        isPremium: isPremiumMealProtein(option),
      });
    })
    .sort(sortByCatalogOrder);

  // mealProteins: proteins that are not salad-only AND are in the extended display set.
  // The extended display set includes standard variants (chicken_fajita, meatballs, etc.)
  // and premium proteins (beef_steak, shrimp, salmon) for display in the picker Tabs.
  // Proteins that are salad_only AND not in the extended set are excluded from the meal picker
  // (they remain available only for premium_large_salad selection).
  const mealProteins = normalizedProteins.filter((protein) => {
    const isSaladOnly = hasRuleTag(protein, "salad_only");
    if (!isSaladOnly) return true; // always include non-salad-only proteins
    // Include salad_only proteins if they appear in the extended display set
    const key = String(protein.key || "").trim().toLowerCase();
    return STANDARD_MEAL_EXTENDED_PROTEIN_KEY_SET.has(key);
  });
  const proteins = mealProteins.filter((protein) => !protein.isPremium);
  const premiumProteins = mealProteins.filter((protein) => protein.isPremium);

  const selectableCarbs = carbOptions
    .filter((option) => isCustomerVisibleCarb(option))
    .map((option) => buildCarbPayload(option, lang))
    .filter((carb) => String(carb.displayCategoryKey || "").trim().toLowerCase() !== "large_salad")
    .sort(sortByCatalogOrder);

  const saladGroups = SALAD_SELECTION_GROUPS
    .filter((group) => !SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEY_SET.has(group.key))
    .map((group) => buildSaladGroupPayload(group, lang));
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
    enabled: Boolean(premiumLargeSaladProduct) && !premiumLargeSaladPricing.isCatalogUnavailable,
    carbId: premiumLargeSaladProduct ? String(premiumLargeSaladProduct._id) : null,
    premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
    selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
    presetKey: PREMIUM_LARGE_SALAD_PRESET_KEY,
    name: saladName,
    extraFeeHalala: premiumLargeSaladPricing.extraFeeHalala,
    priceHalala: premiumLargeSaladPricing.priceHalala,
    priceSource: premiumLargeSaladPricing.source,
    currency: premiumLargeSaladPricing.currency || SYSTEM_CURRENCY,
    preset: {
      key: PREMIUM_LARGE_SALAD_PRESET_KEY,
      name: saladName,
      selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
      fixedPriceHalala: premiumLargeSaladPricing.priceHalala,
      priceSource: premiumLargeSaladPricing.source,
      currency: premiumLargeSaladPricing.currency || SYSTEM_CURRENCY,
      groups: saladGroups,
    },
    groups: saladGroups,
    ingredients: saladIngredients,
  };

  const builderCatalog = sanitizeObject({
    categories: MEAL_PLANNER_CATEGORY_DEFINITIONS.map((definition) => buildCategoryPayload(definition, lang)),
    proteins: proteins.map((protein) => ({
      id: protein.id,
      key: protein.key,
      displayCategoryKey: protein.displayCategoryKey,
      name: protein.name,
      description: protein.description,
      proteinFamilyKey: protein.proteinFamilyKey,
      proteinFamilyNameI18n: protein.proteinFamilyNameI18n,
      ruleTags: protein.ruleTags,
      selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
      isPremium: false,
      sortOrder: protein.sortOrder,
    })),
    premiumProteins: premiumProteins.map((protein) => ({
      id: protein.id,
      key: protein.key,
      displayCategoryKey: protein.displayCategoryKey,
      name: protein.name,
      description: protein.description,
      proteinFamilyKey: protein.proteinFamilyKey,
      proteinFamilyNameI18n: protein.proteinFamilyNameI18n,
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
  const builderCatalogV2 = includeV2
    ? await buildSubscriptionBuilderCatalogV2({
      builderCatalog,
      lang,
      context: {
        proteinGroup: proteinGroupData.group,
        carbGroup: carbGroupData.group,
        sandwiches,
        premiumLargeSaladProduct,
        premiumLargeSaladPricing,
        normalizedProteins,
      },
    })
    : null;

  return { builderCatalog, builderCatalogV2 };
}

async function getSubscriptionBuilderCatalog({ lang = "en" } = {}) {
  const { builderCatalog } = await buildSubscriptionBuilderCatalogBundle({ lang, includeV2: false });
  return builderCatalog;
}

async function getSubscriptionBuilderCatalogWithV2({ lang = "en" } = {}) {
  return buildSubscriptionBuilderCatalogBundle({ lang });
}

module.exports = {
  buildSubscriptionBuilderCatalogV2,
  getSubscriptionBuilderCatalog,
  getSubscriptionBuilderCatalogWithV2,
};
