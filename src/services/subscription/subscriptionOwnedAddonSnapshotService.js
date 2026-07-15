"use strict";

/**
 * subscriptionOwnedAddonSnapshotService.js
 *
 * Separates the two product-loading code paths that were previously conflated:
 *
 *   loadGenericSelectableProducts()  — full live availability filters (new purchase / generic catalog)
 *   loadOwnedSnapshotProducts()      — NO live filters (owned entitlement usage after archival)
 *
 * Also provides:
 *   resolveOwnedAddonEntitlementChoice() — resolves a single owned entitlement for validate/save/edit/cancel.
 *   buildMenuProductsSnapshot()          — called at checkout to persist immutable product snapshot.
 */

const mongoose = require("mongoose");
const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const {
  filterGloballyAvailable,
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const { availableForChannelQuery } = require("./subscriptionMenuEligibilityPolicyService");
const {
  findAddonBalanceBucket,
  normalizeSubscriptionAddonCategory,
} = require("./subscriptionAddonPolicyService");

// ─── Error codes ──────────────────────────────────────────────────────────────

const ERROR_CODE_ENTITLEMENT_NOT_OWNED = "ENTITLEMENT_NOT_OWNED";
const ERROR_CODE_ENTITLEMENT_PRODUCT_NOT_FOUND = "ENTITLEMENT_PRODUCT_NOT_FOUND";
const ERROR_CODE_ENTITLEMENT_CATEGORY_MISMATCH = "ENTITLEMENT_CATEGORY_MISMATCH";
const ERROR_CODE_ADDON_PLAN_MISMATCH = "ADDON_PLAN_MISMATCH";
const ERROR_CODE_BALANCE_BUCKET_MISMATCH = "BALANCE_BUCKET_MISMATCH";
const ERROR_CODE_SNAPSHOT_MISSING = "OWNED_ENTITLEMENT_PRODUCT_SNAPSHOT_MISSING";

function createSnapshotIntegrityError(productId, entitlementKey) {
  const err = new Error(
    `Owned entitlement product snapshot missing: productId=${productId} entitlementKey=${entitlementKey}. ` +
    `The live catalog record is inaccessible and no snapshot was persisted at checkout.`
  );
  err.status = 409;
  err.code = ERROR_CODE_SNAPSHOT_MISSING;
  err.details = { productId: String(productId || ""), entitlementKey: String(entitlementKey || "") };
  return err;
}

function createIntegrityError(code, message, details = {}) {
  const err = new Error(message);
  err.status = code === ERROR_CODE_ENTITLEMENT_NOT_OWNED ? 403 : 409;
  err.code = code;
  err.details = details;
  return err;
}

function createOwnershipError(message) {
  const err = new Error(message);
  err.status = 403;
  err.code = ERROR_CODE_ENTITLEMENT_NOT_OWNED;
  return err;
}

function createNotFoundError(message) {
  const err = new Error(message);
  err.status = 404;
  err.code = "NOT_FOUND";
  return err;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeIdList(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
}

function isDailyAddonMenuProduct(product) {
  return String(product && product.kind || "").toLowerCase() !== "plan"
    && String(product && product.type || "").toLowerCase() !== "subscription"
    && String(product && product.itemType || "").toLowerCase() !== "subscription"
    && String(product && product.billingMode || "").toLowerCase() !== "per_day";
}

function activePublishedQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function buildEntitlementKey(entitlement, index = 0) {
  const category = String(entitlement && entitlement.category || "legacy").trim();
  const planId = String(
    (entitlement && (entitlement.addonPlanId || entitlement.addonId)) || index
  );
  return `${category}:${planId}`;
}

/**
 * Synthesize a minimal category-like object from a string key, used when the
 * live MenuCategory document is missing or archived.
 */
function syntheticCategoryFromKey(key) {
  return { _id: null, key: String(key || ""), isActive: true, publishedAt: new Date(0) };
}

function snapshotIdOf(snapshot) {
  return String(snapshot && (snapshot.id || snapshot._id) || "");
}

function entitlementProductIds(entitlement) {
  const ids = new Set();
  for (const id of Array.isArray(entitlement && entitlement.menuProductIds) ? entitlement.menuProductIds : []) {
    const normalized = String(id || "").trim();
    if (normalized) ids.add(normalized);
  }
  for (const snapshot of Array.isArray(entitlement && entitlement.menuProductsSnapshot) ? entitlement.menuProductsSnapshot : []) {
    const normalized = snapshotIdOf(snapshot).trim();
    if (normalized) ids.add(normalized);
  }
  return [...ids];
}

function materializeProductFromSnapshot(snapshot) {
  return {
    _id: snapshot.id || snapshot._id,
    key: snapshot.key || "",
    name: snapshot.name || snapshot.nameI18n || "",
    nameI18n: snapshot.nameI18n || snapshot.name || null,
    description: snapshot.description || snapshot.descriptionI18n || "",
    descriptionI18n: snapshot.descriptionI18n || snapshot.description || null,
    imageUrl: snapshot.imageUrl || "",
    categoryId: null,
    category: snapshot.category || "",
    categoryKey: snapshot.categoryKey || snapshot.category || "",
    itemType: snapshot.itemType || "",
    priceHalala: Number(snapshot.priceHalala || 0),
    currency: snapshot.currency || "SAR",
    isActive: false,
    isAvailable: false,
    isVisible: false,
    _isOwnedSnapshot: true,
  };
}

// ─── Generic selectable product loader (NEW PURCHASE / GENERIC CATALOG) ───────

/**
 * Loads products with ALL live availability filters applied.
 * Use this for generic catalog browsing and new checkout flows only.
 *
 * Requires:
 *   isActive = true
 *   isVisible != false
 *   isAvailable != false
 *   publishedAt != null
 *   availableForChannelQuery("one_time")
 *   filterGloballyAvailable (CatalogItem gate)
 *   active MenuCategory (implied by caller)
 */
async function loadGenericSelectableProducts(productIds, { MenuProductModel = MenuProduct } = {}) {
  const validIds = normalizeIdList(productIds);
  if (!validIds.length) return [];

  const rows = await MenuProductModel.find(
    activePublishedQuery({
      _id: { $in: validIds },
      ...availableForChannelQuery("one_time"),
    })
  ).lean();

  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  const byId = new Map(
    filterGloballyAvailable(rows, catalogItemsById)
      .filter(isDailyAddonMenuProduct)
      .map((row) => [String(row._id), row])
  );

  return validIds.map((id) => byId.get(id)).filter(Boolean);
}

// ─── Owned snapshot product loader (OWNED ENTITLEMENT USAGE) ─────────────────

/**
 * Loads products by ID with NO live availability filters.
 * Use this exclusively for resolving owned entitlement snapshots.
 *
 * For each requested product ID:
 *  1. Uses the immutable `menuProductsSnapshot` stored in the entitlement.
 *  2. Falls back to the live/archived MenuProduct document (without live availability filters).
 *  3. If neither is available, emits OWNED_ENTITLEMENT_PRODUCT_SNAPSHOT_MISSING.
 *
 * Returns an array of { product, fromSnapshot } objects in the same order as productIds,
 * omitting only ids where neither DB record nor snapshot is available (error is emitted).
 */
async function loadOwnedSnapshotProducts(productIds, entitlement, {
  MenuProductModel = MenuProduct,
  onMissingProduct = null,
} = {}) {
  const validIds = normalizeIdList(productIds);
  if (!validIds.length) return [];

  // Build snapshot lookup from the entitlement (if present).
  const snapshotById = new Map();
  const snapshots = Array.isArray(entitlement && entitlement.menuProductsSnapshot)
    ? entitlement.menuProductsSnapshot
    : [];
  for (const snap of snapshots) {
    const snapId = snapshotIdOf(snap);
    if (snapId) snapshotById.set(snapId, snap);
  }

  const idsMissingSnapshot = validIds.filter((id) => !snapshotById.has(id));
  const rows = idsMissingSnapshot.length
    ? await MenuProductModel.find({ _id: { $in: idsMissingSnapshot } }).lean()
    : [];
  const byId = new Map(rows.map((row) => [String(row._id), row]));

  const results = [];
  const entitlementKey = buildEntitlementKey(entitlement);

  for (const id of validIds) {
    const snap = snapshotById.get(id);
    if (snap) {
      results.push({ product: materializeProductFromSnapshot(snap), fromSnapshot: true, id });
      continue;
    }

    const dbProduct = byId.get(id);
    if (dbProduct) {
      results.push({ product: dbProduct, fromSnapshot: false, id });
      continue;
    }

    // Neither DB nor snapshot — integrity error
    if (typeof onMissingProduct === "function") {
      onMissingProduct(createSnapshotIntegrityError(id, entitlementKey));
    } else {
      throw createSnapshotIntegrityError(id, entitlementKey);
    }
  }

  return results;
}

// ─── Category loader for owned products ───────────────────────────────────────

/**
 * Loads MenuCategory documents for the given products WITHOUT active/published filters.
 * When a category is missing, synthesizes one from the entitlement's category field.
 */
async function loadOwnedCategoryRowsForProducts(products, entitlementCategory, {
  MenuCategoryModel = MenuCategory,
} = {}) {
  const categoryIds = [
    ...new Set(
      (Array.isArray(products) ? products : [])
        .map((p) => {
          const prod = p && p.product ? p.product : p;
          return String(prod && prod.categoryId || "");
        })
        .filter(Boolean)
    ),
  ];

  const rowsById = new Map();
  if (categoryIds.length) {
    // Load regardless of active/published state.
    const rows = await MenuCategoryModel.find({
      _id: { $in: categoryIds },
    }).lean();
    for (const row of rows) {
      rowsById.set(String(row._id), row);
    }
  }

  // For any product whose categoryId is missing/archived, synthesize from entitlementCategory.
  const fallbackCategory = syntheticCategoryFromKey(entitlementCategory);
  return { rowsById, fallbackCategory };
}

// ─── Owned entitlement resolver ───────────────────────────────────────────────

/**
 * resolveOwnedAddonEntitlementChoice
 *
 * Resolves an owned add-on entitlement for validate / save / edit / cancel flows.
 * Never touches the generic live catalog path.
 *
 * Priority for bucket resolution:
 *   balanceBucketId._id > addonPlanId > addonId > category > productId > unitPriceHalala > currency
 *
 * Returns:
 * {
 *   entitlement,        // matched addonSubscriptions entry
 *   bucket,             // matched addonBalance entry
 *   entitlementKey,     // string key
 *   entitlementIndex,   // index in addonSubscriptions
 *   category,           // normalized category string
 *   addonPlanId,        // string
 *   addonId,            // string
 *   productId,          // string
 *   unitPriceHalala,    // number (from bucket or entitlement)
 *   currency,           // string
 *   remainingQty,       // number
 *   includedTotalQty,   // number
 * }
 *
 * Throws 403 if ownership cannot be confirmed.
 * Throws 404 if subscription or entitlement not found.
 * Throws 409 with OWNED_ENTITLEMENT_PRODUCT_SNAPSHOT_MISSING if product data is unavailable.
 */
async function resolveOwnedAddonEntitlementChoice({
  subscription,
  productId,
  addonPlanId = null,
  category = null,
  balanceBucketId = null,
  userId,
  session = null,
}) {
  if (!subscription) {
    throw createNotFoundError("Subscription not found");
  }

  // 1. Confirm ownership
  if (userId && String(subscription.userId || "") !== String(userId)) {
    throw createOwnershipError("Subscription does not belong to the authenticated user");
  }

  // 2. Confirm subscription is active
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    err.status = 422;
    throw err;
  }

  const normalizedProductId = String(productId || "").trim();
  const normalizedAddonPlanId = String(addonPlanId || "").trim();
  const normalizedBalanceBucketId = String(balanceBucketId || "").trim();
  const normalizedCategory = category
    ? normalizeSubscriptionAddonCategory(String(category).trim()) || String(category).trim()
    : null;

  const entitlements = Array.isArray(subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];

  // 3. Search addonSubscriptions for a matching entitlement.
  // Category is only an isolation check. It is never sufficient to prove coverage.
  let matchedEntitlement = null;
  let matchedIndex = -1;
  let sawPlanMismatch = false;
  let sawCategoryMismatch = false;
  let sawProductMismatch = false;
  const hasExplicitIdentity = Boolean(normalizedAddonPlanId || normalizedBalanceBucketId);

  for (let i = 0; i < entitlements.length; i++) {
    const entry = entitlements[i];
    if (!entry) continue;

    const entryPlanId = String(entry.addonPlanId || entry.addonId || "");
    const entryCategory = normalizeSubscriptionAddonCategory(entry.category) || String(entry.category || "");

    // 4. Match criteria
    if (normalizedAddonPlanId && entryPlanId !== normalizedAddonPlanId) {
      sawPlanMismatch = true;
      continue;
    }
    if (normalizedCategory && entryCategory !== normalizedCategory) {
      sawCategoryMismatch = true;
      continue;
    }

    const productIds = entitlementProductIds(entry);
    if (normalizedProductId) {
      if (productIds.length > 0) {
        if (!productIds.includes(normalizedProductId)) {
          sawProductMismatch = true;
          continue;
        }
      } else if (entryPlanId !== normalizedProductId && (!normalizedAddonPlanId || entryPlanId !== normalizedAddonPlanId)) {
        sawProductMismatch = true;
        continue;
      }
    } else if (!hasExplicitIdentity) {
      continue;
    }

    // Product-only legacy payloads are allowed only when exactly one plan contains the product.
    if (matchedEntitlement !== null && !normalizedAddonPlanId) {
      const err = new Error(
        "Ambiguous owned entitlement: multiple buckets match the add-on product. Supply addonPlanId."
      );
      err.status = 409;
      err.code = "ENTITLEMENT_AMBIGUOUS";
      throw err;
    }

    matchedEntitlement = entry;
    matchedIndex = i;
    if (normalizedAddonPlanId) break; // strong match — stop early
  }

  if (!matchedEntitlement) {
    if (normalizedAddonPlanId && sawPlanMismatch) {
      throw createIntegrityError(ERROR_CODE_ADDON_PLAN_MISMATCH, "Owned entitlement add-on plan mismatch", {
        addonPlanId: normalizedAddonPlanId,
        category: normalizedCategory,
        productId: normalizedProductId,
      });
    }
    if (normalizedCategory && sawCategoryMismatch) {
      throw createIntegrityError(ERROR_CODE_ENTITLEMENT_CATEGORY_MISMATCH, "Owned entitlement category mismatch", {
        addonPlanId: normalizedAddonPlanId,
        category: normalizedCategory,
        productId: normalizedProductId,
      });
    }
    if (normalizedProductId && sawProductMismatch && (normalizedAddonPlanId || normalizedCategory || normalizedBalanceBucketId)) {
      throw createIntegrityError(ERROR_CODE_ENTITLEMENT_PRODUCT_NOT_FOUND, "Owned entitlement product not found in entitlement snapshot", {
        addonPlanId: normalizedAddonPlanId,
        category: normalizedCategory,
        productId: normalizedProductId,
      });
    }
    throw createIntegrityError(ERROR_CODE_ENTITLEMENT_NOT_OWNED, "No owned entitlement found for add-on choice", {
      addonPlanId: normalizedAddonPlanId,
      category: normalizedCategory,
      productId: normalizedProductId,
    });
  }

  // 6. Resolve the exact balance bucket
  const entryPlanId = String(matchedEntitlement.addonPlanId || matchedEntitlement.addonId || "");
  const entryCategory = String(matchedEntitlement.category || "");
  let bucket = null;
  if (normalizedBalanceBucketId) {
    bucket = (Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [])
      .find((row) => row && row._id && String(row._id) === normalizedBalanceBucketId) || null;
    if (!bucket) {
      throw createIntegrityError(ERROR_CODE_BALANCE_BUCKET_MISMATCH, "Owned entitlement balance bucket id was not found", {
        addonPlanId: entryPlanId,
        category: entryCategory,
        productId: normalizedProductId,
        balanceBucketId: normalizedBalanceBucketId,
      });
    }
  }
  if (!bucket) {
    bucket = findAddonBalanceBucket(subscription, {
      addonPlanId: entryPlanId,
      addonId: entryPlanId,
      category: entryCategory,
    });
  }
  if (!bucket) {
    throw createIntegrityError(ERROR_CODE_BALANCE_BUCKET_MISMATCH, "Owned entitlement balance bucket was not found", {
      addonPlanId: entryPlanId,
      category: entryCategory,
      productId: normalizedProductId,
      balanceBucketId: normalizedBalanceBucketId || null,
    });
  }
  const bucketPlanId = String(bucket.addonPlanId || bucket.addonId || "");
  const bucketCategory = normalizeSubscriptionAddonCategory(bucket.category, { allowEmpty: true }) || String(bucket.category || "");
  if (bucketPlanId !== entryPlanId || bucketCategory !== entryCategory) {
    throw createIntegrityError(ERROR_CODE_BALANCE_BUCKET_MISMATCH, "Owned entitlement balance bucket identity mismatch", {
      addonPlanId: entryPlanId,
      category: entryCategory,
      productId: normalizedProductId,
      balanceBucketId: normalizedBalanceBucketId || (bucket._id ? String(bucket._id) : null),
    });
  }

  // 7. Build result
  const entitlementKey = buildEntitlementKey(matchedEntitlement, matchedIndex);
  const unitPriceHalala = Number(
    (bucket && bucket.unitPriceHalala) ||
    matchedEntitlement.unitPriceHalala ||
    matchedEntitlement.priceHalala ||
    0
  );
  const currency = String(
    (bucket && bucket.currency) ||
    matchedEntitlement.currency ||
    "SAR"
  );
  const remainingQty = Number(bucket && bucket.remainingQty || 0);
  const includedTotalQty = Number(
    (bucket && bucket.includedTotalQty != null ? bucket.includedTotalQty : null) ??
    matchedEntitlement.includedTotalQty ??
    0
  );

  return {
    entitlement: matchedEntitlement,
    bucket,
    balanceBucketId: bucket._id,
    entitlementKey,
    entitlementIndex: matchedIndex,
    category: entryCategory,
    addonPlanId: entryPlanId,
    addonId: entryPlanId,
    productId: normalizedProductId,
    unitPriceHalala,
    currency,
    remainingQty,
    includedTotalQty,
  };
}

// ─── Checkout snapshot builder ────────────────────────────────────────────────

/**
 * buildMenuProductsSnapshot
 *
 * Called at checkout to persist immutable product metadata so the entitlement can
 * still be resolved after the live catalog record is archived or deleted.
 *
 * Products are fetched with FULL live filters here (they must be purchasable at checkout).
 */
async function buildMenuProductsSnapshot(productIds, {
  MenuProductModel = MenuProduct,
  MenuCategoryModel = MenuCategory,
  session = null,
} = {}) {
  const validIds = normalizeIdList(productIds);
  if (!validIds.length) return [];

  let query = MenuProductModel.find(
    activePublishedQuery({
      _id: { $in: validIds },
      ...availableForChannelQuery("one_time"),
    })
  );
  if (session) query = query.session(session);
  const rows = await query.lean();

  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  const usableRows = filterGloballyAvailable(rows, catalogItemsById).filter(isDailyAddonMenuProduct);
  const categoryIds = [...new Set(usableRows.map((product) => String(product.categoryId || "")).filter(Boolean))];
  let categoryQuery = categoryIds.length
    ? MenuCategoryModel.find({ _id: { $in: categoryIds } })
    : null;
  if (categoryQuery && session) categoryQuery = categoryQuery.session(session);
  const categoryRows = categoryQuery ? await categoryQuery.lean() : [];
  const categoriesById = new Map(categoryRows.map((row) => [String(row._id), row]));

  return usableRows.map((product) => ({
    id: product._id,
    key: product.key || "",
    name: product.name || "",
    nameI18n: product.nameI18n || product.name || null,
    description: product.description || "",
    descriptionI18n: product.descriptionI18n || product.description || null,
    imageUrl: product.imageUrl || "",
    category: product.category || product.itemType || "",
    categoryKey: (categoriesById.get(String(product.categoryId || "")) || {}).key || product.category || "",
    itemType: product.itemType || "",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || "SAR",
  }));
}

module.exports = {
  ERROR_CODE_ENTITLEMENT_NOT_OWNED,
  ERROR_CODE_ENTITLEMENT_PRODUCT_NOT_FOUND,
  ERROR_CODE_ENTITLEMENT_CATEGORY_MISMATCH,
  ERROR_CODE_ADDON_PLAN_MISMATCH,
  ERROR_CODE_BALANCE_BUCKET_MISMATCH,
  ERROR_CODE_SNAPSHOT_MISSING,
  loadGenericSelectableProducts,
  loadOwnedCategoryRowsForProducts,
  loadOwnedSnapshotProducts,
  resolveOwnedAddonEntitlementChoice,
  buildMenuProductsSnapshot,
  syntheticCategoryFromKey,
  isDailyAddonMenuProduct,
};
