const MenuProduct = require("../../models/MenuProduct");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalogAvailabilityService");
const {
  PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
} = require("../../config/mealPlannerContract");

const PREMIUM_LARGE_SALAD_PRODUCT_KEY = "premium_large_salad";
const PREMIUM_LARGE_SALAD_FALLBACK_PRODUCT_KEY = "basic_salad";
const LEGACY_FALLBACK_PRICE_SOURCE = "legacy_config_fallback";

function activeSubscriptionProductQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: "subscription" },
    ],
    ...extra,
  };
}

function resolveProductPriceHalala(product) {
  const price = Number(product && product.priceHalala);
  return Number.isFinite(price) && price >= 0 ? Math.round(price) : null;
}

async function findPublishedPremiumLargeSaladProduct({ session = null } = {}) {
  const primaryQuery = MenuProduct.findOne(activeSubscriptionProductQuery({
    key: PREMIUM_LARGE_SALAD_PRODUCT_KEY,
  }));
  const primary = await (session ? primaryQuery.session(session) : primaryQuery).lean();
  if (primary) {
    const catalogItemsById = await loadCatalogItemsByIdForDocs([primary]);
    if (isLinkedDocGloballyAvailable(primary, catalogItemsById)) {
      return { product: primary, productKey: PREMIUM_LARGE_SALAD_PRODUCT_KEY, isFallbackProduct: false };
    }
    return { product: null, productKey: PREMIUM_LARGE_SALAD_PRODUCT_KEY, isFallbackProduct: false, isCatalogUnavailable: true };
  }

  const fallbackQuery = MenuProduct.findOne(activeSubscriptionProductQuery({
    key: PREMIUM_LARGE_SALAD_FALLBACK_PRODUCT_KEY,
  }));
  const fallback = await (session ? fallbackQuery.session(session) : fallbackQuery).lean();
  if (fallback) {
    const catalogItemsById = await loadCatalogItemsByIdForDocs([fallback]);
    if (isLinkedDocGloballyAvailable(fallback, catalogItemsById)) {
      return { product: fallback, productKey: PREMIUM_LARGE_SALAD_FALLBACK_PRODUCT_KEY, isFallbackProduct: true };
    }
    return { product: null, productKey: PREMIUM_LARGE_SALAD_FALLBACK_PRODUCT_KEY, isFallbackProduct: true, isCatalogUnavailable: true };
  }

  return { product: null, productKey: null, isFallbackProduct: false };
}

async function resolvePremiumLargeSaladPricing({ session = null } = {}) {
  const { product, productKey, isFallbackProduct } = await findPublishedPremiumLargeSaladProduct({ session });
  if (!product && isFallbackProduct !== undefined && productKey) {
    return {
      premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      product: null,
      productId: null,
      productKey,
      priceHalala: 0,
      extraFeeHalala: 0,
      currency: "SAR",
      source: "catalog_item_unavailable",
      isLegacyFallback: false,
      isCatalogUnavailable: true,
    };
  }
  const productPriceHalala = resolveProductPriceHalala(product);

  if (product && productPriceHalala !== null) {
    return {
      premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      product,
      productId: product._id,
      productKey,
      priceHalala: productPriceHalala,
      extraFeeHalala: productPriceHalala,
      currency: product.currency || "SAR",
      source: isFallbackProduct ? "menu_product_basic_salad_fallback" : "menu_product_premium_large_salad",
      isLegacyFallback: false,
    };
  }

  return {
    premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
    product: null,
    productId: null,
    productKey: null,
    priceHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
    extraFeeHalala: PREMIUM_LARGE_SALAD_FIXED_PRICE_HALALA,
    currency: "SAR",
    source: LEGACY_FALLBACK_PRICE_SOURCE,
    isLegacyFallback: true,
  };
}

module.exports = {
  LEGACY_FALLBACK_PRICE_SOURCE,
  PREMIUM_LARGE_SALAD_FALLBACK_PRODUCT_KEY,
  PREMIUM_LARGE_SALAD_PRODUCT_KEY,
  findPublishedPremiumLargeSaladProduct,
  resolvePremiumLargeSaladPricing,
};
