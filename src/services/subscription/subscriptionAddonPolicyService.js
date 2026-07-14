const SUBSCRIPTION_ADDON_CHOICE_MAPPINGS = Object.freeze({
  juice: Object.freeze({
    category: "juice",
    sourceCategories: Object.freeze(["juices", "drinks"]),
  }),
  snack: Object.freeze({
    category: "snack",
    sourceCategories: Object.freeze(["desserts"]),
  }),
  small_salad: Object.freeze({
    category: "small_salad",
    sourceCategories: Object.freeze(["light_options"]),
    productKeys: Object.freeze(["green_salad", "small_salad", "fruit_salad", "greek_salad", "vegetable_salad", "fruit_salad_addon"]),
  }),
});

const SUBSCRIPTION_ADDON_CATEGORIES = Object.freeze(
  Object.keys(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS)
);

function buildAddonEntitlementEligibility(subscription) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : null;
  const legacyEligibleCategories = new Set();
  const eligibleProductIds = new Set();

  for (const entitlement of entitlements || []) {
    if (!entitlement) continue;
    if (hasModernAddonProductSnapshot(entitlement)) {
      entitlement.menuProductIds.forEach((id) => eligibleProductIds.add(String(id)));
    } else if (entitlement.category) {
      legacyEligibleCategories.add(String(entitlement.category));
    }
  }

  return {
    hasSubscriptionFilter: entitlements !== null,
    legacyEligibleCategories,
    eligibleProductIds,
  };
}

function isAddonChoiceEligibleForAllowance(eligibility, category, productId) {
  if (!eligibility || eligibility.hasSubscriptionFilter !== true) return undefined;
  return eligibility.eligibleProductIds.has(String(productId || ""))
    || eligibility.legacyEligibleCategories.has(String(category || ""));
}

function resolveEntitlementPlanId(entitlement) {
  return String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
}

function hasModernAddonProductSnapshot(entitlement) {
  return Array.isArray(entitlement && entitlement.menuProductIds)
    && entitlement.menuProductIds.length > 0;
}

function isAddonEntitlementEligibleForProduct(entitlement, {
  productId,
  category,
  addonPlanId = null,
} = {}) {
  if (!entitlement) return false;
  const normalizedProductId = String(productId || "");
  const normalizedCategory = String(category || "");
  const normalizedPlanId = String(addonPlanId || "");
  const entryPlanId = resolveEntitlementPlanId(entitlement);

  if (normalizedPlanId && entryPlanId !== normalizedPlanId) return false;

  if (hasModernAddonProductSnapshot(entitlement)) {
    return entitlement.menuProductIds.some((id) => String(id) === normalizedProductId);
  }

  if (normalizedCategory && String(entitlement.category || "") === normalizedCategory) return true;
  if (normalizedProductId && String(entitlement.addonId || entitlement.addonPlanId || "") === normalizedProductId) return true;
  return false;
}

function getAddonEntitlementKey(entitlement, index = 0) {
  const category = String(entitlement && entitlement.category || "legacy");
  const planId = resolveEntitlementPlanId(entitlement);
  return `${category}:${planId || index}`;
}

function getEligibleAddonEntitlementsForProduct(subscription, {
  productId,
  category,
  addonPlanId = null,
} = {}) {
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
    const positive = matches.find(({ entry }) => {
      const bucket = findAddonBalanceBucket(subscription, {
        addonPlanId: entry && (entry.addonPlanId || entry.addonId),
        addonId: entry && (entry.addonId || entry.addonPlanId),
        category: entry && entry.category,
        requirePositiveRemaining: true,
      });
      return Boolean(bucket);
    });
    if (positive) return positive.entry;
  }

  return matches[0].entry;
}

function resolveAddonCategoryForMenuProduct(product, menuCategoryKey) {
  for (const mapping of Object.values(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS)) {
    if (!mapping.sourceCategories.includes(menuCategoryKey)) continue;
    if (
      Array.isArray(mapping.productKeys)
      && mapping.productKeys.length > 0
      && !mapping.productKeys.includes(product && product.key)
    ) {
      continue;
    }
    return mapping.category;
  }
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
  const balances = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance
    : [];
  const existingSelections = Array.isArray(day && day.addonSelections)
    ? day.addonSelections
    : [];
  const simulatedRemaining = new Map();

  for (const bucket of balances) {
    if (!bucket || !bucket.category) continue;
    const category = bucket.category;
    // remainingQty is already net of consumed/reserved units. Editing restores
    // this day's existing claims in-memory without mutating the subscription.
    let remainingQty = Number(bucket.remainingQty || 0);

    for (const selection of existingSelections) {
      if (selection.source === "subscription" && selection.category === category) {
        remainingQty += 1;
      }
    }

    simulatedRemaining.set(
      category,
      (simulatedRemaining.get(category) || 0) + remainingQty
    );
  }

  return simulatedRemaining;
}

function buildSimulatedAddonRemainingByEntitlement(subscription, day = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  const existingSelections = Array.isArray(day && day.addonSelections)
    ? day.addonSelections
    : [];
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
    simulatedRemaining.set(key, (simulatedRemaining.get(key) || 0) + 1);
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
  const balances = Array.isArray(subscription && subscription.addonBalance)
    ? subscription.addonBalance
    : [];
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];

  return balances.find((bucket) => {
    if (!bucket) return false;
    if (requirePositiveRemaining && Number(bucket.remainingQty || 0) <= 0) return false;
    if (addonPlanId && String(bucket.addonPlanId || bucket.addonId || "") === String(addonPlanId)) return true;
    if (addonId && String(bucket.addonId || "") === String(addonId)) return true;
    if (category && bucket.category === category) return true;
    if (category) {
      return entitlements.some((entry) => {
        const entryPlanId = String(entry.addonPlanId || entry.addonId || "");
        const bucketPlanId = String(bucket.addonPlanId || bucket.addonId || "");
        return entry.category === category && entryPlanId && entryPlanId === bucketPlanId;
      });
    }
    if (unitPriceHalala !== null && Number(bucket.unitPriceHalala || 0) === Number(unitPriceHalala || 0)) return true;
    return false;
  }) || null;
}

module.exports = {
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
  resolveAddonCategoryForMenuProduct,
  resolveEntitlementPlanId,
  selectAddonEntitlementForProduct,
};
