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

function buildAddonEntitlementEligibility(subscription) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : null;
  const eligibleProductIdsByCategory = new Map();

  for (const entitlement of entitlements || []) {
    if (!entitlement) continue;
    const category = normalizeSubscriptionAddonCategory(entitlement.category, { allowEmpty: true });
    if (hasModernAddonProductSnapshot(entitlement)) {
      const categoryKey = category || "legacy";
      if (!eligibleProductIdsByCategory.has(categoryKey)) eligibleProductIdsByCategory.set(categoryKey, new Set());
      for (const id of getEntitlementMenuProductIds(entitlement)) {
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

  if (normalizedPlanId && entryPlanId !== normalizedPlanId) return false;
  if (normalizedCategory && entitlementCategory && normalizedCategory !== entitlementCategory) return false;

  const productIds = getEntitlementMenuProductIds(entitlement);
  if (normalizedProductId && productIds.length > 0) {
    return productIds.some((id) => String(id) === normalizedProductId);
  }

  if (normalizedProductId && normalizedCategory && entitlementCategory) {
    return normalizedCategory === entitlementCategory;
  }

  if (normalizedProductId) {
    return Boolean(entryPlanId && entryPlanId === normalizedProductId);
  }

  return Boolean(normalizedPlanId && entryPlanId === normalizedPlanId);
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
  if (!hasOwnValue(bucket, "remainingQty")) return false;
  const rawRemainingQty = Number(rawValue(bucket, "remainingQty") || 0);
  if (!Number.isFinite(rawRemainingQty) || rawRemainingQty !== 0) return false;
  if (!hasPositivePurchasedAddonUnits(bucket) && !hasPositiveEntitlementUnits(entitlement)) return false;
  if (resolveAddonBalanceCapacity(bucket, entitlement) <= 0) return false;
  return toNonNegativeInteger(rawValue(bucket, "consumedQty"), 0) === 0
    && toNonNegativeInteger(rawValue(bucket, "reservedQty"), 0) === 0
    && toNonNegativeInteger(rawValue(bucket, "overageConsumedQty"), 0) === 0;
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
  const matches = getEligibleAddonEntitlementsForProduct(subscription, { productId, category, addonPlanId });
  if (!matches.length) return null;
  if (!addonPlanId && matches.length > 1) return null;

  if (preferPositiveRemaining) {
    const positive = matches.find(({ entry }) => {
      const bucket = findAddonBalanceBucket(subscription, {
        addonPlanId: entry && (entry.addonPlanId || entry.addonId),
        addonId: entry && (entry.addonId || entry.addonPlanId),
        category: entry && entry.category,
      });
      return resolveAddonBalanceRemainingQty(bucket, { entitlement: entry }) > 0;
    });
    if (positive) return positive.entry;
  }
  return matches[0].entry;
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
    const match = getEligibleAddonEntitlementsForProduct(subscription, {
      productId: selection.addonId,
      category: selection.category,
      addonPlanId: selection.addonPlanId,
    })[0];
    if (!match) continue;
    const key = getAddonEntitlementKey(match.entry, match.index);
    simulatedRemaining.set(key, (simulatedRemaining.get(key) || 0) + Math.max(1, Math.floor(Number(selection.qty || 1))));
  }
  return simulatedRemaining;
}

function findAddonBalanceBucket(subscription, {
  addonId = null,
  addonPlanId = null,
  category = null,
  unitPriceHalala = null,
  requirePositiveRemaining = false,
} = {}) {
  const balances = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
  const normalizedCategory = category == null ? null : normalizeSubscriptionAddonCategory(category);
  const normalizedPlanId = String(addonPlanId || "");
  const normalizedAddonId = String(addonId || "");

  return balances.find((bucket) => {
    if (!bucket) return false;
    if (requirePositiveRemaining && resolveAddonBalanceRemainingQty(bucket) <= 0) return false;

    const bucketCategory = normalizeSubscriptionAddonCategory(rawValue(bucket, "category"), { allowEmpty: true });
    const bucketPlanId = String(rawValue(bucket, "addonPlanId") || rawValue(bucket, "addonId") || "");
    const bucketAddonId = String(rawValue(bucket, "addonId") || "");

    if (normalizedCategory && bucketCategory !== normalizedCategory) return false;
    if (normalizedPlanId) {
      if (bucketPlanId !== normalizedPlanId) return false;
    } else if (normalizedAddonId && bucketAddonId !== normalizedAddonId && bucketPlanId !== normalizedAddonId) {
      return false;
    }
    if (unitPriceHalala !== null && Number(rawValue(bucket, "unitPriceHalala") || 0) !== Number(unitPriceHalala || 0)) return false;
    return Boolean(normalizedCategory || normalizedPlanId || normalizedAddonId || unitPriceHalala !== null);
  }) || null;
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
  getEligibleAddonEntitlementsForProduct,
  hasModernAddonProductSnapshot,
  isAddonEntitlementEligibleForProduct,
  isAddonChoiceEligibleForAllowance,
  isRecoverableUninitializedAddonBalanceBucket,
  normalizeSubscriptionAddonCategory,
  resolveAddonBalanceRemainingQty,
  resolveEntitlementPlanId,
  resolveAddonCategoryForMenuProduct,
  resolveAddonBalanceCapacity,
  selectAddonEntitlementForProduct,
};
