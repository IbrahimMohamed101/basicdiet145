"use strict";

const crypto = require("crypto");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const {
  MEAL_SELECTION_TYPES,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  SALAD_SELECTION_GROUPS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
  SYSTEM_CURRENCY,
  buildProteinOptionSections,
  getProteinFamilyNameI18n,
  resolveProteinVisualFamilyKey,
} = require("../config/mealPlannerContract");
const { pickLang } = require("../utils/i18n");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const {
  isMenuItemEnabledForSubscription,
  isSubscriptionPremiumLargeSaladProtein,
} = require("./subscription/subscriptionMenuEligibilityPolicyService");

const STATE_KEY = Symbol.for(
  "basicdiet.flutterPremiumLargeSaladOptionGroups.state"
);
const WRAPPER_MARKER = "__flutterPremiumLargeSaladOptionGroups";
const EXCLUDED_GROUP_KEYS = new Set(
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS.map(token)
);
const RULE_BY_GROUP_KEY = new Map(
  SALAD_SELECTION_GROUPS.map((rule) => [token(rule.key), rule])
);
const GROUP_ALIASES = Object.freeze({
  leafy_green: "leafy_greens",
  leafy_greens: "leafy_greens",
  vegetables_legumes: "vegetables",
  vegetable: "vegetables",
  vegetables: "vegetables",
  proteins: "protein",
  protein: "protein",
  cheese_nuts: "cheese_nuts",
  fruits: "fruits",
  fruit: "fruits",
  sauces: "sauce",
  sauce: "sauce",
  extra_protein_50g: "extra_protein_50g",
});

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function localizedPair(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ar: typeof value.ar === "string" ? value.ar : "",
      en: typeof value.en === "string" ? value.en : "",
    };
  }
  const scalar = typeof value === "string" ? value : "";
  return { ar: scalar, en: scalar };
}

function relationReady(row) {
  return Boolean(
    row
      && row.isActive !== false
      && row.isVisible !== false
      && row.isAvailable !== false
  );
}

function documentReady(row, catalogItemsById = null) {
  return Boolean(
    row
      && row.isActive !== false
      && row.isVisible !== false
      && row.isAvailable !== false
      && row.publishedAt
      && isMenuItemEnabledForSubscription(row)
      && (!catalogItemsById || isLinkedDocGloballyAvailable(row, catalogItemsById))
  );
}

function canonicalSaladGroupKey(value) {
  const raw = token(value);
  const canonical = GROUP_ALIASES[raw] || raw;
  if (!canonical || EXCLUDED_GROUP_KEYS.has(canonical)) return "";
  return RULE_BY_GROUP_KEY.has(canonical) ? canonical : "";
}

function nutritionPayload(option = {}) {
  const nutrition = option.nutrition && typeof option.nutrition === "object"
    ? option.nutrition
    : {};
  return {
    calories: Number(nutrition.calories || 0),
    proteinGrams: Number(nutrition.proteinGrams || 0),
    carbGrams: Number(nutrition.carbGrams || 0),
    fatGrams: Number(nutrition.fatGrams || 0),
  };
}

function optionPayload({ option, relation, groupKey, lang = "en" }) {
  const extraFeeHalala = Number(
    relation?.extraPriceHalala
      ?? option.extraFeeHalala
      ?? option.extraPriceHalala
      ?? 0
  );
  const proteinFamilyKey = groupKey === "protein"
    ? token(resolveProteinVisualFamilyKey(option) || option.proteinFamilyKey)
    : "";
  const isPremium = groupKey === "protein" && extraFeeHalala > 0;

  return {
    id: String(option._id),
    optionId: String(option._id),
    key: option.key || option.premiumKey || "",
    name: pickLang(option.name || {}, lang),
    nameI18n: localizedPair(option.name),
    description: pickLang(option.description || {}, lang),
    descriptionI18n: localizedPair(option.description),
    imageUrl: option.imageUrl || "",
    nutrition: nutritionPayload(option),
    calories: Number(option.nutrition?.calories || 0),
    displayCategoryKey: groupKey === "protein"
      ? token(option.displayCategoryKey || proteinFamilyKey)
      : groupKey,
    proteinFamilyKey,
    proteinFamilyNameI18n: proteinFamilyKey
      ? getProteinFamilyNameI18n(proteinFamilyKey)
      : undefined,
    selectionType: MEAL_SELECTION_TYPES.STANDARD_MEAL,
    isPremium,
    premiumKey: isPremium ? (option.premiumKey || option.key || null) : null,
    extraPriceHalala: extraFeeHalala,
    extraFeeHalala,
    extraWeightUnitGrams: Number(
      relation?.extraWeightUnitGrams ?? option.extraWeightUnitGrams ?? 0
    ),
    extraWeightPriceHalala: Number(
      relation?.extraWeightPriceHalala ?? option.extraWeightPriceHalala ?? 0
    ),
    currency: option.currency || SYSTEM_CURRENCY,
    sortOrder: Number(relation?.sortOrder ?? option.sortOrder ?? 0),
  };
}

async function loadPremiumLargeSaladConfiguration({ lang = "en" } = {}) {
  const product = await MenuProduct.findOne({
    key: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
  }).lean();
  if (!product || !documentReady(product)) return null;

  const groupRelations = (await ProductOptionGroup.find({ productId: product._id })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean()).filter(relationReady);
  if (!groupRelations.length) {
    return { productId: String(product._id), groups: [] };
  }

  const groupIds = groupRelations.map((relation) => relation.groupId);
  const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
  const groupsById = new Map(
    groups
      .filter((group) => documentReady(group))
      .map((group) => [String(group._id), group])
  );
  const availableGroupIds = new Set(groupsById.keys());

  const optionRelations = (await ProductGroupOption.find({
    productId: product._id,
    groupId: { $in: [...availableGroupIds] },
  })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean()).filter(relationReady);
  const optionIds = [...new Set(optionRelations.map((relation) => String(relation.optionId)))];
  const options = optionIds.length
    ? await MenuOption.find({ _id: { $in: optionIds } }).lean()
    : [];
  const catalogItemsById = await loadCatalogItemsByIdForDocs(options);
  const optionsById = new Map(
    options
      .filter((option) => documentReady(option, catalogItemsById))
      .map((option) => [String(option._id), option])
  );
  const optionRelationsByGroup = new Map();
  for (const relation of optionRelations) {
    const groupId = String(relation.groupId);
    if (!optionRelationsByGroup.has(groupId)) {
      optionRelationsByGroup.set(groupId, []);
    }
    optionRelationsByGroup.get(groupId).push(relation);
  }

  const groupsPayload = groupRelations
    .map((groupRelation) => {
      const group = groupsById.get(String(groupRelation.groupId));
      if (!group) return null;
      const groupKey = canonicalSaladGroupKey(group.key);
      if (!groupKey) return null;
      const rule = RULE_BY_GROUP_KEY.get(groupKey);
      if (!rule) return null;

      const optionsPayload = (optionRelationsByGroup.get(String(group._id)) || [])
        .map((optionRelation) => {
          const option = optionsById.get(String(optionRelation.optionId));
          if (!option) return null;
          if (
            groupKey === "protein"
            && !isSubscriptionPremiumLargeSaladProtein(option)
          ) {
            return null;
          }
          return optionPayload({ option, relation: optionRelation, groupKey, lang });
        })
        .filter(Boolean)
        .sort((left, right) => (
          Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
          || String(left.name || "").localeCompare(String(right.name || ""))
        ));

      const payload = {
        id: String(group._id),
        groupId: String(group._id),
        key: groupKey,
        canonicalGroupKey: groupKey,
        sourceKey: group.key || groupKey,
        name: pickLang(rule.name || group.name || {}, lang),
        nameI18n: localizedPair(rule.name || group.name),
        minSelections: Number(rule.minSelect || 0),
        maxSelections: rule.maxSelect === null || rule.maxSelect === undefined
          ? null
          : Number(rule.maxSelect),
        required: Number(rule.minSelect || 0) > 0,
        isRequired: Number(rule.minSelect || 0) > 0,
        sortOrder: Number(rule.sortOrder ?? groupRelation.sortOrder ?? 0),
        ui: group.ui || {},
        rules: {
          minSelect: Number(rule.minSelect || 0),
          maxSelect: rule.maxSelect === null || rule.maxSelect === undefined
            ? null
            : Number(rule.maxSelect),
          source: rule.source || "ingredient",
        },
        options: optionsPayload,
      };
      if (groupKey === "protein") {
        const optionSections = buildProteinOptionSections(optionsPayload, lang);
        if (optionSections.length) payload.optionSections = optionSections;
      }
      return payload;
    })
    .filter(Boolean)
    .filter((group) => group.options.length > 0 || group.isRequired)
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));

  return {
    productId: String(product._id),
    productKey: product.key || PREMIUM_LARGE_SALAD_PREMIUM_KEY,
    groups: groupsPayload,
  };
}

function isPremiumLargeSaladProduct(product = {}) {
  return token(product.key || product.premiumKey) === PREMIUM_LARGE_SALAD_PREMIUM_KEY
    || token(product.selectionType) === MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD;
}

function containsPremiumLargeSalad(catalog = {}) {
  return (catalog.sections || []).some((section) =>
    (section.products || []).some(isPremiumLargeSaladProduct)
  );
}

function rehashCatalog(catalog = {}) {
  const stablePayload = { ...catalog };
  delete stablePayload.catalogHash;
  return {
    ...catalog,
    catalogHash: `sha256:${crypto
      .createHash("sha256")
      .update(JSON.stringify(stablePayload))
      .digest("hex")}`,
  };
}

function attachPremiumLargeSaladGroups(catalog, configuration) {
  if (!catalog || !configuration || !Array.isArray(catalog.sections)) return catalog;
  let hydrated = false;
  const sections = catalog.sections.map((section) => ({
    ...section,
    products: (section.products || []).map((product) => {
      if (!isPremiumLargeSaladProduct(product)) return product;
      hydrated = true;
      return {
        ...product,
        productId: product.productId || product.id || configuration.productId,
        premiumKey: product.premiumKey || PREMIUM_LARGE_SALAD_PREMIUM_KEY,
        selectionType: MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD,
        action: {
          ...(product.action || {}),
          type: "open_builder",
          requiresBuilder: true,
          treatAsFullMeal: false,
        },
        optionGroups: configuration.groups,
      };
    }),
  }));
  if (!hydrated) return catalog;
  return rehashCatalog({
    ...catalog,
    sections,
    premiumLargeSaladBuilder: {
      source: "menu_product_relations",
      productId: configuration.productId,
      groupCount: configuration.groups.length,
      optionCount: configuration.groups.reduce(
        (total, group) => total + (group.options || []).length,
        0
      ),
    },
  });
}

function cloneSet(value) {
  if (value instanceof Set) return new Set(value);
  return new Set(Array.isArray(value) ? value.map(String) : []);
}

function attachPremiumLargeSaladMembership(result, configuration) {
  if (!result?.membership || !configuration) return result;
  const membership = result.membership;
  if (!(membership.bySelectionType instanceof Map)) return result;

  const selectionType = MEAL_SELECTION_TYPES.PREMIUM_LARGE_SALAD;
  const bySelectionType = new Map(membership.bySelectionType);
  const existing = bySelectionType.get(selectionType) || {};
  const scoped = {
    ...existing,
    products: cloneSet(existing.products),
    groups: cloneSet(existing.groups),
    options: cloneSet(existing.options),
  };
  scoped.products.add(configuration.productId);
  for (const group of configuration.groups) {
    const groupId = String(group.groupId || group.id || "");
    if (!groupId) continue;
    scoped.groups.add(`${configuration.productId}:${groupId}`);
    for (const option of group.options || []) {
      const optionId = String(option.optionId || option.id || "");
      if (optionId) {
        scoped.options.add(`${configuration.productId}:${groupId}:${optionId}`);
      }
    }
  }
  bySelectionType.set(selectionType, scoped);

  const products = cloneSet(membership.products);
  const groups = cloneSet(membership.groups);
  const options = cloneSet(membership.options);
  for (const value of scoped.products) products.add(String(value));
  for (const value of scoped.groups) groups.add(String(value));
  for (const value of scoped.options) options.add(String(value));

  return {
    ...result,
    membership: {
      ...membership,
      bySelectionType,
      products,
      groups,
      options,
    },
  };
}

function wrapCatalogBuilder() {
  const original = mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder;
  if (typeof original !== "function") {
    throw new Error("Missing published Meal Builder catalog function");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function premiumLargeSaladGroupsCatalog(args = {}) {
    const catalog = await original.call(mealBuilderConfigService, args);
    if (!catalog || !containsPremiumLargeSalad(catalog)) return catalog;
    const configuration = await loadPremiumLargeSaladConfiguration({
      lang: args.lang || "en",
    });
    return attachPremiumLargeSaladGroups(catalog, configuration);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = wrapped;
}

function wrapMembershipBuilder() {
  const original = mealBuilderConfigService.buildPublishedMembership;
  if (typeof original !== "function") {
    throw new Error("Missing published Meal Builder membership function");
  }
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function premiumLargeSaladGroupsMembership(...args) {
    const result = await original.apply(mealBuilderConfigService, args);
    if (!result?.hasPublishedConfig) return result;
    const configuration = await loadPremiumLargeSaladConfiguration({ lang: "en" });
    return attachPremiumLargeSaladMembership(result, configuration);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  mealBuilderConfigService.buildPublishedMembership = wrapped;
}

function installFlutterPremiumLargeSaladOptionGroups() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;
  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;

  try {
    wrapCatalogBuilder();
    wrapMembershipBuilder();
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      source: "menu_product_relations",
      catalogHydration: true,
      membershipHydration: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error?.code || "FLUTTER_PREMIUM_LARGE_SALAD_GROUPS_INSTALL_FAILED";
    state.errorMessage = error?.message || String(error);
    throw error;
  }
}

installFlutterPremiumLargeSaladOptionGroups();

module.exports = {
  STATE_KEY,
  attachPremiumLargeSaladGroups,
  attachPremiumLargeSaladMembership,
  canonicalSaladGroupKey,
  containsPremiumLargeSalad,
  installFlutterPremiumLargeSaladOptionGroups,
  isPremiumLargeSaladProduct,
  loadPremiumLargeSaladConfiguration,
};
