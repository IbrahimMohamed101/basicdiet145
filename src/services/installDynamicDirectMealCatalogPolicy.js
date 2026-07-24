"use strict";

const crypto = require("crypto");

const MealBuilderConfig = require("../models/MealBuilderConfig");
const MenuProduct = require("../models/MenuProduct");
const {
  MEAL_SELECTION_TYPES,
  SYSTEM_CURRENCY,
} = require("../config/mealPlannerContract");
const { pickLang } = require("../utils/i18n");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const mealBuilderConfigService = require("./subscription/mealBuilderConfigService");
const dashboardMealBuilderService = require("./subscription/dashboardMealPlannerDashboardService");
const {
  isMenuItemEnabledForSubscription,
} = require("./subscription/subscriptionMenuEligibilityPolicyService");

const STATE_KEY = Symbol.for("basicdiet.dynamicDirectMealCatalogPolicy.state");
const WRAPPER_MARKER = "__dynamicDirectMealCatalogPolicy";
const DYNAMIC_SECTION_KEY = "sandwich";
const DIRECT_ITEM_TYPES = new Set([
  "cold_sandwich",
  "full_meal_product",
  "standalone_meal",
]);
const DIRECT_CARD_VARIANTS = new Set([
  "ready_meal",
  "ready_meal_customizable",
  "sandwich_card",
]);
const EXCLUDED_PRODUCT_KEYS = new Set([
  "basic_meal",
  "premium_large_salad",
]);
const EXCLUDED_ITEM_TYPES = new Set([
  "addon",
  "subscription_addon",
  "basic_meal",
  "custom_meal",
  "meal_builder",
  "premium_large_salad",
  "basic_salad",
]);

function token(value) {
  return String(value || "").trim().toLowerCase();
}

function stableHash(payload) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

function sectionKey(section = {}) {
  return token(section.key || section.sectionKey);
}

function isDynamicDirectSection(section = {}) {
  const membershipSource = token(
    section.metadata?.membershipSource || section.membershipSource
  );
  const sectionType = token(section.sectionType || section.type);
  const directType =
    sectionType === "product_list" ||
    token(section.selectionType) === MEAL_SELECTION_TYPES.SANDWICH ||
    token(section.selectionType) === MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT;
  return (
    directType &&
    (sectionKey(section) === DYNAMIC_SECTION_KEY ||
      membershipSource === "live_catalog")
  );
}

function hasExplicitDirectMealIdentity(product = {}) {
  const key = token(product.key);
  const itemType = token(product.itemType);
  const cardVariant = token(product.ui?.cardVariant);
  if (EXCLUDED_PRODUCT_KEYS.has(key) || EXCLUDED_ITEM_TYPES.has(itemType)) {
    return false;
  }
  return (
    DIRECT_ITEM_TYPES.has(itemType) || DIRECT_CARD_VARIANTS.has(cardVariant)
  );
}

function customerReady(product = {}, catalogItemsById = new Map()) {
  return Boolean(
    product &&
      product.isActive !== false &&
      product.isVisible !== false &&
      product.isAvailable !== false &&
      product.publishedAt &&
      isMenuItemEnabledForSubscription(product) &&
      isLinkedDocGloballyAvailable(product, catalogItemsById)
  );
}

async function loadLiveDirectMeals() {
  const products = await MenuProduct.find({})
    .sort({ sortOrder: 1, key: 1, _id: 1 })
    .lean();
  const candidates = products.filter(hasExplicitDirectMealIdentity);
  const catalogItemsById = await loadCatalogItemsByIdForDocs(candidates);
  return candidates
    .filter((product) => customerReady(product, catalogItemsById))
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
        token(left.key).localeCompare(token(right.key)) ||
        String(left._id).localeCompare(String(right._id))
    );
}

function directProductPayload(product, lang = "en") {
  const priceHalala = Number(product.priceHalala || 0);
  return {
    id: String(product._id),
    productId: String(product._id),
    key: product.key || "",
    type: "product",
    name: pickLang(product.name || {}, lang),
    nameI18n: product.name || { ar: "", en: "" },
    description: pickLang(product.description || {}, lang),
    descriptionI18n: product.description || { ar: "", en: "" },
    imageUrl: product.imageUrl || "",
    itemType: product.itemType || "full_meal_product",
    selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
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
    sectionKey: DYNAMIC_SECTION_KEY,
  };
}

function dynamicSectionDefaults(lang = "en") {
  const nameI18n = { ar: "الوجبات", en: "Meals" };
  return {
    id: `section:${DYNAMIC_SECTION_KEY}:live`,
    key: DYNAMIC_SECTION_KEY,
    type: "product_list",
    builderSectionType: "product_list",
    source: { kind: "live_catalog" },
    name: pickLang(nameI18n, lang),
    nameI18n,
    sortOrder: 20,
    selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
    ui: {
      cardType: "direct_product",
      cardKind: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
      requiresBuilder: false,
      treatAsFullMeal: true,
      membershipSource: "live_catalog",
      systemManaged: true,
    },
    rules: { carbsRequired: false },
    products: [],
  };
}

function decorateDynamicPlannerCatalog(catalog, products, lang = "en") {
  if (!catalog || typeof catalog !== "object") return catalog;
  const liveProducts = products.map((product) => directProductPayload(product, lang));
  const sections = Array.isArray(catalog.sections) ? [...catalog.sections] : [];
  let found = false;
  const nextSections = sections.map((section) => {
    if (!isDynamicDirectSection(section)) return section;
    found = true;
    return {
      ...section,
      key: DYNAMIC_SECTION_KEY,
      type: "product_list",
      selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
      source: { ...(section.source || {}), kind: "live_catalog" },
      ui: {
        ...(section.ui || {}),
        cardType: "direct_product",
        cardKind: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
        requiresBuilder: false,
        treatAsFullMeal: true,
        membershipSource: "live_catalog",
        systemManaged: true,
      },
      rules: { ...(section.rules || {}), carbsRequired: false },
      products: liveProducts,
    };
  });
  if (!found) {
    nextSections.push({
      ...dynamicSectionDefaults(lang),
      products: liveProducts,
    });
  }
  nextSections.sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      sectionKey(left).localeCompare(sectionKey(right))
  );
  const stablePayload = {
    contractVersion: catalog.contractVersion || "meal_planner_menu.v3",
    currency: catalog.currency || SYSTEM_CURRENCY,
    sections: nextSections,
    rules: catalog.rules || {},
  };
  return {
    ...catalog,
    sections: nextSections,
    catalogHash: stableHash(stablePayload),
  };
}

function ensureMembershipScope(membership, selectionType) {
  if (!membership.bySelectionType) membership.bySelectionType = new Map();
  if (!membership.products) membership.products = new Set();
  if (!membership.groups) membership.groups = new Set();
  if (!membership.options) membership.options = new Set();
  if (!membership.bySelectionType.has(selectionType)) {
    membership.bySelectionType.set(selectionType, {
      products: new Set(),
      groups: new Set(),
      options: new Set(),
    });
  }
  return membership.bySelectionType.get(selectionType);
}

function addLiveProductsToMembership(result, products) {
  if (!result || !result.membership) return result;
  for (const selectionType of [
    MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
    MEAL_SELECTION_TYPES.SANDWICH,
  ]) {
    const scope = ensureMembershipScope(result.membership, selectionType);
    for (const product of products) {
      const id = String(product._id);
      result.membership.products.add(id);
      scope.products.add(id);
    }
  }
  return result;
}

function systemDynamicSection(section, liveProductIds) {
  return {
    ...section,
    key: DYNAMIC_SECTION_KEY,
    sectionType: "product_list",
    sourceKind: "product_list",
    includeMode: "selected",
    selectedProductIds: [...liveProductIds],
    selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
    metadata: {
      ...(section.metadata || {}),
      cardType: "direct_product",
      cardKind: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
      requiresBuilder: false,
      treatAsFullMeal: true,
      membershipSource: "live_catalog",
      systemManaged: true,
    },
    rules: { ...(section.rules || {}), carbsRequired: false },
  };
}

function sanitizeSectionsForValidation(sections = [], liveProductIds = []) {
  const source = Array.isArray(sections) ? sections : [];
  let found = false;
  const output = [];
  for (const section of source) {
    if (!isDynamicDirectSection(section)) {
      output.push(section);
      continue;
    }
    found = true;
    if (liveProductIds.length) {
      output.push(systemDynamicSection(section, liveProductIds));
    }
  }
  if (!found && liveProductIds.length) {
    output.push(
      systemDynamicSection(
        {
          key: DYNAMIC_SECTION_KEY,
          titleOverride: { ar: "الوجبات", en: "Meals" },
          sortOrder: 20,
          required: false,
          minSelections: 0,
          maxSelections: 1,
          multiSelect: false,
          visible: true,
          availableFor: ["subscription"],
        },
        liveProductIds
      )
    );
  }
  return output.sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
  );
}

function dynamicCatalogWarning() {
  return {
    level: "warning",
    code: "MEAL_BUILDER_DIRECT_CATALOG_EMPTY",
    message: "No active standalone subscription meals are currently available",
    sectionKey: DYNAMIC_SECTION_KEY,
    membershipSource: "live_catalog",
  };
}

async function validateConfigAgainstLiveCatalog(config = {}) {
  const products = await loadLiveDirectMeals();
  const liveProductIds = products.map((product) => String(product._id));
  const sanitized = {
    ...config,
    sections: sanitizeSectionsForValidation(config.sections || [], liveProductIds),
  };
  const validation = await mealBuilderConfigService.validateConfigObject(sanitized);
  const warnings = [...(validation.warnings || [])];
  if (!liveProductIds.length) warnings.push(dynamicCatalogWarning());
  const errors = [...(validation.errors || [])];
  return {
    products,
    liveProductIds,
    sanitized,
    validation: {
      ...validation,
      status: errors.length ? "error" : warnings.length ? "warning" : "ok",
      ready: errors.length === 0,
      errors,
      warnings,
      checks: [...errors, ...warnings],
      summary: {
        ...(validation.summary || {}),
        errors: errors.length,
        warnings: warnings.length,
      },
    },
  };
}

function hydratedProduct(product, lang = "en") {
  return {
    id: String(product._id),
    productId: String(product._id),
    type: "product",
    key: product.key || "",
    name: product.name || { ar: "", en: "" },
    label: pickLang(product.name || {}, lang),
    itemType: product.itemType || "full_meal_product",
    selectionType: MEAL_SELECTION_TYPES.FULL_MEAL_PRODUCT,
    configurable: false,
    pricing: {
      pricingModel: product.pricingModel || "fixed",
      priceHalala: Number(product.priceHalala || 0),
      currency: product.currency || SYSTEM_CURRENCY,
    },
    selected: true,
    required: false,
    eligible: true,
    linked: true,
    available: true,
    active: true,
    visible: true,
    published: true,
    subscriptionEnabled: true,
    relationExists: true,
    catalogItemAvailable: true,
    included: true,
    includedVia: "live_catalog",
    reasonCodes: ["LIVE_CATALOG", "ELIGIBLE"],
    warnings: [],
    errors: [],
    state: "selected",
  };
}

function decorateHydratedSections(sections, products, lang = "en") {
  const rows = products.map((product) => hydratedProduct(product, lang));
  return (sections || []).map((section) => {
    if (!isDynamicDirectSection(section)) return section;
    const nonProductItems = (section.items || []).filter(
      (item) => item?.type !== "product" && item?.type !== "missing_product"
    );
    return {
      ...section,
      ...systemDynamicSection(
        section,
        rows.map((row) => row.productId)
      ),
      selectedProducts: rows,
      items: [...nonProductItems, ...rows],
      hydration: {
        ...(section.hydration || {}),
        selectedProductCount: rows.length,
        errorCount: 0,
        warningCount: 0,
        membershipSource: "live_catalog",
      },
    };
  });
}

function wrapPlannerCatalog() {
  const original = mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder;
  if (typeof original !== "function" || original[WRAPPER_MARKER]) return;
  const wrapped = async function dynamicDirectPlannerCatalog(args = {}) {
    const [catalog, products] = await Promise.all([
      original.call(mealBuilderConfigService, args),
      loadLiveDirectMeals(),
    ]);
    return decorateDynamicPlannerCatalog(
      catalog,
      products,
      args.lang || "en"
    );
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder = wrapped;
}

function wrapMembership() {
  const original = mealBuilderConfigService.buildPublishedMembership;
  if (typeof original !== "function" || original[WRAPPER_MARKER]) return;
  const wrapped = async function dynamicDirectMembership(...args) {
    const [result, products] = await Promise.all([
      original.apply(mealBuilderConfigService, args),
      loadLiveDirectMeals(),
    ]);
    return addLiveProductsToMembership(result, products);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  mealBuilderConfigService.buildPublishedMembership = wrapped;
}

function installDashboardWrappers() {
  const originalReadiness = dashboardMealBuilderService.getReadinessReport;
  const originalHydratedDraft = dashboardMealBuilderService.getHydratedDraft;
  const originalDashboardState = dashboardMealBuilderService.getDashboardState;
  const originalPublishDraft = dashboardMealBuilderService.publishDraft;
  const originalUpdateDraft = dashboardMealBuilderService.updateDraft;
  const originalValidatePayload = dashboardMealBuilderService.validatePayload;

  dashboardMealBuilderService.getReadinessReport = async function dynamicReadiness() {
    const [draft, published] = await Promise.all([
      MealBuilderConfig.findOne({ status: "draft", isCurrent: true })
        .sort({ updatedAt: -1 })
        .lean(),
      mealBuilderConfigService.getCurrentPublishedConfig({
        allowVirtualFallback: true,
      }),
    ]);
    if (!published) return originalReadiness.call(dashboardMealBuilderService);
    const { validation } = await validateConfigAgainstLiveCatalog(published);
    const errors = [...validation.errors];
    if (!draft) {
      errors.unshift({
        level: "error",
        code: "MEAL_BUILDER_DRAFT_NOT_FOUND",
        message: "No current Meal Builder draft exists",
      });
    }
    const warnings = [...validation.warnings];
    return {
      ...validation,
      status: errors.length ? "error" : warnings.length ? "warning" : "ok",
      ready: errors.length === 0,
      errors,
      warnings,
      checks: [...errors, ...warnings],
      summary: {
        ...(validation.summary || {}),
        draft: Boolean(draft),
        published: true,
        sections: Array.isArray(published.sections)
          ? published.sections.length
          : 0,
        errors: errors.length,
        warnings: warnings.length,
        revisionHash: published.revisionHash || "",
        route: "/api/dashboard/meal-builder/readiness",
        directMembershipSource: "live_catalog",
      },
    };
  };

  dashboardMealBuilderService.getHydratedDraft = async function dynamicHydratedDraft(
    options = {}
  ) {
    const response = await originalHydratedDraft.call(
      dashboardMealBuilderService,
      options
    );
    if (!response?.draft) return response;
    const { products, liveProductIds, validation } =
      await validateConfigAgainstLiveCatalog(response.draft);
    const sections = decorateHydratedSections(
      response.sections || response.draft.sections || [],
      products,
      options.lang || "en"
    );
    return {
      ...response,
      draft: {
        ...response.draft,
        sections,
      },
      sections,
      ready: validation.ready,
      errors: validation.errors,
      warnings: validation.warnings,
      validation,
      dynamicDirectCatalog: {
        sectionKey: DYNAMIC_SECTION_KEY,
        membershipSource: "live_catalog",
        productIds: liveProductIds,
        count: liveProductIds.length,
      },
    };
  };

  dashboardMealBuilderService.getDashboardState = async function dynamicDashboardState(
    options = {}
  ) {
    const state = await originalDashboardState.call(
      dashboardMealBuilderService,
      options
    );
    const validation = { ...(state.validation || {}) };
    for (const key of ["draft", "published"]) {
      if (state[key]) {
        validation[key] = (
          await validateConfigAgainstLiveCatalog(state[key])
        ).validation;
      }
    }
    return {
      ...state,
      validation,
      dynamicDirectCatalog: {
        sectionKey: DYNAMIC_SECTION_KEY,
        membershipSource: "live_catalog",
      },
    };
  };

  dashboardMealBuilderService.validatePayload = async function dynamicValidatePayload(
    payload = {}
  ) {
    const products = await loadLiveDirectMeals();
    return originalValidatePayload.call(dashboardMealBuilderService, {
      ...payload,
      sections: sanitizeSectionsForValidation(
        payload.sections || [],
        products.map((product) => String(product._id))
      ),
    });
  };

  dashboardMealBuilderService.publishDraft = async function dynamicPublishDraft(
    args = {}
  ) {
    const draft = await MealBuilderConfig.findOne({
      status: "draft",
      isCurrent: true,
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (draft) {
      const products = await loadLiveDirectMeals();
      await originalUpdateDraft.call(dashboardMealBuilderService, {
        sections: sanitizeSectionsForValidation(
          draft.sections || [],
          products.map((product) => String(product._id))
        ),
        notes: draft.notes,
        actor: args.actor || {},
      });
    }
    return originalPublishDraft.call(dashboardMealBuilderService, args);
  };

  for (const method of [
    dashboardMealBuilderService.getReadinessReport,
    dashboardMealBuilderService.getHydratedDraft,
    dashboardMealBuilderService.getDashboardState,
    dashboardMealBuilderService.validatePayload,
    dashboardMealBuilderService.publishDraft,
  ]) {
    Object.defineProperty(method, WRAPPER_MARKER, { value: true });
  }
}

function installDynamicDirectMealCatalogPolicy() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;
  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    wrapPlannerCatalog();
    wrapMembership();
    installDashboardWrappers();
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      sectionKey: DYNAMIC_SECTION_KEY,
      catalogAuthority: "menu_products",
      membershipSource: "live_catalog",
      flutterContractPreserved: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode =
      error.code || "DYNAMIC_DIRECT_MEAL_CATALOG_INSTALL_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installDynamicDirectMealCatalogPolicy();

module.exports = {
  STATE_KEY,
  decorateDynamicPlannerCatalog,
  hasExplicitDirectMealIdentity,
  installDynamicDirectMealCatalogPolicy,
  isDynamicDirectSection,
  loadLiveDirectMeals,
  sanitizeSectionsForValidation,
};
