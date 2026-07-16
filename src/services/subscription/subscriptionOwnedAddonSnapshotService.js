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
  getLegacyRecoveredAddonProductMetadata,
  getLegacyRecoveredAddonProductMetadataBySource,
  normalizeSubscriptionAddonCategory,
  registerLegacyRecoveredAddonProducts,
  resolveAddonBalanceRemainingQty,
  resolveAddonEntitlementContext,
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

function materializeProductFromSnapshot(snapshot, liveProduct = null, catalogItemsById = new Map()) {
  const liveCatalogMissing = !liveProduct;
  const catalogActive = Boolean(liveProduct) && liveProduct.isActive !== false;
  const catalogAvailable = Boolean(liveProduct)
    && isLinkedDocGloballyAvailable(liveProduct, catalogItemsById);
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
    availableForNewSale: false,
    _isOwnedSnapshot: true,
    _catalogActive: catalogActive,
    _catalogAvailable: catalogAvailable,
    _liveCatalogMissing: liveCatalogMissing,
  };
}

function materializeUnavailableOwnedProduct(productId, entitlement) {
  const entitlementCategory = normalizeSubscriptionAddonCategory(
    entitlement && entitlement.category,
    { allowEmpty: true }
  ) || String(entitlement && entitlement.category || "legacy");
  const unitPriceHalala = Number(
    entitlement && (
      entitlement.unitPriceHalala
      ?? entitlement.unitPlanPriceHalala
      ?? entitlement.priceHalala
    ) || 0
  );
  return {
    _id: productId,
    key: "",
    name: { en: "Unavailable add-on", ar: "إضافة غير متاحة" },
    nameI18n: { en: "Unavailable add-on", ar: "إضافة غير متاحة" },
    description: "",
    descriptionI18n: { en: "", ar: "" },
    imageUrl: "",
    categoryId: null,
    category: entitlementCategory,
    categoryKey: entitlementCategory,
    itemType: entitlementCategory,
    priceHalala: Number.isInteger(unitPriceHalala) && unitPriceHalala >= 0 ? unitPriceHalala : 0,
    currency: entitlement && entitlement.currency || "SAR",
    isActive: false,
    isAvailable: false,
    isVisible: false,
    availableForNewSale: false,
    _isOwnedSnapshot: false,
    _snapshotMissing: true,
    _liveCatalogMissing: true,
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
async function loadGenericSelectableProducts(productIds, { MenuProductModel = MenuProduct, session = null } = {}) {
  const validIds = normalizeIdList(productIds);
  if (!validIds.length) return [];

  let query = MenuProductModel.find(
    activePublishedQuery({
      _id: { $in: validIds },
      ...availableForChannelQuery("one_time"),
    })
  );
  if (session && typeof query.session === "function") query = query.session(session);
  const rows = await query.lean();

  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  const byId = new Map(
    filterGloballyAvailable(rows, catalogItemsById)
      .filter(isDailyAddonMenuProduct)
      .map((row) => [String(row._id), row])
  );

  return validIds.map((id) => byId.get(id)).filter(Boolean);
}

async function recoverMissingOwnedProductsFromCurrentPlan(results, entitlement, {
  subscription = null,
  entitlementIndex = 0,
  AddonModel = mongoose.models.Addon,
  MenuProductModel = MenuProduct,
  session = null,
} = {}) {
  if (!subscription || !AddonModel) return results;
  let resolvedResults = Array.isArray(results) ? results : [];
  let missingRows = resolvedResults.filter((row) => row && row.snapshotMissing === true);
  if (!missingRows.length) {
    return resolvedResults.map((row) => {
      const metadata = getLegacyRecoveredAddonProductMetadata(
        subscription,
        entitlement,
        row && row.product && row.product._id,
        entitlementIndex
      );
      return metadata ? {
        ...row,
        snapshotMissing: true,
        liveCatalogMissing: false,
        legacyRecovered: true,
        legacySourceProductId: metadata.legacySourceProductId,
      } : row;
    });
  }

  resolvedResults = resolvedResults.map((row) => {
    if (!row || row.snapshotMissing !== true) return row;
    const metadata = getLegacyRecoveredAddonProductMetadataBySource(
      subscription,
      entitlement,
      row.id || row.product && row.product._id,
      entitlementIndex
    );
    if (!metadata || !metadata.product) return row;
    return {
      product: metadata.product,
      fromSnapshot: false,
      snapshotMissing: true,
      liveCatalogMissing: false,
      legacyRecovered: true,
      legacySourceProductId: metadata.legacySourceProductId,
      id: metadata.productId,
    };
  });
  missingRows = resolvedResults.filter((row) => row && row.snapshotMissing === true && row.legacyRecovered !== true);
  if (!missingRows.length) return resolvedResults;

  const addonPlanId = String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
  const entitlementCategory = normalizeSubscriptionAddonCategory(
    entitlement && entitlement.category,
    { allowEmpty: true }
  );
  if (!mongoose.Types.ObjectId.isValid(addonPlanId) || !entitlementCategory) return resolvedResults;

  let planQuery = AddonModel.findOne({ _id: addonPlanId, kind: "plan" });
  if (session && planQuery && typeof planQuery.session === "function") planQuery = planQuery.session(session);
  const plan = planQuery && typeof planQuery.lean === "function" ? await planQuery.lean() : await planQuery;
  if (!plan) return resolvedResults;
  const planCategory = normalizeSubscriptionAddonCategory(plan.category, { allowEmpty: true });
  if (!planCategory || planCategory !== entitlementCategory) return resolvedResults;

  const currentPlanProductIds = normalizeIdList(plan.menuProductIds);
  if (!currentPlanProductIds.length) return resolvedResults;
  const currentProducts = await loadGenericSelectableProducts(currentPlanProductIds, {
    MenuProductModel,
    session,
  });
  if (!currentProducts.length) return resolvedResults;

  const alreadyResolvedIds = new Set(
    resolvedResults
      .filter((row) => row && row.product && (row.snapshotMissing !== true || row.legacyRecovered === true))
      .map((row) => String(row.product._id || ""))
      .filter(Boolean)
  );
  const candidates = currentProducts.filter((product) => !alreadyResolvedIds.has(String(product && product._id || "")));
  const recoveredCount = Math.min(missingRows.length, candidates.length);
  if (recoveredCount <= 0) return resolvedResults;

  const recoveredRows = candidates.slice(0, recoveredCount).map((product, index) => ({
    product,
    fromSnapshot: false,
    snapshotMissing: true,
    liveCatalogMissing: false,
    legacyRecovered: true,
    legacySourceProductId: String(missingRows[index].id || missingRows[index].product && missingRows[index].product._id || "") || null,
    id: String(product._id),
  }));
  registerLegacyRecoveredAddonProducts(subscription, entitlement, recoveredRows, entitlementIndex);

  let recoveredIndex = 0;
  return resolvedResults.map((row) => {
    if (!row || row.snapshotMissing !== true || row.legacyRecovered === true || recoveredIndex >= recoveredRows.length) return row;
    const recovered = recoveredRows[recoveredIndex];
    recoveredIndex += 1;
    return recovered;
  });
}

async function ensureLegacyRecoveredAddonEntitlements(subscription, {
  AddonModel = mongoose.models.Addon,
  MenuProductModel = MenuProduct,
  session = null,
} = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  for (const [entitlementIndex, entitlement] of entitlements.entries()) {
    const productIds = entitlementProductIds(entitlement);
    if (!productIds.length) continue;
    await loadOwnedSnapshotProducts(productIds, entitlement, {
      AddonModel,
      MenuProductModel,
      entitlementIndex,
      session,
      subscription,
    });
  }
  return subscription;
}

// ─── Owned snapshot product loader (OWNED ENTITLEMENT USAGE) ─────────────────

/**
 * Loads products by ID with NO live availability filters.
 * Use this exclusively for resolving owned entitlement snapshots.
 *
 * For each requested product ID:
 *  1. Uses the immutable `menuProductsSnapshot` stored in the entitlement.
 *  2. Falls back to the live/archived MenuProduct document (without live availability filters).
 *  3. If neither is available, returns an unavailable owned placeholder.
 *
 * Returns an array of { product, fromSnapshot } objects in the same order as productIds,
 * Historical missing rows are never allowed to abort an entire owned catalog.
 */
async function loadOwnedSnapshotProducts(productIds, entitlement, {
  AddonModel = mongoose.models.Addon,
  MenuProductModel = MenuProduct,
  entitlementIndex = 0,
  onMissingProduct = null,
  session = null,
  subscription = null,
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

  let rows = [];
  if (validIds.length) {
    // Live rows are loaded for status metadata only. Snapshot content remains
    // authoritative for owned selections and is never filtered by these flags.
    let query = MenuProductModel.find({ _id: { $in: validIds } });
    if (session && typeof query.session === "function") query = query.session(session);
    rows = await query.lean();
  }
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);

  const results = [];
  const entitlementKey = buildEntitlementKey(entitlement);

  for (const id of validIds) {
    const snap = snapshotById.get(id);
    if (snap) {
      const liveProduct = byId.get(id) || null;
      results.push({
        product: materializeProductFromSnapshot(snap, liveProduct, catalogItemsById),
        fromSnapshot: true,
        liveCatalogMissing: !liveProduct,
        id,
      });
      continue;
    }

    const dbProduct = byId.get(id);
    if (dbProduct) {
      results.push({ product: dbProduct, fromSnapshot: false, id });
      continue;
    }

    // Neither DB nor snapshot. Exact menuProductIds membership still proves
    // ownership, so preserve that identity as an unavailable placeholder. This
    // is non-fatal for historical subscriptions created before snapshots were
    // persisted and must never be reclassified as a generic paid extra.
    const warning = createSnapshotIntegrityError(id, entitlementKey);
    if (typeof onMissingProduct === "function") {
      onMissingProduct(warning);
    }
    results.push({
      product: materializeUnavailableOwnedProduct(id, entitlement),
      fromSnapshot: false,
      snapshotMissing: true,
      liveCatalogMissing: true,
      warning,
      id,
    });
  }

  return recoverMissingOwnedProductsFromCurrentPlan(results, entitlement, {
    subscription,
    entitlementIndex,
    AddonModel,
    MenuProductModel,
    session,
  });
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
 * Product catalog availability is resolved separately; ownership resolution
 * never fails merely because a historical product row/snapshot is missing.
 */
async function resolveOwnedAddonEntitlementChoice({
  subscription,
  productId,
  addonPlanId = null,
  category = null,
  balanceBucketId = null,
  entitlementKey = null,
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
  const normalizedEntitlementKey = String(entitlementKey || "").trim();
  const normalizedCategory = category
    ? normalizeSubscriptionAddonCategory(String(category).trim()) || String(category).trim()
    : null;

  const entitlements = Array.isArray(subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];

  if (normalizedBalanceBucketId && !(Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [])
    .some((row) => row && row._id && String(row._id) === normalizedBalanceBucketId)) {
    throw createIntegrityError(ERROR_CODE_BALANCE_BUCKET_MISMATCH, "Owned entitlement balance bucket id was not found", {
      addonPlanId: normalizedAddonPlanId || null,
      category: normalizedCategory,
      productId: normalizedProductId,
      balanceBucketId: normalizedBalanceBucketId,
    });
  }

  await ensureLegacyRecoveredAddonEntitlements(subscription, { session });

  // 3. Search addonSubscriptions for a matching entitlement.
  // Category is only an isolation check. It is never sufficient to prove coverage.
  const authoritativeContext = resolveAddonEntitlementContext(subscription, {
    productId: normalizedProductId,
    addonPlanId: normalizedAddonPlanId,
    balanceBucketId: normalizedBalanceBucketId,
    entitlementKey: normalizedEntitlementKey,
    category: normalizedCategory,
    preferPositiveRemaining: true,
  });
  const matchedEntitlement = authoritativeContext && authoritativeContext.entitlement || null;
  const matchedIndex = authoritativeContext ? authoritativeContext.entitlementIndex : -1;
  let sawPlanMismatch = false;
  let sawCategoryMismatch = false;
  let sawProductMismatch = false;
  let diagnosticMatchCount = 0;
  const hasExplicitIdentity = Boolean(normalizedAddonPlanId || normalizedBalanceBucketId || normalizedEntitlementKey);

  // This loop diagnoses why the authoritative resolver rejected the request;
  // it must never select a different entitlement on its own.
  for (let i = 0; !matchedEntitlement && i < entitlements.length; i++) {
    const entry = entitlements[i];
    if (!entry) continue;

    const entryPlanId = String(entry.addonPlanId || entry.addonId || "");
    const entryCategory = normalizeSubscriptionAddonCategory(entry.category) || String(entry.category || "");

    // 4. Match criteria
    if (normalizedAddonPlanId && entryPlanId !== normalizedAddonPlanId) {
      sawPlanMismatch = true;
      continue;
    }
    const productIds = entitlementProductIds(entry);
    let hasExactProductSnapshotMatch = false;
    if (normalizedProductId) {
      if (productIds.length > 0) {
        if (!productIds.includes(normalizedProductId)) {
          sawProductMismatch = true;
          continue;
        }
        hasExactProductSnapshotMatch = true;
      } else if (entryPlanId !== normalizedProductId && (!normalizedAddonPlanId || entryPlanId !== normalizedAddonPlanId)) {
        if (!normalizedCategory || entryCategory !== normalizedCategory) {
          sawProductMismatch = true;
          continue;
        }
      }
    } else if (!hasExplicitIdentity) {
      continue;
    }
    if (normalizedCategory && entryCategory !== normalizedCategory && !hasExactProductSnapshotMatch) {
      sawCategoryMismatch = true;
      continue;
    }
    if (normalizedEntitlementKey && buildEntitlementKey(entry, i) !== normalizedEntitlementKey) continue;

    diagnosticMatchCount += 1;
  }

  if (!matchedEntitlement) {
    if (diagnosticMatchCount > 1) {
      const err = new Error(
        "Ambiguous owned entitlement: multiple buckets match the add-on product. Supply exact entitlement identity."
      );
      err.status = 409;
      err.code = "ENTITLEMENT_AMBIGUOUS";
      throw err;
    }
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
  if (bucketPlanId !== entryPlanId) {
    throw createIntegrityError(ERROR_CODE_BALANCE_BUCKET_MISMATCH, "Owned entitlement balance bucket identity mismatch", {
      addonPlanId: entryPlanId,
      category: entryCategory,
      productId: normalizedProductId,
      balanceBucketId: normalizedBalanceBucketId || (bucket._id ? String(bucket._id) : null),
    });
  }

  // 7. Build result
  const resolvedEntitlementKey = buildEntitlementKey(matchedEntitlement, matchedIndex);
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
  const remainingQty = resolveAddonBalanceRemainingQty(bucket, { entitlement: matchedEntitlement });
  const includedTotalQty = Math.max(
    Number(bucket && bucket.includedTotalQty || 0),
    Number(matchedEntitlement.includedTotalQty || 0)
  );

  return {
    entitlement: matchedEntitlement,
    bucket,
    balanceBucketId: bucket._id,
    entitlementKey: resolvedEntitlementKey,
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
  ensureLegacyRecoveredAddonEntitlements,
  materializeUnavailableOwnedProduct,
  resolveOwnedAddonEntitlementChoice,
  buildMenuProductsSnapshot,
  syntheticCategoryFromKey,
  isDailyAddonMenuProduct,
};
