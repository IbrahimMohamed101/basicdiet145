"use strict";

const orderMenuService = require("./orders/orderMenuService");
const CatalogService = require("./catalog/CatalogService");
const mealPlannerCatalogService = require("./subscription/mealPlannerCatalogService");
const {
  createTtlSingleFlightCache,
  hydrateAndOptimizeMenuImages,
  resolveMenuCacheTtlMs,
  resolveMenuImageWidth,
} = require("./menu/menuImageDeliveryService");

const INSTALL_KEY = Symbol.for("basicdiet.menuDeliveryOptimization.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.menuDeliveryOptimization.wrapped");
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MENU_MUTATION_PATH_PREFIXES = Object.freeze([
  "/api/dashboard/menu",
  "/api/dashboard/meal-planner",
  "/api/dashboard/meal-builder",
  "/api/dashboard/catalog-items",
  "/api/dashboard/premium-upgrades",
  "/api/admin/meal-planner-menu",
]);

const cacheTtlMs = resolveMenuCacheTtlMs();
const imageWidth = resolveMenuImageWidth();
const oneTimeMenuCache = createTtlSingleFlightCache({ ttlMs: cacheTtlMs, maxEntries: 12 });
const plannerCatalogCache = createTtlSingleFlightCache({ ttlMs: cacheTtlMs, maxEntries: 12 });

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function cacheEnabled() {
  return String(process.env.MENU_CATALOG_CACHE_DISABLED || "").trim().toLowerCase() !== "true";
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableObject(value[key]);
      return result;
    }, {});
}

function cacheKey(prefix, value) {
  return `${prefix}:${JSON.stringify(stableObject(value || {}))}`;
}

async function loadOptimized(loader) {
  const payload = await loader();
  return hydrateAndOptimizeMenuImages(payload, { width: imageWidth });
}

function wrapStaticCatalogFunction(target, propertyName, keyResolver, cache) {
  const original = target && target[propertyName];
  if (typeof original !== "function") {
    throw new TypeError(`${propertyName} is required for menu delivery optimization`);
  }
  if (original[WRAPPED_KEY] === true) return original;

  const wrapped = async function optimizedStaticMenuCatalog(...args) {
    const load = () => loadOptimized(() => original.apply(this, args));
    if (!cacheEnabled()) return load();
    return cache.getOrLoad(keyResolver(...args), load);
  };

  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  target[propertyName] = wrapped;
  return wrapped;
}

function invalidateMenuDeliveryOptimizationCache() {
  oneTimeMenuCache.clear();
  plannerCatalogCache.clear();
  return true;
}

function wrapPlannerInvalidation() {
  const original = mealPlannerCatalogService.invalidateMealPlannerCatalogCache;
  if (typeof original !== "function" || original[WRAPPED_KEY] === true) return;

  const wrapped = async function invalidateMealPlannerAndDeliveryCaches(...args) {
    invalidateMenuDeliveryOptimizationCache();
    return original.apply(this, args);
  };
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  mealPlannerCatalogService.invalidateMealPlannerCatalogCache = wrapped;
}

function isMenuMutationRequest(req) {
  if (!req || !MUTATING_METHODS.has(String(req.method || "").toUpperCase())) return false;
  const requestPath = clean(req.originalUrl || req.url || req.path).split("?")[0];
  return MENU_MUTATION_PATH_PREFIXES.some((prefix) => (
    requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  ));
}

function menuMutationCacheInvalidationMiddleware(req, res, next) {
  if (!isMenuMutationRequest(req)) return next();

  res.once("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      invalidateMenuDeliveryOptimizationCache();
    }
  });
  return next();
}

function getMenuDeliveryOptimizationState() {
  return {
    installed: Boolean(globalThis[INSTALL_KEY] && globalThis[INSTALL_KEY].installed),
    cacheEnabled: cacheEnabled(),
    cacheTtlMs,
    imageWidth,
    oneTimeMenuCache: oneTimeMenuCache.snapshot(),
    plannerCatalogCache: plannerCatalogCache.snapshot(),
  };
}

function installMenuDeliveryOptimization() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  wrapStaticCatalogFunction(
    orderMenuService,
    "getOneTimeOrderMenu",
    (options = {}) => cacheKey("one-time", {
      lang: options.lang || "en",
      fulfillmentMethod: options.fulfillmentMethod || "",
      includePublicV2: options.includePublicV2 === true,
    }),
    oneTimeMenuCache
  );

  wrapStaticCatalogFunction(
    CatalogService,
    "getSubscriptionBuilderCatalogWithV2",
    (options = {}) => cacheKey("planner", {
      lang: options.lang || "en",
      includeV2: options.includeV2 === true,
      includeV3: options.includeV3 === true,
      ignorePublishedMealBuilder: options.ignorePublishedMealBuilder === true,
    }),
    plannerCatalogCache
  );

  wrapPlannerInvalidation();

  const state = Object.freeze({
    installed: true,
    cacheTtlMs,
    imageWidth,
    oneTimeMenuWrapped: orderMenuService.getOneTimeOrderMenu[WRAPPED_KEY] === true,
    plannerCatalogWrapped: CatalogService.getSubscriptionBuilderCatalogWithV2[WRAPPED_KEY] === true,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installMenuDeliveryOptimization();

module.exports = {
  INSTALL_KEY,
  WRAPPED_KEY,
  getMenuDeliveryOptimizationState,
  installMenuDeliveryOptimization,
  invalidateMenuDeliveryOptimizationCache,
  isMenuMutationRequest,
  menuMutationCacheInvalidationMiddleware,
};
