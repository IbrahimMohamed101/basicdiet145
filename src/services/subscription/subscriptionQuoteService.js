const Plan = require("../../models/Plan");
const BuilderProtein = require("../../models/BuilderProtein");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const Addon = require("../../models/Addon");
const AddonPlanPrice = require("../../models/AddonPlanPrice");
const Zone = require("../../models/Zone");
const Setting = require("../../models/Setting");
const dateUtils = require("../../utils/date");
const validateObjectId = require("../../utils/validateObjectId");
const { pickLang } = require("../../utils/i18n");
const { SYSTEM_CURRENCY, assertSystemCurrencyOrThrow } = require("../../utils/currency");
const { computeInclusiveVatBreakdown } = require("../../utils/pricing");
const { VAT_PERCENTAGE } = require("../../config/vat");
const {
  resolvePickupLocationSelection,
  resolveAddonChargeTotalHalala,
  resolveSubscriptionAddonBillingMode,
  formatWindowLabel,
} = require("../../utils/subscription/subscriptionCatalog");
const { applyPromoCodeToSubscriptionQuote } = require("../promoCodeService");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { resolveCanonicalPremiumIdentity, normalizePremiumItemKey } = require("../../utils/subscription/premiumIdentity");
const { resolveSubscriptionPremiumUpgradePricing } = require("./premiumUpgradeConfigService");
const {
  assertPremiumUpgradeLimit,
  buildPremiumUpgradeLimit,
  resolveTotalSubscriptionMealsFromQuote,
} = require("./premiumUpgradeLimitService");
const {
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const {
  availableForChannelQuery,
} = require("./subscriptionMenuEligibilityPolicyService");
const {
  normalizeSubscriptionAddonCategory,
} = require("./subscriptionAddonPolicyService");

async function findMenuPremiumOptionsByIds(ids) {
  if (!ids.length) return [];
  const group = await MenuOptionGroup.findOne({ key: "proteins", isActive: true }).lean();
  if (!group) return [];
  const rows = await MenuOption.find({
    _id: { $in: ids },
    groupId: group._id,
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    availableForSubscription: { $ne: false },
    ...availableForChannelQuery("subscription"),
    extraPriceHalala: { $gt: 0 },
  }).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(rows);
  return filterGloballyAvailable(rows, catalogItemsById);
}

function mapMenuPremiumOptionForQuote(option) {
  return {
    _id: option._id,
    name: option.name,
    description: option.description,
    imageUrl: option.imageUrl || "",
    currency: option.currency || SYSTEM_CURRENCY,
    extraFeeHalala: Number(option.extraPriceHalala || 0),
    nutrition: option.nutrition || {},
    isPremium: true,
    premiumKey: option.premiumKey || option.key,
    isActive: option.isActive,
    sortOrder: option.sortOrder || 0,
    _sourceModel: "MenuOption",
  };
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function parsePositiveInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  return parseNonNegativeInteger(rawValue);
}

function sumCheckoutPremiumItemsQty(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Number(item && item.qty ? item.qty : 0),
    0
  );
}

function resolveAddonUnitPriceHalala(addon) {
  if (!addon || typeof addon !== "object") {
    return 0;
  }
  if (Number.isInteger(addon.priceHalala)) {
    return addon.priceHalala;
  }
  const parsedPrice = Number(addon.price);
  if (Number.isFinite(parsedPrice) && parsedPrice >= 0) {
    return Math.round(parsedPrice * 100);
  }
  return 0;
}

function localizedNameObject(value = {}) {
  return {
    ar: String((value && value.ar) || ""),
    en: String((value && value.en) || ""),
  };
}

function normalizeSlotInput(slot = {}) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    return { type: "delivery", window: "", slotId: "" };
  }
  const type = slot.type && ["delivery", "pickup"].includes(slot.type) ? slot.type : "delivery";
  return {
    type,
    window: slot.window === undefined || slot.window === null ? "" : String(slot.window).trim(),
    slotId: slot.slotId === undefined || slot.slotId === null ? "" : String(slot.slotId).trim(),
  };
}

function createDeliverySlotError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.status = 422;
  return err;
}

function normalizeWindowValue(value) {
  return String(value || "").trim();
}

function normalizeDeliveryWindowOption(rawWindow, index, lang) {
  const fallbackId = `delivery_slot_${index + 1}`;
  if (typeof rawWindow === "string") {
    const window = normalizeWindowValue(rawWindow);
    return window
      ? {
        id: fallbackId,
        slotId: fallbackId,
        type: "delivery",
        window,
        label: formatWindowLabel(window, lang) || window,
      }
      : null;
  }
  if (!rawWindow || typeof rawWindow !== "object" || Array.isArray(rawWindow)) {
    return null;
  }
  const window = normalizeWindowValue(rawWindow.window || rawWindow.value || rawWindow.deliveryWindow);
  if (!window) return null;
  const id = normalizeWindowValue(rawWindow.id || rawWindow.slotId || fallbackId);
  return {
    id,
    slotId: id,
    type: "delivery",
    window,
    label: normalizeWindowValue(pickLang(rawWindow.label, lang) || rawWindow.label) || formatWindowLabel(window, lang) || window,
  };
}

function resolveDeliverySlotOrThrow(slot, windows, lang) {
  const options = Array.isArray(windows)
    ? windows.map((windowValue, index) => normalizeDeliveryWindowOption(windowValue, index, lang)).filter(Boolean)
    : [];

  if (!options.length) {
    throw createDeliverySlotError("DELIVERY_WINDOW_MISSING", "No delivery windows are configured");
  }

  const slotId = normalizeWindowValue(slot && slot.slotId);
  const requestedWindow = normalizeWindowValue(slot && slot.window);

  if (!slotId) {
    throw createDeliverySlotError("DELIVERY_WINDOW_MISSING", "delivery.slotId is required for delivery subscriptions");
  }

  const resolved = options.find((option) => option.id === slotId || option.slotId === slotId);

  if (!resolved) {
    throw createDeliverySlotError("INVALID_DELIVERY_SLOT", "Invalid delivery slot");
  }

  if (requestedWindow && requestedWindow !== resolved.window) {
    throw createDeliverySlotError("INVALID_DELIVERY_SLOT", "delivery slotId does not match delivery window");
  }

  return {
    type: "delivery",
    slotId: resolved.slotId,
    window: resolved.window,
    label: resolved.label,
  };
}

function normalizePremiumCheckoutPayloadItems(rawItems) {
  if (rawItems === undefined || rawItems === null) {
    return rawItems;
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error("premiumItems must be an array");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return rawItems.map((item) => {
    if (typeof item === "string") {
      return { premiumKey: normalizePremiumItemKey(item), qty: 1 };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const explicitProtein = item.proteinId;
    const legacyMealKey = item.premiumMealId;
    const premiumKeyInput = item.premiumKey;
    const resolved = explicitProtein != null ? explicitProtein : legacyMealKey;
    const resolvedStr = String(resolved || "");

    if (premiumKeyInput && typeof premiumKeyInput === "string" && premiumKeyInput.trim()) {
      return { ...item, premiumKey: normalizePremiumItemKey(premiumKeyInput) };
    }

    const normalizedResolvedKey = normalizePremiumItemKey(resolvedStr);
    if (normalizedResolvedKey === "premium_large_salad") {
      return { ...item, proteinId: undefined, premiumMealId: undefined, premiumKey: normalizedResolvedKey };
    }
    
    if (explicitProtein != null && legacyMealKey != null && String(explicitProtein) !== String(legacyMealKey)) {
      const err = new Error("premiumItems entry must not set proteinId and premiumMealId to different values");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    
    if (resolved == null) {
      return item;
    }
    return { ...item, proteinId: resolved };
  });
}

function normalizeCheckoutItemsOrThrow(rawItems, idField, itemName) {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error(`${itemName} must be an array`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const byId = new Map();
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const err = new Error(`${itemName} must contain objects`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const itemId = item[idField];
    try {
      validateObjectId(itemId, idField);
    } catch (_err) {
      const err = new Error(`${idField} must be a valid ObjectId`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const qty = parsePositiveInteger(item.qty);
    if (!qty) {
      const err = new Error(`qty must be a positive integer for ${itemName}`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    byId.set(String(itemId), (byId.get(String(itemId)) || 0) + qty);
  }

  return Array.from(byId.entries()).map(([id, qty]) => ({ id, qty }));
}

function normalizePremiumItemsByKey(rawItems) {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error("premiumItems must be an array");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const byKey = new Map();
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const err = new Error("premiumItems must contain objects");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const premiumKey = item.premiumKey;
    if (!premiumKey || typeof premiumKey !== "string" || !premiumKey.trim()) {
      const err = new Error("premiumItems entry must have premiumKey");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const qty = parsePositiveInteger(item.qty);
    if (!qty) {
      const err = new Error("qty must be a positive integer for premiumItems");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const key = normalizePremiumItemKey(premiumKey);
    byKey.set(key, (byKey.get(key) || 0) + qty);
  }

  return Array.from(byKey.entries()).map(([premiumKey, qty]) => ({ premiumKey, qty }));
}

function createAddonSelectionError(code, message, field, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = code === "ADDON_PLAN_NOT_FOUND" || code === "ADDON_PRODUCT_NOT_FOUND"
    ? 404
    : code === "INVALID_ADDON_SELECTION"
      ? 400
      : 422;
  err.field = field;
  err.details = { field, ...details };
  return err;
}

function assertCheckoutObjectId(value, field, code = "INVALID_ADDON_SELECTION") {
  try {
    validateObjectId(value, field);
  } catch (_err) {
    throw createAddonSelectionError(code, `${field} must be a valid ObjectId`, field);
  }
  return String(value);
}

function normalizeCheckoutAddonSelectionShape(item, index = 0) {
  const sourceRequestShape = typeof item === "string" ? "legacy_string_id" : "object";
  const raw = typeof item === "string"
    ? { id: item }
    : item && typeof item === "object" && !Array.isArray(item)
      ? item
      : null;
  if (!raw) {
    throw createAddonSelectionError("INVALID_ADDON_SELECTION", "addons must contain strings or objects", `addons[${index}]`);
  }

  let quantityPerDay = 1;
  const rawQty = raw.quantityPerDay !== undefined
    ? raw.quantityPerDay
    : raw.qty !== undefined
      ? raw.qty
      : raw.quantity;
  if (rawQty !== undefined) {
    quantityPerDay = Number(rawQty);
    if (!Number.isInteger(quantityPerDay) || quantityPerDay < 1 || typeof rawQty === "string") {
      throw createAddonSelectionError("INVALID_ADDON_SELECTION", "quantityPerDay must be an integer >= 1", `addons[${index}].quantityPerDay`);
    }
  }

  const explicitAddonPlanId = raw.addonPlanId != null && String(raw.addonPlanId).trim()
    ? assertCheckoutObjectId(raw.addonPlanId, `addons[${index}].addonPlanId`)
    : null;
  const explicitAddonId = raw.addonId != null && String(raw.addonId).trim()
    ? assertCheckoutObjectId(raw.addonId, `addons[${index}].addonId`)
    : null;
  const explicitProductId = raw.productId != null && String(raw.productId).trim()
    ? assertCheckoutObjectId(raw.productId, `addons[${index}].productId`)
    : raw.menuProductId != null && String(raw.menuProductId).trim()
      ? assertCheckoutObjectId(raw.menuProductId, `addons[${index}].menuProductId`)
      : null;
  const explicitMenuProductIds = Array.isArray(raw.menuProductIds)
    ? raw.menuProductIds.map((id, productIndex) => assertCheckoutObjectId(id, `addons[${index}].menuProductIds[${productIndex}]`))
    : [];
  const legacyId = raw.id != null && String(raw.id).trim()
    ? assertCheckoutObjectId(raw.id, `addons[${index}].id`)
    : null;
  const category = raw.category != null && String(raw.category).trim()
    ? String(raw.category).trim().toLowerCase()
    : null;

  const productIds = [];
  if (explicitProductId) productIds.push(explicitProductId);
  for (const id of explicitMenuProductIds) productIds.push(id);

  return {
    addonPlanId: explicitAddonPlanId || explicitAddonId || null,
    addonId: explicitAddonId || explicitAddonPlanId || null,
    productIds,
    category,
    quantityPerDay,
    legacyId,
    sourceRequestShape,
    raw,
  };
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "")).filter(Boolean))];
}

function isNewSaleProductUsable(product) {
  return Boolean(product)
    && product.isActive !== false
    && product.isVisible !== false
    && product.isAvailable !== false
    && product.publishedAt != null
    && String(product.kind || "").toLowerCase() !== "plan"
    && String(product.type || "").toLowerCase() !== "subscription"
    && String(product.itemType || "").toLowerCase() !== "subscription"
    && String(product.billingMode || "").toLowerCase() !== "per_day";
}

function normalizeAddonPlanCategory(addon) {
  return normalizeSubscriptionAddonCategory(addon && addon.category, { allowEmpty: true }) || String(addon && addon.category || "").trim().toLowerCase();
}

async function resolveCheckoutAddonSelectionsOrThrow(rawItems, { basePlanId } = {}) {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    throw createAddonSelectionError("INVALID_ADDON_SELECTION", "addons must be an array", "addons");
  }

  const shapes = rawItems.map((item, index) => normalizeCheckoutAddonSelectionShape(item, index));
  const candidateIds = uniqueStrings(shapes.flatMap((shape) => [
    shape.addonPlanId,
    shape.addonId,
    shape.legacyId,
    ...shape.productIds,
  ]));
  if (!candidateIds.length) return [];

  const [addonDocs, productDocs] = await Promise.all([
    Addon.find({ _id: { $in: candidateIds }, isArchived: { $ne: true } }).lean(),
    MenuProduct.find({ _id: { $in: candidateIds } }).lean(),
  ]);
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));
  const productById = new Map(productDocs.map((doc) => [String(doc._id), doc]));
  const linkedPlanProductIds = uniqueStrings(addonDocs.flatMap((doc) => Array.isArray(doc.menuProductIds) ? doc.menuProductIds : []))
    .filter((id) => !productById.has(id));
  if (linkedPlanProductIds.length) {
    const linkedProducts = await MenuProduct.find({ _id: { $in: linkedPlanProductIds } }).lean();
    for (const product of linkedProducts) {
      productById.set(String(product._id), product);
    }
  }

  const productOnlyLegacyIds = shapes
    .filter((shape) => !shape.addonPlanId && !shape.addonId && shape.legacyId && productById.has(shape.legacyId) && !addonById.has(shape.legacyId))
    .map((shape) => shape.legacyId);
  const productIdsNeedingPlanProof = uniqueStrings([
    ...productOnlyLegacyIds,
    ...shapes.filter((shape) => !shape.addonPlanId && !shape.addonId).flatMap((shape) => shape.productIds),
  ]);
  const plansContainingLegacyProducts = productIdsNeedingPlanProof.length
    ? await Addon.find({
      kind: "plan",
      isActive: true,
      isArchived: { $ne: true },
      archivedAt: null,
      menuProductIds: { $in: productIdsNeedingPlanProof },
    }).lean()
    : [];
  for (const plan of plansContainingLegacyProducts) {
    addonById.set(String(plan._id), plan);
  }
  const plansByContainedProductId = new Map();
  for (const plan of plansContainingLegacyProducts) {
    for (const productId of Array.isArray(plan.menuProductIds) ? plan.menuProductIds : []) {
      const key = String(productId);
      if (!plansByContainedProductId.has(key)) plansByContainedProductId.set(key, []);
      plansByContainedProductId.get(key).push(plan);
    }
  }

  const normalizedRows = [];
  for (const shape of shapes) {
    if (shape.legacyId && addonById.has(shape.legacyId) && productById.has(shape.legacyId) && !shape.addonPlanId && !shape.productIds.length) {
      throw createAddonSelectionError("AMBIGUOUS_ADDON_SELECTION_ID", "Legacy add-on id exists as both an add-on plan and menu product", "id", { id: shape.legacyId });
    }

    let addonPlanId = shape.addonPlanId || shape.addonId || null;
    let productIds = [...shape.productIds];

    if (shape.legacyId) {
      const legacyIsPlan = addonById.has(shape.legacyId);
      const legacyIsProduct = productById.has(shape.legacyId);
      if (addonPlanId && shape.legacyId !== addonPlanId && legacyIsPlan) {
        throw createAddonSelectionError("INVALID_ADDON_SELECTION", "Conflicting add-on plan identifiers", "id", { id: shape.legacyId, addonPlanId });
      }
      if (!addonPlanId && legacyIsPlan) {
        addonPlanId = shape.legacyId;
      } else if (legacyIsProduct && !productIds.includes(shape.legacyId)) {
        productIds.push(shape.legacyId);
      } else if (!legacyIsPlan && !legacyIsProduct) {
        throw createAddonSelectionError("ADDON_PLAN_NOT_FOUND", "Add-on selection id was not found", "id", { id: shape.legacyId });
      }
    }

    if (!addonPlanId && productIds.length) {
      const candidatePlansById = new Map();
      for (const productId of productIds) {
        const plans = plansByContainedProductId.get(String(productId)) || [];
        for (const plan of plans) candidatePlansById.set(String(plan._id), plan);
      }
      if (candidatePlansById.size === 1) {
        addonPlanId = [...candidatePlansById.keys()][0];
      } else if (candidatePlansById.size > 1) {
        throw createAddonSelectionError("AMBIGUOUS_ADDON_SELECTION_ID", "Product id belongs to multiple active add-on plans", "id", { productIds });
      } else {
        throw createAddonSelectionError("ADDON_PLAN_NOT_FOUND", "No active add-on plan contains the selected product", "addonPlanId", { productIds });
      }
    }

    if (!addonPlanId) {
      throw createAddonSelectionError("ADDON_PLAN_NOT_FOUND", "addonPlanId is required", "addonPlanId");
    }

    const addonPlan = addonById.get(String(addonPlanId));
    if (!addonPlan) {
      throw createAddonSelectionError("ADDON_PLAN_NOT_FOUND", "Add-on plan was not found", "addonPlanId", { addonPlanId });
    }
    if (addonPlan.kind !== "plan") {
      throw createAddonSelectionError("INVALID_ADDON_SELECTION", "Add-on selection must reference a subscription plan", "addonPlanId", { addonPlanId });
    }
    if (addonPlan.isActive === false) {
      throw createAddonSelectionError("ADDON_PLAN_INACTIVE", "Add-on plan is inactive", "addonPlanId", { addonPlanId });
    }
    if (resolveSubscriptionAddonBillingMode(addonPlan, { defaultMode: "per_day" }) !== "per_day") {
      throw createAddonSelectionError("INVALID_ADDON_SELECTION", "Add-on plan must use per_day billing for subscription checkout", "addonPlanId", { addonPlanId });
    }

    const planCategory = normalizeAddonPlanCategory(addonPlan);
    const planProductIds = uniqueStrings(addonPlan.menuProductIds || []);
    if (!productIds.length) {
      productIds = planProductIds;
    }
    productIds = uniqueStrings(productIds);
    if (!productIds.length) {
      if (["meal", "dessert", "premium_meal", "premium_large_salad"].includes(planCategory)) {
        throw createAddonSelectionError("ADDON_PRODUCT_NOT_FOUND", "Add-on plan has no selectable products", "productId", { addonPlanId });
      }
      normalizedRows.push({
        id: String(addonPlanId),
        addonPlanId: String(addonPlanId),
        addonId: String(addonPlanId),
        productIds: [],
        productId: null,
        menuProductIds: [],
        category: planCategory,
        quantityPerDay: shape.quantityPerDay,
        sourceRequestShape: shape.sourceRequestShape,
        addonPlan,
        products: [],
      });
      continue;
    }

    const missingProductId = productIds.find((productId) => !productById.has(String(productId)));
    if (missingProductId) {
      throw createAddonSelectionError("ADDON_PRODUCT_NOT_FOUND", "Selected add-on product was not found", "productId", { productId: missingProductId });
    }
    const notInPlanProductId = productIds.find((productId) => !planProductIds.includes(String(productId)));
    if (notInPlanProductId) {
      throw createAddonSelectionError("ADDON_PRODUCT_NOT_IN_PLAN", "Selected add-on product does not belong to the selected plan", "productId", { productId: notInPlanProductId, addonPlanId });
    }

    const requestedCategory = shape.category ? normalizeSubscriptionAddonCategory(shape.category) : null;
    if (shape.category && (!requestedCategory || requestedCategory !== planCategory)) {
      throw createAddonSelectionError("ADDON_CATEGORY_MISMATCH", "Requested add-on category does not match the add-on plan", "category", {
        requestedCategory: shape.category,
        planCategory,
      });
    }
    for (const productId of productIds) {
      const product = productById.get(String(productId));
      if (!isNewSaleProductUsable(product)) {
        throw createAddonSelectionError("ADDON_PRODUCT_UNAVAILABLE_FOR_NEW_PURCHASE", "Selected add-on product is unavailable for new purchase", "productId", { productId });
      }
    }

    normalizedRows.push({
      id: String(addonPlanId),
      addonPlanId: String(addonPlanId),
      addonId: String(addonPlanId),
      productIds,
      productId: productIds.length === 1 ? productIds[0] : null,
      menuProductIds: productIds,
      category: planCategory,
      quantityPerDay: shape.quantityPerDay,
      sourceRequestShape: shape.sourceRequestShape,
      addonPlan,
      products: productIds.map((productId) => productById.get(String(productId))),
    });
  }

  const byPlanAndProducts = new Map();
  for (const row of normalizedRows) {
    const key = `${row.addonPlanId}:${row.menuProductIds.join(",")}`;
    const existing = byPlanAndProducts.get(key);
    if (existing) {
      existing.quantityPerDay += row.quantityPerDay;
    } else {
      byPlanAndProducts.set(key, row);
    }
  }

  return Array.from(byPlanAndProducts.values());
}

function buildAddonBalanceRowsFromQuote(quote) {
  const planDaysCount = Number(quote && quote.plan && quote.plan.daysCount || 0);
  return (Array.isArray(quote && quote.addonItems) ? quote.addonItems : []).map((item) => {
    const addon = item.addon || {};
    const quantityPerDay = Math.max(1, Math.floor(Number(item.quantityPerDay || item.qty || 1)));
    const includedTotalQty = Math.max(0, Math.floor(Number(item.includedTotalQty != null ? item.includedTotalQty : planDaysCount * quantityPerDay)));
    const unitPriceHalala = Number(item.unitPlanPriceHalala != null ? item.unitPlanPriceHalala : item.unitPriceHalala || 0);
    return {
      addonPlanId: item.addonPlanId || addon._id,
      addonId: item.addonPlanId || addon._id,
      name: addon.name || item.name || "",
      category: item.category || addon.category || "",
      purchasedDailyQty: quantityPerDay,
      includedTotalQty,
      purchasedQty: includedTotalQty + Number(item.extraPurchasedQty || 0),
      consumedQty: 0,
      reservedQty: 0,
      remainingQty: includedTotalQty + Number(item.extraPurchasedQty || 0),
      extraPurchasedQty: Number(item.extraPurchasedQty || 0),
      overageConsumedQty: 0,
      unitIncludedPriceHalala: unitPriceHalala,
      overageUnitPriceHalala: unitPriceHalala,
      unitPriceHalala,
      currency: item.currency || "SAR",
    };
  });
}

function resolveDeliveryInput(payload = {}) {
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const type = delivery.type || payload.deliveryMode || (delivery.slot && delivery.slot.type) || "delivery";
  const normalizedType = ["delivery", "pickup"].includes(type) ? type : null;
  if (!normalizedType) {
    const err = new Error("delivery.type must be one of: delivery, pickup");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const pickupLocationId = String(
    delivery.pickupLocationId
    || delivery.locationId
    || payload.pickupLocationId
    || payload.locationId
    || ""
  ).trim();
  const address = delivery.address || payload.deliveryAddress || null;
  const slot = normalizeSlotInput(
    delivery.slot || {
      type: normalizedType,
      window: delivery.window || payload.deliveryWindow || "",
      slotId: delivery.slotId || payload.deliverySlotId || payload.slotId || "",
    }
  );
  if (!slot.type) {
    slot.type = normalizedType;
  }
  if (slot.type !== normalizedType) {
    slot.type = normalizedType;
  }
  const isDelivery = normalizedType === "delivery";
  const zoneId = isDelivery && delivery.zoneId ? delivery.zoneId : null;
  const zoneName = isDelivery && delivery.zoneName ? String(delivery.zoneName || "").trim() : "";
  const firstDayFulfillmentOverride = delivery.firstDayFulfillmentOverride || null;

  return { type: normalizedType, address, slot, pickupLocationId, zoneId, zoneName, firstDayFulfillmentOverride };
}

async function parseFutureStartDate(rawValue, currentBusinessDate = null) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: true, value: null };
  }
  const normalized = String(rawValue).trim();
  const bareDateMatch = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const parsed = bareDateMatch
    ? new Date(`${normalized}T00:00:00+03:00`)
    : new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: "startDate must be a valid date" };
  }
  const parsedDate = dateUtils.toKSADateString(parsed);
  const today = currentBusinessDate || await getRestaurantBusinessDate();
  if (!dateUtils.isOnOrAfterKSADate(parsedDate, today)) {
    return { ok: false, message: "startDate must be today or a future date" };
  }
  return { ok: true, value: parsed };
}

function toKsaMidnightDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+03:00`);
}

function isActivePickupLocation(location) {
  return Boolean(location)
    && typeof location === "object"
    && !Array.isArray(location)
    && location.isActive !== false
    && location.active !== false
    && location.enabled !== false
    && location.isEnabled !== false
    && location.isAvailable !== false
    && location.available !== false
    && location.pickupEnabled !== false
    && location.isPickupEnabled !== false
    && location.supportsPickup !== false
    && location.pickupAvailable !== false
    && location.availableForPickup !== false
    && location.acceptsPickup !== false;
}

function normalizeFirstDayOverride(override) {
  if (!override) return null;
  const type = typeof override === "object" ? override.type : override;
  if (String(type || "").trim() !== "pickup") return null;
  const pickupLocationId = typeof override === "object" ? String(override.pickupLocationId || "").trim() : "";
  return { type: "pickup", pickupLocationId: pickupLocationId || null };
}

function normalizeFirstDayOverrideOrThrow(override) {
  if (!override) return null;
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    const err = new Error("firstDayFulfillmentOverride must be an object");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const type = String(override.type || "").trim();
  const pickupLocationId = String(override.pickupLocationId || "").trim();
  if (type !== "pickup") {
    const err = new Error("firstDayFulfillmentOverride.type must be pickup");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (!pickupLocationId) {
    const err = new Error("firstDayFulfillmentOverride.pickupLocationId is required");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return { type: "pickup", pickupLocationId };
}

function validateFirstDayPickupOverrideOrThrow({ override, activePickupLocations, lang }) {
  const normalized = normalizeFirstDayOverrideOrThrow(override);
  if (!normalized) return null;
  const resolvedPickupLocation = resolvePickupLocationSelection(
    activePickupLocations,
    normalized.pickupLocationId,
    lang,
    []
  );
  if (!resolvedPickupLocation) {
    const err = new Error("Invalid pickup location in firstDayFulfillmentOverride");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return normalized;
}

async function applySameDayDeliveryPickupOverride({ delivery, lang }) {
  if (!delivery || delivery.type !== "delivery") return delivery;

  // A first-day pickup is an explicit customer choice. For a normal same-day
  // delivery request, preserve delivery mode and let resolveFirstServiceDate
  // move service to the next available delivery day.
  if (!delivery.firstDayFulfillmentOverride) {
    delivery.firstDayFulfillmentOverride = null;
    return delivery;
  }

  const pickupLocations = await getSettingValue("pickup_locations", []);
  const activePickupLocations = Array.isArray(pickupLocations)
    ? pickupLocations.filter(isActivePickupLocation)
    : [];
  const existingOverride = validateFirstDayPickupOverrideOrThrow({
    override: delivery.firstDayFulfillmentOverride,
    activePickupLocations,
    lang,
  });
  if (existingOverride) {
    delivery.firstDayFulfillmentOverride = existingOverride;
    return delivery;
  }
  return delivery;
}

function resolveFirstServiceDate({
  requestedStartDate,
  currentBusinessDate,
  rootDeliveryType,
  firstDayPickupOverride,
} = {}) {
  const requestedDate = requestedStartDate
    ? dateUtils.toKSADateString(requestedStartDate)
    : currentBusinessDate;
  const rootType = rootDeliveryType === "pickup" ? "pickup" : "delivery";
  const override = normalizeFirstDayOverride(firstDayPickupOverride);
  const isSameDay = requestedDate === currentBusinessDate;
  const sameDayDeliveryAllowed = false;
  const firstDayPickupOverrideAvailable = rootType === "delivery" && isSameDay;
  const deliveryStartDateIfNoPickup = rootType === "delivery" && isSameDay
    ? dateUtils.addDaysToKSADateString(currentBusinessDate, 1)
    : requestedDate;

  if (rootType === "delivery" && isSameDay && !override) {
    return {
      requestedDate,
      resolvedDate: deliveryStartDateIfNoPickup,
      shifted: true,
      fulfillmentOptions: {
        sameDayDeliveryAllowed,
        sameDayPickupAllowed: true,
        firstDayPickupOverrideAvailable,
        deliveryStartDateIfNoPickup,
        reason: "SAME_DAY_DELIVERY_NOT_AVAILABLE",
      },
    };
  }

  return {
    requestedDate,
    resolvedDate: requestedDate,
    shifted: false,
    fulfillmentOptions: {
      sameDayDeliveryAllowed: rootType === "delivery" ? !isSameDay : false,
      sameDayPickupAllowed: rootType === "pickup" || firstDayPickupOverrideAvailable,
      firstDayPickupOverrideAvailable,
      deliveryStartDateIfNoPickup,
      reason: rootType === "delivery" && isSameDay ? "SAME_DAY_DELIVERY_NOT_AVAILABLE" : null,
    },
  };
}

async function resolveCheckoutQuoteOrThrow(
  payload,
  {
    enforceActivePlan = true,
    lang = "ar",
    allowMissingDeliveryAddress = false,
    userId = null,
  } = {}
) {
  const planId = payload && payload.planId;
  try {
    validateObjectId(planId, "planId");
  } catch (_err) {
    const err = new Error("planId must be a valid ObjectId");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const grams = parsePositiveInteger(payload.grams);
  if (!grams) {
    const err = new Error("grams must be a positive integer");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const mealsPerDay = parsePositiveInteger(payload.mealsPerDay);
  if (!mealsPerDay) {
    const err = new Error("mealsPerDay must be a positive integer");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const delivery = resolveDeliveryInput(payload || {});
  const currentBusinessDate = await getRestaurantBusinessDate();
  const startValidation = await parseFutureStartDate(payload.startDate, currentBusinessDate);
  if (!startValidation.ok) {
    const err = new Error(startValidation.message);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  await applySameDayDeliveryPickupOverride({
    delivery,
    requestedStartDate: startValidation.value,
    currentBusinessDate,
    lang,
  });
  const serviceDate = resolveFirstServiceDate({
    requestedStartDate: startValidation.value,
    currentBusinessDate,
    rootDeliveryType: delivery.type,
    firstDayPickupOverride: delivery.firstDayFulfillmentOverride,
  });
  const resolvedStartDate = toKsaMidnightDate(serviceDate.resolvedDate);

  const planQuery = { _id: planId };
  if (enforceActivePlan) {
    planQuery.isActive = true;
  }
  const plan = await Plan.findOne(planQuery).lean();
  if (!plan) {
    const err = new Error("Plan not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const planCurrency = assertSystemCurrencyOrThrow(plan.currency || SYSTEM_CURRENCY, "Plan currency");

  const gramsOptions = Array.isArray(plan.gramsOptions) ? plan.gramsOptions : [];
  const gramsOption = gramsOptions.find((item) => item && item.grams === grams && item.isActive !== false);
  if (!gramsOption) {
    const err = new Error("Selected grams option is not available");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const mealsOptions = Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [];
  const mealOption = mealsOptions.find((item) => item && item.mealsPerDay === mealsPerDay && item.isActive !== false);
  if (!mealOption) {
    const err = new Error("Selected mealsPerDay option is not available");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const basePlanPriceHalala = parseNonNegativeInteger(mealOption.priceHalala);
  if (basePlanPriceHalala === null) {
    const err = new Error("Plan price is invalid");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const normalizedPremiumItems = normalizePremiumCheckoutPayloadItems(payload.premiumItems);
  const hasPremiumKey = normalizedPremiumItems && 
    Array.isArray(normalizedPremiumItems) && 
    normalizedPremiumItems.some(item => item && item.premiumKey && typeof item.premiumKey === "string");

  let premiumItems, addonItems;
  if (hasPremiumKey) {
    premiumItems = normalizePremiumItemsByKey(normalizedPremiumItems);
  } else {
    premiumItems = normalizeCheckoutItemsOrThrow(
      normalizedPremiumItems,
      "proteinId",
      "premiumItems"
    );
  }
  addonItems = await resolveCheckoutAddonSelectionsOrThrow(payload.addons, { basePlanId: plan._id });

  const premiumCountInput = parseOptionalNonNegativeInteger(payload.premiumCount);
  const compatibilityPremiumCount = sumCheckoutPremiumItemsQty(premiumItems);

  const premiumIds = premiumItems.map((item) => item.id || item.premiumKey);
  const addonIds = addonItems.map((item) => item.id);

  const [builderPremiumDocs, menuPremiumDocs, addonDocs, addonPlanPrices] = await Promise.all([
    hasPremiumKey 
      ? Promise.resolve([])
      : (premiumIds.length ? BuilderProtein.find({ _id: { $in: premiumIds }, isActive: true, isPremium: true }).lean() : Promise.resolve([])),
    hasPremiumKey ? Promise.resolve([]) : findMenuPremiumOptionsByIds(premiumIds),
    addonIds.length ? Addon.find({ _id: { $in: addonIds }, isArchived: { $ne: true } }).lean() : Promise.resolve([]),
    addonIds.length ? AddonPlanPrice.find({ addonPlanId: { $in: addonIds }, basePlanId: plan._id, isActive: true }).lean() : Promise.resolve([]),
  ]);

  const premiumDocs = builderPremiumDocs.concat(menuPremiumDocs.map(mapMenuPremiumOptionForQuote));
  const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));
  const addonPlanPriceByAddonId = new Map(addonPlanPrices.map((p) => [String(p.addonPlanId), p]));

  let premiumTotalHalala = 0;
  const resolvedPremiumItems = [];
  let premiumCount = 0;
  let premiumUnitPriceHalala = 0;

  for (const item of premiumItems) {
    let resolved;
    let doc = null;
    
    if (hasPremiumKey) {
      try {
        resolved = await resolveCanonicalPremiumIdentity({
          premiumKey: item.premiumKey,
        });
      } catch (resolveErr) {
        const err = new Error(`Invalid premiumKey: ${item.premiumKey} - ${resolveErr.message}`);
        err.code = "INVALID_PREMIUM_ITEM";
        err.status = resolveErr.status || 422;
        throw err;
      }
      doc = resolved.canonicalMenuOptionDoc
        ? { ...resolved.canonicalMenuOptionDoc, _sourceModel: "MenuOption" }
        : resolved.canonicalMenuProductDoc
          ? { ...resolved.canonicalMenuProductDoc, _sourceModel: "MenuProduct" }
        : resolved.canonicalProteinDoc || null;
    } else {
      doc = premiumById.get(item.id);
      if (!doc) {
        const err = new Error(`Invalid premium protein: ${item.id}`);
        err.code = "INVALID_PREMIUM_ITEM";
        throw err;
      }
      assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Premium protein ${item.id} currency`);

      if (doc._sourceModel === "MenuOption") {
        resolved = await resolveCanonicalPremiumIdentity({
          premiumKey: doc.premiumKey,
          proteinId: doc._id,
          name: pickLang(doc.name, "en"),
        });
        resolved.canonicalProteinId = resolved.canonicalProteinId || doc._id;
      } else {
        try {
          resolved = await resolveCanonicalPremiumIdentity({
            proteinId: item.id,
            builderProteinDoc: doc,
          });
        } catch (resolveErr) {
          if (resolveErr.code === "UNKNOWN_PREMIUM_KEY" || resolveErr.code === "INVALID_PREMIUM_ITEM") {
            const err = new Error(`Cannot resolve premium identity: ${resolveErr.message}`);
            err.code = "INVALID_PREMIUM_ITEM";
            throw err;
          }
          throw resolveErr;
        }
      }
    }

    const premiumKey = resolved.premiumKey || (doc && (doc.premiumKey || doc.key)) || item.premiumKey;
    if (!premiumKey) {
      const err = new Error("Cannot resolve premium identity: missing premiumKey");
      err.code = "INVALID_PREMIUM_ITEM";
      throw err;
    }

    const upgrade = await resolveSubscriptionPremiumUpgradePricing(premiumKey, {
      fallbackPriceHalala: resolved.unitExtraFeeHalala,
      optionDoc: doc && doc._sourceModel === "MenuOption" ? doc : null,
      builderProteinDoc: doc && !doc._sourceModel ? doc : null,
    });
    const unitExtraFeeHalala = Number(upgrade.priceHalala);
    const priceSource = upgrade.priceSource;
    const isExplicitlyFree = upgrade.isConfigured && unitExtraFeeHalala === 0;

    if (!Number.isSafeInteger(unitExtraFeeHalala) || (unitExtraFeeHalala === 0 && !isExplicitlyFree) || unitExtraFeeHalala < 0) {
      console.log('DEBUG: upgrade=', upgrade, 'resolved=', resolved);
      const err = new Error(`Premium upgrade has invalid canonical pricing: ${premiumKey}`);
      err.code = "INVALID_PREMIUM_ITEM";
      throw err;
    }
    const snapshot = upgrade.snapshot || {};

    resolvedPremiumItems.push({
      protein: doc,
      qty: item.qty,
      unitExtraFeeHalala,
      totalHalala: Number(item.qty || 0) * unitExtraFeeHalala,
      currency: SYSTEM_CURRENCY,
      configId: snapshot.configId || upgrade.configId || null,
      revision: Number(snapshot.revision || upgrade.revision || 0),
      premiumKey: snapshot.premiumKey || premiumKey,
      canonicalProteinId: resolved.canonicalProteinId,
      kind: snapshot.kind || "",
      entityType: snapshot.entityType || (premiumKey === "premium_large_salad" ? "premium_large_salad" : "premium_meal"),
      selectionType: snapshot.selectionType || upgrade.selectionType || "",
      sourceType: snapshot.sourceType || upgrade.sourceType || "",
      sourceModel: snapshot.sourceModel || (doc && doc._sourceModel ? doc._sourceModel : doc ? "BuilderProtein" : null),
      sourceId: snapshot.sourceId || (doc && doc._id ? doc._id : null),
      sourceProductId: snapshot.sourceProductId || upgrade.sourceProductId || "",
      sourceGroupId: snapshot.sourceGroupId || upgrade.sourceGroupId || "",
      sourceGroupKey: snapshot.sourceGroupKey || "",
      sourceKey: snapshot.sourceKey || "",
      name: snapshot.name || resolved.name,
      nameI18n: snapshot.nameI18n || localizedNameObject((doc && doc.name) || {}),
      imageUrl: String(snapshot.imageUrl || (doc && doc.imageUrl) || ""),
      catalogVersion: snapshot.catalogVersion || (doc && doc.updatedAt ? doc.updatedAt : null),
      purchasedAt: snapshot.purchasedAt || new Date(),
      priceSource,
    });
  }

  premiumTotalHalala = resolvedPremiumItems.reduce((sum, row) => sum + Number(row.qty || 0) * Number(row.unitExtraFeeHalala || 0), 0);

  let addonsTotalHalala = 0;
  const resolvedAddonItems = [];
  for (const item of addonItems) {
    const doc = item.addonPlan || addonById.get(item.id);
    if (!doc) {
      const err = new Error(`Addon plan ${item.id} not found or inactive`);
      err.code = "NOT_FOUND";
      throw err;
    }
    if (doc.kind !== "plan") {
      const err = new Error(`Addon ${item.id} is not a subscription plan`);
      err.code = "INVALID_SELECTION";
      throw err;
    }
    if (doc.isActive === false) {
      const err = new Error(`Addon plan ${item.id} not found or inactive`);
      err.code = "NOT_FOUND";
      throw err;
    }
    if (resolveSubscriptionAddonBillingMode(doc, { defaultMode: "per_day" }) !== "per_day") {
      const err = new Error(`Addon ${item.id} must use per_day billing for subscription checkout`);
      err.code = "INVALID_SELECTION";
      throw err;
    }

    let unit = resolveAddonUnitPriceHalala(doc);
    if (doc.pricingMode === "base_plan_matrix" || doc.kind === "plan") {
      const matrixPrice = addonPlanPriceByAddonId.get(String(doc._id));
      if (matrixPrice) {
        unit = Number(matrixPrice.priceHalala);
      } else {
        const err = new Error(`Addon plan ${item.id} is not configured for the selected base plan`);
        err.code = "PRICE_MATRIX_NOT_FOUND";
        throw err;
      }
    }
    
    assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon plan ${item.id} currency`);

    const quantityPerDay = Math.max(1, Math.floor(Number(item.quantityPerDay || 1)));
    const daysCount = Number(plan.daysCount || 0);
    const includedTotalQty = daysCount * quantityPerDay;
    const lineTotal = resolveAddonChargeTotalHalala({
      unitPriceHalala: unit,
      qty: quantityPerDay,
      daysCount,
      mealsPerDay: Number(mealsPerDay || 0),
      addon: doc,
    });

    addonsTotalHalala += lineTotal;
    resolvedAddonItems.push({
      addon: doc,
      addonPlanId: doc._id,
      productId: item.productId,
      menuProductIds: item.menuProductIds,
      products: item.products,
      category: doc.category,
      qty: quantityPerDay,
      quantityPerDay,
      billingMode: resolveSubscriptionAddonBillingMode(doc, { defaultMode: "per_day" }),
      durationDays: daysCount,
      daysCount,
      includedTotalQty,
      unitPlanPriceHalala: unit,
      unitPriceHalala: unit,
      totalHalala: lineTotal,
      priceHalala: lineTotal,
      currency: SYSTEM_CURRENCY,
      sourceRequestShape: item.sourceRequestShape || null,
    });
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (delivery.type === "pickup") {
    delivery.firstDayFulfillmentOverride = null;
    const pickupLocations = await getSettingValue("pickup_locations", []);
    const activePickupLocations = Array.isArray(pickupLocations)
      ? pickupLocations.filter((location) => location && location.isActive !== false)
      : [];

    if (!delivery.pickupLocationId) {
      if (activePickupLocations.length >= 1) {
        const defaultLocation = activePickupLocations[0];
        delivery.pickupLocationId = String(
          defaultLocation.id
          || defaultLocation.locationId
          || "pickup_location_1"
        );
      } else {
        const err = new Error("No active pickup location is configured");
        err.code = "VALIDATION_ERROR";
        throw err;
      }
    }

    const resolvedPickupLocation = resolvePickupLocationSelection(activePickupLocations, delivery.pickupLocationId, lang, windows);
    if (!resolvedPickupLocation) {
      const err = new Error("Invalid pickup location");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    delivery.address = resolvedPickupLocation.address || null;
  }
  if (delivery.type === "delivery" && !delivery.address && !allowMissingDeliveryAddress) {
    const err = new Error("Missing delivery address");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let deliveryFeeHalala = 0;
  if (delivery.type === "delivery") {
    if (delivery.firstDayFulfillmentOverride) {
      const pickupLocations = await getSettingValue("pickup_locations", []);
      const activePickupLocations = Array.isArray(pickupLocations)
        ? pickupLocations.filter(isActivePickupLocation)
        : [];
      delivery.firstDayFulfillmentOverride = validateFirstDayPickupOverrideOrThrow({
        override: delivery.firstDayFulfillmentOverride,
        activePickupLocations,
        lang,
      });
    }
    if (!delivery.zoneId) {
      throw createDeliverySlotError("VALIDATION_ERROR", "Delivery zone is required for delivery subscriptions");
    }
    try {
      validateObjectId(delivery.zoneId, "delivery.zoneId");
    } catch (_err) {
      const err = new Error("delivery.zoneId must be a valid ObjectId");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    delivery.slot = resolveDeliverySlotOrThrow(delivery.slot, windows, lang);

    const zone = await Zone.findById(delivery.zoneId).lean();
    if (!zone) {
      const err = new Error("Delivery zone not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    if (!zone.isActive && !payload.renewedFromSubscriptionId) {
      const err = new Error("Selected delivery zone is currently inactive for new subscriptions");
      err.code = "INVALID_SELECTION";
      throw err;
    }

    delivery.zoneName = pickLang(zone.name, lang) || "";
    deliveryFeeHalala = Number(zone.deliveryFeeHalala || 0);
  }

  if (premiumCountInput !== null && premiumCountInput !== compatibilityPremiumCount) {
    const err = new Error("premiumCount must equal the sum of premiumItems quantities");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  premiumCount = compatibilityPremiumCount;
  if (resolvedPremiumItems.length) {
    const uniqueUnitPrices = Array.from(new Set(resolvedPremiumItems.map((item) => Number(item.unitExtraFeeHalala || 0))));
    premiumUnitPriceHalala = uniqueUnitPrices.length === 1 ? uniqueUnitPrices[0] : 0;
  }

  const totalSubscriptionMeals = resolveTotalSubscriptionMealsFromQuote({
    plan,
    mealsPerDay,
  });
  const premiumUpgradeLimit = assertPremiumUpgradeLimit({
    premiumUpgradeCount: premiumCount,
    totalSubscriptionMeals,
  });

  const grossTotalHalala = basePlanPriceHalala + premiumTotalHalala + addonsTotalHalala + deliveryFeeHalala;
  // VAT is system-owned (16%)
  const vatPercentage = VAT_PERCENTAGE;
  const vatBreakdown = computeInclusiveVatBreakdown(grossTotalHalala, vatPercentage);

  const divisor = 1 + (vatPercentage / 100);
  const basePlanNetHalala = divisor > 0 ? Math.round(basePlanPriceHalala / divisor) : basePlanPriceHalala;
  const addonSubscriptions = [];
  for (const item of resolvedAddonItems) {
    const resolvedProductIds = (Array.isArray(item.menuProductIds) && item.menuProductIds.length
      ? item.menuProductIds
      : item.addon.menuProductIds || []
    ).map(String);
    const addonPlanId = item.addon._id;
    const allowanceCategory = item.addon.allowanceCategory || item.category || item.addon.category;
    addonSubscriptions.push({
      addonId: item.addon._id,
      addonPlanId,
      name: pickLang(item.addon.name, lang),
      addonPlanName: pickLang(item.addon.name, lang),
      addonPlanNameI18n: item.addon.name || null,
      category: item.category || item.addon.category,
      allowanceCategory,
      displayKey: item.addon.displayKey || item.addon.displayCategory || item.addon.category,
      displayCategory: item.addon.displayCategory || item.addon.displayKey || item.addon.category,
      entitlementKey: `${allowanceCategory || "addon"}:${addonPlanId}`,
      sortOrder: Number(item.addon.sortOrder || 0),
      maxPerDay: item.addon.maxPerDay || 1,
      basePlanId: plan._id,
      priceHalala: Number(item.unitPriceHalala || 0),
      quantityPerDay: Number(item.quantityPerDay || item.qty || 1),
      purchasedDailyQty: Number(item.quantityPerDay || item.qty || 1),
      includedTotalQty: Number(item.includedTotalQty || 0),
      unitPlanPriceHalala: Number(item.unitPlanPriceHalala || item.unitPriceHalala || 0),
      totalHalala: Number(item.totalHalala || 0),
      currency: item.currency || SYSTEM_CURRENCY,
      menuProductIds: resolvedProductIds,
      menuCategoryKeys: Array.isArray(item.addon.menuCategoryKeys)
        ? item.addon.menuCategoryKeys.map(String)
        : [],
      priceSource: "base_plan_addon_price",
      sourceRequestShape: item.sourceRequestShape || null,
    });
  }

  let quote = {
    plan,
    grams,
    mealsPerDay,
    startDate: resolvedStartDate,
    requestedStartDate: serviceDate.requestedDate,
    fulfillmentOptions: {
      ...serviceDate.fulfillmentOptions,
      requestedStartDate: serviceDate.requestedDate,
      resolvedStartDate: serviceDate.resolvedDate,
      startDateShifted: serviceDate.shifted,
    },
    delivery,
    premiumCount,
    premiumUnitPriceHalala,
    totalSubscriptionMeals,
    premiumUpgradeLimit: buildPremiumUpgradeLimit({
      totalSubscriptionMeals,
      selectedPremiumUpgrades: premiumUpgradeLimit.selectedPremiumUpgrades,
    }),
    premiumItems: resolvedPremiumItems,
    addonItems: resolvedAddonItems,
    addonSubscriptions,
    addonBalance: [],
    breakdown: {
      basePlanPriceHalala,
      basePlanGrossHalala: basePlanPriceHalala,
      basePlanNetHalala,
      premiumTotalHalala,
      addonsTotalHalala,
      deliveryFeeHalala,
      grossTotalHalala,
      subtotalHalala: vatBreakdown.subtotalHalala,
      subtotalBeforeVatHalala: vatBreakdown.subtotalBeforeVatHalala,
      vatPercentage: vatBreakdown.vatPercentage,
      vatHalala: vatBreakdown.vatHalala,
      totalHalala: vatBreakdown.totalHalala,
      currency: planCurrency,
    },
  };

  if (payload && payload.promoCode) {
    const promoResult = await applyPromoCodeToSubscriptionQuote({
      promoCode: payload.promoCode,
      userId,
      quote,
    });
    quote = promoResult.quote;
  }

  quote.addonBalance = buildAddonBalanceRowsFromQuote(quote);

  return quote;
}

module.exports = {
  applySameDayDeliveryPickupOverride,
  resolveCheckoutQuoteOrThrow,
  buildAddonBalanceRowsFromQuote,
  resolveCheckoutAddonSelectionsOrThrow,
  resolveFirstServiceDate,
};
