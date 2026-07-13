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
  const entitledCategories = new Set();
  const legacyEligibleProductIds = new Set();

  for (const entitlement of entitlements || []) {
    if (entitlement && entitlement.category) {
      entitledCategories.add(String(entitlement.category));
    } else if (entitlement && Array.isArray(entitlement.menuProductIds)) {
      entitlement.menuProductIds.forEach((id) => legacyEligibleProductIds.add(String(id)));
    }
  }

  return {
    hasSubscriptionFilter: entitlements !== null,
    entitledCategories,
    legacyEligibleProductIds,
  };
}

function isAddonChoiceEligibleForAllowance(eligibility, category, productId) {
  if (!eligibility || eligibility.hasSubscriptionFilter !== true) return undefined;
  return eligibility.entitledCategories.has(String(category || ""))
    || eligibility.legacyEligibleProductIds.has(String(productId || ""));
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
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  return entitlements.find((entry) => {
    if (!entry) return false;
    // Modern entitlements grant credits by canonical category. menuProductIds
    // remains a catalog snapshot and is only authoritative for legacy rows
    // that do not contain a category.
    if (category && entry.category === category) return true;
    if (!entry.category && addonId && Array.isArray(entry.menuProductIds)) {
      return entry.menuProductIds.some((productId) => String(productId) === String(addonId));
    }
    if (addonId && String(entry.addonId || entry.addonPlanId || "") === String(addonId)) return true;
    return false;
  }) || null;
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
  buildSimulatedAddonRemainingByCategory,
  findAddonBalanceBucket,
  findAddonEntitlementForChoice,
  isAddonChoiceEligibleForAllowance,
  resolveAddonCategoryForMenuProduct,
};
