const mongoose = require("mongoose");
const Addon = require("../../models/Addon");
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
  ensureLegacyRecoveredAddonEntitlements,
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
  buildAddonSelectionAvailability,
} = require("./subscriptionAddonAvailabilityService");
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
  const availableForNewSale = product.availableForNewSale !== false;
  const availability = buildAddonSelectionAvailability({
    product,
    availableForNewSale,
  });
  // Historical rows may retain a scalar `name` in one language while
  // `nameI18n` contains the authoritative bilingual snapshot. Always
  // prefer the bilingual source so Accept-Language remains deterministic.
  const nameSource = product.nameI18n || product.name;
  const descriptionSource = product.descriptionI18n || product.description;
  return {
    id: String(product._id),
    productId: String(product._id),
    menuProductId: String(product._id),
    key: product.key || "",
    name: localized(nameSource, lang),
    nameAr: pickLang(nameSource, "ar") || "",
    nameEn: pickLang(nameSource, "en") || "",
    nameI18n: {
      ar: pickLang(nameSource, "ar") || "",
      en: pickLang(nameSource, "en") || "",
    },
    description: localized(descriptionSource, lang),
    descriptionI18n: {
      ar: pickLang(descriptionSource, "ar") || "",
      en: pickLang(descriptionSource, "en") || "",
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
    ...availability,
    snapshotMissing: product._snapshotMissing === true,
    liveCatalogMissing: product._liveCatalogMissing === true,
    ui: normalizeProductUiMetadata(product.ui),
  };
}

function objectIdString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
}

function uniqueIdStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(objectIdString)
    .map((value) => value.trim())
    .filter((value) => mongoose.Types.ObjectId.isValid(value)))];
}

function entitlementProductIds(entitlement) {
  return uniqueIdStrings([
    ...(Array.isArray(entitlement && entitlement.menuProductIds) ? entitlement.menuProductIds : []),
    ...(Array.isArray(entitlement && entitlement.menuProductsSnapshot)
      ? entitlement.menuProductsSnapshot.map((snapshot) => snapshot && (snapshot.id || snapshot._id || snapshot.productId))
      : []),
  ]);
}

function normalizeDynamicDisplayKey(value, fallbackId = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || String(fallbackId || "");
}

function firstLocalizedValue(source, lang) {
  if (source === undefined || source === null) return "";
  if (typeof source === "string") return source.trim();
  if (typeof source !== "object" || Array.isArray(source)) return "";
  const direct = source[lang];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return "";
}

function resolvePlanLocalizedFields(plan, entitlement, displayKey, lang) {
  const labelI18n = plan && (plan.labelI18n || plan.label) || null;
  const nameI18n = plan && (plan.nameI18n || plan.name)
    || entitlement && entitlement.addonPlanNameI18n
    || null;
  const entitlementName = String(entitlement && (entitlement.addonPlanName || entitlement.name) || "").trim();
  const labelAr = String(
    plan && (plan.labelAr || plan.titleAr || plan.nameAr) || ""
  ).trim()
    || firstLocalizedValue(labelI18n, "ar")
    || firstLocalizedValue(nameI18n, "ar")
    || entitlementName;
  const labelEn = String(
    plan && (plan.labelEn || plan.titleEn || plan.nameEn) || ""
  ).trim()
    || firstLocalizedValue(labelI18n, "en")
    || firstLocalizedValue(nameI18n, "en")
    || entitlementName;
  const fallback = displayKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || objectIdString(plan && plan._id);
  const resolvedAr = labelAr || labelEn || fallback;
  const resolvedEn = labelEn || labelAr || fallback;
  const label = lang === "ar" ? resolvedAr : resolvedEn;
  return {
    label,
    labelText: label,
    labelAr: resolvedAr,
    labelEn: resolvedEn,
    labelI18n: { ar: resolvedAr, en: resolvedEn },
    addonPlanName: label,
    nameAr: resolvedAr,
    nameEn: resolvedEn,
    nameI18n: { ar: resolvedAr, en: resolvedEn },
  };
}

function normalizePlanDisplayKey(value) {
  return normalizeDynamicDisplayKey(value);
}

function normalizeProductDisplayKey(value) {
  return normalizeDynamicDisplayKey(normalizeDisplayCategoryKey(value));
}

function uniquePlanDisplayKey(values) {
  const keys = (Array.isArray(values) ? values : [])
    .map((value) => normalizePlanDisplayKey(value))
    .filter(Boolean);
  const uniqueKeys = [...new Set(keys)];
  return uniqueKeys.length === 1 ? uniqueKeys[0] : "";
}

async function loadPlanDisplayMetadata(plans, {
  MenuProductModel = MenuProduct,
  MenuCategoryModel = MenuCategory,
} = {}) {
  const planRows = Array.isArray(plans) ? plans.filter(Boolean) : [];
  const productIds = uniqueIdStrings(planRows.flatMap((plan) => (
    Array.isArray(plan.menuProductIds) ? plan.menuProductIds : []
  )));
  if (!productIds.length) {
    return { productsById: new Map(), categoriesById: new Map() };
  }

  // Display identity must describe every product configured on the dashboard
  // plan, including a temporarily hidden or unavailable product. Choice
  // availability is filtered separately by loadLivePlanProducts().
  const products = await MenuProductModel.find({ _id: { $in: productIds } }).lean();
  const productsById = new Map(products.map((product) => [objectIdString(product._id), product]));
  const categoryIds = uniqueIdStrings(products.map((product) => product && product.categoryId));
  const categories = categoryIds.length
    ? await MenuCategoryModel.find({ _id: { $in: categoryIds } }).lean()
    : [];
  return {
    productsById,
    categoriesById: new Map(categories.map((category) => [objectIdString(category._id), category])),
  };
}

function inferPlanProductDisplayKey(plan, { productsById, categoriesById }) {
  const productIds = uniqueIdStrings(Array.isArray(plan && plan.menuProductIds) ? plan.menuProductIds : []);
  if (!productIds.length) return "";

  const productKeys = [];
  for (const productId of productIds) {
    const product = productsById.get(productId);
    if (!product) return "";
    const category = categoriesById.get(objectIdString(product.categoryId));
    const categoryKey = normalizeProductDisplayKey(
      product.categoryKey || category && category.key || product.category
    );
    const itemTypeKey = normalizeProductDisplayKey(product.itemType);
    const meaningfulItemType = itemTypeKey
      && !["addon", "item", "product", "subscription"].includes(itemTypeKey)
      ? itemTypeKey
      : "";
    const productKey = meaningfulItemType || categoryKey;
    if (!productKey) return "";
    productKeys.push(productKey);
  }
  return uniquePlanDisplayKey(productKeys);
}

function planDisplayKey(plan, planId, displayMetadata) {
  // These values belong to the dashboard plan. Subscription entitlement and
  // balance fields are intentionally absent from this resolver.
  for (const value of [
    plan && plan.displayKey,
    plan && plan.displayCategory,
    plan && plan.categoryKey,
    plan && plan.displayCategoryKey,
  ]) {
    const key = normalizePlanDisplayKey(value);
    if (key) return key;
  }

  const categoryKey = normalizePlanDisplayKey(plan && plan.category);
  if (categoryKey) return categoryKey;

  for (const value of [plan && plan.slug, plan && plan.key]) {
    const key = normalizePlanDisplayKey(value);
    if (key) return key;
  }

  const configuredKey = uniquePlanDisplayKey(
    Array.isArray(plan && plan.menuCategoryKeys) ? plan.menuCategoryKeys : []
  );
  if (configuredKey) return configuredKey;

  return inferPlanProductDisplayKey(plan, displayMetadata) || String(planId || "");
}

function numericPlanOrder(plan) {
  for (const value of [
    plan && plan.sortOrder,
    plan && plan.displayOrder,
    plan && plan.order,
  ]) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function loadDynamicAddonPlans(subscription, { AddonModel = Addon } = {}) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions)
    ? subscription.addonSubscriptions.filter(Boolean)
    : [];
  const purchasedPlanIds = uniqueIdStrings(entitlements.map((entitlement) => (
    entitlement && (entitlement.addonPlanId || entitlement.addonId)
  )));

  const activeRows = await AddonModel.find({
    kind: "plan",
    isActive: true,
    isArchived: { $ne: true },
  }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const rowsById = new Map(activeRows.map((row) => [objectIdString(row._id), row]));
  const missingPurchasedIds = purchasedPlanIds.filter((id) => !rowsById.has(id));
  if (missingPurchasedIds.length) {
    const purchasedRows = await AddonModel.find({
      _id: { $in: missingPurchasedIds },
      kind: "plan",
    }).lean();
    for (const row of purchasedRows) rowsById.set(objectIdString(row._id), row);
  }
  return { rowsById, entitlements };
}

async function loadLivePlanProducts(productIds, {
  MenuProductModel = MenuProduct,
} = {}) {
  const ids = uniqueIdStrings(productIds);
  if (!ids.length) return [];
  const rows = await MenuProductModel.find(activePublishedQuery({
    _id: { $in: ids },
    ...availableForChannelQuery("one_time"),
  })).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  const usableById = new Map(
    filterGloballyAvailable(rows, catalogItemsById)
      .filter(isDailyAddonMenuProduct)
      .map((row) => [objectIdString(row._id), row])
  );
  return ids.map((id) => usableById.get(id)).filter(Boolean);
}

function buildAddonChoicesCompatibilityMap(groups) {
  const data = {};
  const rows = Array.isArray(groups) ? groups : [];
  const displayKeyCounts = rows.reduce((counts, group) => {
    const key = normalizeDynamicDisplayKey(group.displayKey, group.addonPlanId);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  for (const group of rows) {
    const preferredKey = normalizeDynamicDisplayKey(group.displayKey, group.addonPlanId);
    const key = displayKeyCounts.get(preferredKey) === 1
      ? preferredKey
      : `${preferredKey}:${group.addonPlanId}`;
    data[key] = {
      category: group.displayCategory,
      displayKey: group.displayKey,
      displayCategory: group.displayCategory,
      groupId: group.groupId,
      addonPlanId: group.addonPlanId,
      addonPlanName: group.addonPlanName,
      allowanceCategory: group.allowanceCategory,
      entitlementCategory: group.entitlementCategory,
      label: group.label,
      labelText: group.labelText,
      labelAr: group.labelAr,
      labelEn: group.labelEn,
      labelI18n: group.labelI18n,
      source: group.source,
      isPurchased: group.isPurchased,
      includedTotalQty: group.includedTotalQty,
      remainingIncludedQty: group.remainingIncludedQty,
      choices: group.choices,
      entitlements: group.entitlements,
      catalogType: "addon_plan_groups_compatibility",
    };
  }
  return data;
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
    id: preview.id,
    productId: preview.productId,
    menuProductId: preview.menuProductId,
    addonId: preview.addonId,
    addonPlanId: preview.addonPlanId,
    entitlementKey: preview.entitlementKey,
    balanceBucketId: preview.balanceBucketId,
    entitlementCategory: preview.entitlementCategory,
    ownedSnapshot: preview.ownedSnapshot,
    legacyRecovered: preview.legacyRecovered,
    legacySourceProductId: preview.legacySourceProductId,
    isEligibleForAllowance: preview.isEligibleForAllowance,
    source: preview.source,
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
    remainingQty: preview.remainingQty,
    includedTotalQty: preview.includedTotalQty,
    maxPerDay: preview.maxPerDay,
  };
}

function buildGenericChoicePricingMetadata(product, subscription = null, category = null) {
  const preview = buildAddonChoicePricingPreview({
    subscription,
    product,
    category,
    quantity: 1,
  });
  return {
    productId: preview.productId,
    menuProductId: preview.menuProductId,
    addonId: preview.addonId,
    addonPlanId: preview.addonPlanId,
    entitlementKey: preview.entitlementKey,
    balanceBucketId: preview.balanceBucketId,
    entitlementCategory: preview.entitlementCategory,
    ownedSnapshot: preview.ownedSnapshot,
    legacyRecovered: preview.legacyRecovered,
    legacySourceProductId: preview.legacySourceProductId,
    isEligibleForAllowance: preview.isEligibleForAllowance,
    source: preview.source,
    requestedQty: preview.requestedQty,
    freeQtyAvailable: preview.freeQtyAvailable,
    coveredQty: preview.coveredQty,
    paidQty: preview.paidQty,
    payableTotalHalala: preview.payableTotalHalala,
    pricingMode: preview.pricingMode,
    unitPriceHalala: preview.unitPriceHalala,
    currency: preview.currency,
    remainingBefore: preview.remainingBefore,
    remainingAfter: preview.remainingAfter,
    remainingQty: preview.remainingQty,
    includedTotalQty: preview.includedTotalQty,
    maxPerDay: preview.maxPerDay,
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
        AddonModel: models.AddonModel,
        MenuProductModel: models.MenuProductModel,
        entitlementIndex: index,
        subscription,
      });
    }

    const productsList = loadedProducts.map(p => p.product).filter(Boolean);
    const { rowsById: categoriesById, fallbackCategory } = await loadOwnedCategoryRowsForProducts(productsList, entitlementCategory, { MenuCategoryModel: models.MenuCategoryModel });
    const metadata = buildEntitlementMetadata(subscription, entitlement, index);
    const groupedChoices = new Map();
    for (const {
      product,
      fromSnapshot,
      snapshotMissing,
      liveCatalogMissing,
      legacyRecovered,
      legacySourceProductId,
    } of loadedProducts) {
      if (!product) continue;
      const sourceCategory = categoriesById.get(String(product.categoryId)) || fallbackCategory;
      if (!sourceCategory) continue;
      const displayCategory = resolveDisplayCategoryForProduct(product, sourceCategory, { entitlementCategory });
      if (!displayCategory || !requestedCategoryMatches(requestedCategory, displayCategory)) continue;
      const serialized = serializeChoice(product, sourceCategory.key, lang);
      const pricing = buildChoicePricingMetadata(subscription, entitlement, product);
      const ownedSnapshot = fromSnapshot === true;
      const availability = buildAddonSelectionAvailability({
        product,
        pricing,
        ownedSnapshot: ownedSnapshot || legacyRecovered === true,
        snapshotMissing: snapshotMissing === true && legacyRecovered !== true,
        liveCatalogMissing: liveCatalogMissing === true,
        availableForNewSale: false,
      });
      const choice = {
        ...serialized,
        ...metadata,
        ...pricing,
        ...availability,
        category: displayCategory,
        entitlementCategory,
        ownedSnapshot,
        snapshotMissing: snapshotMissing === true,
        liveCatalogMissing: liveCatalogMissing === true,
        legacyRecovered: legacyRecovered === true,
        legacySourceProductId: legacySourceProductId || null,
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
        const serialized = serializeChoice(product, sourceCategory.key, lang);
        const pricing = buildGenericChoicePricingMetadata(product, null, addonCategory);
        return {
          ...serialized,
          ...pricing,
          ...buildAddonSelectionAvailability({
            product,
            pricing,
            availableForNewSale: serialized.availableForNewSale,
          }),
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
  for (const [entitlementIndex, entitlement] of entitlements.entries()) {
    const snapshotProductIds = snapshotProductIdList(entitlement);
    if (!snapshotProductIds.length) {
      if (entitlement && entitlement.category) displayCategories.add(String(entitlement.category));
      continue;
    }
    const loadedProducts = await loadOwnedSnapshotProducts(snapshotProductIds, entitlement, {
      AddonModel: models.AddonModel,
      MenuProductModel: models.MenuProductModel,
      entitlementIndex,
      subscription,
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
    for (const [groupCategory, group] of Object.entries(merged)) {
      for (const choice of group.choices || []) {
        const availabilityMetadata = {
          ownedSnapshot: choice.ownedSnapshot === true,
          snapshotMissing: choice.snapshotMissing === true,
          liveCatalogMissing: choice.liveCatalogMissing === true,
          legacyRecovered: choice.legacyRecovered === true,
          legacySourceProductId: choice.legacySourceProductId || null,
          availableForNewSale: choice.availableForNewSale !== false,
          catalogAvailable: choice.catalogAvailable === true,
          catalogActive: choice.catalogActive === true,
          liveCatalogAvailable: choice.liveCatalogAvailable === true,
          liveCatalogActive: choice.liveCatalogActive === true,
        };
        const authoritative = buildGenericChoicePricingMetadata({
          _id: choice.id,
          priceHalala: choice.priceHalala,
          currency: choice.currency,
          maxPerDay: choice.maxPerDay,
        }, subscription, groupCategory);
        Object.assign(choice, authoritative);
        Object.assign(choice, buildAddonSelectionAvailability({
          pricing: authoritative,
          ...availabilityMetadata,
          ownedSnapshot: availabilityMetadata.ownedSnapshot || availabilityMetadata.legacyRecovered,
          snapshotMissing: availabilityMetadata.snapshotMissing && !availabilityMetadata.legacyRecovered,
        }));
        Object.assign(choice, availabilityMetadata);
      }
    }
    return filterCatalogToRequestedCategory(merged, category);
  }

  return filterCatalogToRequestedCategory(data, category);
}

async function buildAddonChoiceGroups({
  lang = "en",
  category,
  subscriptionId = null,
  userId = null,
  subscription: suppliedSubscription = null,
  models = {},
} = {}) {
  const SubscriptionModel = models.SubscriptionModel || mongoose.model("Subscription");
  const AddonModel = models.AddonModel || Addon;
  let subscription = suppliedSubscription;
  if (!subscription && subscriptionId) {
    if (!mongoose.Types.ObjectId.isValid(String(subscriptionId))) {
      throw createServiceError(400, "INVALID_ID", "subscriptionId is not a valid id");
    }
    subscription = await SubscriptionModel.findById(subscriptionId).lean();
    if (!subscription) throw createServiceError(404, "NOT_FOUND", "Subscription not found");
  } else if (!subscription && userId) {
    subscription = await findCurrentSubscriptionForUser(userId, { SubscriptionModel });
  }
  if (subscription && userId && String(subscription.userId || "") !== String(userId)) {
    throw createServiceError(403, "FORBIDDEN", "Subscription does not belong to the authenticated user");
  }

  const { rowsById: planRowsById, entitlements } = await loadDynamicAddonPlans(subscription, { AddonModel });
  const entitlementRows = entitlements.map((entitlement, entitlementIndex) => ({
    entitlement,
    entitlementIndex,
    addonPlanId: objectIdString(entitlement && (entitlement.addonPlanId || entitlement.addonId)),
  })).filter((row) => row.addonPlanId);
  const entitlementByPlanId = new Map(entitlementRows.map((row) => [row.addonPlanId, row]));
  const allPlanIds = [...new Set([
    ...planRowsById.keys(),
    ...entitlementRows.map((row) => row.addonPlanId),
  ])];
  const requestedDisplayKey = category
    ? normalizeDynamicDisplayKey(category)
    : "";
  const displayMetadata = await loadPlanDisplayMetadata([...planRowsById.values()], {
    MenuProductModel: models.MenuProductModel || MenuProduct,
    MenuCategoryModel: models.MenuCategoryModel || MenuCategory,
  });
  const groups = [];

  for (const addonPlanId of allPlanIds) {
    const plan = planRowsById.get(addonPlanId) || null;
    const entitlementRow = entitlementByPlanId.get(addonPlanId) || null;
    const entitlement = entitlementRow && entitlementRow.entitlement;
    const displayKey = planDisplayKey(plan, addonPlanId, displayMetadata);
    if (requestedDisplayKey && requestedDisplayKey !== displayKey && requestedDisplayKey !== addonPlanId) {
      continue;
    }
    const entitlementCategory = String(
      entitlement && (entitlement.entitlementCategory || entitlement.category) || ""
    ).trim();
    const allowanceCategory = String(
      entitlement && (entitlement.allowanceCategory || entitlement.category)
      || plan && (plan.allowanceCategory || plan.category)
      || ""
    ).trim();
    const configuredProductIds = uniqueIdStrings([
      ...(Array.isArray(plan && plan.menuProductIds) ? plan.menuProductIds : []),
      ...entitlementProductIds(entitlement),
    ]);
    const entitlementIds = new Set(entitlementProductIds(entitlement));
    const loadedById = new Map();
    const ownedMetadataById = new Map();

    if (entitlement && entitlementIds.size) {
      const ownedRows = await loadOwnedSnapshotProducts([...entitlementIds], entitlement, {
        AddonModel,
        MenuProductModel: models.MenuProductModel,
        entitlementIndex: entitlementRow.entitlementIndex,
        subscription,
      });
      for (const owned of ownedRows) {
        if (!owned || !owned.product) continue;
        const productId = objectIdString(owned.product._id);
        loadedById.set(productId, owned.product);
        ownedMetadataById.set(productId, owned);
      }
    }

    const missingLiveIds = configuredProductIds.filter((id) => !loadedById.has(id));
    const liveProducts = await loadLivePlanProducts(missingLiveIds, {
      MenuProductModel: models.MenuProductModel || MenuProduct,
    });
    for (const product of liveProducts) loadedById.set(objectIdString(product._id), product);

    const products = configuredProductIds.map((id) => loadedById.get(id)).filter(Boolean);
    const categoriesById = await loadCategoryRowsForProducts(products, {
      MenuCategoryModel: models.MenuCategoryModel || MenuCategory,
    });
    const choices = products.map((product) => {
      const productId = objectIdString(product._id);
      const categoryRow = categoriesById.get(objectIdString(product.categoryId));
      const serialized = serializeChoice(
        product,
        categoryRow && categoryRow.key || product.categoryKey || product.category || product.itemType || "",
        lang
      );
      const isEntitledProduct = Boolean(entitlement && entitlementIds.has(productId));
      const pricing = isEntitledProduct
        ? buildChoicePricingMetadata(subscription, entitlement, product)
        : buildGenericChoicePricingMetadata(product, subscription, allowanceCategory);
      const isOwnedChoice = isEntitledProduct
        || pricing.isEligibleForAllowance === true;
      const owned = ownedMetadataById.get(productId);
      const ownedSnapshot = owned ? owned.fromSnapshot === true : pricing.ownedSnapshot;
      const snapshotMissing = owned ? owned.snapshotMissing === true : serialized.snapshotMissing;
      const liveCatalogMissing = owned ? owned.liveCatalogMissing === true : serialized.liveCatalogMissing;
      const availableForNewSale = isOwnedChoice ? false : serialized.availableForNewSale;
      return {
        ...serialized,
        ...pricing,
        ...buildAddonSelectionAvailability({
          product,
          pricing,
          ownedSnapshot: ownedSnapshot || Boolean(owned && owned.legacyRecovered),
          snapshotMissing: snapshotMissing && !Boolean(owned && owned.legacyRecovered),
          liveCatalogMissing,
          availableForNewSale,
        }),
        addonPlanId,
        category: displayKey,
        displayCategory: displayKey,
        allowanceCategory,
        entitlementCategory: entitlementCategory || null,
        ownedSnapshot,
        snapshotMissing,
        liveCatalogMissing,
        legacyRecovered: owned ? owned.legacyRecovered === true : pricing.legacyRecovered,
        legacySourceProductId: owned && owned.legacySourceProductId || pricing.legacySourceProductId || null,
        availableForNewSale,
      };
    });
    const balance = entitlement
      ? resolveEntitlementBalance(subscription, entitlement)
      : { includedTotalQty: 0, remainingQty: 0, bucket: null };
    const localizedFields = resolvePlanLocalizedFields(plan, entitlement, displayKey, lang);
    const sortOrder = numericPlanOrder(plan);
    const entitlementIndex = entitlementRow ? entitlementRow.entitlementIndex : Number.POSITIVE_INFINITY;

    groups.push({
      groupId: addonPlanId,
      addonPlanId,
      ...localizedFields,
      displayKey,
      displayCategory: displayKey,
      category: displayKey,
      allowanceCategory,
      entitlementCategory: entitlementCategory || allowanceCategory || null,
      sortOrder: sortOrder == null
        ? (Number.isFinite(entitlementIndex) ? entitlementIndex : 0)
        : sortOrder,
      isPurchased: Boolean(entitlement),
      source: entitlement ? "subscription" : "catalog",
      includedTotalQty: Number(balance.includedTotalQty || 0),
      remainingIncludedQty: Number(balance.remainingQty || 0),
      balanceBucketId: balance.bucket && balance.bucket._id ? String(balance.bucket._id) : null,
      choicesCount: choices.length,
      choices,
      entitlements: entitlement ? [{
        entitlementIndex: entitlementRow.entitlementIndex,
        entitlementKey: `${entitlementCategory || "addon"}:${addonPlanId}`,
        addonPlanId,
        allowanceCategory,
        includedTotalQty: Number(balance.includedTotalQty || 0),
        remainingQty: Number(balance.remainingQty || 0),
      }] : [],
      _sortOrder: sortOrder,
      _entitlementIndex: entitlementIndex,
    });
  }

  groups.sort((left, right) => {
    const leftHasOrder = Number.isFinite(left._sortOrder);
    const rightHasOrder = Number.isFinite(right._sortOrder);
    if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
    if (leftHasOrder && left._sortOrder !== right._sortOrder) return left._sortOrder - right._sortOrder;
    if (left._entitlementIndex !== right._entitlementIndex) return left._entitlementIndex - right._entitlementIndex;
    const labelOrder = String(left.addonPlanName || "").localeCompare(String(right.addonPlanName || ""), lang);
    if (labelOrder !== 0) return labelOrder;
    return left.addonPlanId.localeCompare(right.addonPlanId);
  });

  return groups.map(({ _sortOrder, _entitlementIndex, ...group }) => group);
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
    await ensureLegacyRecoveredAddonEntitlements(subscription, {
      AddonModel: models.AddonModel || mongoose.models.Addon,
      MenuProductModel: models.MenuProductModel || MenuProduct,
    });
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
        AddonModel: models.AddonModel || mongoose.models.Addon,
        MenuProductModel: models.MenuProductModel || MenuProduct,
        entitlementIndex: owned.entitlementIndex,
        subscription,
      });
      if (results.length > 0 && results[0].product) {
        const resolvedProduct = results[0].snapshotMissing === true
          ? {
            ...results[0].product,
            priceHalala: Number.isInteger(Number(owned.unitPriceHalala))
              ? Math.max(0, Number(owned.unitPriceHalala))
              : Number(results[0].product.priceHalala || 0),
            currency: owned.currency || results[0].product.currency || SYSTEM_CURRENCY,
          }
          : results[0].product;
        return {
          product: resolvedProduct,
          category: syntheticCategoryFromKey(owned.category),
          addonCategory: owned.category,
          fromOwnedSnapshot: results[0].fromSnapshot,
          snapshotMissing: results[0].snapshotMissing === true,
          liveCatalogMissing: results[0].liveCatalogMissing === true,
          legacyRecovered: results[0].legacyRecovered === true,
          legacySourceProductId: results[0].legacySourceProductId || null,
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
  buildAddonChoiceGroups,
  buildAddonChoicesCompatibilityMap,
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
