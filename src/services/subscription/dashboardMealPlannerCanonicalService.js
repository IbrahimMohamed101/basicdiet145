"use strict";

const mongoose = require("mongoose");

const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const { pickLang } = require("../../utils/i18n");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const cardFacade = require("./dashboardMealPlannerCardFacadeService");
const authoringContract = require("./dashboardMealBuilderAuthoringContractService");

const PICKER_VERSION = "dashboard_meal_builder_picker.v2";
const CARD_ACTION_VERSION = "dashboard_meal_builder_card_action.v2";
const DIRECT_SELECTION_TYPE = "full_meal_product";
const STANDARD_SELECTION_TYPE = "standard_meal";
const SYSTEM_CURRENCY = "SAR";
const MAX_PICKER_LIMIT = 1000;
const DIRECT_ITEM_TYPES = new Set(["cold_sandwich", "full_meal_product"]);
const DIRECT_CARD_VARIANTS = new Set([
  "ready_meal",
  "ready_meal_customizable",
  "sandwich_card",
]);
const NON_DIRECT_CARD_VARIANTS = new Set([
  "addon",
  "addon_card",
  "hero_builder",
  "compact_builder",
  "compact_product",
]);

function mealBuilderError(message, code, status = 400, details) {
  return new cardFacade.MealBuilderError(message, code, status, details);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(
    MAX_PICKER_LIMIT,
    Math.max(1, Number.parseInt(limit || "100", 10) || 100)
  );
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
}

function normalizeSectionKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(key)) {
    throw mealBuilderError(
      "Card key must contain 2-64 lowercase letters, numbers, underscores, or dashes",
      "MEAL_BUILDER_CARD_KEY_INVALID",
      400,
      { value }
    );
  }
  return key;
}

function normalizeLocalizedTitle(value, fallbackKey = "") {
  if (typeof value === "string") {
    const title = value.trim();
    return { ar: title, en: title };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const ar = String(source.ar || "").trim();
  const en = String(source.en || "").trim();
  if (!ar && !en) {
    const fallback = String(fallbackKey || "").replace(/[_-]+/g, " ").trim();
    return { ar: fallback, en: fallback };
  }
  return { ar: ar || en, en: en || ar };
}

function normalizeOptionalInteger(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw mealBuilderError(
      "Card numeric fields must be integers greater than or equal to zero",
      "MEAL_BUILDER_CARD_NUMBER_INVALID",
      400,
      { value }
    );
  }
  return parsed;
}

function normalizeIds(value, fieldName = "ids", required = false) {
  const source = value === undefined || value === null ? [] : value;
  if (!Array.isArray(source)) {
    throw mealBuilderError(
      `${fieldName} must be an array`,
      "MEAL_BUILDER_INVALID_REFERENCE",
      400
    );
  }
  const ids = [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
  const invalid = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalid.length) {
    throw mealBuilderError(
      `${fieldName} contains invalid ids`,
      "MEAL_BUILDER_INVALID_REFERENCE",
      400,
      { [fieldName]: invalid }
    );
  }
  if (required && !ids.length) {
    throw mealBuilderError(
      "A direct product card must contain at least one product",
      "MEAL_BUILDER_CARD_PRODUCTS_REQUIRED",
      422
    );
  }
  return ids;
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function sectionOptionRole(section = {}) {
  const explicit = String(
    section.optionRole || section.metadata?.optionRole || ""
  )
    .trim()
    .toLowerCase();
  if (explicit === "protein" || explicit === "carbs") return explicit;
  const visualRole = String(section.metadata?.visualRole || "")
    .trim()
    .toLowerCase();
  if (visualRole === "carbs") return "carbs";
  if (visualRole === "protein_family" || section.metadata?.proteinFamilyKey) {
    return "protein";
  }
  const key = sectionKeyOf(section);
  return key === "carbs" ? "carbs" : null;
}

function isSystemManagedCard(section = {}) {
  const selectionType = String(section.selectionType || "").trim();
  return (
    section.systemManaged === true ||
    sectionKeyOf(section) === "premium" ||
    section.sourceKind === "premium_visual" ||
    section.metadata?.visualRole === "premium" ||
    selectionType === "premium_meal" ||
    selectionType === "premium_large_salad"
  );
}

function isOptionCard(section = {}) {
  const explicit = String(section.cardType || section.metadata?.cardType || "").trim();
  return (
    !isSystemManagedCard(section) &&
    (explicit === "option_family" ||
      String(section.sectionType || section.type || "") === "option_group" ||
      (Array.isArray(section.selectedOptionIds) && section.selectedOptionIds.length > 0) ||
      Boolean(section.productContextId && section.sourceGroupId))
  );
}

function isDirectCard(section = {}) {
  if (isSystemManagedCard(section) || isOptionCard(section)) return false;
  const explicit = String(section.cardType || section.metadata?.cardType || "").trim();
  const sectionType = String(section.sectionType || section.type || "").trim();
  return (
    explicit === "direct_product" ||
    sectionType === "product_list" ||
    sectionType === "product_category" ||
    Array.isArray(section.selectedProductIds)
  );
}

function flutterSlotContract(section = {}) {
  if (isDirectCard(section)) {
    return { idField: "sandwichId", requiresCompanionCard: false };
  }
  const role = sectionOptionRole(section);
  if (role === "carbs") {
    return { idField: "carbs[].carbId", requiresCompanionCard: true };
  }
  return { idField: "proteinId", requiresCompanionCard: true };
}

function decorateSection(section = {}) {
  const role = sectionOptionRole(section);
  const direct = isDirectCard(section);
  const option = isOptionCard(section);
  if (!direct && !option) return { ...section };
  const cardType = direct ? "direct_product" : "option_family";
  const selectionType = direct ? DIRECT_SELECTION_TYPE : STANDARD_SELECTION_TYPE;
  return {
    ...section,
    cardType,
    optionRole: option ? role : null,
    selectionType,
    itemEntity: direct ? "MenuProduct" : "MenuOption",
    completeByItself: direct,
    flutterSlotContract: flutterSlotContract(section),
    metadata: {
      ...(section.metadata || {}),
      cardType,
      cardKind: direct ? "full_meal_product" : "option_family",
      ...(option && role ? { optionRole: role } : {}),
      dashboardManaged: section.metadata?.dashboardManaged !== false,
    },
  };
}

function canonicalStoredSection(section = {}) {
  const decorated = decorateSection(section);
  if (!isDirectCard(decorated) && !isOptionCard(decorated)) return { ...section };
  const {
    cardType: _cardType,
    optionRole: _optionRole,
    itemEntity: _itemEntity,
    completeByItself: _completeByItself,
    flutterSlotContract: _slot,
    ...stored
  } = decorated;
  return stored;
}

function decorateConfig(config) {
  if (!config || typeof config !== "object") return config;
  return {
    ...config,
    sections: (config.sections || []).map(decorateSection),
  };
}

function decorateState(state) {
  if (!state || typeof state !== "object") return state;
  return {
    ...state,
    cardContract: authoringContract.getCardContract(),
    draft: decorateConfig(state.draft),
    published: decorateConfig(state.published),
  };
}

function decorateAction(response) {
  if (!response || typeof response !== "object") return response;
  return {
    ...response,
    contractVersion: CARD_ACTION_VERSION,
    section: response.section ? decorateSection(response.section) : null,
    draft: decorateConfig(response.draft),
  };
}

function decorateLifecycle(response) {
  if (!response || typeof response !== "object") return response;
  if (Array.isArray(response.sections)) return decorateConfig(response);
  return {
    ...response,
    config: decorateConfig(response.config),
    draft: decorateConfig(response.draft),
    published: decorateConfig(response.published),
  };
}

function productCardVariant(product = {}) {
  return String(product.ui?.cardVariant || "").trim().toLowerCase();
}

function directCatalogCompatible(product = {}) {
  const itemType = String(product.itemType || "").trim().toLowerCase();
  const variant = productCardVariant(product);
  return (
    DIRECT_ITEM_TYPES.has(itemType) ||
    (itemType === "product" && DIRECT_CARD_VARIANTS.has(variant))
  );
}

function explicitDirectCompatible(product = {}) {
  const itemType = String(product.itemType || "").trim().toLowerCase();
  const variant = productCardVariant(product);
  if (DIRECT_ITEM_TYPES.has(itemType)) return true;
  return itemType === "product" && !NON_DIRECT_CARD_VARIANTS.has(variant);
}

function subscriptionEnabled(product = {}) {
  if (product.availableForSubscription === false) return false;
  if (!Array.isArray(product.availableFor) || product.availableFor.length === 0) {
    return true;
  }
  return product.availableFor.includes("subscription");
}

function productStatus(product = {}, catalogItemsById = new Map()) {
  const reasonCodes = [];
  const active = product.isActive !== false;
  const visible = product.isVisible !== false;
  const available = product.isAvailable !== false;
  const published = Boolean(product.publishedAt);
  const subscription = subscriptionEnabled(product);
  const catalogItemAvailable = isLinkedDocGloballyAvailable(
    product,
    catalogItemsById
  );
  if (!active) reasonCodes.push("PRODUCT_INACTIVE");
  if (!visible) reasonCodes.push("PRODUCT_HIDDEN");
  if (!available) reasonCodes.push("PRODUCT_UNAVAILABLE");
  if (!published) reasonCodes.push("PRODUCT_UNPUBLISHED");
  if (!subscription) reasonCodes.push("PRODUCT_NOT_SUBSCRIPTION_ENABLED");
  if (!catalogItemAvailable) reasonCodes.push("CATALOG_ITEM_UNAVAILABLE");
  return {
    active,
    visible,
    available,
    published,
    subscriptionEnabled: subscription,
    catalogItemAvailable,
    customerReady: reasonCodes.length === 0,
    eligible: reasonCodes.length === 0,
    reasonCodes,
  };
}

function matchesSearch(row = {}, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [
    row.key,
    row.name?.ar,
    row.name?.en,
    row.description?.ar,
    row.description?.en,
  ]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(q));
}

function selectedProductIdsOf(section = {}) {
  return Array.isArray(section.selectedProductIds)
    ? section.selectedProductIds.map(String)
    : [];
}

function directAssignmentMap(sections = [], excludedSectionKey = "") {
  const excluded = String(excludedSectionKey || "").trim().toLowerCase();
  const map = new Map();
  for (const section of sections) {
    const key = sectionKeyOf(section);
    if (excluded && key === excluded) continue;
    if (!isDirectCard(section)) continue;
    for (const productId of selectedProductIdsOf(section)) {
      if (!map.has(productId)) map.set(productId, key || "unknown");
    }
  }
  return map;
}

async function assertDirectProductsAssignable({
  productIds,
  sections,
  excludedSectionKey = "",
}) {
  const ids = normalizeIds(productIds, "productIds", true);
  const products = await MenuProduct.find({ _id: { $in: ids } }).lean();
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const missing = ids.filter((id) => !productsById.has(id));
  if (missing.length) {
    throw mealBuilderError(
      "Some products do not exist",
      "MEAL_BUILDER_PRODUCT_NOT_FOUND",
      404,
      { productIds: missing }
    );
  }
  const invalid = products
    .filter((product) => !explicitDirectCompatible(product))
    .map((product) => ({
      id: String(product._id),
      key: product.key || "",
      itemType: product.itemType || "",
      cardVariant: productCardVariant(product),
    }));
  if (invalid.length) {
    throw mealBuilderError(
      "Some products are not valid standalone Meal Planner cards",
      "MEAL_BUILDER_PRODUCT_TYPE_INVALID",
      422,
      { products: invalid }
    );
  }
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  const unavailable = products
    .map((product) => ({
      id: String(product._id),
      key: product.key || "",
      status: productStatus(product, catalogItemsById),
    }))
    .filter((entry) => !entry.status.eligible);
  if (unavailable.length) {
    throw mealBuilderError(
      "Some products are not ready for subscription Meal Planner",
      "MEAL_BUILDER_PRODUCT_UNAVAILABLE",
      422,
      { products: unavailable }
    );
  }
  const assignments = directAssignmentMap(sections, excludedSectionKey);
  const conflicts = ids
    .filter((id) => assignments.has(id))
    .map((id) => ({ productId: id, sectionKey: assignments.get(id) }));
  if (conflicts.length) {
    throw mealBuilderError(
      "A product cannot be assigned to more than one Meal Planner card",
      "MEAL_BUILDER_PRODUCT_ALREADY_ASSIGNED",
      409,
      { conflicts }
    );
  }
  return ids;
}

function maxSortOrder(sections = []) {
  return sections.reduce(
    (max, section) => Math.max(max, Number(section.sortOrder || 0)),
    0
  );
}

function buildDirectSection({ source = {}, key, productIds, sections, existing = null }) {
  const current = existing ? canonicalStoredSection(existing) : null;
  return {
    ...(current || {}),
    key,
    sectionType: "product_list",
    sourceKind: "product_list",
    titleOverride:
      Object.prototype.hasOwnProperty.call(source, "titleOverride") ||
      Object.prototype.hasOwnProperty.call(source, "title") ||
      !current
        ? normalizeLocalizedTitle(source.titleOverride || source.title, key)
        : current.titleOverride,
    productContextId: null,
    sourceGroupId: null,
    sourceCategoryId: null,
    selectedOptionIds: [],
    selectedProductIds: productIds,
    includeMode: "selected",
    selectionType: DIRECT_SELECTION_TYPE,
    sortOrder: normalizeOptionalInteger(
      source.sortOrder,
      current ? current.sortOrder : maxSortOrder(sections) + 10
    ),
    required: Object.prototype.hasOwnProperty.call(source, "required")
      ? source.required === true
      : current?.required === true,
    minSelections: normalizeOptionalInteger(
      source.minSelections,
      current ? current.minSelections : 0
    ),
    maxSelections: Object.prototype.hasOwnProperty.call(source, "maxSelections")
      ? normalizeOptionalInteger(source.maxSelections, 1)
      : current?.maxSelections ?? 1,
    multiSelect: Object.prototype.hasOwnProperty.call(source, "multiSelect")
      ? source.multiSelect === true
      : current?.multiSelect === true,
    visible: Object.prototype.hasOwnProperty.call(source, "visible")
      ? source.visible !== false
      : current?.visible !== false,
    availableFor: ["subscription"],
    metadata: {
      ...(current?.metadata || {}),
      ...(source.metadata && typeof source.metadata === "object"
        ? source.metadata
        : {}),
      cardType: "direct_product",
      cardKind: "full_meal_product",
      dashboardManaged: true,
      requiresBuilder: false,
      treatAsFullMeal: true,
    },
    rules: {
      ...(current?.rules || {}),
      ...(source.rules && typeof source.rules === "object" ? source.rules : {}),
      carbsRequired: false,
    },
  };
}

async function buildActionResponse({
  action,
  draft,
  sectionKey,
  previousSectionKey = null,
  itemId = null,
  productId = null,
}) {
  const validation = await cardFacade.validatePayload({
    sections: draft.sections || [],
  });
  const section = sectionKey
    ? (draft.sections || []).find(
        (item) => sectionKeyOf(item) === String(sectionKey).toLowerCase()
      ) || null
    : null;
  return decorateAction({
    contractVersion: CARD_ACTION_VERSION,
    action,
    sectionKey: sectionKey || null,
    previousSectionKey,
    itemId,
    productId,
    section,
    draft,
    validation,
    summary: {
      sectionCount: (draft.sections || []).length,
      selectedProductCount: (draft.sections || []).reduce(
        (sum, item) => sum + selectedProductIdsOf(item).length,
        0
      ),
      selectedOptionCount: (draft.sections || []).reduce(
        (sum, item) => sum + (item.selectedOptionIds || []).length,
        0
      ),
      ready: validation.ready === true,
      errorCount: (validation.errors || []).length,
      warningCount: (validation.warnings || []).length,
    },
  });
}

async function getDirectProductPicker({
  sectionKey = "products",
  targetSectionKey,
  lang = "en",
  q = "",
  includeUnavailable,
  unassignedOnly,
  page,
  limit,
} = {}) {
  const state = await cardFacade.getDashboardState({ lang });
  const config = state.draft || state.published || null;
  const sections = config?.sections || [];
  const requestedKey = String(sectionKey || "products").trim().toLowerCase();
  const targetKey = String(
    targetSectionKey || (requestedKey === "products" ? "" : requestedKey)
  )
    .trim()
    .toLowerCase();
  const currentSection = targetKey
    ? sections.find((section) => sectionKeyOf(section) === targetKey) || null
    : null;
  const selectedIds = new Set(selectedProductIdsOf(currentSection || {}));
  const assignedElsewhere = directAssignmentMap(sections, targetKey);
  const pagination = normalizePagination({ page, limit });
  const showUnavailable = normalizeBoolean(includeUnavailable, false);
  const onlyUnassigned = normalizeBoolean(unassignedOnly, true);

  const allProducts = await MenuProduct.find({})
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const products = allProducts.filter(directCatalogCompatible);
  const categoryIds = [
    ...new Set(products.map((product) => String(product.categoryId || "")).filter(Boolean)),
  ];
  const categories = categoryIds.length
    ? await MenuCategory.find({ _id: { $in: categoryIds } }).lean()
    : [];
  const categoriesById = new Map(
    categories.map((category) => [String(category._id), category])
  );
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);

  const allRows = products
    .filter((product) => matchesSearch(product, q))
    .map((product) => {
      const id = String(product._id);
      const selected = selectedIds.has(id);
      const assignedSectionKey = selected ? null : assignedElsewhere.get(id) || null;
      const status = productStatus(product, catalogItemsById);
      const assignable = status.eligible && !assignedSectionKey;
      const reasonCodes = selected
        ? ["SELECTED", ...status.reasonCodes]
        : assignedSectionKey
          ? ["ASSIGNED_TO_OTHER_CARD", ...status.reasonCodes]
          : assignable
            ? ["ELIGIBLE"]
            : status.reasonCodes;
      const category = categoriesById.get(String(product.categoryId || "")) || null;
      return {
        id,
        productId: id,
        type: "product",
        key: product.key || "",
        name: product.name || { ar: "", en: "" },
        label: pickLang(product.name || {}, lang),
        imageUrl: product.imageUrl || "",
        itemType: product.itemType || "",
        cardVariant: productCardVariant(product),
        categoryId: product.categoryId ? String(product.categoryId) : null,
        categoryKey: category?.key || "",
        category: category
          ? {
              id: String(category._id),
              key: category.key || "",
              name: category.name || { ar: "", en: "" },
            }
          : null,
        cardType: "direct_product",
        selectionType: DIRECT_SELECTION_TYPE,
        deprecatedSelectionType:
          productCardVariant(product) === "sandwich_card" ||
          product.itemType === "cold_sandwich"
            ? "sandwich"
            : null,
        completeByItself: true,
        flutterSlotContract: {
          idField: "sandwichId",
          requiresCompanionCard: false,
        },
        action: {
          type: "direct_add",
          requiresBuilder: false,
          treatAsFullMeal: true,
        },
        configurable: product.isCustomizable === true,
        pricing: {
          pricingModel: product.pricingModel || "fixed",
          priceHalala: Number(product.priceHalala || 0),
          currency: product.currency || SYSTEM_CURRENCY,
        },
        selected,
        assigned: selected || Boolean(assignedSectionKey),
        assignedSectionKey,
        assignable: selected || assignable,
        required: false,
        eligible: selected || assignable,
        linked: true,
        relationExists: true,
        available: status.available,
        active: status.active,
        visible: status.visible,
        published: status.published,
        subscriptionEnabled: status.subscriptionEnabled,
        catalogItemAvailable: status.catalogItemAvailable,
        status,
        reasonCodes: [...new Set(reasonCodes)],
        warnings: [],
        errors: [],
        state: selected
          ? "selected"
          : assignedSectionKey
            ? "assigned_elsewhere"
            : assignable
              ? "eligible"
              : "unavailable",
        sortOrder: Number(product.sortOrder || 0),
      };
    })
    .filter((candidate) => candidate.selected || showUnavailable || candidate.assignable)
    .sort(
      (left, right) =>
        Number(right.selected) - Number(left.selected) ||
        Number(right.assignable) - Number(left.assignable) ||
        left.sortOrder - right.sortOrder ||
        String(left.key).localeCompare(String(right.key))
    );

  const rows = onlyUnassigned
    ? allRows.filter((candidate) => candidate.selected || candidate.assignable)
    : allRows;
  const total = rows.length;
  const candidates = rows.slice(
    pagination.skip,
    pagination.skip + pagination.limit
  );

  return {
    contractVersion: PICKER_VERSION,
    sectionKey: requestedKey,
    targetSectionKey: targetKey || null,
    cardType: "direct_product",
    candidateType: "product",
    category: null,
    rules: {
      selectionTypeRequired: true,
      allowedSelectionTypes: [DIRECT_SELECTION_TYPE],
      deprecatedSelectionTypes: ["sandwich"],
      canonicalSelectionType: DIRECT_SELECTION_TYPE,
      legacyInputPolicy: "normalize_to_full_meal_product",
      classificationAuthority: "meal_product_classification.v1",
      source: "menu_products",
      selectionBehavior: "dashboard_explicit",
      uniquenessScope: "current_draft",
      excludeProductsAssignedToOtherCards: onlyUnassigned,
    },
    candidates,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
      catalogTotal: allRows.length,
      selectedInCurrentCard: allRows.filter((row) => row.selected).length,
      assignedToOtherCards: allRows.filter(
        (row) => row.state === "assigned_elsewhere"
      ).length,
      unassigned: allRows.filter((row) => row.state === "eligible").length,
      unavailable: allRows.filter((row) => row.state === "unavailable").length,
    },
  };
}

async function getSectionPicker(options = {}) {
  const sectionKey = String(options.sectionKey || "").trim().toLowerCase();
  if (sectionKey === "products" || sectionKey === "sandwich") {
    return getDirectProductPicker(options);
  }
  if (options.productContextId || options.sourceGroupId || sectionKey === "options") {
    const response = await cardFacade.getSectionPicker(options);
    const role = String(response.rules?.optionRole || options.optionRole || "").trim();
    return {
      ...response,
      cardType: "option_family",
      rules: {
        ...(response.rules || {}),
        allowedSelectionTypes: [STANDARD_SELECTION_TYPE],
        canonicalSelectionType: STANDARD_SELECTION_TYPE,
        flutterSlotField: role === "carbs" ? "carbs[].carbId" : "proteinId",
      },
    };
  }
  const state = await cardFacade.getDashboardState({ lang: options.lang || "en" });
  const config = state.draft || state.published || null;
  const matching = (config?.sections || []).find(
    (section) => sectionKeyOf(section) === sectionKey
  );
  if (matching && isDirectCard(matching)) {
    return getDirectProductPicker({ ...options, targetSectionKey: sectionKey });
  }
  const response = await cardFacade.getSectionPicker(options);
  return response.candidateType === "option"
    ? {
        ...response,
        cardType: "option_family",
        rules: {
          ...(response.rules || {}),
          allowedSelectionTypes: [STANDARD_SELECTION_TYPE],
          canonicalSelectionType: STANDARD_SELECTION_TYPE,
          flutterSlotField:
            sectionOptionRole(matching || {}) === "carbs"
              ? "carbs[].carbId"
              : "proteinId",
        },
      }
    : response;
}

async function createProductSection({ section = {}, actor = {} } = {}) {
  const cardType = String(section.cardType || section.metadata?.cardType || "").trim();
  const optionPayload =
    cardType === "option_family" ||
    String(section.sectionType || section.type || "") === "option_group" ||
    Array.isArray(section.selectedOptionIds) ||
    Array.isArray(section.optionIds);
  if (optionPayload) {
    return decorateAction(
      await cardFacade.createProductSection({ section, actor })
    );
  }

  const draft = await cardFacade.openWorkingDraft({ actor });
  const sections = draft.sections || [];
  const key = normalizeSectionKey(section.key || section.sectionKey);
  if (sections.some((item) => sectionKeyOf(item) === key)) {
    throw mealBuilderError(
      "Meal Builder card key already exists",
      "MEAL_BUILDER_CARD_KEY_DUPLICATE",
      409,
      { sectionKey: key }
    );
  }
  const productIds = await assertDirectProductsAssignable({
    productIds: section.selectedProductIds || section.productIds,
    sections,
  });
  const nextSection = buildDirectSection({
    source: section,
    key,
    productIds,
    sections,
  });
  const updatedDraft = await cardFacade.updateDraft({
    sections: [...sections.map(canonicalStoredSection), nextSection],
    actor,
    notes: draft.notes,
  });
  return buildActionResponse({
    action: "created",
    draft: updatedDraft,
    sectionKey: key,
  });
}

async function updateProductSection({ sectionKey, patch = {}, actor = {} } = {}) {
  const draft = await cardFacade.openWorkingDraft({ actor });
  const sections = draft.sections || [];
  const currentKey = normalizeSectionKey(sectionKey);
  const current = sections.find((item) => sectionKeyOf(item) === currentKey) || null;
  if (!current) {
    throw mealBuilderError(
      "Meal Builder card not found",
      "MEAL_BUILDER_CARD_NOT_FOUND",
      404,
      { sectionKey: currentKey }
    );
  }
  if (isSystemManagedCard(current)) {
    throw mealBuilderError(
      "System-managed Meal Builder cards are read-only",
      "MEAL_BUILDER_SYSTEM_CARD_READ_ONLY",
      409,
      { sectionKey: currentKey }
    );
  }
  if (isOptionCard(current)) {
    return decorateAction(
      await cardFacade.updateProductSection({ sectionKey, patch, actor })
    );
  }
  const requestedCardType = String(patch.cardType || patch.metadata?.cardType || "").trim();
  if (requestedCardType && requestedCardType !== "direct_product") {
    throw mealBuilderError(
      "Card type cannot be changed after creation",
      "MEAL_BUILDER_CARD_TYPE_CHANGE_UNSUPPORTED",
      409,
      { sectionKey: currentKey }
    );
  }
  const nextKey = patch.key ? normalizeSectionKey(patch.key) : currentKey;
  if (
    nextKey !== currentKey &&
    sections.some((item) => sectionKeyOf(item) === nextKey)
  ) {
    throw mealBuilderError(
      "Meal Builder card key already exists",
      "MEAL_BUILDER_CARD_KEY_DUPLICATE",
      409,
      { sectionKey: nextKey }
    );
  }
  const hasProductPatch =
    Object.prototype.hasOwnProperty.call(patch, "selectedProductIds") ||
    Object.prototype.hasOwnProperty.call(patch, "productIds");
  const productIds = hasProductPatch
    ? await assertDirectProductsAssignable({
        productIds: patch.selectedProductIds || patch.productIds,
        sections,
        excludedSectionKey: currentKey,
      })
    : selectedProductIdsOf(current);
  const nextSection = buildDirectSection({
    source: patch,
    key: nextKey,
    productIds,
    sections,
    existing: current,
  });
  const updatedDraft = await cardFacade.updateDraft({
    sections: sections.map((item) =>
      sectionKeyOf(item) === currentKey
        ? nextSection
        : canonicalStoredSection(item)
    ),
    actor,
    notes: draft.notes,
  });
  return buildActionResponse({
    action: "updated",
    draft: updatedDraft,
    sectionKey: nextKey,
    previousSectionKey: nextKey === currentKey ? null : currentKey,
  });
}

async function deleteProductSection(args = {}) {
  return decorateAction(await cardFacade.deleteProductSection(args));
}

async function replaceSectionItems({
  sectionKey,
  productIds,
  optionIds,
  actor = {},
} = {}) {
  const state = await cardFacade.getDashboardState({ lang: "en" });
  const config = state.draft || state.published || null;
  const current = (config?.sections || []).find(
    (section) => sectionKeyOf(section) === String(sectionKey || "").toLowerCase()
  );
  if (current && isOptionCard(current)) {
    return decorateAction(
      await cardFacade.replaceSectionItems({
        sectionKey,
        productIds,
        optionIds,
        actor,
      })
    );
  }
  return updateProductSection({
    sectionKey,
    patch: { selectedProductIds: productIds },
    actor,
  });
}

async function addProductsToSection({ sectionKey, productIds, actor = {} } = {}) {
  const draft = await cardFacade.openWorkingDraft({ actor });
  const current = (draft.sections || []).find(
    (section) => sectionKeyOf(section) === String(sectionKey || "").toLowerCase()
  );
  if (!current || !isDirectCard(current)) {
    throw mealBuilderError(
      "This action is only supported for direct product cards",
      "MEAL_BUILDER_CARD_TYPE_UNSUPPORTED",
      409,
      { sectionKey }
    );
  }
  const additions = normalizeIds(productIds, "productIds", true);
  return updateProductSection({
    sectionKey,
    patch: {
      selectedProductIds: [
        ...new Set([...selectedProductIdsOf(current), ...additions]),
      ],
    },
    actor,
  }).then((response) => ({ ...response, action: "products_added" }));
}

async function removeProductFromSection({ sectionKey, productId, actor = {} } = {}) {
  const draft = await cardFacade.openWorkingDraft({ actor });
  const current = (draft.sections || []).find(
    (section) => sectionKeyOf(section) === String(sectionKey || "").toLowerCase()
  );
  if (!current || !isDirectCard(current)) {
    throw mealBuilderError(
      "This action is only supported for direct product cards",
      "MEAL_BUILDER_CARD_TYPE_UNSUPPORTED",
      409,
      { sectionKey }
    );
  }
  const id = String(productId || "").trim();
  const currentIds = selectedProductIdsOf(current);
  if (!currentIds.includes(id)) {
    throw mealBuilderError(
      "Product is not assigned to this card",
      "MEAL_BUILDER_PRODUCT_NOT_IN_CARD",
      404,
      { sectionKey, productId: id }
    );
  }
  const nextIds = currentIds.filter((item) => item !== id);
  if (!nextIds.length) {
    throw mealBuilderError(
      "A product card cannot be empty; delete the card instead",
      "MEAL_BUILDER_CARD_WOULD_BE_EMPTY",
      422,
      { sectionKey, productId: id }
    );
  }
  return updateProductSection({
    sectionKey,
    patch: { selectedProductIds: nextIds },
    actor,
  }).then((response) => ({
    ...response,
    action: "product_removed",
    productId: id,
  }));
}

async function addOptionsToSection(args = {}) {
  return decorateAction(await cardFacade.addOptionsToSection(args));
}

async function removeOptionFromSection(args = {}) {
  return decorateAction(await cardFacade.removeOptionFromSection(args));
}

async function createDraft({ sections, notes, actor } = {}) {
  const response = await cardFacade.createDraft({
    sections: (sections || []).map(canonicalStoredSection),
    notes,
    actor,
  });
  return decorateConfig(response);
}

async function updateDraft({ sections, notes, actor } = {}) {
  const response = await cardFacade.updateDraft({
    sections: (sections || []).map(canonicalStoredSection),
    notes,
    actor,
  });
  return decorateConfig(response);
}

async function getDashboardState(options = {}) {
  return decorateState(await cardFacade.getDashboardState(options));
}

async function getHydratedDraft(options = {}) {
  const response = await cardFacade.getHydratedDraft(options);
  return {
    ...response,
    draft: decorateConfig(response.draft),
    sections: (response.sections || []).map(decorateSection),
  };
}

function serializeConfig(config) {
  return decorateConfig(cardFacade.serializeConfig(config));
}

async function validatePayload(payload = {}) {
  return cardFacade.validatePayload({
    ...payload,
    sections: (payload.sections || []).map(canonicalStoredSection),
  });
}

async function publishDraft({ notes, actor } = {}) {
  const draft = await cardFacade.openWorkingDraft({ actor });
  const canonicalSections = (draft.sections || []).map(canonicalStoredSection);
  await cardFacade.updateDraft({
    sections: canonicalSections,
    notes: draft.notes,
    actor,
  });
  return decorateLifecycle(await cardFacade.publishDraft({ notes, actor }));
}

function getCardContract() {
  return authoringContract.getCardContract();
}

module.exports = {
  ...cardFacade,
  CARD_ACTION_VERSION,
  PICKER_VERSION,
  addOptionsToSection,
  addProductsToSection,
  createDraft,
  createProductSection,
  deleteProductSection,
  getCardContract,
  getDashboardState,
  getDirectProductPicker,
  getHydratedDraft,
  getSectionPicker,
  publishDraft,
  removeOptionFromSection,
  removeProductFromSection,
  replaceSectionItems,
  serializeConfig,
  updateDraft,
  updateProductSection,
  validatePayload,
};
