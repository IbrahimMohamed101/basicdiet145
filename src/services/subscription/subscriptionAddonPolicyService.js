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
  return Array.isArray(entitlement && entitlement.menuProductIds) && entitlement.menuProductIds.length > 0;
}

function buildAddonEntitlementEligibility(subscription) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : null;
  const legacyEligibleCategories = new Set();
  const eligibleProductIdsByCategory = new Map();

  for (const entitlement of entitlements || []) {
    if (!entitlement) continue;
    const category = normalizeSubscriptionAddonCategory(entitlement.category, { allowEmpty: true });
    if (hasModernAddonProductSnapshot(entitlement)) {
      const categoryKey = category || "legacy";
      if (!eligibleProductIdsByCategory.has(categoryKey)) eligibleProductIdsByCategory.set(categoryKey, new Set());
      for (const id of entitlement.menuProductIds) {
        eligibleProductIdsByCategory.get(categoryKey).add(String(id));
      }
      continue;
    }
    if (category) legacyEligibleCategories.add(category);
  }

  return {
    hasSubscriptionFilter: entitlements !== null,
    legacyEligibleCategories,
    eligibleProductIdsByCategory,
  };
}

function isAddonChoiceEligibleForAllowance(eligibility, category, productId) {
  if (!eligibility || eligibility.hasSubscriptionFilter !== true) return undefined;
  const normalizedCategory = normalizeSubscriptionAddonCategory(category);
  if (!normalizedCategory) return false;
  const ids = eligibility.eligibleProductIdsByCategory.get(normalizedCategory);
  return Boolean(ids && ids.has(String(productId || "")))
    || eligibility.legacyEligibleCategories.has(normalizedCategory);
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

  if (hasModernAddonProductSnapshot(entitlement)) {
    return entitlement.menuProductIds.some((id) => String(id) === normalizedProductId);
  }
  if (normalizedCategory && entitlementCategory === normalizedCategory) return true;
  if (normalizedProductId && String(entitlement.addonId || entitlement.addonPlanId || "") === normalizedProductId) return true;
  return false;
}

function getAddonEntitlementKey(entitlement, index = 0) {
  const category = normalizeSubscriptionAddonCategory(entitlement && entitlement.category, { allowEmpty: true }) || "legacy";
  const planId = resolveEntitlementPlanId(entitlement);
  return `${category}:${planId || index}`;
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

  if (preferPositiveRemaining) {
    const positive = matches.find(({ entry }) => Boolean(findAddonBalanceBucket(subscription, {
      addonPlanId: entry && (entry.addonPlanId || entry.addonId),
      addonId: entry && (entry.addonId || entry.addonPlanId),
      category: entry && entry.category,
      requirePositiveRemaining: true,
    })));
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
    let remainingQty = Number(bucket.remainingQty || 0);
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
    simulatedRemaining.set(key, Number(bucket && bucket.remainingQty || 0));
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
    if (requirePositiveRemaining && Number(bucket.remainingQty || 0) <= 0) return false;

    const bucketCategory = normalizeSubscriptionAddonCategory(bucket.category, { allowEmpty: true });
    const bucketPlanId = String(bucket.addonPlanId || bucket.addonId || "");
    const bucketAddonId = String(bucket.addonId || "");

    if (normalizedCategory && bucketCategory !== normalizedCategory) return false;
    if (normalizedPlanId) {
      if (bucketPlanId !== normalizedPlanId) return false;
    } else if (normalizedAddonId && bucketAddonId !== normalizedAddonId && bucketPlanId !== normalizedAddonId) {
      return false;
    }
    if (unitPriceHalala !== null && Number(bucket.unitPriceHalala || 0) !== Number(unitPriceHalala || 0)) return false;
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
  normalizeSubscriptionAddonCategory,
  resolveAddonCategoryForMenuProduct,
  resolveEntitlementPlanId,
  selectAddonEntitlementForProduct,
};
