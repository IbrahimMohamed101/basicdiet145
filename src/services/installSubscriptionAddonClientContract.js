"use strict";

const INSTALL_KEY = Symbol.for("basicdiet.subscriptionAddonClientContract.installed");
const WRAPPED_KEY = Symbol.for("basicdiet.subscriptionAddonClientContract.wrapped");
const LEGACY_DAILY_ADDON_WRAP_KEY = Symbol.for("basicdiet.subscriptionDailyAddonPolicy.wrapped");

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveHalala(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function resolveBalanceBucket(args = {}, result = {}) {
  const rows = Array.isArray(args.subscription && args.subscription.addonBalance)
    ? args.subscription.addonBalance
    : [];
  const balanceBucketId = clean(args.balanceBucketId || result.balanceBucketId);
  if (balanceBucketId) {
    const exact = rows.find((row) => clean(row && row._id) === balanceBucketId);
    if (exact) return exact;
  }

  const addonPlanId = clean(
    args.addonPlanId
      || result.addonPlanId
      || (args.entitlement && (args.entitlement.addonPlanId || args.entitlement.addonId))
  );
  if (addonPlanId) {
    const exact = rows.find((row) => clean(row && (row.addonPlanId || row.addonId)) === addonPlanId);
    if (exact) return exact;
  }

  return null;
}

function resolvePositiveAddonUnitPrice(args = {}, result = {}) {
  const product = args.product && typeof args.product === "object" ? args.product : {};
  const entitlement = args.entitlement && typeof args.entitlement === "object" ? args.entitlement : {};
  const bucket = resolveBalanceBucket(args, result) || {};
  const candidates = [
    result.unitPriceHalala,
    product.priceHalala,
    product.unitPriceHalala,
    bucket.overageUnitPriceHalala,
    bucket.unitPriceHalala,
    bucket.unitIncludedPriceHalala,
    entitlement.overageUnitPriceHalala,
    entitlement.unitPriceHalala,
    entitlement.unitIncludedPriceHalala,
    entitlement.unitPlanPriceHalala,
    entitlement.priceHalala,
  ];

  for (const candidate of candidates) {
    const price = positiveHalala(candidate);
    if (price > 0) return price;
  }
  return 0;
}

function invalidAddonPriceError(args = {}, result = {}) {
  const productId = clean(
    args.product && (args.product._id || args.product.productId || args.product.id)
      || result.productId
      || result.addonId
  );
  const err = new Error(`Add-on ${productId || "item"} does not have a positive authoritative price`);
  err.status = 422;
  err.code = "INVALID_ADDON_PRICE";
  err.details = {
    productId: productId || null,
    addonPlanId: clean(args.addonPlanId || result.addonPlanId) || null,
    field: "priceHalala",
  };
  return err;
}

function normalizeAddonPricingPreview(result, args = {}) {
  if (!result || typeof result !== "object") return result;

  const paidQty = nonNegativeInteger(result.paidQty, 0);
  const coveredQty = nonNegativeInteger(result.coveredQty, 0);
  const unitPriceHalala = resolvePositiveAddonUnitPrice(args, result);

  if (unitPriceHalala > 0) {
    return {
      ...result,
      unitPriceHalala,
      priceHalala: unitPriceHalala,
      priceSar: unitPriceHalala / 100,
      payableTotalHalala: paidQty > 0
        ? paidQty * unitPriceHalala
        : nonNegativeInteger(result.payableTotalHalala, 0),
      invalidPrice: false,
    };
  }

  if (paidQty > 0) {
    const strict = args.strictPayablePrice === true
      || Object.prototype.hasOwnProperty.call(args, "remainingQtyOverride");
    if (strict) throw invalidAddonPriceError(args, result);

    return {
      ...result,
      coveredQty,
      paidQty: 0,
      payableTotalHalala: 0,
      pricingMode: "invalid_price",
      source: "unavailable",
      invalidPrice: true,
    };
  }

  return {
    ...result,
    invalidPrice: false,
  };
}

function normalizeAddonChoiceGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const choices = (Array.isArray(group && group.choices) ? group.choices : [])
      .filter((choice) => choice && choice.invalidPrice !== true && choice.pricingMode !== "invalid_price")
      .map((choice) => {
        const unitPriceHalala = positiveHalala(choice.unitPriceHalala)
          || positiveHalala(choice.priceHalala);
        const payableTotalHalala = nonNegativeInteger(choice.payableTotalHalala, 0);
        const displayPriceHalala = payableTotalHalala > 0
          ? payableTotalHalala
          : unitPriceHalala;
        return {
          ...choice,
          unitPriceHalala,
          priceHalala: displayPriceHalala,
          priceSar: displayPriceHalala / 100,
          coveredQty: nonNegativeInteger(choice.coveredQty, 0),
          paidQty: nonNegativeInteger(choice.paidQty, 0),
          payableTotalHalala,
        };
      });

    return {
      ...group,
      choices,
      choicesCount: choices.length,
    };
  });
}

function normalizeAddonCoverageRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const unitPriceHalala = resolvePositiveAddonUnitPrice({
      product: row,
      entitlement: row && row.entitlement,
      addonPlanId: row && row.addonPlanId,
      balanceBucketId: row && row.balanceBucketId,
    }, row || {});
    return unitPriceHalala > 0
      ? {
        ...row,
        unitPriceHalala,
        referenceUnitPriceHalala: unitPriceHalala,
      }
      : row;
  });
}

function wrapExport(target, name, factory) {
  const original = target && target[name];
  if (typeof original !== "function" || original[WRAPPED_KEY]) return original;
  const wrapped = factory(original);
  Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  target[name] = wrapped;
  return wrapped;
}

function installPricingCoreGuard(pricing) {
  const originalCore = pricing.buildAddonChoicePricingPreviewCore
    || pricing.buildAddonChoicePricingPreview;
  if (typeof originalCore !== "function") {
    throw new Error("subscriptionAddonPricingService.buildAddonChoicePricingPreviewCore is missing");
  }
  if (originalCore[WRAPPED_KEY]) {
    pricing.buildAddonChoicePricingPreviewCore = originalCore;
    pricing.buildAddonChoicePricingPreview = originalCore;
    return originalCore;
  }

  const guardedCore = function guardedAddonPricingPreview(args = {}) {
    return normalizeAddonPricingPreview(originalCore(args), args);
  };
  Object.defineProperty(guardedCore, WRAPPED_KEY, { value: true });
  Object.defineProperty(guardedCore, "__original", { value: originalCore });
  // The backend composition intentionally protects this exact canonical core
  // from the deprecated carryover mutation wrapper. Keep both exported names
  // identical so every later service captures the same non-mutating authority.
  Object.defineProperty(guardedCore, LEGACY_DAILY_ADDON_WRAP_KEY, {
    value: true,
    configurable: true,
  });
  Object.defineProperty(guardedCore, "__legacyCarryoverProtected", {
    value: true,
    configurable: true,
  });
  pricing.buildAddonChoicePricingPreviewCore = guardedCore;
  pricing.buildAddonChoicePricingPreview = guardedCore;
  return guardedCore;
}

function installSubscriptionAddonClientContract() {
  if (globalThis[INSTALL_KEY]) return globalThis[INSTALL_KEY];

  const pricing = require("./subscription/subscriptionAddonPricingService");
  installPricingCoreGuard(pricing);
  wrapExport(pricing, "resolveAuthoritativeAddonUnitPriceHalala", (original) => function guardedAddonUnitPrice(product, options = {}) {
    const originalPrice = positiveHalala(original(product, { ...options, required: false }));
    const fallback = resolvePositiveAddonUnitPrice({
      product,
      entitlement: options.entitlement,
      subscription: options.subscription,
      addonPlanId: options.addonPlanId,
      balanceBucketId: options.balanceBucketId,
    });
    const resolved = originalPrice || fallback;
    if (resolved > 0) return resolved;
    if (options.required === true) throw invalidAddonPriceError({ product, ...options });
    return 0;
  });
  wrapExport(pricing, "buildSubscriptionAddonCoverageSummary", (original) => function guardedAddonCoverage(subscription) {
    return normalizeAddonCoverageRows(original(subscription));
  });

  // Load the choices service only after the canonical pricing core is guarded,
  // because it captures buildAddonChoicePricingPreview during initialization.
  const choices = require("./subscription/subscriptionAddonChoicesService");
  const {
    findCurrentActiveSubscriptionForUser,
  } = require("./subscription/subscriptionCurrentResolverService");

  const findIncludingUpcoming = function findAddonChoicesSubscription(userId, { SubscriptionModel } = {}) {
    return findCurrentActiveSubscriptionForUser(userId, {
      SubscriptionModel,
      context: "addon_choices_current_or_upcoming_subscription",
      includeUpcoming: true,
    });
  };
  Object.defineProperty(findIncludingUpcoming, WRAPPED_KEY, { value: true });
  choices.findCurrentSubscriptionForUser = findIncludingUpcoming;

  wrapExport(choices, "buildAddonChoiceGroups", (original) => async function guardedAddonChoiceGroups(args = {}) {
    let effectiveArgs = args;
    if (!args.subscription && !args.subscriptionId && args.userId) {
      const SubscriptionModel = args.models && args.models.SubscriptionModel;
      const subscription = await findIncludingUpcoming(args.userId, { SubscriptionModel });
      effectiveArgs = { ...args, subscription };
    }
    return normalizeAddonChoiceGroups(await original(effectiveArgs));
  });

  const state = Object.freeze({
    installed: true,
    installedAt: new Date(),
    includesUpcomingSubscriptions: true,
    zeroAmountInvoicesBlocked: true,
    pricingCoreIdentityPreserved: true,
    flutterRepositoryChanged: false,
  });
  globalThis[INSTALL_KEY] = state;
  return state;
}

installSubscriptionAddonClientContract();

module.exports = {
  INSTALL_KEY,
  installPricingCoreGuard,
  installSubscriptionAddonClientContract,
  invalidAddonPriceError,
  normalizeAddonChoiceGroups,
  normalizeAddonCoverageRows,
  normalizeAddonPricingPreview,
  resolvePositiveAddonUnitPrice,
};
