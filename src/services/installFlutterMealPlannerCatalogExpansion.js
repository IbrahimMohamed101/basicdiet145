"use strict";

const MenuProduct = require("../models/MenuProduct");
const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const ProductGroupOption = require("../models/ProductGroupOption");
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

const STATE_KEY = Symbol.for(
  "basicdiet.flutterMealPlannerCatalogExpansion.state"
);
const WRAPPER_MARKER = "__flutterMealPlannerCatalogExpansion";
const PROTEIN_GROUP_KEYS = new Set(["protein", "proteins"]);
const CARB_GROUP_KEYS = new Set(["carb", "carbs"]);
const PROTEIN_FAMILY_KEYS = new Set([
  "chicken",
  "beef",
  "fish",
  "eggs",
  "other",
]);
const DIRECT_SELECTION_TYPES = new Set([
  MEAL_SELECTION_TYPES.SANDWICH,
  MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
]);

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

function subscriptionEnabled(doc = {}) {
  if (doc.availableForSubscription === false) return false;
  return (
    !Array.isArray(doc.availableFor) ||
    doc.availableFor.length === 0 ||
    doc.availableFor.includes("subscription")
  );
}

function docReady(doc, catalogItemsById = new Map()) {
  return Boolean(
    doc &&
      doc.isActive !== false &&
      doc.isVisible !== false &&
      doc.isAvailable !== false &&
      doc.publishedAt &&
      subscriptionEnabled(doc) &&
      isMenuItemEnabledForSubscription(doc) &&
      isLinkedDocGloballyAvailable(doc, catalogItemsById)
  );
}

function relationReady(relation) {
  return Boolean(
    relation &&
      relation.isActive !== false &&
      relation.isVisible !== false &&
      relation.isAvailable !== false
  );
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey || section.selectionType);
}

function sectionSelectionType(section = {}) {
  const configured = token(section.selectionType);
  if (configured) return configured;
  const key = sectionKey(section);
  if (key === "premium") return MEAL_SELECTION_TYPES.PREMIUM_MEAL;
  if (key === "sandwich") return MEAL_SELECTION_TYPES.SANDWICH;
  return key;
}

function isVisibleSubscriptionSection(section = {}) {
  return (
    section.visible !== false &&
    (!Array.isArray(section.availableFor) ||
      section.availableFor.length === 0 ||
      section.availableFor.includes("subscription"))
  );
}

function sectionAllowsExpansion(section = {}) {
  return section.metadata?.exposeAllEligibleItems !== false;
}

function groupKey(group = {}, descriptor = {}) {
  return token(
    group.sourceKey ||
      group.key ||
      descriptor.metadata?.sourceGroupKey ||
      descriptor.optionRole
  );
}

function optionFamily(option = {}) {
  return token(
    resolveProteinVisualFamilyKey(option) ||
      option.displayCategoryKey ||
      option.proteinFamilyKey
  );
}

function isPremiumOption(option, premiumConfigState) {
  const premiumKey = token(option?.premiumKey || option?.key);
  return Boolean(
    option?.isPremium === true ||
      isSubscriptionPremiumMealProtein(option) ||
      (premiumKey && premiumConfigState?.getActiveConfig?.(premiumKey))
  );
}

function optionMatchesSection({ option, descriptor, group, premiumConfigState }) {
  const resolvedGroupKey = groupKey(group, descriptor);
  if (CARB_GROUP_KEYS.has(resolvedGroupKey)) {
    return token(option.displayCategoryKey) !== "large_salad";
  }
  if (!PROTEIN_GROUP_KEYS.has(resolvedGroupKey)) return true;

  const selectionType = sectionSelectionType(descriptor);
  const premium = isPremiumOption(option, premiumConfigState);
  if (selectionType === MEAL_SELECTION_TYPES.PREMIUM_MEAL) {
    if (!premium) return false;
    const premiumKey = option.premiumKey || option.key;
    return !premiumConfigState?.hasConfigs || premiumConfigState.isAllowed(premiumKey);
  }
  if (premium) return false;

  const explicitFamily = token(
    descriptor.metadata?.proteinFamilyKey ||
      descriptor.metadata?.familyKey ||
      (PROTEIN_FAMILY_KEYS.has(sectionKey(descriptor))
        ? sectionKey(descriptor)
        : "")
  );
  return !explicitFamily || optionFamily(option) === explicitFamily;
}

function addMembership(membership, selectionType, productId, groupId = null, optionId = null) {
  if (!membership || !membership.bySelectionType) return;
  const type = selectionType || "";
  if (!membership.bySelectionType.has(type)) {
    membership.bySelectionType.set(type, {
      products: new Set(),
      groups: new Set(),
      options: new Set(),
    });
  }
  const scoped = membership.bySelectionType.get(type);
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

function directTypeForProduct(product, descriptor = {}) {
  const configured = sectionSelectionType(descriptor);
  if (DIRECT_SELECTION_TYPES.has(configured)) return configured;
  return directSelectionType(product) || MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
}

function plannerOptionPayload({
  option,
  relation,
  descriptor,
  group,
  premiumConfigState,
  lang,
}) {
  const selectionType = sectionSelectionType(descriptor);
  const premium = isPremiumOption(option, premiumConfigState);
  const premiumKey = premium ? option.premiumKey || option.key || null : null;
  const premiumConfig = premiumKey
    ? premiumConfigState?.getActiveConfig?.(premiumKey)
    : null;
  const family = premium ? "premium" : optionFamily(option);
  const relationPrice = Number(
    relation?.extraPriceHalala ?? option.extraPriceHalala ?? 0
  );
  const premiumPrice = premium
    ? Number(premiumConfig?.upgradeDeltaHalala ?? relationPrice)
    : 0;

  return {
    id: String(option._id),
    optionId: String(option._id),
    key: option.key || "",
    name: pickLang(option.name || {}, lang),
    nameI18n: localizedPair(option.name),
    description: pickLang(option.description || {}, lang),
    descriptionI18n: localizedPair(option.description),
    imageUrl: option.imageUrl || "",
    selectionType: PROTEIN_GROUP_KEYS.has(groupKey(group, descriptor))
      ? premium
        ? MEAL_SELECTION_TYPES.PREMIUM_MEAL
        : MEAL_SELECTION_TYPES.STANDARD_MEAL
      : selectionType,
    isPremium: premium,
    displayCategoryKey: premium ? "premium" : family,
    proteinFamilyKey: premium ? "premium" : family,
    proteinFamilyNameI18n: family
      ? getProteinFamilyNameI18n(premium ? "premium" : family)
      : undefined,
    premiumKey,
    extraPriceHalala: premium ? premiumPrice : relationPrice,
    extraFeeHalala: premium ? premiumPrice : relationPrice,
    currency: option.currency || SYSTEM_CURRENCY,
    ruleTags: Array.isArray(option.ruleTags) ? option.ruleTags : [],
    sortOrder: Number(
      premiumConfig?.sortOrder ?? relation?.sortOrder ?? option.sortOrder ?? 0
    ),
  };
}

function plannerProductPayload({ product, descriptor, lang }) {
  const selectionType = directTypeForProduct(product, descriptor);
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
    selectionType,
    pricingModel: product.pricingModel || "fixed",
    priceHalala,
    currency: product.currency || SYSTEM_CURRENCY,
    pricing: {
      model: product.pricingModel || "fixed",
      basePriceHalala: priceHalala,
      extraFeeHalala: 0,
      currency: product.currency || SYSTEM_CURRENCY,
    },
    action: {
      type: "direct_add",
      requiresBuilder: false,
      treatAsFullMeal: true,
    },
    optionGroups: [],
    sortOrder: Number(product.sortOrder || 0),
  };
}

function descriptorForCatalogSection(configSections, catalogSection) {
  const key = sectionKey(catalogSection);
  return (
    configSections.find((section) => sectionKey(section) === key) ||
    configSections.find(
      (section) =>
        Number(section.sortOrder || 0) === Number(catalogSection.sortOrder || 0) &&
        sectionSelectionType(section) === key
    ) ||
    null
  );
}

async function loadExpansionContext(config) {
  const sections = (config?.sections || [])
    .filter(isVisibleSubscriptionSection)
    .filter(sectionAllowsExpansion);
  const optionSections = sections.filter(
    (section) =>
      token(section.sectionType || section.type) === "option_group" &&
      section.productContextId &&
      section.sourceGroupId
  );
  const directSections = sections.filter((section) => {
    const type = token(section.sectionType || section.type);
    return type === "product_list" || type === "product_category";
  });

  const productContextIds = [
    ...new Set(optionSections.map((section) => String(section.productContextId))),
  ];
  const groupIds = [
    ...new Set(optionSections.map((section) => String(section.sourceGroupId))),
  ];
  const selectedDirectIds = [
    ...new Set(
      directSections.flatMap((section) =>
        (section.selectedProductIds || section.productIds || []).map(String)
      )
    ),
  ];

  const [groups, groupRelations, optionRelations, selectedDirectProducts] =
    await Promise.all([
      groupIds.length
        ? MenuOptionGroup.find({ _id: { $in: groupIds } }).lean()
        : [],
      productContextIds.length
        ? ProductOptionGroup.find({
            productId: { $in: productContextIds },
            groupId: { $in: groupIds },
          }).lean()
        : [],
      productContextIds.length
        ? ProductGroupOption.find({
            productId: { $in: productContextIds },
            groupId: { $in: groupIds },
          })
            .sort({ sortOrder: 1, createdAt: 1 })
            .lean()
        : [],
      selectedDirectIds.length
        ? MenuProduct.find({ _id: { $in: selectedDirectIds } }).lean()
        : [],
    ]);

  const optionIds = [...new Set(optionRelations.map((row) => String(row.optionId)))];
  const options = optionIds.length
    ? await MenuOption.find({ _id: { $in: optionIds } }).lean()
    : [];
  const optionCatalogItemsById = await loadCatalogItemsByIdForDocs(options);
  const premiumConfigState = await loadClientPremiumUpgradeConfigState().catch(
    () => ({ hasConfigs: false })
  );

  const selectedDirectById = new Map(
    selectedDirectProducts.map((product) => [String(product._id), product])
  );
  const categoryIdsBySectionKey = new Map();
  for (const section of directSections) {
    const categoryIds = new Set();
    if (section.sourceCategoryId) categoryIds.add(String(section.sourceCategoryId));
    for (const id of section.selectedProductIds || section.productIds || []) {
      const product = selectedDirectById.get(String(id));
      if (product?.categoryId) categoryIds.add(String(product.categoryId));
    }
    categoryIdsBySectionKey.set(sectionKey(section), categoryIds);
  }
  const directCategoryIds = [
    ...new Set([...categoryIdsBySectionKey.values()].flatMap((ids) => [...ids])),
  ];
  const directCandidates = directCategoryIds.length
    ? await MenuProduct.find({ categoryId: { $in: directCategoryIds } })
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean()
    : [];
  const directCatalogItemsById = await loadCatalogItemsByIdForDocs(
    directCandidates
  );

  return {
    sections,
    optionSections,
    directSections,
    groupsById: new Map(groups.map((group) => [String(group._id), group])),
    groupRelationByKey: new Map(
      groupRelations.map((relation) => [
        `${String(relation.productId)}:${String(relation.groupId)}`,
        relation,
      ])
    ),
    optionRelations,
    optionsById: new Map(options.map((option) => [String(option._id), option])),
    optionCatalogItemsById,
    premiumConfigState,
    categoryIdsBySectionKey,
    directCandidates,
    directCatalogItemsById,
  };
}

function optionCandidatesForDescriptor(descriptor, context) {
  const productId = String(descriptor.productContextId || "");
  const groupId = String(descriptor.sourceGroupId || "");
  const group = context.groupsById.get(groupId);
  const groupRelation = context.groupRelationByKey.get(`${productId}:${groupId}`);
  if (!group || !relationReady(groupRelation)) return [];

  return context.optionRelations
    .filter(
      (relation) =>
        String(relation.productId) === productId &&
        String(relation.groupId) === groupId &&
        relationReady(relation)
    )
    .map((relation) => ({
      relation,
      option: context.optionsById.get(String(relation.optionId)),
    }))
    .filter(({ option }) => docReady(option, context.optionCatalogItemsById))
    .filter(({ option }) =>
      optionMatchesSection({
        option,
        descriptor,
        group,
        premiumConfigState: context.premiumConfigState,
      })
    )
    .sort(
      (left, right) =>
        Number(left.relation.sortOrder ?? left.option.sortOrder ?? 0) -
        Number(right.relation.sortOrder ?? right.option.sortOrder ?? 0)
    );
}

function directCandidatesForDescriptor(descriptor, context) {
  const categoryIds = context.categoryIdsBySectionKey.get(sectionKey(descriptor));
  if (!categoryIds?.size) return [];
  return context.directCandidates
    .filter((product) => categoryIds.has(String(product.categoryId || "")))
    .filter(isProductionDirectProduct)
    .filter((product) => docReady(product, context.directCatalogItemsById))
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    );
}

function applyFlutterGramRules(catalog) {
  const configured = catalog?.rules?.standardCarbs || STANDARD_CARB_RULES;
  const maxTypes = Number(configured?.maxTypes || STANDARD_CARB_RULES.maxTypes || 2);
  const maxTotalGrams = Number(
    configured?.maxTotalGrams || STANDARD_CARB_RULES.maxTotalGrams || 300
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
      maxCarbTotalGrams,
      carbGramStep: 50,
      carbUnit: "grams",
    },
  };
}

async function expandPlannerCatalog(catalog, config, lang = "en") {
  if (!catalog || !config) return applyFlutterGramRules(catalog || {});
  const context = await loadExpansionContext(config);
  const assignedDirectIds = new Set(
    (catalog.sections || []).flatMap((section) =>
      (section.products || [])
        .filter((product) => product.action?.type === "direct_add")
        .map((product) => String(product.id || product.productId || ""))
        .filter(Boolean)
    )
  );

  const sections = (catalog.sections || []).map((catalogSection) => {
    const descriptor = descriptorForCatalogSection(context.sections, catalogSection);
    if (!descriptor) return catalogSection;

    const products = (catalogSection.products || []).map((product) => {
      const optionGroups = (product.optionGroups || []).map((group) => {
        if (
          String(product.id || product.productId || "") !==
            String(descriptor.productContextId || "") ||
          String(group.id || group.groupId || "") !==
            String(descriptor.sourceGroupId || "")
        ) {
          return group;
        }
        const candidates = optionCandidatesForDescriptor(descriptor, context);
        const byId = new Map(
          (group.options || []).map((option) => [
            String(option.id || option.optionId || ""),
            option,
          ])
        );
        const sourceGroup = context.groupsById.get(
          String(descriptor.sourceGroupId)
        );
        for (const candidate of candidates) {
          const id = String(candidate.option._id);
          if (!byId.has(id)) {
            byId.set(
              id,
              plannerOptionPayload({
                ...candidate,
                descriptor,
                group: sourceGroup,
                premiumConfigState: context.premiumConfigState,
                lang,
              })
            );
          }
        }
        const options = [...byId.values()].sort(
          (left, right) =>
            Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
        );
        const resolvedGroupKey = groupKey(group, descriptor);
        const nextGroup = { ...group, options };
        if (PROTEIN_GROUP_KEYS.has(resolvedGroupKey)) {
          const optionSections = buildProteinOptionSections(options, lang);
          if (optionSections.length) nextGroup.optionSections = optionSections;
        }
        return nextGroup;
      });
      return { ...product, optionGroups };
    });

    if (
      token(descriptor.sectionType || descriptor.type) === "product_list" ||
      token(descriptor.sectionType || descriptor.type) === "product_category"
    ) {
      for (const product of directCandidatesForDescriptor(descriptor, context)) {
        const id = String(product._id);
        if (assignedDirectIds.has(id)) continue;
        products.push(plannerProductPayload({ product, descriptor, lang }));
        assignedDirectIds.add(id);
      }
      products.sort(
        (left, right) =>
          Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      );
    }

    return { ...catalogSection, products };
  });

  return applyFlutterGramRules({ ...catalog, sections });
}

async function expandPublishedMembership(result, config) {
  if (!result?.membership || !config) return result;
  const context = await loadExpansionContext(config);
  for (const descriptor of context.optionSections) {
    const selectionType = sectionSelectionType(descriptor);
    const productId = String(descriptor.productContextId);
    const groupId = String(descriptor.sourceGroupId);
    addMembership(result.membership, selectionType, productId, groupId);
    for (const { option } of optionCandidatesForDescriptor(descriptor, context)) {
      addMembership(
        result.membership,
        selectionType,
        productId,
        groupId,
        option._id
      );
    }
  }
  for (const descriptor of context.directSections) {
    for (const product of directCandidatesForDescriptor(descriptor, context)) {
      addMembership(
        result.membership,
        directTypeForProduct(product, descriptor),
        product._id
      );
    }
  }
  return result;
}

function wrapPlannerCatalog(original) {
  if (typeof original !== "function") {
    const error = new Error("Missing Meal Builder planner catalog builder");
    error.code = "FLUTTER_MEAL_PLANNER_EXPANSION_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPER_MARKER] === true) return original;

  const wrapped = async function flutterMealPlannerExpandedCatalog(args = {}) {
    const catalog = await original.call(mealBuilderConfigService, args);
    if (!catalog) return catalog;
    const config = args.config || (await mealBuilderConfigService.getCurrentPublishedConfig());
    return expandPlannerCatalog(catalog, config, args.lang || "en");
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  return wrapped;
}

function wrapPublishedMembership(original) {
  if (typeof original !== "function") {
    const error = new Error("Missing Meal Builder published membership builder");
    error.code = "FLUTTER_MEAL_PLANNER_EXPANSION_INSTALL_FAILED";
    throw error;
  }
  if (original[WRAPPER_MARKER] === true) return original;

  const wrapped = async function flutterMealPlannerExpandedMembership(...args) {
    const result = await original.apply(mealBuilderConfigService, args);
    const config = await mealBuilderConfigService.getCurrentPublishedConfig();
    return expandPublishedMembership(result, config);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  return wrapped;
}

function installFlutterMealPlannerCatalogExpansion() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;
  if (current?.status === "installing") {
    const error = new Error(
      "Flutter Meal Planner catalog expansion installation was re-entered"
    );
    error.code = "FLUTTER_MEAL_PLANNER_EXPANSION_INSTALL_REENTRANT";
    throw error;
  }

  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder =
      wrapPlannerCatalog(
        mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder
      );
    mealBuilderConfigService.buildPublishedMembership =
      wrapPublishedMembership(mealBuilderConfigService.buildPublishedMembership);
    state.status = "installed";
    state.installedAt = new Date();
    state.expandsEligibleOptionRelations = true;
    state.expandsDirectProductsByCategory = true;
    state.exposesFlutterGramRules = true;
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error?.code || "FLUTTER_MEAL_PLANNER_EXPANSION_INSTALL_FAILED";
    state.errorMessage = error?.message || "Installation failed";
    throw error;
  }
}

installFlutterMealPlannerCatalogExpansion();

module.exports = {
  STATE_KEY,
  applyFlutterGramRules,
  expandPlannerCatalog,
  expandPublishedMembership,
  installFlutterMealPlannerCatalogExpansion,
  optionCandidatesForDescriptor,
};
