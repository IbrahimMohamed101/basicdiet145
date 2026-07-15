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
  ALL_SUPPORTED_SUBSCRIPTION_ADDON_CATEGORIES,
  SUBSCRIPTION_ADDON_CATEGORIES,
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
  buildAddonEntitlementEligibility,
  isAddonChoiceEligibleForAllowance,
  normalizeSubscriptionAddonCategory,
  resolveAddonCategoryForMenuProduct,
} = require("./subscriptionAddonPolicyService");
const {
  ERROR_CODE_ADDON_PLAN_MISMATCH,
  ERROR_CODE_BALANCE_BUCKET_MISMATCH,
  ERROR_CODE_ENTITLEMENT_CATEGORY_MISMATCH,
  ERROR_CODE_ENTITLEMENT_NOT_OWNED,
  ERROR_CODE_ENTITLEMENT_PRODUCT_NOT_FOUND,
  ERROR_CODE_SNAPSHOT_MISSING,
  loadOwnedCategoryRowsForProducts,
  loadOwnedSnapshotProducts,
  resolveOwnedAddonEntitlementChoice,
  syntheticCategoryFromKey,
} = require("./subscriptionOwnedAddonSnapshotService");
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
const DYNAMIC_CATEGORY_PLURAL_OVERRIDES = Object.freeze({
  meal: "meals",
  dessert: "desserts",
  salad: "salads",
});

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
    return ALL_SUPPORTED_SUBSCRIPTION_ADDON_CATEGORIES;
  }
  const normalized = normalizeSubscriptionAddonCategory(category);
  if (!normalized) {
    const err = new Error();
    err.status = 400;
    err.code = "INVALID";
    throw err;
  }
  return [normalized];
}

function normalizeDisplayCategoryKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  if (key === "meals") return "meal";
  if (key === "desserts") return "dessert";
  if (key === "salads") return "salad";
  if (key.endsWith("ies")) return `${key.slice(0, -3)}y`;
  if (key.endsWith("s") && key.length > 3) return key.slice(0, -1);
  return key;
}

function resolveDisplayCategoryForProduct(product, sourceCategory, { entitlementCategory = null, genericOnly = false } = {}) {
  const sourceCategoryKey = String(sourceCategory && sourceCategory.key || "").trim().toLowerCase();
  const legacyCategory = resolveAddonCategoryForMenuProduct(product, sourceCategoryKey);
  if (legacyCategory && (genericOnly || !entitlementCategory || String(entitlementCategory) === legacyCategory)) {
    return legacyCategory;
  }

  const normalizedEntitlementCategory = normalizeDisplayCategoryKey(entitlementCategory);
  const itemTypeCategory = normalizeDisplayCategoryKey(product && product.itemType);
  const sourceDisplayCategory = normalizeDisplayCategoryKey(sourceCategoryKey);

  if (normalizedEntitlementCategory && (
    normalizedEntitlementCategory === itemTypeCategory
    || normalizedEntitlementCategory === sourceDisplayCategory
  )) {
    return normalizedEntitlementCategory;
  }

  return itemTypeCategory || sourceDisplayCategory || legacyCategory || normalizedEntitlementCategory || null;
}

function serializeChoice(product, categoryKey, lang) {
  const priceHalala = Number(product.priceHalala || 0);
  return {
    id: String(product._id),
    productId: String(product._id),
    menuProductId: String(product._id),
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
  return normalizeSubscriptionAddonCategory(category);
}

function normalizeIdList(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
}

function snapshotProductIdList(entitlement) {
  return normalizeIdList([
    ...(Array.isArray(entitlement && entitlement.menuProductIds) ? entitlement.menuProductIds : []),
    ...(Array.isArray(entitlement && entitlement.menuProductsSnapshot)
      ? entitlement.menuProductsSnapshot.map((snapshot) => snapshot && (snapshot.id || snapshot._id))
      : []),
  ]);
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
  const { bucket, includedTotalQty, remainingQty } = resolveEntitlementBalance(subscription, entitlement);
  const addonPlanId = String(entitlement && (entitlement.addonPlanId || entitlement.addonId) || "");
  const category = String(entitlement && entitlement.category || "");
  return {
    entitlementIndex: index,
    entitlementKey: `${category || "legacy"}:${addonPlanId || index}`,
    addonId: addonPlanId,
    addonPlanId,
    addonPlanName: normalizeEntitlementName(entitlement),
    balanceBucketId: bucket && bucket._id ? String(bucket._id) : null,
    category,
    entitlementCategory: category,
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
  for (const choice of choices) {
    mergeChoiceIntoCatalog(data, category, choice, { preferCategory: true, overwriteExisting: false });
  }
  data[category].entitlements.push({
    ...metadata,
    choicesCount: choices.length,
    menuProductIds: choices.map((choice) => choice.id),
  });
}

function emptyGenericCatalogEntry(category, mapping = null) {
  return {
    category,
    sourceCategories: mapping && Array.isArray(mapping.sourceCategories) ? [...mapping.sourceCategories] : [],
    catalogType: "generic",
    choices: [],
  };
}

function ensureCatalogEntry(data, category, entry = null) {
  if (!data[category]) {
    data[category] = entry || emptyGenericCatalogEntry(category);
  }
  return data[category];
}

function removeChoiceFromOtherCategories(data, category, productId) {
  const id = String(productId || "");
  for (const [key, group] of Object.entries(data || {})) {
    if (key === category || !group || !Array.isArray(group.choices)) continue;
    group.choices = group.choices.filter((choice) => String(choice && choice.id || "") !== id);
  }
}

function mergeChoiceIntoCatalog(data, category, choice, { preferCategory = true, overwriteExisting = true } = {}) {
  if (!category || !choice) return;
  if (preferCategory) removeChoiceFromOtherCategories(data, category, choice.id);
  const group = ensureCatalogEntry(data, category);
  const existingIndex = group.choices.findIndex((row) => String(row && row.id || "") === String(choice.id));
  if (existingIndex >= 0) {
    if (overwriteExisting) {
      group.choices[existingIndex] = {
        ...group.choices[existingIndex],
        ...choice,
        category,
      };
    }
  } else {
    group.choices.push({ ...choice, category });
  }
}

function requestedCategoryMatches(requestedCategory, displayCategory) {
  return !requestedCategory || String(requestedCategory) === String(displayCategory);
}

function categoryKeysForDisplayCategory(category) {
  if (SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[category]) {
    return [...SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[category].sourceCategories];
  }
  const plural = DYNAMIC_CATEGORY_PLURAL_OVERRIDES[category] || `${category}s`;
  return [...new Set([category, plural])];
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
    .filter(Boolean);
  const data = {};
  if (requestedCategory) {
    data[requestedCategory] = emptyEntitlementCatalogEntry(requestedCategory);
  }

  for (const [index, entitlement] of entitlements.entries()) {
    const snapshotProductIds = snapshotProductIdList(entitlement);
    const entitlementCategory = String(entitlement.category || requestedCategory || "legacy");
    let loadedProducts = [];
    if (snapshotProductIds.length) {
      loadedProducts = await loadOwnedSnapshotProducts(snapshotProductIds, entitlement, {
        MenuProductModel: models.MenuProductModel,
      });
    }

    const productsList = loadedProducts.map(p => p.product).filter(Boolean);
    const { rowsById: categoriesById, fallbackCategory } = await loadOwnedCategoryRowsForProducts(productsList, entitlementCategory, { MenuCategoryModel: models.MenuCategoryModel });
    const metadata = buildEntitlementMetadata(subscription, entitlement, index);
    const groupedChoices = new Map();
    for (const { product, fromSnapshot } of loadedProducts) {
      if (!product) continue;
      const sourceCategory = categoriesById.get(String(product.categoryId)) || fallbackCategory;
      if (!sourceCategory) continue;
      const displayCategory = resolveDisplayCategoryForProduct(product, sourceCategory, { entitlementCategory });
      if (!displayCategory || !requestedCategoryMatches(requestedCategory, displayCategory)) continue;
      const serialized = serializeChoice(product, sourceCategory.key, lang);
      const choice = {
        ...serialized,
        ...metadata,
        ...buildChoicePricingMetadata(subscription, entitlement, product),
        category: displayCategory,
        entitlementCategory,
        source: "subscription",
        ownedSnapshot: true,
        availableForNewSale: false,
        addonId: serialized.id,
        unitPriceHalala: serialized.priceHalala,
        currency: serialized.currency,
      };
      const list = groupedChoices.get(displayCategory) || [];
      list.push(choice);
      groupedChoices.set(displayCategory, list);
    }

    for (const [groupCategory, choices] of groupedChoices.entries()) {
      appendEntitlementChoiceGroup(data, groupCategory, {
        ...metadata,
        category: groupCategory,
        entitlementCategory,
      }, choices);
    }
  }

  return data;
}

async function buildGenericAddonChoicesCatalog({
  lang = "en",
  category,
  extraDisplayCategories = [],
  models = {},
} = {}) {
  const requestedCategory = normalizeOptionalCategory(category);
  const categories = requestedCategory
    ? [requestedCategory]
    : [...SUBSCRIPTION_ADDON_CATEGORIES, ...extraDisplayCategories.filter((key) => !SUBSCRIPTION_ADDON_CATEGORIES.includes(key))];
  const data = {};

  for (const addonCategory of categories) {
    const mapping = SUBSCRIPTION_ADDON_CHOICE_MAPPINGS[addonCategory] || null;
    const sourceKeys = categoryKeysForDisplayCategory(addonCategory);
    const categoryRows = await findActiveOneTimeCategories(sourceKeys, models);
    const productRows = mapping
      ? await findMappedProducts(categoryRows, mapping, models)
      : await findMappedProducts(categoryRows, {}, models);
    const categoriesById = await loadCategoryRowsForProducts(productRows, models);
    const group = ensureCatalogEntry(data, addonCategory, emptyGenericCatalogEntry(addonCategory, mapping));
    group.choices = productRows
      .map((product) => {
        const sourceCategory = categoriesById.get(String(product.categoryId));
        if (!sourceCategory) return null;
        const displayCategory = resolveDisplayCategoryForProduct(product, sourceCategory, { genericOnly: Boolean(mapping) });
        if (displayCategory !== addonCategory) return null;
        return {
          ...serializeChoice(product, sourceCategory.key, lang),
          category: addonCategory,
        };
      })
      .filter(Boolean);
  }

  return data;
}

async function resolveEntitlementDisplayCategories(subscription, { models = {} } = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions
    : [];
  const displayCategories = new Set();
  for (const entitlement of entitlements) {
    const snapshotProductIds = snapshotProductIdList(entitlement);
    if (!snapshotProductIds.length) {
      if (entitlement && entitlement.category) displayCategories.add(String(entitlement.category));
      continue;
    }
    const loadedProducts = await loadOwnedSnapshotProducts(snapshotProductIds, entitlement, {
      MenuProductModel: models.MenuProductModel,
    });
    const productsList = loadedProducts.map(p => p.product).filter(Boolean);
    const { rowsById: categoriesById, fallbackCategory } = await loadOwnedCategoryRowsForProducts(productsList, entitlement.category, { MenuCategoryModel: models.MenuCategoryModel });
    for (const { product } of loadedProducts) {
      if (!product) continue;
      const sourceCategory = categoriesById.get(String(product.categoryId)) || fallbackCategory;
      if (!sourceCategory) continue;
      const displayCategory = resolveDisplayCategoryForProduct(product, sourceCategory, {
        entitlementCategory: entitlement.category,
      });
      if (displayCategory) displayCategories.add(displayCategory);
    }
  }
  return [...displayCategories];
}

function overlayEntitlementMetadata(genericData, entitlementData) {
  const merged = { ...genericData };
  for (const [category, group] of Object.entries(entitlementData || {})) {
    const target = ensureCatalogEntry(merged, category, {
      ...emptyEntitlementCatalogEntry(category),
      catalogType: "generic",
    });
    if (group && Array.isArray(group.entitlements) && group.entitlements.length) {
      target.entitlements = [...(target.entitlements || []), ...group.entitlements];
    }
    for (const choice of group && Array.isArray(group.choices) ? group.choices : []) {
      mergeChoiceIntoCatalog(merged, category, choice, { preferCategory: true });
    }
  }
  return Object.fromEntries(
    Object.entries(merged).filter(([, group]) => group && Array.isArray(group.choices) && group.choices.length > 0)
  );
}

function filterCatalogToRequestedCategory(data, category) {
  const requestedCategory = normalizeOptionalCategory(category);
  if (!requestedCategory) return data;
  return data && data[requestedCategory] ? { [requestedCategory]: data[requestedCategory] } : {};
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
    const entitlementData = await buildSubscriptionAddonChoicesCatalog({
      lang,
      category,
      subscriptionId,
      userId,
      models,
    });
    return filterCatalogToRequestedCategory(entitlementData, category);
  }

  const SubscriptionModel = models.SubscriptionModel || mongoose.model("Subscription");
  let subscription = null;
  if (userId) {
    subscription = await findCurrentSubscriptionForUser(userId, { SubscriptionModel });
  }

  const extraDisplayCategories = subscription
    ? await resolveEntitlementDisplayCategories(subscription, { models })
    : [];
  const data = await buildGenericAddonChoicesCatalog({
    lang,
    category,
    extraDisplayCategories,
    models,
  });

  if (subscription && Array.isArray(subscription.addonSubscriptions) && subscription.addonSubscriptions.length > 0) {
    const entitlementData = await buildSubscriptionAddonChoicesCatalog({
      lang,
      category,
      subscription,
      userId,
      models,
    });
    const merged = overlayEntitlementMetadata(data, entitlementData);
    const entitlementEligibility = buildAddonEntitlementEligibility(subscription);
    for (const [groupCategory, group] of Object.entries(merged)) {
      for (const choice of group.choices || []) {
        if (choice.isEligibleForAllowance !== true) {
          choice.isEligibleForAllowance = isAddonChoiceEligibleForAllowance(
            entitlementEligibility,
            groupCategory,
            choice.id
          ) === true;
        }
      }
    }
    return filterCatalogToRequestedCategory(merged, category);
  }

  return filterCatalogToRequestedCategory(data, category);
}

function isOwnedResolutionHardError(err) {
  return [
    ERROR_CODE_ADDON_PLAN_MISMATCH,
    ERROR_CODE_BALANCE_BUCKET_MISMATCH,
    ERROR_CODE_ENTITLEMENT_CATEGORY_MISMATCH,
    ERROR_CODE_ENTITLEMENT_PRODUCT_NOT_FOUND,
    ERROR_CODE_SNAPSHOT_MISSING,
  ].includes(err && err.code);
}

function hasPersistedOwnedProductSnapshot(entitlement) {
  return (Array.isArray(entitlement && entitlement.menuProductIds) && entitlement.menuProductIds.length > 0)
    || (Array.isArray(entitlement && entitlement.menuProductsSnapshot) && entitlement.menuProductsSnapshot.length > 0);
}

async function resolveAddonChoiceProductById(productId, {
  subscription = null,
  entitlement = null,
  addonPlanId = null,
  category = null,
  balanceBucketId = null,
  userId = null,
  models = {},
} = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(productId || ""))) return null;

  if (subscription) {
    let owned = null;
    try {
      owned = await resolveOwnedAddonEntitlementChoice({
        subscription,
        productId,
        addonPlanId: addonPlanId || (entitlement && (entitlement.addonPlanId || entitlement.addonId)) || null,
        category: category || (entitlement && entitlement.category) || null,
        balanceBucketId,
        userId,
      });
      const results = await loadOwnedSnapshotProducts([productId], owned.entitlement, {
        MenuProductModel: models.MenuProductModel || MenuProduct,
      });
      if (results.length > 0 && results[0].product) {
        return {
          product: results[0].product,
          category: syntheticCategoryFromKey(owned.category),
          addonCategory: owned.category,
          fromOwnedSnapshot: results[0].fromSnapshot,
          ownedResolution: owned,
        };
      }
    } catch (err) {
      if (err && err.code === ERROR_CODE_SNAPSHOT_MISSING && owned && !hasPersistedOwnedProductSnapshot(owned.entitlement)) {
        // Historical exact Addon-item entitlements predate menu product
        // snapshots. Let the resolver continue to the Addon item fallback.
      } else {
        if (isOwnedResolutionHardError(err)) throw err;
        if (err && err.code !== ERROR_CODE_ENTITLEMENT_NOT_OWNED) throw err;
      }
    }
  }

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

  const menuCategory = await MenuCategoryModel.findOne(activePublishedQuery({
    _id: product.categoryId,
  })).lean();
  if (!menuCategory) return null;

  const addonCategory = resolveAddonCategoryForMenuProduct(product, menuCategory.key);
  if (addonCategory) {
    return {
      product,
      category: menuCategory,
      addonCategory,
    };
  }

  return null;
}

module.exports = {
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
  SUBSCRIPTION_ADDON_CATEGORIES,
  buildAddonChoicesCatalog,
  buildGenericAddonChoicesCatalog,
  buildSubscriptionAddonChoicesCatalog,
  buildAddonChoicePricingPreview,
  findCurrentSubscriptionForUser,
  isDailyAddonMenuProduct,
  resolveDisplayCategoryForProduct,
  resolveAddonChoiceProductById,
  serializeChoice,
};
