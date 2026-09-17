"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const CatalogItem = require("../../models/CatalogItem");
const MenuProduct = require("../../models/MenuProduct");
const MenuOption = require("../../models/MenuOption");
const Sandwich = require("../../models/Sandwich");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const Addon = require("../../models/Addon");
const SaladIngredient = require("../../models/SaladIngredient");
const Meal = require("../../models/Meal");

const DEFAULT_MENU_IMAGE_WIDTH = 900;
const DEFAULT_MENU_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_MENU_CACHE_MAX_ENTRIES = 24;
const PLANNER_CATALOG_V3_VERSION = "meal_planner_menu.v3";
const MENU_IMAGE_ID_FIELDS = Object.freeze([
  "id",
  "_id",
  "optionId",
  "productId",
  "catalogItemId",
]);
const IMAGE_SOURCE_MODELS = Object.freeze([
  MenuProduct,
  MenuOption,
  Sandwich,
  BuilderProtein,
  BuilderCarb,
  Addon,
  SaladIngredient,
  Meal,
]);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function resolveMenuImageWidth(value = process.env.MENU_IMAGE_MAX_WIDTH) {
  return clampInteger(value, DEFAULT_MENU_IMAGE_WIDTH, 320, 1600);
}

function resolveMenuCacheTtlMs(value = process.env.MENU_CATALOG_CACHE_TTL_MS) {
  return clampInteger(value, DEFAULT_MENU_CACHE_TTL_MS, 1000, 5 * 60 * 1000);
}

function isCloudinaryHost(hostname) {
  const normalized = clean(hostname).toLowerCase();
  return normalized === "res.cloudinary.com" || normalized.endsWith(".cloudinary.com");
}

function optimizeCloudinaryImageUrl(value, { width = resolveMenuImageWidth() } = {}) {
  let imageUrl = clean(value);
  if (!imageUrl) return "";

  if (/^http:\/\//i.test(imageUrl)) {
    imageUrl = imageUrl.replace(/^http:\/\//i, "https://");
  }

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (_err) {
    return imageUrl;
  }

  if (!isCloudinaryHost(parsed.hostname)) return imageUrl;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const uploadIndex = segments.indexOf("upload");
  if (uploadIndex < 0) return imageUrl;

  // Inserting transformations into a signed delivery URL invalidates its path
  // signature. Keep those URLs untouched apart from the safe HTTPS upgrade.
  if (segments.some((segment) => /^s--.+--$/.test(segment))) {
    return parsed.toString();
  }

  const resolvedWidth = clampInteger(width, DEFAULT_MENU_IMAGE_WIDTH, 320, 1600);
  const transformation = `f_auto,q_auto:eco,c_limit,w_${resolvedWidth}`;
  const nextSegment = segments[uploadIndex + 1] || "";
  const alreadyOptimized = nextSegment.includes("f_auto")
    && nextSegment.includes("q_auto")
    && /(?:^|,)w_\d+(?:,|$)/.test(nextSegment);

  if (!alreadyOptimized) {
    segments.splice(uploadIndex + 1, 0, transformation);
    parsed.pathname = `/${segments.join("/")}`;
  }

  return parsed.toString();
}

function isObjectIdLike(value) {
  const normalized = clean(value);
  return Boolean(normalized && mongoose.Types.ObjectId.isValid(normalized));
}

function collectCandidateIds(value, ids = new Set(), visited = new WeakSet()) {
  if (!value || typeof value !== "object") return ids;
  if (visited.has(value)) return ids;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectCandidateIds(entry, ids, visited));
    return ids;
  }

  for (const field of MENU_IMAGE_ID_FIELDS) {
    if (isObjectIdLike(value[field])) ids.add(String(value[field]));
  }
  Object.values(value).forEach((entry) => collectCandidateIds(entry, ids, visited));
  return ids;
}

function firstImageUrl(...values) {
  for (const value of values) {
    const normalized = clean(value);
    if (normalized) return normalized;
  }
  return "";
}

async function loadImageLookup(candidateIds) {
  const ids = [...candidateIds].filter(isObjectIdLike);
  if (ids.length === 0) {
    return { imageById: new Map(), catalogImageById: new Map() };
  }

  const sourceCollections = await Promise.all(
    IMAGE_SOURCE_MODELS.map((Model) => (
      Model.find({ _id: { $in: ids } })
        .select("_id imageUrl catalogItemId")
        .lean()
    ))
  );
  const sourceRows = sourceCollections.flat();
  const linkedCatalogItemIds = sourceRows
    .map((row) => clean(row && row.catalogItemId))
    .filter(isObjectIdLike);
  const catalogIds = [...new Set([...ids, ...linkedCatalogItemIds])];
  const catalogRows = catalogIds.length > 0
    ? await CatalogItem.find({ _id: { $in: catalogIds } }).select("_id imageUrl").lean()
    : [];
  const catalogImageById = new Map(
    catalogRows
      .map((row) => [String(row._id), clean(row.imageUrl)])
      .filter(([, imageUrl]) => Boolean(imageUrl))
  );
  const imageById = new Map();

  for (const row of sourceRows) {
    const imageUrl = firstImageUrl(
      row && row.imageUrl,
      row && row.catalogItemId ? catalogImageById.get(String(row.catalogItemId)) : ""
    );
    if (imageUrl) imageById.set(String(row._id), imageUrl);
  }

  for (const [id, imageUrl] of catalogImageById.entries()) {
    if (!imageById.has(id)) imageById.set(id, imageUrl);
  }

  return { imageById, catalogImageById };
}

function resolveNodeImageUrl(node, lookup) {
  const current = clean(node && node.imageUrl);
  if (current) return current;

  for (const field of MENU_IMAGE_ID_FIELDS) {
    const id = clean(node && node[field]);
    if (!id) continue;
    const resolved = firstImageUrl(
      lookup.imageById.get(id),
      lookup.catalogImageById.get(id)
    );
    if (resolved) return resolved;
  }

  return "";
}

function applyImageLookup(value, lookup, options, visited = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (visited.has(value)) return value;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => applyImageLookup(entry, lookup, options, visited));
    return value;
  }

  const resolvedImageUrl = resolveNodeImageUrl(value, lookup);
  if (resolvedImageUrl) {
    value.imageUrl = optimizeCloudinaryImageUrl(resolvedImageUrl, options);
  }

  Object.values(value).forEach((entry) => applyImageLookup(entry, lookup, options, visited));
  return value;
}

function computePlannerCatalogHash(catalog = {}) {
  const stablePayload = {
    contractVersion: catalog.contractVersion,
    currency: catalog.currency,
    sections: Array.isArray(catalog.sections) ? catalog.sections : [],
    rules: catalog.rules && typeof catalog.rules === "object" ? catalog.rules : {},
  };
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex")}`;
}

function refreshPlannerCatalogHashes(value, visited = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (visited.has(value)) return value;
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => refreshPlannerCatalogHashes(entry, visited));
    return value;
  }

  Object.values(value).forEach((entry) => refreshPlannerCatalogHashes(entry, visited));
  if (
    value.contractVersion === PLANNER_CATALOG_V3_VERSION
    && Array.isArray(value.sections)
    && value.rules
  ) {
    value.catalogHash = computePlannerCatalogHash(value);
  }
  return value;
}

async function hydrateAndOptimizeMenuImages(payload, options = {}) {
  const cloned = clonePlain(payload);
  if (!cloned || typeof cloned !== "object") return cloned;
  const candidateIds = collectCandidateIds(cloned);
  const lookup = await loadImageLookup(candidateIds);
  applyImageLookup(cloned, lookup, options);
  return refreshPlannerCatalogHashes(cloned);
}

function createTtlSingleFlightCache({
  ttlMs = resolveMenuCacheTtlMs(),
  maxEntries = DEFAULT_MENU_CACHE_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) {
  const entries = new Map();
  const stats = { hits: 0, misses: 0, loads: 0, clears: 0 };
  const normalizedTtlMs = clampInteger(ttlMs, DEFAULT_MENU_CACHE_TTL_MS, 1, 5 * 60 * 1000);
  const normalizedMaxEntries = clampInteger(maxEntries, DEFAULT_MENU_CACHE_MAX_ENTRIES, 1, 100);

  function prune() {
    const currentTime = now();
    for (const [key, entry] of entries.entries()) {
      if (!entry.promise && entry.expiresAt <= currentTime) entries.delete(key);
    }
    while (entries.size > normalizedMaxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  async function getOrLoad(key, loader) {
    const normalizedKey = clean(key);
    if (!normalizedKey) throw new TypeError("cache key is required");
    if (typeof loader !== "function") throw new TypeError("cache loader is required");

    prune();
    const existing = entries.get(normalizedKey);
    if (existing && existing.value !== undefined && existing.expiresAt > now()) {
      stats.hits += 1;
      return clonePlain(existing.value);
    }
    if (existing && existing.promise) {
      stats.hits += 1;
      return clonePlain(await existing.promise);
    }

    stats.misses += 1;
    stats.loads += 1;
    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        const stored = clonePlain(value);
        entries.delete(normalizedKey);
        entries.set(normalizedKey, {
          value: stored,
          expiresAt: now() + normalizedTtlMs,
          promise: null,
        });
        prune();
        return stored;
      })
      .catch((error) => {
        entries.delete(normalizedKey);
        throw error;
      });

    entries.set(normalizedKey, { value: undefined, expiresAt: 0, promise });
    return clonePlain(await promise);
  }

  function clear() {
    entries.clear();
    stats.clears += 1;
  }

  function snapshot() {
    prune();
    return {
      ...stats,
      size: entries.size,
      ttlMs: normalizedTtlMs,
      maxEntries: normalizedMaxEntries,
    };
  }

  return { clear, getOrLoad, snapshot };
}

module.exports = {
  DEFAULT_MENU_CACHE_TTL_MS,
  DEFAULT_MENU_IMAGE_WIDTH,
  clonePlain,
  collectCandidateIds,
  computePlannerCatalogHash,
  createTtlSingleFlightCache,
  hydrateAndOptimizeMenuImages,
  optimizeCloudinaryImageUrl,
  refreshPlannerCatalogHashes,
  resolveMenuCacheTtlMs,
  resolveMenuImageWidth,
};
