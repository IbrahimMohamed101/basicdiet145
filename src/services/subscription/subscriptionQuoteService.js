const Plan = require("../../models/Plan");
const BuilderProtein = require("../../models/BuilderProtein");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const Addon = require("../../models/Addon");
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
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: "subscription" },
    ],
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

function normalizeCheckoutAddonSelectionsOrThrow(rawItems, itemName = "addons") {
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
    const addonId = typeof item === "string"
      ? item
      : item && typeof item === "object" && !Array.isArray(item)
        ? (item.addonPlanId || item.id || item.addonId)
        : null;

    try {
      validateObjectId(addonId, "addonId");
    } catch (_err) {
      const err = new Error("addonId must be a valid ObjectId");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    let quantityPerDay = 1;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const rawQty = item.quantityPerDay !== undefined
        ? item.quantityPerDay
        : item.qty !== undefined
          ? item.qty
          : item.quantity;
      if (rawQty !== undefined) {
        quantityPerDay = Number(rawQty);
        if (!Number.isInteger(quantityPerDay) || quantityPerDay < 1 || typeof rawQty === "string") {
          const err = new Error("quantityPerDay must be an integer >= 1");
          err.code = "VALIDATION_ERROR";
          throw err;
        }
      }
    }

    const key = String(addonId);
    const existing = byId.get(key);
    byId.set(key, {
      id: key,
      addonPlanId: key,
      quantityPerDay: (existing ? existing.quantityPerDay : 0) + quantityPerDay,
    });
  }

  return Array.from(byId.values());
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

async function parseFutureStartDate(rawValue) {
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
  const today = await getRestaurantBusinessDate();
  if (!dateUtils.isOnOrAfterKSADate(parsedDate, today)) {
    return { ok: false, message: "startDate must be today or a future date" };
  }
  return { ok: true, value: parsed };
}

function toKsaMidnightDate(dateStr) {
  return new Date(`${dateStr}T00:00:00+03:00`);
}

function normalizeFirstDayOverride(override) {
  if (!override) return null;
  const type = typeof override === "object" ? override.type : override;
  if (String(type || "").trim() !== "pickup") return null;
  const pickupLocationId = typeof override === "object" ? String(override.pickupLocationId || "").trim() : "";
  return { type: "pickup", pickupLocationId: pickupLocationId || null };
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
  const startValidation = await parseFutureStartDate(payload.startDate);
  if (!startValidation.ok) {
    const err = new Error(startValidation.message);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const currentBusinessDate = await getRestaurantBusinessDate();
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
  addonItems = normalizeCheckoutAddonSelectionsOrThrow(payload.addons, "addons");

  const premiumCountInput = parseOptionalNonNegativeInteger(payload.premiumCount);
  const compatibilityPremiumCount = sumCheckoutPremiumItemsQty(premiumItems);

  const premiumIds = premiumItems.map((item) => item.id || item.premiumKey);
  const addonIds = addonItems.map((item) => item.id);

  const [builderPremiumDocs, menuPremiumDocs, addonDocs] = await Promise.all([
    hasPremiumKey 
      ? Promise.resolve([])
      : (premiumIds.length ? BuilderProtein.find({ _id: { $in: premiumIds }, isActive: true, isPremium: true }).lean() : Promise.resolve([])),
    hasPremiumKey ? Promise.resolve([]) : findMenuPremiumOptionsByIds(premiumIds),
    addonIds.length ? Addon.find({ _id: { $in: addonIds }, isArchived: { $ne: true } }).lean() : Promise.resolve([]),
  ]);

  const premiumDocs = builderPremiumDocs.concat(menuPremiumDocs.map(mapMenuPremiumOptionForQuote));
  const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

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
        throw err;
      }
      doc = resolved.canonicalProteinDoc || null;
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
      builderProteinDoc: doc && doc._sourceModel !== "MenuOption" ? doc : null,
    });
    const unitExtraFeeHalala = Number(upgrade.priceHalala);
    const priceSource = upgrade.priceSource;
    const isExplicitlyFree = upgrade.isConfigured && unitExtraFeeHalala === 0;

    if (!Number.isSafeInteger(unitExtraFeeHalala) || (unitExtraFeeHalala === 0 && !isExplicitlyFree) || unitExtraFeeHalala < 0) {
      const err = new Error(`Premium upgrade has invalid canonical pricing: ${premiumKey}`);
      err.code = "INVALID_PREMIUM_ITEM";
      throw err;
    }

    resolvedPremiumItems.push({
      protein: doc,
      qty: item.qty,
      unitExtraFeeHalala,
      currency: SYSTEM_CURRENCY,
      premiumKey,
      canonicalProteinId: resolved.canonicalProteinId,
      name: resolved.name,
      priceSource,
    });
  }

  premiumTotalHalala = resolvedPremiumItems.reduce((sum, row) => sum + Number(row.qty || 0) * Number(row.unitExtraFeeHalala || 0), 0);

  let addonsTotalHalala = 0;
  const resolvedAddonItems = [];
  for (const item of addonItems) {
    const doc = addonById.get(item.id);
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

    const unit = resolveAddonUnitPriceHalala(doc);
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
      const overrideObj = delivery.firstDayFulfillmentOverride;
      const overrideType = overrideObj && typeof overrideObj === "object" ? overrideObj.type : overrideObj;
      const overrideLocId = overrideObj && typeof overrideObj === "object" ? overrideObj.pickupLocationId : null;
      if (overrideType === "pickup" && overrideLocId) {
        const pickupLocations = await getSettingValue("pickup_locations", []);
        const activePickupLocations = Array.isArray(pickupLocations)
          ? pickupLocations.filter((location) => location && location.isActive !== false)
          : [];
        const resolvedPickupLocation = resolvePickupLocationSelection(activePickupLocations, overrideLocId, lang, windows);
        if (!resolvedPickupLocation) {
          const err = new Error("Invalid pickup location in firstDayFulfillmentOverride");
          err.code = "VALIDATION_ERROR";
          throw err;
        }
      }
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
  const addonSubscriptions = resolvedAddonItems.map((item) => ({
    addonId: item.addon._id,
    addonPlanId: item.addon._id,
    name: pickLang(item.addon.name, lang),
    addonPlanName: pickLang(item.addon.name, lang),
    category: item.category || item.addon.category,
    maxPerDay: item.addon.maxPerDay || 1,
    basePlanId: plan._id,
    priceHalala: Number(item.unitPriceHalala || 0),
    quantityPerDay: Number(item.quantityPerDay || item.qty || 1),
    purchasedDailyQty: Number(item.quantityPerDay || item.qty || 1),
    includedTotalQty: Number(item.includedTotalQty || 0),
    unitPlanPriceHalala: Number(item.unitPlanPriceHalala || item.unitPriceHalala || 0),
    totalHalala: Number(item.totalHalala || 0),
    currency: item.currency || SYSTEM_CURRENCY,
    menuProductIds: item.addon.menuProductIds || [],
    priceSource: "base_plan_addon_price",
  }));

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
  resolveCheckoutQuoteOrThrow,
  buildAddonBalanceRowsFromQuote,
};
