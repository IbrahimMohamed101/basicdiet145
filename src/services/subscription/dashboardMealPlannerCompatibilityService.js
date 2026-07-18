const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const { pickLang } = require("../../utils/i18n");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const baseService = require("./mealBuilderConfigService");

const PICKER_VERSION = "dashboard_meal_builder_picker.v1";
const CARD_ACTION_VERSION = "dashboard_meal_builder_card_action.v1";
const SYSTEM_CURRENCY = "SAR";
const DIRECT_PRODUCT_ITEM_TYPES = ["cold_sandwich", "full_meal_product"];
const MAX_PICKER_LIMIT = 1000;

function mealBuilderError(message, code, status = 400, details) {
  return new baseService.MealBuilderError(message, code, status, details);
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

function normalizeProductIds(value) {
  const source = value === undefined || value === null ? [] : value;
  if (!Array.isArray(source)) {
    throw mealBuilderError(
      "productIds must be an array",
      "MEAL_BUILDER_PRODUCT_IDS_INVALID",
      400
    );
  }
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
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

function isSubscriptionEnabled(product = {}) {
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
  const subscriptionEnabled = isSubscriptionEnabled(product);
  const catalogItemAvailable = isLinkedDocGloballyAvailable(
    product,
    catalogItemsById
  );

  if (!active) reasonCodes.push("PRODUCT_INACTIVE");
  if (!visible) reasonCodes.push("PRODUCT_HIDDEN");
  if (!available) reasonCodes.push("PRODUCT_UNAVAILABLE");
  if (!published) reasonCodes.push("PRODUCT_UNPUBLISHED");
  if (!subscriptionEnabled) {
    reasonCodes.push("PRODUCT_NOT_SUBSCRIPTION_ENABLED");
  }
  if (!catalogItemAvailable) reasonCodes.push("CATALOG_ITEM_UNAVAILABLE");

  return {
    active,
    visible,
    available,
    published,
    subscriptionEnabled,
    catalogItemAvailable,
    reasonCodes: [...new Set(reasonCodes)],
    eligible: reasonCodes.length === 0,
  };
}

function directSelectionType(product = {}) {
  return product.itemType === "cold_sandwich"
    ? "sandwich"
    : "full_meal_product";
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function isProductCard(section = {}) {
  return String(section.sectionType || section.type || "") === "product_list";
}

function selectedProductIdsOf(section = {}) {
  return normalizeProductIds(section.selectedProductIds || section.productIds || []);
}

function writableSection(section = {}) {
  return {
    key: sectionKeyOf(section),
    sectionType: section.sectionType || "product_list",
    sourceKind: section.sourceKind || "",
    titleOverride: normalizeLocalizedTitle(
      section.titleOverride || section.title,
      sectionKeyOf(section)
    ),
    productContextId: section.productContextId || null,
    sourceGroupId: section.sourceGroupId || null,
    sourceCategoryId: section.sourceCategoryId || null,
    selectedOptionIds: Array.isArray(section.selectedOptionIds)
      ? section.selectedOptionIds.map(String)
      : [],
    selectedProductIds: selectedProductIdsOf(section),
    includeMode: section.includeMode || "selected",
    selectionType: section.selectionType || "",
    sortOrder: Number(section.sortOrder || 0),
    required: section.required === true,
    minSelections: Number(section.minSelections || 0),
    maxSelections:
      section.maxSelections === null || section.maxSelections === undefined
        ? null
        : Number(section.maxSelections),
    multiSelect: section.multiSelect === true,
    visible: section.visible !== false,
    availableFor: Array.isArray(section.availableFor)
      ? section.availableFor
      : ["subscription"],
    metadata:
      section.metadata && typeof section.metadata === "object"
        ? { ...section.metadata }
        : {},
    rules:
      section.rules && typeof section.rules === "object"
        ? { ...section.rules }
        : {},
  };
}

function maxSortOrder(sections = []) {
  return sections.reduce(
    (max, section) => Math.max(max, Number(section.sortOrder || 0)),
    0
  );
}

function assignmentMap(sections = [], excludedSectionKey = "") {
  const excluded = String(excludedSectionKey || "").trim().toLowerCase();
  const map = new Map();
  for (const section of sections) {
    const key = sectionKeyOf(section);
    if (excluded && key === excluded) continue;
    for (const productId of selectedProductIdsOf(section)) {
      if (!map.has(productId)) map.set(productId, key || "unknown");
    }
  }
  return map;
}

async function plannerConfig({ lang = "en", preferDraft = true } = {}) {
  const state = await baseService.getDashboardState({ lang });
  return preferDraft
    ? state.draft || state.published || null
    : state.published || state.draft || null;
}

function findProductCard(sections = [], sectionKey) {
  const key = String(sectionKey || "").trim().toLowerCase();
  const section = sections.find((item) => sectionKeyOf(item) === key) || null;
  if (!section) {
    throw mealBuilderError(
      "Meal Builder card not found",
      "MEAL_BUILDER_CARD_NOT_FOUND",
      404,
      { sectionKey: key }
    );
  }
  if (!isProductCard(section)) {
    throw mealBuilderError(
      "This action is only supported for direct product cards",
      "MEAL_BUILDER_CARD_TYPE_UNSUPPORTED",
      409,
      { sectionKey: key, sectionType: section.sectionType || section.type }
    );
  }
  return section;
}

async function loadDirectProducts() {
  const products = await MenuProduct.find({
    itemType: { $in: DIRECT_PRODUCT_ITEM_TYPES },
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  return { products, catalogItemsById };
}

async function assertDirectProductsAssignable({
  productIds,
  sections,
  excludedSectionKey = "",
}) {
  const ids = normalizeProductIds(productIds);
  if (!ids.length) {
    throw mealBuilderError(
      "A direct product card must contain at least one product",
      "MEAL_BUILDER_CARD_PRODUCTS_REQUIRED",
      422
    );
  }

  const products = await MenuProduct.find({ _id: { $in: ids } }).lean();
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const missingProductIds = ids.filter((id) => !productsById.has(id));
  if (missingProductIds.length) {
    throw mealBuilderError(
      "Some products do not exist",
      "MEAL_BUILDER_PRODUCT_NOT_FOUND",
      404,
      { productIds: missingProductIds }
    );
  }

  const invalidTypeProducts = products
    .filter((product) => !DIRECT_PRODUCT_ITEM_TYPES.includes(product.itemType))
    .map((product) => ({ id: String(product._id), itemType: product.itemType }));
  if (invalidTypeProducts.length) {
    throw mealBuilderError(
      "Only direct meal products can be added to this card",
      "MEAL_BUILDER_PRODUCT_TYPE_INVALID",
      422,
      { products: invalidTypeProducts, allowedItemTypes: DIRECT_PRODUCT_ITEM_TYPES }
    );
  }

  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  const unavailableProducts = products
    .map((product) => ({
      id: String(product._id),
      key: product.key || "",
      status: productStatus(product, catalogItemsById),
    }))
    .filter((entry) => !entry.status.eligible);
  if (unavailableProducts.length) {
    throw mealBuilderError(
      "Some products are not ready for subscription Meal Planner",
      "MEAL_BUILDER_PRODUCT_UNAVAILABLE",
      422,
      { products: unavailableProducts }
    );
  }

  const assignedElsewhere = assignmentMap(sections, excludedSectionKey);
  const conflicts = ids
    .filter((id) => assignedElsewhere.has(id))
    .map((id) => ({ productId: id, sectionKey: assignedElsewhere.get(id) }));
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

function serializeDirectProduct({
  product,
  category,
  selected,
  assignedSectionKey,
  catalogItemsById,
  lang,
}) {
  const status = productStatus(product, catalogItemsById);
  const assignedElsewhere = Boolean(assignedSectionKey) && !selected;
  const assignable = status.eligible && !assignedElsewhere;
  const reasonCodes = selected
    ? ["SELECTED", ...status.reasonCodes]
    : assignedElsewhere
      ? ["ASSIGNED_TO_OTHER_CARD", ...status.reasonCodes]
      : status.eligible
        ? ["ELIGIBLE"]
        : status.reasonCodes;

  return {
    id: String(product._id),
    productId: String(product._id),
    type: "product",
    key: product.key || "",
    name: product.name || { ar: "", en: "" },
    label: pickLang(product.name || {}, lang),
    imageUrl: product.imageUrl || "",
    itemType: product.itemType || "",
    categoryId: product.categoryId ? String(product.categoryId) : null,
    categoryKey: category?.key || "",
    category: category
      ? {
          id: String(category._id),
          key: category.key || "",
          name: category.name || { ar: "", en: "" },
        }
      : null,
    selectionType: directSelectionType(product),
    configurable: product.isCustomizable === true,
    pricing: {
      pricingModel: product.pricingModel || "fixed",
      priceHalala: Number(product.priceHalala || 0),
      currency: product.currency || SYSTEM_CURRENCY,
    },
    selected,
    assigned: selected || assignedElsewhere,
    assignedSectionKey: selected ? null : assignedSectionKey || null,
    assignable,
    required: false,
    eligible: assignable || selected,
    linked: true,
    available: status.available,
    active: status.active,
    visible: status.visible,
    published: status.published,
    subscriptionEnabled: status.subscriptionEnabled,
    relationExists: true,
    catalogItemAvailable: status.catalogItemAvailable,
    reasonCodes: [...new Set(reasonCodes)],
    warnings: [],
    errors: [],
    state: selected
      ? "selected"
      : assignedElsewhere
        ? "assigned_elsewhere"
        : status.eligible
          ? "eligible"
          : "unavailable",
    sortOrder: Number(product.sortOrder || 0),
  };
}

async function getDirectProductPicker({
  sectionKey,
  targetSectionKey,
  lang = "en",
  q = "",
  includeUnavailable,
  unassignedOnly,
  page,
  limit,
} = {}) {
  const requestedKey = String(sectionKey || "products").trim().toLowerCase();
  const targetKey = String(
    targetSectionKey || (requestedKey === "products" ? "" : requestedKey)
  )
    .trim()
    .toLowerCase();
  const config = await plannerConfig({ lang, preferDraft: true });
  const sections = config?.sections || [];
  let currentSection = targetKey
    ? sections.find((section) => sectionKeyOf(section) === targetKey) || null
    : null;
  if (!currentSection && requestedKey === "sandwich") {
    currentSection =
      sections.find((section) => sectionKeyOf(section) === "sandwich") ||
      sections.find((section) => isProductCard(section)) ||
      null;
  }

  const currentSectionKey = currentSection ? sectionKeyOf(currentSection) : targetKey;
  const selectedIds = new Set(selectedProductIdsOf(currentSection || {}));
  const assignedElsewhere = assignmentMap(sections, currentSectionKey);
  const pagination = normalizePagination({ page, limit });
  const showUnavailable = normalizeBoolean(includeUnavailable, false);
  const onlyUnassigned = normalizeBoolean(unassignedOnly, true);
  const { products, catalogItemsById } = await loadDirectProducts();

  const categoryIds = [
    ...new Set(
      products
        .map((product) => String(product.categoryId || ""))
        .filter(Boolean)
    ),
  ];
  const categories = categoryIds.length
    ? await MenuCategory.find({ _id: { $in: categoryIds } }).lean()
    : [];
  const categoriesById = new Map(
    categories.map((category) => [String(category._id), category])
  );

  const allRows = products
    .filter((product) => matchesSearch(product, q))
    .map((product) => {
      const productId = String(product._id);
      return serializeDirectProduct({
        product,
        category:
          categoriesById.get(String(product.categoryId || "")) || null,
        selected: selectedIds.has(productId),
        assignedSectionKey: assignedElsewhere.get(productId) || null,
        catalogItemsById,
        lang,
      });
    })
    .filter((candidate) => candidate.selected || showUnavailable || candidate.available)
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
    targetSectionKey: currentSectionKey || null,
    candidateType: "product",
    category: null,
    rules: {
      itemTypes: DIRECT_PRODUCT_ITEM_TYPES,
      source: "menu_products",
      selectionBehavior: "direct_full_meal",
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
      unassigned: allRows.filter((row) => row.assignable).length,
      unavailable: allRows.filter((row) => row.state === "unavailable").length,
    },
  };
}

async function cardActionResponse({
  action,
  draft,
  sectionKey,
  previousSectionKey = null,
  productId = null,
}) {
  const validation = await baseService.validatePayload({
    sections: draft.sections || [],
  });
  const section = sectionKey
    ? (draft.sections || []).find(
        (item) => sectionKeyOf(item) === String(sectionKey).toLowerCase()
      ) || null
    : null;
  return {
    contractVersion: CARD_ACTION_VERSION,
    action,
    sectionKey: sectionKey || null,
    previousSectionKey,
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
      ready: validation.ready === true,
      errorCount: (validation.errors || []).length,
      warningCount: (validation.warnings || []).length,
    },
  };
}

async function createProductSection({ section = {}, actor = {} } = {}) {
  const draft = await baseService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(section.key || section.sectionKey);
  if (sections.some((item) => sectionKeyOf(item) === key)) {
    throw mealBuilderError(
      "Meal Builder card key already exists",
      "MEAL_BUILDER_CARD_KEY_DUPLICATE",
      409,
      { sectionKey: key }
    );
  }

  const selectedProductIds = await assertDirectProductsAssignable({
    productIds: section.selectedProductIds || section.productIds,
    sections,
  });
  const nextSection = {
    key,
    sectionType: "product_list",
    sourceKind: "product_list",
    titleOverride: normalizeLocalizedTitle(
      section.titleOverride || section.title,
      key
    ),
    productContextId: null,
    sourceGroupId: null,
    sourceCategoryId: null,
    selectedOptionIds: [],
    selectedProductIds,
    includeMode: "selected",
    selectionType: String(section.selectionType || "").trim(),
    sortOrder: normalizeOptionalInteger(
      section.sortOrder,
      maxSortOrder(sections) + 10
    ),
    required: section.required === true,
    minSelections: normalizeOptionalInteger(section.minSelections, 0),
    maxSelections:
      section.maxSelections === null
        ? null
        : normalizeOptionalInteger(section.maxSelections, 1),
    multiSelect: section.multiSelect === true,
    visible: section.visible !== false,
    availableFor: ["subscription"],
    metadata: {
      ...(section.metadata && typeof section.metadata === "object"
        ? section.metadata
        : {}),
      dashboardManaged: true,
      cardKind: "direct_products",
    },
    rules:
      section.rules && typeof section.rules === "object"
        ? { ...section.rules }
        : {},
  };
  const updatedDraft = await baseService.updateDraft({
    sections: [...sections, nextSection],
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "created",
    draft: updatedDraft,
    sectionKey: key,
  });
}

async function updateProductSection({ sectionKey, patch = {}, actor = {} } = {}) {
  const draft = await baseService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const currentKey = normalizeSectionKey(sectionKey);
  const current = findProductCard(sections, currentKey);
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
  const selectedProductIds = hasProductPatch
    ? await assertDirectProductsAssignable({
        productIds: patch.selectedProductIds || patch.productIds,
        sections,
        excludedSectionKey: currentKey,
      })
    : selectedProductIdsOf(current);

  const nextSection = {
    ...writableSection(current),
    key: nextKey,
    titleOverride: Object.prototype.hasOwnProperty.call(patch, "titleOverride") ||
      Object.prototype.hasOwnProperty.call(patch, "title")
      ? normalizeLocalizedTitle(patch.titleOverride || patch.title, nextKey)
      : current.titleOverride,
    selectedProductIds,
    selectionType: Object.prototype.hasOwnProperty.call(patch, "selectionType")
      ? String(patch.selectionType || "").trim()
      : current.selectionType || "",
    sortOrder: normalizeOptionalInteger(patch.sortOrder, current.sortOrder),
    required: Object.prototype.hasOwnProperty.call(patch, "required")
      ? patch.required === true
      : current.required === true,
    minSelections: normalizeOptionalInteger(
      patch.minSelections,
      current.minSelections
    ),
    maxSelections: Object.prototype.hasOwnProperty.call(patch, "maxSelections")
      ? patch.maxSelections === null
        ? null
        : normalizeOptionalInteger(patch.maxSelections, current.maxSelections)
      : current.maxSelections,
    multiSelect: Object.prototype.hasOwnProperty.call(patch, "multiSelect")
      ? patch.multiSelect === true
      : current.multiSelect === true,
    visible: Object.prototype.hasOwnProperty.call(patch, "visible")
      ? patch.visible !== false
      : current.visible !== false,
    metadata: {
      ...(current.metadata || {}),
      ...(patch.metadata && typeof patch.metadata === "object"
        ? patch.metadata
        : {}),
      dashboardManaged: true,
      cardKind: "direct_products",
    },
    rules: {
      ...(current.rules || {}),
      ...(patch.rules && typeof patch.rules === "object" ? patch.rules : {}),
    },
  };
  const nextSections = sections.map((item) =>
    sectionKeyOf(item) === currentKey ? nextSection : item
  );
  const updatedDraft = await baseService.updateDraft({
    sections: nextSections,
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "updated",
    draft: updatedDraft,
    sectionKey: nextKey,
    previousSectionKey: nextKey === currentKey ? null : currentKey,
  });
}

async function deleteProductSection({ sectionKey, actor = {} } = {}) {
  const draft = await baseService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  findProductCard(sections, key);
  const updatedDraft = await baseService.updateDraft({
    sections: sections.filter((section) => sectionKeyOf(section) !== key),
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "deleted",
    draft: updatedDraft,
    sectionKey: null,
    previousSectionKey: key,
  });
}

async function addProductsToSection({
  sectionKey,
  productIds,
  actor = {},
} = {}) {
  const draft = await baseService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  const current = findProductCard(sections, key);
  const additions = normalizeProductIds(productIds);
  if (!additions.length) {
    throw mealBuilderError(
      "At least one productId is required",
      "MEAL_BUILDER_PRODUCT_IDS_REQUIRED",
      400
    );
  }
  const selectedProductIds = await assertDirectProductsAssignable({
    productIds: [...selectedProductIdsOf(current), ...additions],
    sections,
    excludedSectionKey: key,
  });
  const nextSections = sections.map((section) =>
    sectionKeyOf(section) === key
      ? { ...section, selectedProductIds }
      : section
  );
  const updatedDraft = await baseService.updateDraft({
    sections: nextSections,
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "products_added",
    draft: updatedDraft,
    sectionKey: key,
  });
}

async function removeProductFromSection({
  sectionKey,
  productId,
  actor = {},
} = {}) {
  const draft = await baseService.openWorkingDraft({ actor });
  const sections = (draft.sections || []).map(writableSection);
  const key = normalizeSectionKey(sectionKey);
  const current = findProductCard(sections, key);
  const id = String(productId || "").trim();
  const currentIds = selectedProductIdsOf(current);
  if (!currentIds.includes(id)) {
    throw mealBuilderError(
      "Product is not assigned to this card",
      "MEAL_BUILDER_PRODUCT_NOT_IN_CARD",
      404,
      { sectionKey: key, productId: id }
    );
  }
  const selectedProductIds = currentIds.filter((item) => item !== id);
  if (!selectedProductIds.length) {
    throw mealBuilderError(
      "A product card cannot be empty; delete the card instead",
      "MEAL_BUILDER_CARD_WOULD_BE_EMPTY",
      422,
      { sectionKey: key, productId: id }
    );
  }
  const nextSections = sections.map((section) =>
    sectionKeyOf(section) === key
      ? { ...section, selectedProductIds }
      : section
  );
  const updatedDraft = await baseService.updateDraft({
    sections: nextSections,
    actor,
    notes: draft.notes,
  });
  return cardActionResponse({
    action: "product_removed",
    draft: updatedDraft,
    sectionKey: key,
    productId: id,
  });
}

async function getSectionPicker(options = {}) {
  const sectionKey = String(options.sectionKey || "").trim().toLowerCase();
  if (sectionKey === "sandwich" || sectionKey === "products") {
    return getDirectProductPicker({ ...options, sectionKey });
  }
  const config = await plannerConfig({ lang: options.lang, preferDraft: true });
  const matchingSection = (config?.sections || []).find(
    (section) => sectionKeyOf(section) === sectionKey
  );
  if (matchingSection && isProductCard(matchingSection)) {
    return getDirectProductPicker({ ...options, sectionKey });
  }
  return baseService.getSectionPicker(options);
}

module.exports = {
  ...baseService,
  CARD_ACTION_VERSION,
  DIRECT_PRODUCT_ITEM_TYPES,
  MAX_PICKER_LIMIT,
  addProductsToSection,
  createProductSection,
  deleteProductSection,
  getDirectProductPicker,
  getSectionPicker,
  removeProductFromSection,
  updateProductSection,
};
