const mongoose = require("mongoose");
const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const { pickLang } = require("../../utils/i18n");
const { normalizeProductUiMetadata } = require("../catalog/catalogKeyUiHelpers");
const {
  filterGloballyAvailable,
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const {
  SUBSCRIPTION_ADDON_CATEGORIES,
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
  buildAddonEntitlementEligibility,
  isAddonChoiceEligibleForAllowance,
  resolveAddonCategoryForMenuProduct,
} = require("./subscriptionAddonPolicyService");
const {
  buildAddonChoicePricingPreview,
  resolveEntitlementBalance,
} = require("./subscriptionAddonPricingService");
const {
  findCurrentActiveSubscriptionForUser,
} = require("./subscriptionCurrentResolverService");
const {
  availableForChannelQuery,
} = require("./subscriptionMenuEligibilityPolicyService");

const SYSTEM_CURRENCY = "SAR";

function isDailyAddonMenuProduct(product) {
  return String(product && product.kind || "").toLowerCase() !== "plan"
    && String(product && product.type || "").toLowerCase() !== "subscription"
    && String(product && product.itemType || "").toLowerCase() !== "subscription"
    && String(product && product.billingMode || "").toLowerCase() !== "per_day";
}

function localized(value, lang) {
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function activePublishedQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function normalizeCategoryFilter(category) {
  if (category === undefined || category === null || String(category).trim() === "") {
    return SUBSCRIPTION_ADDON_CATEGORIES;
  }
  const normalized = String(category).trim();
  if (!SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[normalized]) {
    const err = new Error("category must be one of: juice, snack, small_salad");
    err.status = 400;
    err.code = "INVALID";
    throw err;
  }
  return [normalized];
}

function serializeChoice(product, categoryKey, lang) {
  const priceHalala = Number(product.priceHalala || 0);
  return {
    id: String(product._id),
    key: product.key || "",
    name: localized(product.name, lang),
    nameAr: pickLang(product.name, "ar") || "",
    nameI18n: {
      ar: pickLang(product.name, "ar") || "",
      en: pickLang(product.name, "en") || "",
    },
    description: localized(product.description, lang),
    descriptionI18n: {
      ar: pickLang(product.description, "ar") || "",
      en: pickLang(product.description, "en") || "",
    },
    imageUrl: product.imageUrl || "",
    priceHalala,
    priceSar: priceHalala / 100,
    currency: product.currency || SYSTEM_CURRENCY,
    calories: Number.isFinite(Number(product.calories)) ? Number(product.calories) : null,
    prepTimeMinutes: Number.isFinite(Number(product.prepTimeMinutes)) ? Number(product.prepTimeMinutes) : null,
    categoryKey,
    itemType: product.itemType || "product",
    type: "menu_product",
    available: product.isAvailable !== false,
    active: product.isActive !== false,
    ui: normalizeProductUiMetadata(product.ui),
  };
}

function createServiceError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function normalizeOptionalCategory(category) {
  if (category === undefined || category === null || String(category).trim() === "") {
    return null;
  }
  return String(category).trim();
}

function normalizeIdList(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
}

function normalizeEntitlementName(entitlement) {
  return String(
    entitlement && (
      entitlement.addonPlanName
      || entitlement.name
      || ""
    ) || ""
  );
}

function buildEntitlementMetadata(subscription, entitlement, index) {
  const { includedTotalQty, remainingQty } = resolveEntitlementBalance(subscription, entitlement);
  const addonPlanId = String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
  const category = String(entitlement && entitlement.category || "");
  return {
    entitlementIndex: index,
    entitlementKey: `${category || "legacy"}:${addonPlanId || index}`,
    addonPlanId,
    addonPlanName: normalizeEntitlementName(entitlement),
    category,
    maxPerDay: Math.max(1, Math.floor(Number(entitlement && entitlement.maxPerDay || entitlement && entitlement.quantityPerDay || 1))),
    remainingQty,
    includedTotalQty,
    isEligibleForAllowance: true,
  };
}

function buildChoicePricingMetadata(subscription, entitlement, product) {
  const preview = buildAddonChoicePricingPreview({
    subscription,
    entitlement,
    product,
    category: entitlement && entitlement.category,
    quantity: 1,
  });
  return {
    requestedQty: preview.requestedQty,
    freeQtyAvailable: preview.remainingBefore,
    coveredQty: preview.coveredQty,
    paidQty: preview.paidQty,
    payableTotalHalala: preview.payableTotalHalala,
    pricingMode: preview.pricingMode,
    unitPriceHalala: preview.unitPriceHalala,
    currency: preview.currency,
    remainingBefore: preview.remainingBefore,
    remainingAfter: preview.remainingAfter,
  };
}

async function loadSelectableSnapshotProducts(productIds, { MenuProductModel = MenuProduct } = {}) {
  if (!productIds.length) return [];
  const rows = await MenuProductModel.find(activePublishedQuery({
    _id: { $in: productIds },
    ...availableForChannelQuery("one_time"),
  })).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  const byId = new Map(
    filterGloballyAvailable(rows, catalogItemsById)
      .filter(isDailyAddonMenuProduct)
      .map((row) => [String(row._id), row])
  );
  return productIds
    .map((id) => byId.get(String(id)))
    .filter(Boolean);
}

async function loadCategoryRowsForProducts(products, { MenuCategoryModel = MenuCategory } = {}) {
  const categoryIds = [
    ...new Set((Array.isArray(products) ? products : [])
      .map((product) => String(product && product.categoryId || ""))
      .filter(Boolean)),
  ];
  if (!categoryIds.length) return new Map();
  const rows = await MenuCategoryModel.find(activePublishedQuery({
    _id: { $in: categoryIds },
  })).lean();
  return new Map(rows.map((row) => [String(row._id), row]));
}

function emptyEntitlementCatalogEntry(category) {
  return {
    category,
    sourceCategories: [],
    catalogType: "subscription_entitlements",
    choices: [],
    entitlements: [],
  };
}

function appendEntitlementChoiceGroup(data, category, metadata, choices) {
  if (!data[category]) {
    data[category] = emptyEntitlementCatalogEntry(category);
  }
  data[category].choices.push(...choices);
  data[category].entitlements.push({
    ...metadata,
    choicesCount: choices.length,
    menuProductIds: choices.map((choice) => choice.id),
  });
}

async function buildSubscriptionAddonChoicesCatalog({
  lang = "en",
  category,
  subscriptionId,
  subscription: suppliedSubscription = null,
  userId = null,
  models = {},
} = {}) {
  if (!suppliedSubscription && !mongoose.Types.ObjectId.isValid(String(subscriptionId || ""))) {
    throw createServiceError(400, "INVALID_ID", "subscriptionId is not a valid id");
  }

  const SubscriptionModel = models.SubscriptionModel || mongoose.model("Subscription");
  const subscription = suppliedSubscription || await SubscriptionModel.findById(subscriptionId).lean();
  if (!subscription) {
    throw createServiceError(404, "NOT_FOUND", "Subscription not found");
  }
  if (userId && String(subscription.userId || "") !== String(userId)) {
    throw createServiceError(403, "FORBIDDEN", "Subscription does not belong to the authenticated user");
  }

  const requestedCategory = normalizeOptionalCategory(category);
  const entitlements = (Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [])
    .filter((entry) => entry && (!requestedCategory || String(entry.category || "") === requestedCategory));
  const data = {};
  if (requestedCategory) {
    data[requestedCategory] = emptyEntitlementCatalogEntry(requestedCategory);
  }

  for (const [index, entitlement] of entitlements.entries()) {
    const snapshotProductIds = normalizeIdList(entitlement.menuProductIds);
    const groupCategory = String(entitlement.category || requestedCategory || "legacy");
    let products = [];
    if (snapshotProductIds.length) {
      products = await loadSelectableSnapshotProducts(snapshotProductIds, models);
    } else if (SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[groupCategory]) {
      const mapping = SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[groupCategory];
      const categoryRows = await findActiveOneTimeCategories(mapping.sourceCategories, models);
      products = await findMappedProducts(categoryRows, mapping, models);
    }

    const categoriesById = await loadCategoryRowsForProducts(products, models);
    const metadata = buildEntitlementMetadata(subscription, entitlement, index);
    const choices = products
      .map((product) => {
        const sourceCategory = categoriesById.get(String(product.categoryId));
        if (!sourceCategory) return null;
        return {
          ...serializeChoice(product, sourceCategory.key, lang),
          ...metadata,
          ...buildChoicePricingMetadata(subscription, entitlement, product),
          category: groupCategory,
        };
      })
      .filter(Boolean);

    appendEntitlementChoiceGroup(data, groupCategory, metadata, choices);
  }

  return data;
}

function findCurrentSubscriptionForUser(userId, { SubscriptionModel } = {}) {
  return findCurrentActiveSubscriptionForUser(userId, {
    SubscriptionModel,
    context: "addon_choices_current_subscription",
  });
}

async function findActiveOneTimeCategories(sourceCategoryKeys, { MenuCategoryModel = MenuCategory } = {}) {
  const rows = await MenuCategoryModel.find(activePublishedQuery({
    key: { $in: sourceCategoryKeys },
  }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return rows;
}

async function findMappedProducts(categoryRows, mapping, { MenuProductModel = MenuProduct } = {}) {
  if (!categoryRows.length) return [];
  const categoryIds = categoryRows.map((category) => category._id);
  const productQuery = activePublishedQuery({
    categoryId: { $in: categoryIds },
    ...availableForChannelQuery("one_time"),
  });
  if (Array.isArray(mapping.productKeys) && mapping.productKeys.length) {
    productQuery.key = { $in: mapping.productKeys };
  }

  const rows = await MenuProductModel.find(productQuery)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  return filterGloballyAvailable(rows, catalogItemsById).filter(isDailyAddonMenuProduct);
}

async function buildAddonChoicesCatalog({
  lang = "en",
  category,
  subscriptionId = null,
  userId = null,
  models = {},
} = {}) {
  if (subscriptionId) {
    return buildSubscriptionAddonChoicesCatalog({
      lang,
      category,
      subscriptionId,
      userId,
      models,
    });
  }

  const SubscriptionModel = models.SubscriptionModel || mongoose.model("Subscription");
  if (userId) {
    const subscription = await findCurrentSubscriptionForUser(userId, { SubscriptionModel });
    if (subscription && Array.isArray(subscription.addonSubscriptions) && subscription.addonSubscriptions.length > 0) {
      return buildSubscriptionAddonChoicesCatalog({
        lang,
        category,
        subscription,
        userId,
        models,
      });
    }
  }

  let entitlementEligibility = buildAddonEntitlementEligibility(null);

  const categories = normalizeCategoryFilter(category);
  const sourceCategoryKeys = [
    ...new Set(categories.flatMap((key) => SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[key].sourceCategories)),
  ];

  const categoryRows = await findActiveOneTimeCategories(sourceCategoryKeys, models);
  const categoriesById = new Map(categoryRows.map((row) => [String(row._id), row]));
  const categoriesByKey = new Map(categoryRows.map((row) => [row.key, row]));
  const data = {};

  for (const addonCategory of categories) {
    const mapping = SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[addonCategory];
    const mappedCategoryRows = mapping.sourceCategories
      .map((key) => categoriesByKey.get(key))
      .filter(Boolean);
    const productRows = await findMappedProducts(mappedCategoryRows, mapping, models);
    let choices = productRows
      .map((product) => {
        const sourceCategory = categoriesById.get(String(product.categoryId));
        if (!sourceCategory) return null;
        return serializeChoice(product, sourceCategory.key, lang);
      })
      .filter(Boolean);

    if (entitlementEligibility.hasSubscriptionFilter) {
      choices.forEach((choice) => {
        choice.isEligibleForAllowance = isAddonChoiceEligibleForAllowance(
          entitlementEligibility,
          addonCategory,
          choice.id
        );
      });
    }

    data[addonCategory] = {
      category: addonCategory,
      sourceCategories: [...mapping.sourceCategories],
      catalogType: "generic",
      choices,
    };
  }

  return data;
}

async function resolveAddonChoiceProductById(productId, { models = {} } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(productId || ""))) return null;
  const MenuProductModel = models.MenuProductModel || MenuProduct;
  const MenuCategoryModel = models.MenuCategoryModel || MenuCategory;
  const product = await MenuProductModel.findOne(activePublishedQuery({
    _id: productId,
    ...availableForChannelQuery("one_time"),
  })).lean();
  if (!product) {
    const AddonModel = mongoose.model("Addon");
    const addon = await AddonModel.findOne({ _id: productId, kind: "item" }).lean();
    if (addon && addon.isActive !== false) {
      return {
        product: addon,
        category: { key: addon.category },
        addonCategory: addon.category,
      };
    }
    return null;
  }
  const catalogItemsById = await loadCatalogItemsByIdForDocs([product]);
  if (!isLinkedDocGloballyAvailable(product, catalogItemsById)) return null;
  if (!isDailyAddonMenuProduct(product)) return null;

  const category = await MenuCategoryModel.findOne(activePublishedQuery({
    _id: product.categoryId,
  })).lean();
  if (!category) return null;

  const addonCategory = resolveAddonCategoryForMenuProduct(product, category.key);
  if (addonCategory) {
    return {
      product,
      category,
      addonCategory,
    };
  }

  return null;
}

module.exports = {
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
  SUBSCRIPTION_ADDON_CATEGORIES,
  buildAddonChoicesCatalog,
  buildSubscriptionAddonChoicesCatalog,
  buildAddonChoicePricingPreview,
  findCurrentSubscriptionForUser,
  isDailyAddonMenuProduct,
  resolveAddonChoiceProductById,
  serializeChoice,
};
