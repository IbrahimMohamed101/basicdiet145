const {
  findAddonBalanceBucket,
  getEntitlementMenuProductIds,
  resolveAddonBalanceRemainingQty,
  resolveAddonEntitlementContext,
  resolveEntitlementPlanId,
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
    entitlementKey: entitlement && entitlement.entitlementKey,
    balanceBucketId: entitlement && entitlement.balanceBucketId,
    displayKey: entitlement && (entitlement.displayKey || entitlement.displayCategory),
    category: entitlement && (entitlement.allowanceCategory || entitlement.category),
  });
  const includedTotalQty = Math.max(
    toNonNegativeInteger(bucket && bucket.includedTotalQty, 0),
    toNonNegativeInteger(entitlement && entitlement.includedTotalQty, 0)
  );
  const remainingQty = bucket
    ? resolveAddonBalanceRemainingQty(bucket, { entitlement })
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
  addonPlanId = null,
  balanceBucketId = null,
  entitlementKey = null,
  remainingQtyOverride = null,
} = {}) {
  const requestedQty = toPositiveInteger(quantity, 1);
  const productId = String(product && (product._id || product.id || product.productId || product.menuProductId) || "");
  const resolvedContext = entitlement
    ? resolveAddonEntitlementContext(subscription, {
      productId,
      addonPlanId: addonPlanId || resolveEntitlementPlanId(entitlement),
      balanceBucketId,
      entitlementKey,
      category,
    })
    : resolveAddonEntitlementContext(subscription, {
      productId,
      category,
      addonPlanId,
      balanceBucketId,
      entitlementKey,
      preferPositiveRemaining: true,
    });
  const selectedEntitlement = resolvedContext && resolvedContext.entitlement;
  const currency = (product && product.currency) || (selectedEntitlement && selectedEntitlement.currency) || SYSTEM_CURRENCY;
  const baseIdentity = {
    id: productId || null,
    productId: productId || null,
    menuProductId: productId || null,
    addonId: productId || null,
    addonPlanId: resolvedContext && resolvedContext.addonPlanId ? String(resolvedContext.addonPlanId) : null,
    entitlementKey: resolvedContext && resolvedContext.entitlementKey || null,
    balanceBucketId: resolvedContext && resolvedContext.balanceBucketId
      ? String(resolvedContext.balanceBucketId)
      : (resolvedContext && resolvedContext.bucket && resolvedContext.bucket._id ? String(resolvedContext.bucket._id) : null),
    entitlementCategory: resolvedContext && resolvedContext.entitlementCategory || null,
    ownedSnapshot: Boolean(resolvedContext && resolvedContext.ownedSnapshot),
    legacyRecovered: Boolean(resolvedContext && resolvedContext.legacyRecovered),
    legacySourceProductId: resolvedContext && resolvedContext.legacySourceProductId || null,
    isEligibleForAllowance: Boolean(selectedEntitlement),
  };

  if (!selectedEntitlement) {
    const unitPriceHalala = resolveAuthoritativeAddonUnitPriceHalala(product, { required: true, entitlement: null });
    return {
      ...baseIdentity,
      requestedQty,
      coveredQty: 0,
      paidQty: requestedQty,
      unitPriceHalala,
      currency,
      payableTotalHalala: unitPriceHalala * requestedQty,
      remainingBefore: 0,
      remainingAfter: 0,
      pricingMode: "paid_no_entitlement",
      source: "pending_payment",
      entitlement: null,
      includedTotalQty: 0,
      remainingQty: 0,
      freeQtyAvailable: 0,
      maxPerDay: toPositiveInteger(product && product.maxPerDay, 1),
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
  const remainingBefore = remainingQtyOverride === null || remainingQtyOverride === undefined
    ? remainingQty
    : toNonNegativeInteger(remainingQtyOverride, 0);
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
    ...baseIdentity,
    requestedQty,
    coveredQty,
    paidQty,
    unitPriceHalala,
    currency,
    payableTotalHalala: paidQty * unitPriceHalala,
    remainingBefore,
    remainingAfter,
    pricingMode,
    source: paidQty === 0 ? "subscription" : "pending_payment",
    entitlement: selectedEntitlement,
    includedTotalQty,
    remainingQty,
    freeQtyAvailable: remainingBefore,
    maxPerDay,
  };
}

function buildSubscriptionAddonCoverageSummary(subscription) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  const rows = [];

  entitlements.forEach((entitlement, entitlementIndex) => {
    const productIds = getEntitlementMenuProductIds(entitlement);
    const snapshots = new Map(
      (Array.isArray(entitlement && entitlement.menuProductsSnapshot) ? entitlement.menuProductsSnapshot : [])
        .map((snapshot) => [String(snapshot && (snapshot.id || snapshot._id) || ""), snapshot])
        .filter(([id]) => id)
    );
    const ids = productIds.length ? productIds : [null];
    for (const productId of ids) {
      const snapshot = productId ? snapshots.get(String(productId)) : null;
      const product = {
        _id: productId,
        priceHalala: Number(
          snapshot && snapshot.priceHalala != null
            ? snapshot.priceHalala
            : entitlement && (entitlement.unitPriceHalala ?? entitlement.unitPlanPriceHalala ?? entitlement.priceHalala) || 0
        ),
        currency: snapshot && snapshot.currency || entitlement && entitlement.currency || SYSTEM_CURRENCY,
      };
      const preview = buildAddonChoicePricingPreview({
        subscription,
        entitlement,
        product,
        category: entitlement && entitlement.category,
        addonPlanId: resolveEntitlementPlanId(entitlement),
        entitlementKey: `${entitlement && entitlement.category || "legacy"}:${resolveEntitlementPlanId(entitlement) || entitlementIndex}`,
        quantity: 1,
      });
      rows.push({
        ...preview,
        key: snapshot && snapshot.key || "",
        category: entitlement && entitlement.category || "",
        entitlementCategory: entitlement && entitlement.category || "",
      });
    }
  });
  return rows;
}

module.exports = {
  buildAddonChoicePricingPreview,
  buildSubscriptionAddonCoverageSummary,
  createInvalidAddonPriceError,
  resolveAuthoritativeAddonUnitPriceHalala,
  resolveEntitlementBalance,
};
