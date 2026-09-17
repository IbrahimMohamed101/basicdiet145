"use strict";

const MenuProduct = require("../models/MenuProduct");
const menuCatalogService = require("./orders/menuCatalogService");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");

const MAX_DASHBOARD_LIST_LIMIT = 1000;
const LEGACY_PAGE_SIZE = 100;

// Retained as exported compatibility metadata only. These sets no longer gate
// which MenuProduct can be assigned to a Meal Builder direct-product card.
const PRODUCTION_DIRECT_PRODUCT_VARIANTS = new Set([
  "ready_meal",
  "ready_meal_customizable",
  "sandwich_card",
]);
const EXPLICIT_DIRECT_PRODUCT_TYPES = new Set([
  "cold_sandwich",
  "full_meal_product",
]);

let installed = false;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizeProductIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
}

function installExpandedDashboardList(methodName) {
  const original = menuCatalogService[methodName];
  if (typeof original !== "function" || original.__expandedDashboardList === true) return;

  const wrapped = async function expandedDashboardList(options = {}) {
    const rawLimit = parsePositiveInteger(options.limit, 0);
    if (rawLimit <= LEGACY_PAGE_SIZE) {
      return original(options);
    }

    const requestedLimit = Math.min(MAX_DASHBOARD_LIST_LIMIT, rawLimit);
    const requestedPage = parsePositiveInteger(options.page, 1);
    const absoluteStart = (requestedPage - 1) * requestedLimit;
    const firstBackendPage = Math.floor(absoluteStart / LEGACY_PAGE_SIZE) + 1;
    const offsetInsideFirstPage = absoluteStart % LEGACY_PAGE_SIZE;
    const requiredRows = offsetInsideFirstPage + requestedLimit;

    let backendPage = firstBackendPage;
    let backendPages = firstBackendPage;
    let total = 0;
    const rows = [];

    do {
      const result = await original({
        ...options,
        page: backendPage,
        limit: LEGACY_PAGE_SIZE,
      });

      if (Array.isArray(result)) {
        rows.push(...result);
        total = result.length;
        backendPages = backendPage;
        break;
      }

      const pageItems = Array.isArray(result?.items) ? result.items : [];
      rows.push(...pageItems);
      total = Number(result?.pagination?.total || 0);
      backendPages = Number(result?.pagination?.pages || backendPage);

      if (pageItems.length === 0) break;
      backendPage += 1;
    } while (backendPage <= backendPages && rows.length < requiredRows);

    return {
      items: rows.slice(offsetInsideFirstPage, offsetInsideFirstPage + requestedLimit),
      pagination: {
        page: requestedPage,
        limit: requestedLimit,
        total,
        pages: Math.ceil(total / requestedLimit),
      },
    };
  };

  wrapped.__expandedDashboardList = true;
  menuCatalogService[methodName] = wrapped;
}

function productUiVariant(product = {}) {
  return String(product?.ui?.cardVariant || "").trim().toLowerCase();
}

function normalizedItemType(product = {}) {
  return String(product?.itemType || "product").trim().toLowerCase() || "product";
}

/**
 * Meal Builder direct-product cards are category-agnostic. This helper is kept
 * for backward compatibility with existing imports, but intentionally does not
 * whitelist itemType, cardVariant, or category.
 */
function isProductionDirectProduct(product = {}) {
  return Boolean(product && typeof product === "object");
}

function directSelectionType(product = {}) {
  const itemType = normalizedItemType(product);
  const variant = productUiVariant(product);
  return itemType === "cold_sandwich" ||
    itemType === "sourdough" ||
    itemType.includes("sandwich") ||
    variant === "sandwich_card"
    ? "sandwich"
    : "full_meal_product";
}

function registerItemTypes(products = []) {
  const registry = mealBuilderService.DIRECT_PRODUCT_ITEM_TYPES;
  if (!Array.isArray(registry)) return;

  for (const product of products) {
    const itemType = normalizedItemType(product);
    if (!registry.includes(itemType)) registry.push(itemType);
  }
}

async function loadProductsByIds(ids = []) {
  if (!ids.length) return [];
  return MenuProduct.find({ _id: { $in: ids } })
    .select("itemType ui.cardVariant key")
    .lean();
}

async function registerSelectedProductItemTypes(value) {
  const ids = normalizeProductIds(value);
  if (!ids.length) return;
  registerItemTypes(await loadProductsByIds(ids));
}

async function registerAllMenuProductItemTypes() {
  const products = await MenuProduct.find({}).select("itemType").lean();
  registerItemTypes(products);
}

async function loadProductsByCandidateIds(candidates = []) {
  const ids = candidates
    .map((candidate) => String(candidate.productId || candidate.id || "").trim())
    .filter(Boolean);
  const products = await loadProductsByIds(ids);
  return new Map(products.map((product) => [String(product._id), product]));
}

async function enrichCategoryAgnosticCandidates(candidates = []) {
  const productsById = await loadProductsByCandidateIds(candidates);

  return candidates.map((candidate) => {
    const id = String(candidate.productId || candidate.id || "");
    const product = productsById.get(id) || {
      itemType: candidate.itemType,
      ui: { cardVariant: candidate.cardVariant },
    };
    return {
      ...candidate,
      selectionType: directSelectionType(product),
    };
  });
}

function isProductCard(section = {}) {
  return String(section.sectionType || section.type || "") === "product_list";
}

function sectionKeyOf(section = {}) {
  return String(section.key || section.sectionKey || "").trim().toLowerCase();
}

function installMealBuilderActionCompatibility() {
  const originalCreateProductSection = mealBuilderService.createProductSection.bind(mealBuilderService);
  const originalAddProductsToSection = mealBuilderService.addProductsToSection.bind(mealBuilderService);
  const originalUpdateProductSection = mealBuilderService.updateProductSection.bind(mealBuilderService);

  mealBuilderService.createProductSection = async function categoryAgnosticCreateProductSection(
    args = {}
  ) {
    const section = args.section || {};
    await registerSelectedProductItemTypes(
      section.selectedProductIds || section.productIds || []
    );
    return originalCreateProductSection(args);
  };

  mealBuilderService.addProductsToSection = async function categoryAgnosticAddProductsToSection(
    args = {}
  ) {
    await registerSelectedProductItemTypes(args.productIds || []);
    return originalAddProductsToSection(args);
  };

  mealBuilderService.updateProductSection = async function categoryAgnosticUpdateProductSection(
    args = {}
  ) {
    const patch = args.patch || {};
    if (
      Object.prototype.hasOwnProperty.call(patch, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(patch, "productIds")
    ) {
      await registerSelectedProductItemTypes(
        patch.selectedProductIds || patch.productIds || []
      );
    }
    return originalUpdateProductSection(args);
  };
}

function installMealBuilderPickerCompatibility() {
  if (mealBuilderService.getSectionPicker.__categoryAgnosticProductCompatibility === true) {
    return;
  }

  const originalGetSectionPicker = mealBuilderService.getSectionPicker.bind(mealBuilderService);
  const originalGetDirectProductPicker = mealBuilderService.getDirectProductPicker.bind(mealBuilderService);

  async function getCategoryAgnosticDirectProductPicker(options = {}) {
    // The base service queries with DIRECT_PRODUCT_ITEM_TYPES. Populate that
    // registry from current MenuProduct data before invoking it, so new/future
    // item types work without another code whitelist change.
    await registerAllMenuProductItemTypes();

    const requestedPage = parsePositiveInteger(options.page, 1);
    const requestedLimit = Math.min(
      mealBuilderService.MAX_PICKER_LIMIT || MAX_DASHBOARD_LIST_LIMIT,
      parsePositiveInteger(options.limit, 100)
    );

    const raw = await originalGetDirectProductPicker({
      ...options,
      page: 1,
      limit: mealBuilderService.MAX_PICKER_LIMIT || MAX_DASHBOARD_LIST_LIMIT,
      includeUnavailable: true,
      unassignedOnly: false,
    });

    const categoryAgnosticRows = await enrichCategoryAgnosticCandidates(
      raw?.candidates || []
    );
    const showUnavailable = normalizeBoolean(options.includeUnavailable, false);
    const onlyUnassigned = normalizeBoolean(options.unassignedOnly, true);

    const catalogRows = categoryAgnosticRows.filter(
      (candidate) => candidate.selected || showUnavailable || candidate.available
    );
    const selectableRows = onlyUnassigned
      ? catalogRows.filter((candidate) => candidate.selected || candidate.assignable)
      : catalogRows;
    const start = (requestedPage - 1) * requestedLimit;
    const candidates = selectableRows.slice(start, start + requestedLimit);

    return {
      ...raw,
      rules: {
        ...(raw?.rules || {}),
        categoryAgnostic: true,
        itemTypePolicy: "any_menu_product",
        itemTypes: [],
        compatibleProductCardVariants: [],
      },
      candidates,
      meta: {
        page: requestedPage,
        limit: requestedLimit,
        total: selectableRows.length,
        pages:
          selectableRows.length === 0
            ? 0
            : Math.ceil(selectableRows.length / requestedLimit),
        catalogTotal: catalogRows.length,
        selectedInCurrentCard: catalogRows.filter((row) => row.selected).length,
        assignedToOtherCards: catalogRows.filter(
          (row) => row.state === "assigned_elsewhere"
        ).length,
        unassigned: catalogRows.filter((row) => row.state === "eligible").length,
        unavailable: catalogRows.filter((row) => row.state === "unavailable").length,
      },
    };
  }

  async function getCategoryAgnosticSectionPicker(options = {}) {
    const sectionKey = String(options.sectionKey || "").trim().toLowerCase();
    const state = await mealBuilderService.getDashboardState({ lang: options.lang });
    const config = state?.draft || state?.published || null;
    const matchingSection = (config?.sections || []).find(
      (section) => sectionKeyOf(section) === sectionKey
    );

    if (
      (matchingSection && isProductCard(matchingSection)) ||
      (!matchingSection && ["products", "sandwich"].includes(sectionKey))
    ) {
      return getCategoryAgnosticDirectProductPicker(options);
    }

    return originalGetSectionPicker(options);
  }

  getCategoryAgnosticSectionPicker.__categoryAgnosticProductCompatibility = true;
  mealBuilderService.getDirectProductPicker = getCategoryAgnosticDirectProductPicker;
  mealBuilderService.getSectionPicker = getCategoryAgnosticSectionPicker;
  installMealBuilderActionCompatibility();
}

function installDashboardCatalogCompatibility() {
  if (installed) return;
  installed = true;

  for (const methodName of [
    "listProducts",
    "listCategories",
    "listOptionGroups",
    "listOptions",
  ]) {
    installExpandedDashboardList(methodName);
  }
  installMealBuilderPickerCompatibility();
}

installDashboardCatalogCompatibility();

module.exports = {
  EXPLICIT_DIRECT_PRODUCT_TYPES,
  MAX_DASHBOARD_LIST_LIMIT,
  PRODUCTION_DIRECT_PRODUCT_VARIANTS,
  installDashboardCatalogCompatibility,
  isProductionDirectProduct,
};
