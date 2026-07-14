const {
  findAddonBalanceBucket,
} = require("./subscriptionAddonPolicyService");

const SYSTEM_CURRENCY = "SAR";

function toNonNegativeInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveEntitlementPlanId(entitlement) {
  return String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
}

function resolveEntitlementBalance(subscription, entitlement) {
  const bucket = findAddonBalanceBucket(subscription, {
    addonPlanId: entitlement && (entitlement.addonPlanId || entitlement.addonId),
    addonId: entitlement && (entitlement.addonId || entitlement.addonPlanId),
    category: entitlement && entitlement.category,
  });
  const includedTotalQty = toNonNegativeInteger(
    bucket && bucket.includedTotalQty != null
      ? bucket.includedTotalQty
      : entitlement && entitlement.includedTotalQty,
    0
  );
  const remainingQty = toNonNegativeInteger(
    bucket && bucket.remainingQty != null
      ? bucket.remainingQty
      : includedTotalQty,
    0
  );
  return { bucket, includedTotalQty, remainingQty };
}

function selectAddonEntitlementForProduct(subscription, {
  productId,
  category,
  addonPlanId = null,
} = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  const normalizedProductId = String(productId || "");
  const normalizedCategory = String(category || "");
  const normalizedPlanId = String(addonPlanId || "");

  return entitlements.find((entry) => {
    if (!entry) return false;
    const entryPlanId = resolveEntitlementPlanId(entry);
    if (normalizedPlanId && entryPlanId !== normalizedPlanId) return false;
    if (normalizedCategory && String(entry.category || "") !== normalizedCategory) return false;
    if (!Array.isArray(entry.menuProductIds) || entry.menuProductIds.length === 0) {
      return Boolean(normalizedCategory && String(entry.category || "") === normalizedCategory);
    }
    return entry.menuProductIds.some((id) => String(id) === normalizedProductId);
  }) || null;
}

function buildAddonChoicePricingPreview({
  subscription,
  product,
  entitlement = null,
  category = null,
  quantity = 1,
} = {}) {
  const requestedQty = toPositiveInteger(quantity, 1);
  const selectedEntitlement = entitlement || selectAddonEntitlementForProduct(subscription, {
    productId: product && product._id,
    category,
  });
  const unitPriceHalala = toNonNegativeInteger(product && product.priceHalala, 0);
  const currency = (product && product.currency) || (selectedEntitlement && selectedEntitlement.currency) || SYSTEM_CURRENCY;

  if (!selectedEntitlement) {
    return {
      requestedQty,
      coveredQty: 0,
      paidQty: requestedQty,
      unitPriceHalala,
      currency,
      payableTotalHalala: unitPriceHalala * requestedQty,
      remainingBefore: 0,
      remainingAfter: 0,
      pricingMode: "paid_no_entitlement",
      entitlement: null,
    };
  }

  const maxPerDay = toPositiveInteger(
    selectedEntitlement.maxPerDay || selectedEntitlement.quantityPerDay,
    1
  );
  if (requestedQty > maxPerDay) {
    const err = new Error(`Requested quantity exceeds maxPerDay ${maxPerDay}`);
    err.status = 400;
    err.code = "ADDON_MAX_PER_DAY_EXCEEDED";
    throw err;
  }

  const { includedTotalQty, remainingQty } = resolveEntitlementBalance(subscription, selectedEntitlement);
  const remainingBefore = remainingQty;
  const coveredQty = Math.min(requestedQty, remainingBefore);
  const paidQty = requestedQty - coveredQty;
  const remainingAfter = Math.max(0, remainingBefore - coveredQty);
  const pricingMode = paidQty === 0
    ? "allowance_covered"
    : coveredQty > 0
      ? "allowance_partial"
      : "paid_overage";

  return {
    requestedQty,
    coveredQty,
    paidQty,
    unitPriceHalala,
    currency,
    payableTotalHalala: paidQty * unitPriceHalala,
    remainingBefore,
    remainingAfter,
    pricingMode,
    entitlement: selectedEntitlement,
    includedTotalQty,
    remainingQty,
    maxPerDay,
  };
}

module.exports = {
  buildAddonChoicePricingPreview,
  resolveEntitlementBalance,
  selectAddonEntitlementForProduct,
};
