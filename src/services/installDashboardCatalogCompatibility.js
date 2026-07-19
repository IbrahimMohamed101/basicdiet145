"use strict";

const MenuProduct = require("../models/MenuProduct");
const menuCatalogService = require("./orders/menuCatalogService");
const mealBuilderService = require("./subscription/dashboardMealPlannerCompatibilityService");

const MAX_DASHBOARD_LIST_LIMIT = 1000;
const LEGACY_PAGE_SIZE = 100;
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

function isProductionDirectProduct(product = {}) {
  const itemType = String(product.itemType || "").trim().toLowerCase();
  if (EXPLICIT_DIRECT_PRODUCT_TYPES.has(itemType)) return true;
  return itemType === "product" && PRODUCTION_DIRECT_PRODUCT_VARIANTS.has(productUiVariant(product));
}

async function loadProductsByCandidateIds(candidates = []) {
  const ids = candidates
    .map((candidate) => String(candidate.productId || candidate.id || "").trim())
    .filter(Boolean);
  if (!ids.length) return new Map();

  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("itemType ui.cardVariant key")
    .lean();
  return new Map(products.map((product) => [String(product._id), product]));
}

async function filterProductionDirectCandidates(candidates = []) {
  const productsById = await loadProductsByCandidateIds(candidates);
  if (!productsById.size) return [];

  return candidates
    .filter((candidate) => {
      const id = String(candidate.productId || candidate.id || "");
      return isProductionDirectProduct(productsById.get(id));
    })
    .map((candidate) => {
      const id = String(candidate.productId || candidate.id || "");
      const product = productsById.get(id) || {};
      const variant = productUiVariant(product);
      return {
        ...candidate,
        selectionType:
          product.itemType === "cold_sandwich" || variant === "sandwich_card"
            ? "sandwich"
            : "full_meal_product",
      };
    });
}

function normalizeProductIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
}

async function assertProductionDirectProductIds(value) {
  const ids = normalizeProductIds(value);
  if (!ids.length) return;

  const products = await MenuProduct.find({ _id: { $in: ids } })
    .select("itemType ui.cardVariant key")
    .lean();
  const invalidProducts = products
    .filter((product) => !isProductionDirectProduct(product))
    .map((product) => ({
      id: String(product._id),
      key: product.key || "",
      itemType: product.itemType || "",
      cardVariant: productUiVariant(product),
    }));

  if (invalidProducts.length) {
    throw new mealBuilderService.MealBuilderError(
      "Only direct meal products can be added to this card",
      "MEAL_BUILDER_PRODUCT_TYPE_INVALID",
      422,
      {
        products: invalidProducts,
        allowedItemTypes: [...EXPLICIT_DIRECT_PRODUCT_TYPES, "product"],
        compatibleProductCardVariants: [...PRODUCTION_DIRECT_PRODUCT_VARIANTS],
      }
    );
  }
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

  mealBuilderService.createProductSection = async function compatibleCreateProductSection(args = {}) {
    const section = args.section || {};
    await assertProductionDirectProductIds(
      section.selectedProductIds || section.productIds || []
    );
    return originalCreateProductSection(args);
  };

  mealBuilderService.addProductsToSection = async function compatibleAddProductsToSection(args = {}) {
    await assertProductionDirectProductIds(args.productIds || []);
    return originalAddProductsToSection(args);
  };

  mealBuilderService.updateProductSection = async function compatibleUpdateProductSection(args = {}) {
    const patch = args.patch || {};
    if (
      Object.prototype.hasOwnProperty.call(patch, "selectedProductIds") ||
      Object.prototype.hasOwnProperty.call(patch, "productIds")
    ) {
      await assertProductionDirectProductIds(
        patch.selectedProductIds || patch.productIds || []
      );
    }
    return originalUpdateProductSection(args);
  };
}

function installMealBuilderPickerCompatibility() {
  if (!mealBuilderService.DIRECT_PRODUCT_ITEM_TYPES.includes("product")) {
    mealBuilderService.DIRECT_PRODUCT_ITEM_TYPES.push("product");
  }

  if (mealBuilderService.getSectionPicker.__productionProductCompatibility === true) return;

  const originalGetSectionPicker = mealBuilderService.getSectionPicker.bind(mealBuilderService);
  const originalGetDirectProductPicker = mealBuilderService.getDirectProductPicker.bind(mealBuilderService);

  async function getCompatibleDirectProductPicker(options = {}) {
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

    const compatibleRows = await filterProductionDirectCandidates(raw?.candidates || []);
    const showUnavailable = normalizeBoolean(options.includeUnavailable, false);
    const onlyUnassigned = normalizeBoolean(options.unassignedOnly, true);

    const catalogRows = compatibleRows.filter(
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
        itemTypes: [...EXPLICIT_DIRECT_PRODUCT_TYPES, "product"],
        compatibleProductCardVariants: [...PRODUCTION_DIRECT_PRODUCT_VARIANTS],
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

  async function getCompatibleSectionPicker(options = {}) {
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
      return getCompatibleDirectProductPicker(options);
    }

    return originalGetSectionPicker(options);
  }

  getCompatibleSectionPicker.__productionProductCompatibility = true;
  mealBuilderService.getDirectProductPicker = getCompatibleDirectProductPicker;
  mealBuilderService.getSectionPicker = getCompatibleSectionPicker;
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
