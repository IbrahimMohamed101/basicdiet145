"use strict";

const menuCatalogService = require("./orders/menuCatalogService");

const STATE_KEY = Symbol.for("basicdiet.addonPickerAvailabilityGuard.state");
const WRAPPER_MARKER = "__addonPickerAvailabilityGuard";

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function isPickerRequest(options = {}) {
  const view = clean(options.view);
  const context = clean(options.context || options.linkableFor);
  return view === "picker" || view === "addon_plan_picker" || context === "addon_plan";
}

function requestedBoolean(value, fallback) {
  const raw = clean(value).toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return fallback;
}

function matchesPickerAvailability(row, options = {}) {
  if (!row) return false;
  if (options.includeInactive === true || clean(options.includeInactive).toLowerCase() === "true") {
    return true;
  }

  const expectedActive = requestedBoolean(options.isActive, true);
  const expectedVisible = requestedBoolean(options.isVisible, true);
  const expectedAvailable = requestedBoolean(options.isAvailable, true);

  return Boolean(row.isActive !== false) === expectedActive
    && Boolean(row.isVisible !== false) === expectedVisible
    && Boolean(row.isAvailable !== false) === expectedAvailable;
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  return result && Array.isArray(result.items) ? result.items : [];
}

function replaceRows(result, rows) {
  if (Array.isArray(result)) return rows;
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    items: rows,
    pagination: result.pagination
      ? {
          ...result.pagination,
          total: rows.length,
          pages: rows.length === 0 ? 0 : 1,
        }
      : result.pagination,
  };
}

function filterPickerResult(result, options = {}) {
  if (!isPickerRequest(options)) return result;
  return replaceRows(
    result,
    rowsOf(result).filter((row) => matchesPickerAvailability(row, options))
  );
}

function wrapProducts() {
  const original = menuCatalogService.listProducts;
  if (typeof original !== "function") throw new Error("Missing menu product list service");
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function guardedAddonPickerProducts(options = {}) {
    return filterPickerResult(await original.call(menuCatalogService, options), options);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  menuCatalogService.listProducts = wrapped;
}

function wrapCategories() {
  const original = menuCatalogService.listCategories;
  if (typeof original !== "function") throw new Error("Missing menu category list service");
  if (original[WRAPPER_MARKER]) return;

  const wrapped = async function guardedAddonPickerCategories(options = {}) {
    const result = await original.call(menuCatalogService, options);
    if (!isPickerRequest(options)) return result;

    const productResult = await menuCatalogService.listProducts({
      ...options,
      page: undefined,
      limit: undefined,
      categoryId: undefined,
    });
    const counts = new Map();
    for (const product of rowsOf(productResult)) {
      const categoryKey = clean(product.category);
      if (!categoryKey) continue;
      counts.set(categoryKey, (counts.get(categoryKey) || 0) + 1);
    }

    const categories = rowsOf(result)
      .filter((row) => matchesPickerAvailability(row, options))
      .map((row) => ({
        ...row,
        productsCount: counts.get(clean(row.key)) || 0,
      }));
    return replaceRows(result, categories);
  };
  Object.defineProperty(wrapped, WRAPPER_MARKER, { value: true });
  menuCatalogService.listCategories = wrapped;
}

function installAddonPickerAvailabilityGuard() {
  const current = globalThis[STATE_KEY];
  if (current?.status === "installed") return current;

  const state = { status: "installing", installedAt: null };
  globalThis[STATE_KEY] = state;
  try {
    wrapProducts();
    wrapCategories();
    Object.assign(state, {
      status: "installed",
      installedAt: new Date(),
      filtersSerializedPickerRows: true,
      recalculatesCategoryCounts: true,
    });
    return state;
  } catch (error) {
    state.status = "failed";
    state.errorCode = error.code || "ADDON_PICKER_AVAILABILITY_GUARD_FAILED";
    state.errorMessage = error.message;
    throw error;
  }
}

installAddonPickerAvailabilityGuard();

module.exports = {
  filterPickerResult,
  installAddonPickerAvailabilityGuard,
  matchesPickerAvailability,
};
