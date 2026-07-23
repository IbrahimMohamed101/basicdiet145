"use strict";

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const {
  MEAL_SELECTION_TYPES,
  STANDARD_CARB_RULES,
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
const {
  directSelectionType,
  isProductionDirectProduct,
} = require("./catalog/mealProductClassificationService");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const {
  loadClientPremiumUpgradeConfigState,
} = require("./subscription/premiumUpgradeConfigService");
const {
  isMenuItemEnabledForSubscription,
  isSubscriptionPremiumMealProtein,
} = require("./subscription/subscriptionMenuEligibilityPolicyService");

const STATE_KEY = Symbol.for("basicdiet.flutterMealPlannerCatalogExpansion.state");
const WRAPPER_MARKER = "__flutterMealPlannerCatalogExpansion";
const PROTEIN_GROUP_KEYS = new Set(["protein", "proteins"]);
const CARB_GROUP_KEYS = new Set(["carb", "carbs"]);
const PROTEIN_FAMILY_KEYS = new Set(["chicken", "beef", "fish", "eggs", "other"]);
const DIRECT_SECTION_TYPES = new Set(["product_list", "product_category"]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey || section.selectionType);
}

function selectionType(section = {}) {
  const configured = token(section.selectionType);
  if (configured) return configured;
  if (sectionKey(section) === "premium") return MEAL_SELECTION_TYPES.PREMIUM_MEAL;
  if (sectionKey(section) === "sandwich") return MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
  return sectionKey(section);
}

function enabledForSubscription(doc = {}) {
  if (doc.availableForSubscription === false) return false;
  return !Array.isArray(doc.availableFor)
    || doc.availableFor.length === 0
    || doc.availableFor.includes("subscription");
}

function sectionEnabled(section = {}) {
  return section.visible !== false
    && enabledForSubscription(section)
    && section.metadata?.exposeAllEligibleItems !== false;
}

function relationReady(relation) {
  return Boolean(
    relation
      && relation.isActive !== false
      && relation.isVisible !== false
      && relation.isAvailable !== false
  );
}

function customerReady(doc, catalogItemsById) {
  return Boolean(
    doc
      && doc.isActive !== false
      && doc.isVisible !== false
      && doc.isAvailable !== false
      && doc.publishedAt
      && enabledForSubscription(doc)
      && isMenuItemEnabledForSubscription(doc)
      && isLinkedDocGloballyAvailable(doc, catalogItemsById)
  );
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

function roleFor(section, group) {
  const explicit = token(section.metadata?.optionRole || section.optionRole);
  if (explicit) return explicit;
  const key = token(group?.key || section.metadata?.sourceGroupKey || sectionKey(section));
  if (CARB_GROUP_KEYS.has(key)) return "carbs";
  if (PROTEIN_GROUP_KEYS.has(key) || PROTEIN_FAMILY_KEYS.has(sectionKey(section))) {
    return "protein";
  }
  return "";
}

function optionFamily(option = {}) {
  return token(
    resolveProteinVisualFamilyKey(option)
      || option.displayCategoryKey
      || option.proteinFamilyKey
  );
}

function premiumOption(option, premiumState) {
  const premiumKey = option?.premiumKey || option?.key;
  return Boolean(
    option?.isPremium === true
      || isSubscriptionPremiumMealProtein(option)
      || premiumState?.getActiveConfig?.(premiumKey)
  );
}

function optionAllowed({ option, section, group, premiumState }) {
  const role = roleFor(section, group);
  if (role === "carbs") return token(option.displayCategoryKey) !== "large_salad";
  if (role !== "protein") return true;

  const premium = premiumOption(option, premiumState);
  if (selectionType(section) === MEAL_SELECTION_TYPES.PREMIUM_MEAL) {
    if (!premium) return false;
    const key = option.premiumKey || option.key;
    return !premiumState?.hasConfigs || premiumState.isAllowed(key);
  }
  if (premium) return false;

  const family = token(
    section.metadata?.proteinFamilyKey
      || section.metadata?.familyKey
      || (PROTEIN_FAMILY_KEYS.has(sectionKey(section)) ? sectionKey(section) : "")
  );
  return !family || optionFamily(option) === family;
}

function addMembership(membership, type, productId, groupId = null, optionId = null) {
  if (!membership?.bySelectionType) return;
  const normalizedType = type || "";
  if (!membership.bySelectionType.has(normalizedType)) {
    membership.bySelectionType.set(normalizedType, {
      products: new Set(),
      groups: new Set(),
      options: new Set(),
    });
  }
  const scoped = membership.bySelectionType.get(normalizedType);
  if (productId) {
    membership.products?.add(String(productId));
    scoped.products.add(String(productId));
  }
  if (productId && groupId) {
    const key = `${String(productId)}:${String(groupId)}`;
    membership.groups?.add(key);
    scoped.groups.add(key);
  }
  if (productId && groupId && optionId) {
    const key = `${String(productId)}:${String(groupId)}:${String(optionId)}`;
    membership.options?.add(key);
    scoped.options.add(key);
  }
}

async function loadContext(config) {
  const sections = (config?.sections || []).filter(sectionEnabled);
  const optionSections = sections.filter((section) =>
    token(section.sectionType || section.type) === "option_group"
      && section.productContextId
      && section.sourceGroupId
  );
  const directSections = sections.filter((section) =>
    DIRECT_SECTION_TYPES.has(token(section.sectionType || section.type))
  );

  const productIds = [...new Set(optionSections.map((section) => String(section.productContextId)))];
  const groupIds = [...new Set(optionSections.map((section) => String(section.sourceGroupId)))];
  const selectedProductIds = [...new Set(directSections.flatMap((section) =>
    (section.selectedProductIds || section.productIds || []).map(String)
  ))];

  const [groups, groupRelations, optionRelations, selectedProducts, premiumState] = await Promise.all([
    groupIds.length ? MenuOptionGroup.find({ _id: { $in: groupIds } }).lean() : [],
    productIds.length ? ProductOptionGroup.find({
      productId: { $in: productIds },
      groupId: { $in: groupIds },
    }).lean() : [],
    productIds.length ? ProductGroupOption.find({
      productId: { $in: productIds },
      groupId: { $in: groupIds },
    }).sort({ sortOrder: 1, createdAt: 1 }).lean() : [],
    selectedProductIds.length ? MenuProduct.find({ _id: { $in: selectedProductIds } }).lean() : [],
    loadClientPremiumUpgradeConfigState().catch(() => ({ hasConfigs: false })),
  ]);

  const optionIds = [...new Set(optionRelations.map((relation) => String(relation.optionId)))];
  const options = optionIds.length
    ? await MenuOption.find({ _id: { $in: optionIds } }).lean()
    : [];
  const optionCatalogItems = await loadCatalogItemsByIdForDocs(options);

  const selectedProductsById = new Map(
    selectedProducts.map((product) => [String(product._id), product])
  );
  const categoryIdsBySection = new Map();
  for (const section of directSections) {
    const categoryIds = new Set();
    if (section.sourceCategoryId) categoryIds.add(String(section.sourceCategoryId));
    for (const id of section.selectedProductIds || section.productIds || []) {
      const product = selectedProductsById.get(String(id));
      if (product?.categoryId) categoryIds.add(String(product.categoryId));
    }
    categoryIdsBySection.set(sectionKey(section), categoryIds);
  }
  const categoryIds = [...new Set(
    [...categoryIdsBySection.values()].flatMap((set) => [...set])
  )];
  const directProducts = categoryIds.length
    ? await MenuProduct.find({ categoryId: { $in: categoryIds } })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
    : [];
  const directCatalogItems = await loadCatalogItemsByIdForDocs(directProducts);

  return {
    sections,
    optionSections,
    directSections,
    groupsById: new Map(groups.map((group) => [String(group._id), group])),
    groupRelationsByKey: new Map(groupRelations.map((relation) => [
      `${String(relation.productId)}:${String(relation.groupId)}`,
      relation,
    ])),
    optionRelations,
    optionsById: new Map(options.map((option) => [String(option._id), option])),
    optionCatalogItems,
    premiumState,
    categoryIdsBySection,
    directProducts,
    directCatalogItems,
  };
}

function optionsFor(section, context) {
  const productId = String(section.productContextId);
  const groupId = String(section.sourceGroupId);
  const group = context.groupsById.get(groupId);
  const groupRelation = context.groupRelationsByKey.get(`${productId}:${groupId}`);
  if (!group || !relationReady(groupRelation)) return [];

  return context.optionRelations
    .filter((relation) =>
      String(relation.productId) === productId
        && String(relation.groupId) === groupId
        && relationReady(relation)
    )
    .map((relation) => ({
      relation,
      option: context.optionsById.get(String(relation.optionId)),
      group,
    }))
    .filter(({ option }) => customerReady(option, context.optionCatalogItems))
    .filter(({ option }) => optionAllowed({
      option,
      section,
      group,
      premiumState: context.premiumState,
    }))
    .sort((left, right) =>
      Number(left.relation.sortOrder ?? left.option.sortOrder ?? 0)
        - Number(right.relation.sortOrder ?? right.option.sortOrder ?? 0)
    );
}

function directProductsFor(section, context) {
  const categoryIds = context.categoryIdsBySection.get(sectionKey(section));
  if (!categoryIds?.size) return [];
  return context.directProducts
    .filter((product) => categoryIds.has(String(product.categoryId || "")))
    .filter(isProductionDirectProduct)
    .filter((product) => customerReady(product, context.directCatalogItems));
}

function optionPayload({ option, relation, group }, section, premiumState, lang) {
  const premium = premiumOption(option, premiumState);
  const key = option.premiumKey || option.key;
  const premiumConfig = premium ? premiumState?.getActiveConfig?.(key) : null;
  const family = premium ? "premium" : optionFamily(option);
  const relationPrice = Number(relation.extraPriceHalala ?? option.extraPriceHalala ?? 0);
  const price = premium
    ? Number(premiumConfig?.upgradeDeltaHalala ?? relationPrice)
    : relationPrice;
  return {
    id: String(option._id),
    optionId: String(option._id),
    key: option.key || "",
    name: pickLang(option.name || {}, lang),
    nameI18n: localizedPair(option.name),
    description: pickLang(option.description || {}, lang),
    descriptionI18n: localizedPair(option.description),
    imageUrl: option.imageUrl || "",
    selectionType: premium
      ? MEAL_SELECTION_TYPES.PREMIUM_MEAL
      : MEAL_SELECTION_TYPES.STANDARD_MEAL,
    isPremium: premium,
    displayCategoryKey: premium ? "premium" : family,
    proteinFamilyKey: premium ? "premium" : family,
    proteinFamilyNameI18n: family
      ? getProteinFamilyNameI18n(premium ? "premium" : family)
      : undefined,
    premiumKey: premium ? key : null,
    extraPriceHalala: price,
    extraFeeHalala: price,
    currency: option.currency || SYSTEM_CURRENCY,
    ruleTags: Array.isArray(option.ruleTags) ? option.ruleTags : [],
    sortOrder: Number(
      premiumConfig?.sortOrder ?? relation.sortOrder ?? option.sortOrder ?? 0
    ),
    groupId: String(group._id),
    productId: String(section.productContextId),
  };
}

function directProductPayload(product, section, lang) {
  const type = directSelectionType(product) || MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
  const priceHalala = Number(product.priceHalala || 0);
  return {
    id: String(product._id),
    productId: String(product._id),
    key: product.key || "",
    name: pickLang(product.name || {}, lang),
    nameI18n: localizedPair(product.name),
    description: pickLang(product.description || {}, lang),
    descriptionI18n: localizedPair(product.description),
    imageUrl: product.imageUrl || "",
    itemType: product.itemType || "full_meal_product",
    selectionType: type === MEAL_SELECTION_TYPES.SANDWICH
      ? MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT
      : type,
    pricingModel: product.pricingModel || "fixed",
    priceHalala,
    currency: product.currency || SYSTEM_CURRENCY,
    pricing: {
      model: product.pricingModel || "fixed",
      basePriceHalala: priceHalala,
      extraFeeHalala: 0,
      currency: product.currency || SYSTEM_CURRENCY,
    },
    action: { type: "direct_add", requiresBuilder: false, treatAsFullMeal: true },
    optionGroups: [],
    sortOrder: Number(product.sortOrder || 0),
    sectionKey: sectionKey(section),
  };
}

function applyGramRules(catalog = {}) {
  const configured = catalog.rules?.standardCarbs || STANDARD_CARB_RULES;
  const maxTypes = Number(configured.maxTypes || STANDARD_CARB_RULES.maxTypes || 2);
  const maxTotalGrams = Number(
    configured.maxTotalGrams || STANDARD_CARB_RULES.maxTotalGrams || 300
  );
  return {
    ...catalog,
    rules: {
      ...(catalog.rules || {}),
      standardCarbs: {
        ...(catalog.rules?.standardCarbs || {}),
        maxTypes,
        maxTotalGrams,
        unit: "grams",
      },
      premiumCarbs: {
        ...(catalog.rules?.premiumCarbs || catalog.rules?.standardCarbs || {}),
        maxTypes,
        maxTotalGrams,
        unit: "grams",
      },
      maxCarbItemsPerMeal: maxTypes,
      maxCarbTotalGrams: maxTotalGrams,
      carbGramStep: 50,
      carbUnit: "grams",
    },
  };
}

function descriptorFor(catalogSection, sections) {
  return sections.find((section) => sectionKey(section) === sectionKey(catalogSection)) || null;
}

async function expandCatalog(catalog, config, lang = "en") {
  if (!catalog || !config) return applyGramRules(catalog || {});
  const context = await loadContext(config);
  const usedDirectIds = new Set(
    (catalog.sections || []).flatMap((section) =>
      (section.products || [])
        .filter((product) => product.action?.type === "direct_add")
        .map((product) => String(product.id || product.productId || ""))
        .filter(Boolean)
    )
  );

  const sections = (catalog.sections || []).map((catalogSection) => {
    const descriptor = descriptorFor(catalogSection, context.sections);
    if (!descriptor) return catalogSection;

    let products = (catalogSection.products || []).map((product) => {
      const optionGroups = (product.optionGroups || []).map((group) => {
        if (
          String(product.id || product.productId || "") !== String(descriptor.productContextId || "")
          || String(group.id || group.groupId || "") !== String(descriptor.sourceGroupId || "")
        ) return group;

        const byId = new Map((group.options || []).map((option) => [
          String(option.id || option.optionId || ""),
          option,
        ]));
        for (const candidate of optionsFor(descriptor, context)) {
          const id = String(candidate.option._id);
          if (!byId.has(id)) {
            byId.set(id, optionPayload(
              candidate,
              descriptor,
              context.premiumState,
              lang
            ));
          }
        }
        const options = [...byId.values()].sort((left, right) =>
          Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
        );
        const next = { ...group, options };
        if (roleFor(descriptor, candidateGroup(context, descriptor)) === "protein") {
          const optionSections = buildProteinOptionSections(options, lang);
          if (optionSections.length) next.optionSections = optionSections;
        }
        return next;
      });
      return { ...product, optionGroups };
    });

    if (DIRECT_SECTION_TYPES.has(token(descriptor.sectionType || descriptor.type))) {
      for (const product of directProductsFor(descriptor, context)) {
        const id = String(product._id);
        if (usedDirectIds.has(id)) continue;
        products.push(directProductPayload(product, descriptor, lang));
        usedDirectIds.add(id);
      }
      products = products.sort((left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      );
    }
    return { ...catalogSection, products };
  });

  return applyGramRules({ ...catalog, sections });
}

function candidateGroup(context, section) {
  return context.groupsById.get(String(section.sourceGroupId)) || null;
}

async function expandMembership(result, config) {
  if (!result?.membership || !config) return result;
  const context = await loadContext(config);
  for (const section of context.optionSections) {
    const type = selectionType(section);
    const productId = String(section.productContextId);
    const groupId = String(section.sourceGroupId);
    addMembership(result.membership, type, productId, groupId);
    for (const { option } of optionsFor(section, context)) {
      addMembership(result.membership, type, productId, groupId, option._id);
    }
  }
  for (const section of context.directSections) {
    for (const product of directProductsFor(section, context)) {
      addMembership(
        result.membership,
        MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
        product._id
      );
    }
  }
  return result;
}

function wrapCatalog(original) {
  if (typeof original !== "function") throw new Error("Missing planner catalog builder");
  if (original[WRAPPER_MARKER]) return original;
  const wrapped = async function expandedFlutterCatalog(args = {}) {
    const catalog = await original.call(mealBuilderConfigService, args);
    if (!catalog) return catalog;
    const config = args.config || await mealBuilderConfigService.getCurrentPublishedConfig();
    return expandCatalog(catalog, config, args.lang || "en");
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  return wrapped;
}

function wrapMembership(original) {
  if (typeof original !== "function") throw new Error("Missing membership builder");
  if (original[WRAPPER_MARKER]) return original;
  const wrapped = async function expandedFlutterMembership(...args) {
    const result = await original.apply(mealBuilderConfigService, args);
    const config = await mealBuilderConfigService.getCurrentPublishedConfig();
    return expandMembership(result, config);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  return wrapped;
}

function installFlutterMealPlannerCatalogExpansion() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;
  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = wrapCatalog(
      mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder
    );
    mealBuilderConfigService.buildPublishedMembership = wrapMembership(
      mealBuilderConfigService.buildPublishedMembership
    );
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      expandsEligibleRelations: true,
      expandsDirectProductsByCategory: true,
      exposesGramRules: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode = error.code || "FLUTTER_MEAL_PLANNER_EXPANSION_INSTALL_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installFlutterMealPlannerCatalogExpansion();

module.exports = {
  STATE_KEY,
  applyGramRules,
  expandCatalog,
  expandMembership,
  installFlutterMealPlannerCatalogExpansion,
};
