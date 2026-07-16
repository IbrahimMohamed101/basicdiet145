const SUBSCRIPTION_ADDON_CHOICE_MAPPINGS = Object.freeze({
  juice: Object.freeze({ category: "juice", sourceCategories: Object.freeze(["juice", "juices", "drinks"]) }),
  snack: Object.freeze({ category: "snack", sourceCategories: Object.freeze(["desserts"]) }),
  small_salad: Object.freeze({
    category: "small_salad",
    sourceCategories: Object.freeze(["light_options"]),
    productKeys: Object.freeze(["green_salad", "fruit_salad", "fruit_salad_addon", "greek_yogurt", "greek_salad", "vegetable_salad"]),
    itemTypes: Object.freeze(["green_salad", "fruit_salad", "greek_yogurt"]),
  }),
});

const SUBSCRIPTION_ADDON_CATEGORIES = Object.freeze(Object.keys(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS));
const DYNAMIC_SUBSCRIPTION_ADDON_CATEGORIES = Object.freeze(["meal", "dessert", "premium_meal", "premium_large_salad"]);
const ALL_SUPPORTED_SUBSCRIPTION_ADDON_CATEGORIES = Object.freeze([
  ...SUBSCRIPTION_ADDON_CATEGORIES,
  ...DYNAMIC_SUBSCRIPTION_ADDON_CATEGORIES,
]);
const MAX_SUBSCRIPTION_ADDON_CATEGORY_LENGTH = 64;
const LEGACY_RECOVERED_ADDON_STATE = Symbol.for("basicdiet.subscription.legacyRecoveredAddonState");

function normalizeSubscriptionAddonCategory(value, { allowEmpty = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SUBSCRIPTION_ADDON_CATEGORY_LENGTH);
  if (!normalized && allowEmpty) return "";
  return normalized || null;
}

function resolveEntitlementPlanId(entitlement) {
  return String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
}

function hasModernAddonProductSnapshot(entitlement) {
  return (Array.isArray(entitlement && entitlement.menuProductIds) && entitlement.menuProductIds.length > 0)
    || (Array.isArray(entitlement && entitlement.menuProductsSnapshot) && entitlement.menuProductsSnapshot.length > 0);
}

function snapshotIdOf(snapshot) {
  return String(snapshot && (snapshot.id || snapshot._id) || "");
}

function getEntitlementMenuProductIds(entitlement) {
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

function legacyRecoveryKey(entitlement, index = 0) {
  return getAddonEntitlementKey(entitlement, index);
}

function getLegacyRecoveryState(subscription, { create = false } = {}) {
  if (!subscription) return null;
  if (subscription[LEGACY_RECOVERED_ADDON_STATE] instanceof Map) {
    return subscription[LEGACY_RECOVERED_ADDON_STATE];
  }
  if (!create) return null;
  const state = new Map();
  Object.defineProperty(subscription, LEGACY_RECOVERED_ADDON_STATE, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: state,
  });
  return state;
}

function registerLegacyRecoveredAddonProducts(subscription, entitlement, recoveredProducts = [], entitlementIndex = 0) {
  const state = getLegacyRecoveryState(subscription, { create: true });
  if (!state) return null;
  const entitlementKey = legacyRecoveryKey(entitlement, entitlementIndex);
  const existing = state.get(entitlementKey);
  const productMetadataById = new Map(
    existing && existing.productMetadataById ? existing.productMetadataById : []
  );
  for (const row of Array.isArray(recoveredProducts) ? recoveredProducts : []) {
    const productId = String(row && (row.productId || row.id || row.product && row.product._id) || "");
    if (!productId) continue;
    productMetadataById.set(productId, {
      productId,
      legacySourceProductId: row && row.legacySourceProductId
        ? String(row.legacySourceProductId)
        : null,
      product: row && row.product || null,
    });
  }
  const record = {
    entitlementKey,
    addonPlanId: resolveEntitlementPlanId(entitlement),
    category: normalizeSubscriptionAddonCategory(entitlement && entitlement.category, { allowEmpty: true }),
    productMetadataById,
  };
  state.set(record.entitlementKey, record);
  return record;
}

function getLegacyRecoveredAddonRecord(subscription, entitlement, entitlementIndex = 0) {
  const state = getLegacyRecoveryState(subscription);
  return state ? state.get(legacyRecoveryKey(entitlement, entitlementIndex)) || null : null;
}

function getLegacyRecoveredAddonProductMetadata(subscription, entitlement, productId, entitlementIndex = 0) {
  const record = getLegacyRecoveredAddonRecord(subscription, entitlement, entitlementIndex);
  return record && record.productMetadataById
    ? record.productMetadataById.get(String(productId || "")) || null
    : null;
}

function getLegacyRecoveredAddonProductMetadataBySource(subscription, entitlement, sourceProductId, entitlementIndex = 0) {
  const record = getLegacyRecoveredAddonRecord(subscription, entitlement, entitlementIndex);
  const normalizedSourceId = String(sourceProductId || "");
  if (!record || !normalizedSourceId) return null;
  for (const metadata of record.productMetadataById.values()) {
    if (String(metadata && metadata.legacySourceProductId || "") === normalizedSourceId) return metadata;
  }
  return null;
}

function getResolvedEntitlementMenuProductIds(subscription, entitlement, entitlementIndex = 0) {
  const ids = new Set(getEntitlementMenuProductIds(entitlement));
  const record = getLegacyRecoveredAddonRecord(subscription, entitlement, entitlementIndex);
  for (const id of record && record.productMetadataById ? record.productMetadataById.keys() : []) {
    ids.add(String(id));
  }
  return [...ids];
}

function buildAddonEntitlementEligibility(subscription) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : null;
  const eligibleProductIdsByCategory = new Map();

  for (const [entitlementIndex, entitlement] of (entitlements || []).entries()) {
    if (!entitlement) continue;
    const category = normalizeSubscriptionAddonCategory(entitlement.category, { allowEmpty: true });
    if (hasModernAddonProductSnapshot(entitlement)) {
      const categoryKey = category || "legacy";
      if (!eligibleProductIdsByCategory.has(categoryKey)) eligibleProductIdsByCategory.set(categoryKey, new Set());
      for (const id of getResolvedEntitlementMenuProductIds(subscription, entitlement, entitlementIndex)) {
        eligibleProductIdsByCategory.get(categoryKey).add(String(id));
      }
      continue;
    }
    if (category) {
      eligibleProductIdsByCategory.set(category, null);
    }
  }

  return {
    hasSubscriptionFilter: entitlements !== null,
    eligibleProductIdsByCategory,
  };
}

function isAddonChoiceEligibleForAllowance(eligibility, category, productId) {
  if (!eligibility || eligibility.hasSubscriptionFilter !== true) return undefined;
  const normalizedCategory = normalizeSubscriptionAddonCategory(category);
  if (!normalizedCategory) return false;
  const ids = eligibility.eligibleProductIdsByCategory.get(normalizedCategory);
  if (ids === null) return true;
  return Boolean(ids && ids.has(String(productId || "")));
}

function isAddonEntitlementEligibleForProduct(entitlement, { productId, category, addonPlanId = null } = {}) {
  if (!entitlement) return false;
  const normalizedProductId = String(productId || "");
  const normalizedCategory = normalizeSubscriptionAddonCategory(category);
  const entitlementCategory = normalizeSubscriptionAddonCategory(entitlement.category, { allowEmpty: true });
  const normalizedPlanId = String(addonPlanId || "");
  const entryPlanId = resolveEntitlementPlanId(entitlement);

  const productIds = getEntitlementMenuProductIds(entitlement);
  if (normalizedPlanId && entryPlanId !== normalizedPlanId) return false;

  // A modern immutable product snapshot is the strongest ownership proof. A
  // stale/misclassified display category must never override an exact product
  // match, and a same-category product absent from the snapshot must never be
  // admitted through the legacy fallback.
  if (normalizedProductId && productIds.length > 0) {
    return productIds.some((id) => String(id) === normalizedProductId);
  }

  if (normalizedProductId && entryPlanId === normalizedProductId) {
    return true;
  }

  if (normalizedProductId && normalizedCategory && entitlementCategory) {
    return normalizedCategory === entitlementCategory;
  }

  if (normalizedProductId) return false;
  if (normalizedPlanId && entryPlanId === normalizedPlanId) return true;

  // Category-only coverage is intentionally limited to historical
  // entitlements that have no product snapshot or other exact identity.
  return Boolean(normalizedCategory && entitlementCategory && normalizedCategory === entitlementCategory);
}

function getAddonEntitlementKey(entitlement, index = 0) {
  const category = normalizeSubscriptionAddonCategory(entitlement && entitlement.category, { allowEmpty: true }) || "legacy";
  const planId = resolveEntitlementPlanId(entitlement);
  return `${category}:${planId || index}`;
}

function hasOwnValue(source, key) {
  if (!source) return false;
  if (Object.prototype.hasOwnProperty.call(source, key)) return true;
  if (typeof source.get === "function") {
    const raw = source.get(key, null, { getters: false });
    return raw !== undefined;
  }
  return false;
}

function rawValue(source, key) {
  if (!source) return undefined;
  if (typeof source.get === "function") return source.get(key, null, { getters: false });
  return source[key];
}

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveAddonBalanceCapacity(bucket, entitlement = null) {
  if (!bucket && !entitlement) return 0;
  const purchasedQty = toNonNegativeInteger(rawValue(bucket, "purchasedQty"), 0);
  const bucketIncludedTotalQty = toNonNegativeInteger(rawValue(bucket, "includedTotalQty"), 0);
  const entitlementIncludedTotalQty = toNonNegativeInteger(entitlement && entitlement.includedTotalQty, 0);
  const includedTotalQty = Math.max(bucketIncludedTotalQty, entitlementIncludedTotalQty);
  const extraPurchasedQty = toNonNegativeInteger(rawValue(bucket, "extraPurchasedQty"), 0);
  return Math.max(purchasedQty, includedTotalQty + extraPurchasedQty, includedTotalQty);
}

function hasPositivePurchasedAddonUnits(bucket) {
  return hasOwnValue(bucket, "purchasedQty") && toNonNegativeInteger(rawValue(bucket, "purchasedQty"), 0) > 0;
}

function hasPositiveEntitlementUnits(entitlement) {
  return toNonNegativeInteger(entitlement && entitlement.includedTotalQty, 0) > 0;
}

function isRecoverableUninitializedAddonBalanceBucket(bucket, { entitlement = null } = {}) {
  if (!bucket) return false;
  const rawRemainingQty = Number(rawValue(bucket, "remainingQty") || 0);
  if (!Number.isFinite(rawRemainingQty) || rawRemainingQty !== 0) return false;
  if (!hasPositivePurchasedAddonUnits(bucket) && !hasPositiveEntitlementUnits(entitlement)) return false;
  if (resolveAddonBalanceCapacity(bucket, entitlement) <= 0) return false;
  return toNonNegativeInteger(rawValue(bucket, "consumedQty"), 0) === 0
    && toNonNegativeInteger(rawValue(bucket, "reservedQty"), 0) === 0
    && toNonNegativeInteger(rawValue(bucket, "overageConsumedQty"), 0) === 0;
}

function findAddonBalanceBucketById(subscription, balanceBucketId) {
  const normalizedId = String(balanceBucketId || "");
  if (!normalizedId) return null;
  return (Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [])
    .find((bucket) => String(bucket && rawValue(bucket, "_id") || "") === normalizedId) || null;
}

function resolveAddonEntitlementContext(subscription, {
  productId = null,
  addonPlanId = null,
  balanceBucketId = null,
  entitlementKey = null,
  category = null,
  preferPositiveRemaining = false,
  remainingQtyByEntitlement = null,
} = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  const normalizedProductId = String(productId || "");
  const normalizedPlanId = String(addonPlanId || "");
  const normalizedEntitlementKey = String(entitlementKey || "");
  const normalizedCategory = normalizeSubscriptionAddonCategory(category, { allowEmpty: true });
  const explicitBucket = findAddonBalanceBucketById(subscription, balanceBucketId);
  const explicitBucketPlanId = String(explicitBucket && (
    rawValue(explicitBucket, "addonPlanId") || rawValue(explicitBucket, "addonId")
  ) || "");

  const indexed = entitlements.map((entry, index) => ({ entry, index }));
  const exactProductMatches = normalizedProductId
    ? indexed.filter(({ entry, index }) => getResolvedEntitlementMenuProductIds(subscription, entry, index).includes(normalizedProductId))
    : [];

  let candidates = exactProductMatches;
  let matchType = exactProductMatches.length ? "menu_product_snapshot" : null;

  const filterStrongIdentity = (rows) => rows.filter(({ entry, index }) => {
    const entryPlanId = resolveEntitlementPlanId(entry);
    if (normalizedPlanId && entryPlanId !== normalizedPlanId) return false;
    if (explicitBucketPlanId && entryPlanId !== explicitBucketPlanId) return false;
    if (normalizedEntitlementKey && getAddonEntitlementKey(entry, index) !== normalizedEntitlementKey) return false;
    return true;
  });

  if (candidates.length) {
    candidates = filterStrongIdentity(candidates);
  } else if (!normalizedProductId && normalizedPlanId) {
    candidates = indexed.filter(({ entry }) => resolveEntitlementPlanId(entry) === normalizedPlanId);
    matchType = "addon_plan";
  } else if (!normalizedProductId && explicitBucketPlanId) {
    candidates = indexed.filter(({ entry }) => resolveEntitlementPlanId(entry) === explicitBucketPlanId);
    matchType = "balance_bucket";
  } else if (!normalizedProductId && normalizedEntitlementKey) {
    candidates = indexed.filter(({ entry, index }) => getAddonEntitlementKey(entry, index) === normalizedEntitlementKey);
    matchType = "entitlement_key";
  } else {
    // A product ID that is not present in any modern snapshot may only use the
    // category fallback against a genuinely legacy entitlement.
    candidates = indexed.filter(({ entry }) => (
      !hasModernAddonProductSnapshot(entry)
      && isAddonEntitlementEligibleForProduct(entry, {
        productId: normalizedProductId,
        category: normalizedCategory,
        addonPlanId: normalizedPlanId || null,
      })
    ));
    matchType = candidates.length ? "legacy_category" : null;
  }

  if (candidates.length > 1 && preferPositiveRemaining) {
    const positive = candidates.filter(({ entry, index }) => {
      const key = getAddonEntitlementKey(entry, index);
      if (remainingQtyByEntitlement instanceof Map && remainingQtyByEntitlement.has(key)) {
        return Number(remainingQtyByEntitlement.get(key) || 0) > 0;
      }
      const bucket = findAddonBalanceBucket(subscription, {
        addonPlanId: resolveEntitlementPlanId(entry),
        addonId: entry && (entry.addonId || entry.addonPlanId),
        category: entry && entry.category,
      });
      return resolveAddonBalanceRemainingQty(bucket, { entitlement: entry }) > 0;
    });
    // Product snapshots can legitimately overlap across purchased plans. Pick
    // the first positive bucket in subscription order; allocation passes its
    // simulated map so repeated selections advance to the next bucket.
    candidates = [positive[0] || candidates[0]];
  }

  if (candidates.length !== 1) return null;
  const { entry: entitlement, index: entitlementIndex } = candidates[0];
  const recoveredProductMetadata = normalizedProductId
    ? getLegacyRecoveredAddonProductMetadata(subscription, entitlement, normalizedProductId, entitlementIndex)
    : null;
  if (recoveredProductMetadata) matchType = "legacy_plan_recovered";
  const bucket = explicitBucket || findAddonBalanceBucket(subscription, {
    addonPlanId: resolveEntitlementPlanId(entitlement),
    addonId: entitlement && (entitlement.addonId || entitlement.addonPlanId),
    category: entitlement && entitlement.category,
  });
  if (explicitBucket && explicitBucketPlanId !== resolveEntitlementPlanId(entitlement)) return null;

  return {
    entitlement,
    entitlementIndex,
    entitlementKey: getAddonEntitlementKey(entitlement, entitlementIndex),
    addonPlanId: resolveEntitlementPlanId(entitlement),
    entitlementCategory: normalizeSubscriptionAddonCategory(entitlement && entitlement.category, { allowEmpty: true }),
    bucket,
    balanceBucketId: bucket && rawValue(bucket, "_id") ? String(rawValue(bucket, "_id")) : null,
    matchType,
    ownedSnapshot: matchType === "menu_product_snapshot",
    legacyRecovered: matchType === "legacy_plan_recovered",
    legacySourceProductId: recoveredProductMetadata && recoveredProductMetadata.legacySourceProductId || null,
  };
}

function resolveAddonBalanceRemainingQty(bucket, { entitlement = null } = {}) {
  if (!bucket) return 0;
  const rawRemainingQty = Math.floor(Number(rawValue(bucket, "remainingQty")));
  if (Number.isFinite(rawRemainingQty) && rawRemainingQty > 0) return rawRemainingQty;
  if (isRecoverableUninitializedAddonBalanceBucket(bucket, { entitlement })) {
    return resolveAddonBalanceCapacity(bucket, entitlement);
  }
  return 0;
}

function getEligibleAddonEntitlementsForProduct(subscription, { productId, category, addonPlanId = null } = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  return entitlements
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isAddonEntitlementEligibleForProduct(entry, { productId, category, addonPlanId }));
}

function selectAddonEntitlementForProduct(subscription, {
  productId,
  category,
  addonPlanId = null,
  preferPositiveRemaining = false,
} = {}) {
  const context = resolveAddonEntitlementContext(subscription, {
    productId,
    category,
    addonPlanId,
    preferPositiveRemaining,
  });
  return context ? context.entitlement : null;
}

function resolveAddonCategoryForMenuProduct(product, menuCategoryKey) {
  const productKey = String(product && product.key || "").trim().toLowerCase();
  const itemTypeRaw = String(product && product.itemType || "").trim().toLowerCase();
  const itemType = normalizeSubscriptionAddonCategory(itemTypeRaw);
  const sourceKey = String(menuCategoryKey || "").trim().toLowerCase();

  const smallSaladMapping = SUBSCRIPTION_ADDON_CHOICE_MAPPINGS.small_salad;
  if (smallSaladMapping.sourceCategories.includes(sourceKey)) {
    if (
      smallSaladMapping.productKeys.includes(productKey)
      || smallSaladMapping.itemTypes.includes(itemTypeRaw)
      || itemType === "small_salad"
    ) {
      return "small_salad";
    }
    return null;
  }

  // Explicit meal guard — meal must NEVER be mapped to snack.
  // A meal source key or itemType always resolves to "meal", regardless of the
  // SUBSCRIPTION_ADDON_CHOICE_MAPPINGS snack entry (which uses "desserts" as its
  // source category, not "snack").
  if (sourceKey === "meal" || sourceKey === "meals") return "meal";
  if (itemTypeRaw === "meal") return "meal";

  // Dessert — before checking snack mapping (which uses sourceKey "desserts")
  if (itemTypeRaw === "dessert") return "dessert";
  if (!productKey && !itemTypeRaw && (sourceKey === "dessert" || sourceKey === "desserts")) {
    return "dessert";
  }
  // Generic snack mapping (source: "desserts" in CHOICE_MAPPINGS)
  // Do NOT allow snack coercion for meal/dessert products.
  if (itemType && itemType !== "dessert" && itemType !== "snack") return itemType;
  for (const mapping of Object.values(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS)) {
    if (mapping.sourceCategories.includes(sourceKey)) return mapping.category;
  }
  if (itemType) return itemType;
  return null;
}

function findAddonEntitlementForChoice(subscription, category, addonId = null) {
  return selectAddonEntitlementForProduct(subscription, {
    productId: addonId,
    category,
    preferPositiveRemaining: true,
  });
}

function buildSimulatedAddonRemainingByCategory(subscription, day = {}) {
  const balances = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
  const existingSelections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];
  const simulatedRemaining = new Map();

  for (const bucket of balances) {
    const category = normalizeSubscriptionAddonCategory(bucket && bucket.category);
    if (!category) continue;
    let remainingQty = resolveAddonBalanceRemainingQty(bucket);
    for (const selection of existingSelections) {
      if (selection && selection.source === "subscription" && normalizeSubscriptionAddonCategory(selection.category) === category) {
        remainingQty += Math.max(1, Math.floor(Number(selection.qty || 1)));
      }
    }
    simulatedRemaining.set(category, (simulatedRemaining.get(category) || 0) + remainingQty);
  }
  return simulatedRemaining;
}

function buildSimulatedAddonRemainingByEntitlement(subscription, day = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const existingSelections = Array.isArray(day && day.addonSelections) ? day.addonSelections : [];
  const simulatedRemaining = new Map();

  entitlements.forEach((entitlement, index) => {
    if (!entitlement) return;
    const key = getAddonEntitlementKey(entitlement, index);
    const bucket = findAddonBalanceBucket(subscription, {
      addonPlanId: entitlement.addonPlanId || entitlement.addonId,
      addonId: entitlement.addonId || entitlement.addonPlanId,
      category: entitlement.category,
    });
    simulatedRemaining.set(key, resolveAddonBalanceRemainingQty(bucket, { entitlement }));
  });

  for (const selection of existingSelections) {
    if (!selection || selection.source !== "subscription") continue;
    const context = resolveAddonEntitlementContext(subscription, {
      productId: selection.productId || selection.menuProductId || selection.addonId,
      category: selection.category,
      addonPlanId: selection.addonPlanId,
      balanceBucketId: selection.balanceBucketId,
      entitlementKey: selection.entitlementKey,
    });
    if (!context) continue;
    const key = context.entitlementKey;
    simulatedRemaining.set(key, (simulatedRemaining.get(key) || 0) + Math.max(1, Math.floor(Number(selection.qty || 1))));
  }
  return simulatedRemaining;
}

function findAddonBalanceBucket(subscription, {
  addonId = null,
  addonPlanId = null,
  entitlementKey = null,
  balanceBucketId = null,
  displayKey = null,
  category = null,
  unitPriceHalala = null,
  requirePositiveRemaining = false,
} = {}) {
  const balances = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
  const normalizedCategory = category == null ? null : normalizeSubscriptionAddonCategory(category);
  const normalizedPlanId = String(addonPlanId || "");
  const normalizedAddonId = String(addonId || "");
  const normalizedEntitlementKey = String(entitlementKey || "").trim();
  const normalizedBucketId = String(balanceBucketId || "");
  const normalizedDisplayKey = normalizeSubscriptionAddonCategory(displayKey, { allowEmpty: true });
  const eligible = balances.filter((bucket) => (
    bucket && (!requirePositiveRemaining || resolveAddonBalanceRemainingQty(bucket) > 0)
  ));
  const uniqueMatch = (predicate) => {
    const matches = eligible.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  };

  if (normalizedPlanId) {
    const exactPlan = uniqueMatch((bucket) => {
      const bucketPlanId = String(rawValue(bucket, "addonPlanId") || rawValue(bucket, "addonId") || "");
      return bucketPlanId === normalizedPlanId;
    });
    if (exactPlan) return exactPlan;
  }

  if (normalizedPlanId || normalizedEntitlementKey) {
    const planToken = normalizedPlanId || normalizedEntitlementKey;
    const byEntitlementKey = uniqueMatch((bucket) => {
      const bucketKey = String(rawValue(bucket, "entitlementKey") || "").trim();
      return bucketKey && (
        (normalizedEntitlementKey && bucketKey === normalizedEntitlementKey)
        || (normalizedPlanId && bucketKey.includes(normalizedPlanId))
        || (!normalizedPlanId && bucketKey.includes(planToken))
      );
    });
    if (byEntitlementKey) return byEntitlementKey;
  }

  if (normalizedBucketId) {
    const byBucketId = uniqueMatch((bucket) => String(
      rawValue(bucket, "_id") || rawValue(bucket, "balanceBucketId") || ""
    ) === normalizedBucketId);
    if (byBucketId) return byBucketId;
  }

  if (normalizedAddonId) {
    const byAddonId = uniqueMatch((bucket) => {
      const bucketAddonId = String(rawValue(bucket, "addonId") || rawValue(bucket, "addonPlanId") || "");
      return bucketAddonId === normalizedAddonId;
    });
    if (byAddonId) return byAddonId;
  }

  if (normalizedDisplayKey) {
    const byDisplayKey = uniqueMatch((bucket) => normalizeSubscriptionAddonCategory(
      rawValue(bucket, "displayKey") || rawValue(bucket, "displayCategory"),
      { allowEmpty: true }
    ) === normalizedDisplayKey);
    if (byDisplayKey) return byDisplayKey;
  }

  const byCategory = uniqueMatch((bucket) => {
    if (!bucket) return false;
    const bucketCategory = normalizeSubscriptionAddonCategory(rawValue(bucket, "category"), { allowEmpty: true });
    if (unitPriceHalala !== null && Number(rawValue(bucket, "unitPriceHalala") || 0) !== Number(unitPriceHalala || 0)) return false;
    return Boolean(normalizedCategory && bucketCategory === normalizedCategory);
  });
  return byCategory || null;
}

module.exports = {
  ALL_SUPPORTED_SUBSCRIPTION_ADDON_CATEGORIES,
  SUBSCRIPTION_ADDON_CATEGORIES,
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
  buildAddonEntitlementEligibility,
  buildSimulatedAddonRemainingByEntitlement,
  buildSimulatedAddonRemainingByCategory,
  findAddonBalanceBucket,
  findAddonEntitlementForChoice,
  getAddonEntitlementKey,
  getEntitlementMenuProductIds,
  getLegacyRecoveredAddonProductMetadata,
  getLegacyRecoveredAddonProductMetadataBySource,
  getResolvedEntitlementMenuProductIds,
  getEligibleAddonEntitlementsForProduct,
  hasModernAddonProductSnapshot,
  isAddonEntitlementEligibleForProduct,
  isAddonChoiceEligibleForAllowance,
  isRecoverableUninitializedAddonBalanceBucket,
  normalizeSubscriptionAddonCategory,
  registerLegacyRecoveredAddonProducts,
  resolveAddonBalanceRemainingQty,
  resolveAddonEntitlementContext,
  resolveEntitlementPlanId,
  resolveAddonCategoryForMenuProduct,
  resolveAddonBalanceCapacity,
  selectAddonEntitlementForProduct,
};
