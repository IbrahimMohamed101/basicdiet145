const {
  findAddonBalanceBucket,
  resolveAddonBalanceRemainingQty,
  resolveEntitlementPlanId,
  selectAddonEntitlementForProduct,
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
  const remainingQty = bucket
    ? resolveAddonBalanceRemainingQty(bucket)
    : toNonNegativeInteger(includedTotalQty, 0);
  return { bucket, includedTotalQty, remainingQty };
}

function createInvalidAddonPriceError(product) {
  const err = new Error("Invalid add-on price");
  err.status = 422;
  err.code = "INVALID_ADDON_PRICE";
  err.messageKey = "errors.addon.invalidPrice";
  err.fallbackMessage = "Invalid add-on price";
  err.details = {
    productId: product && product._id ? String(product._id) : null,
  };
  return err;
}

function resolveAuthoritativeAddonUnitPriceHalala(product, { required = false, entitlement = null } = {}) {
  const hasPrice = product && Object.prototype.hasOwnProperty.call(product, "priceHalala");
  let value = hasPrice ? product.priceHalala : undefined;

  if (value === undefined && entitlement && typeof entitlement.unitPriceHalala === "number") {
    value = entitlement.unitPriceHalala;
  }

  const valid = typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;

  if (!valid) {
    if (required) throw createInvalidAddonPriceError(product);
    return 0;
  }

  return value;
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
  const currency = (product && product.currency) || (selectedEntitlement && selectedEntitlement.currency) || SYSTEM_CURRENCY;

  if (!selectedEntitlement) {
    const unitPriceHalala = resolveAuthoritativeAddonUnitPriceHalala(product, { required: true, entitlement: null });
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
  const unitPriceHalala = resolveAuthoritativeAddonUnitPriceHalala(product, { required: paidQty > 0, entitlement: selectedEntitlement });

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
  createInvalidAddonPriceError,
  resolveAuthoritativeAddonUnitPriceHalala,
  resolveEntitlementBalance,
  selectAddonEntitlementForProduct,
};