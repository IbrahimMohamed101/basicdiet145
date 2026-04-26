const Plan = require("../../models/Plan");
const BuilderProtein = require("../../models/BuilderProtein");
const Addon = require("../../models/Addon");
const Zone = require("../../models/Zone");
const Setting = require("../../models/Setting");
const dateUtils = require("../../utils/date");
const validateObjectId = require("../../utils/validateObjectId");
const { pickLang } = require("../../utils/i18n");
const { SYSTEM_CURRENCY, assertSystemCurrencyOrThrow } = require("../../utils/currency");
const { computeVatBreakdown } = require("../../utils/pricing");
const {
  resolvePickupLocationSelection,
  resolveAddonChargeTotalHalala,
} = require("../../utils/subscription/subscriptionCatalog");
const { applyPromoCodeToSubscriptionQuote } = require("../promoCodeService");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");

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

function normalizePremiumCheckoutPayloadItems(rawItems) {
  if (rawItems === undefined || rawItems === null) {
    return rawItems;
  }
  if (!Array.isArray(rawItems)) {
    return rawItems;
  }
  return rawItems.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const explicitProtein = item.proteinId;
    const legacyMealKey = item.premiumMealId;
    if (explicitProtein != null && legacyMealKey != null && String(explicitProtein) !== String(legacyMealKey)) {
      const err = new Error("premiumItems entry must not set proteinId and premiumMealId to different values");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    const resolved = explicitProtein != null ? explicitProtein : legacyMealKey;
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

function normalizeCheckoutAddonSelectionsOrThrow(rawItems, itemName = "addons") {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error(`${itemName} must be an array`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const selectedIds = new Set();
  for (const item of rawItems) {
    const addonId = typeof item === "string"
      ? item
      : item && typeof item === "object" && !Array.isArray(item)
        ? (item.id || item.addonId)
        : null;

    try {
      validateObjectId(addonId, "addonId");
    } catch (_err) {
      const err = new Error("addonId must be a valid ObjectId");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    selectedIds.add(String(addonId));
  }

  return Array.from(selectedIds.values()).map((id) => ({ id }));
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

  return { type: normalizedType, address, slot, pickupLocationId, zoneId, zoneName };
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

  const premiumItems = normalizeCheckoutItemsOrThrow(
    normalizePremiumCheckoutPayloadItems(payload.premiumItems),
    "proteinId",
    "premiumItems"
  );
  const addonItems = normalizeCheckoutAddonSelectionsOrThrow(payload.addons, "addons");

  const premiumCountInput = parseOptionalNonNegativeInteger(payload.premiumCount);
  const compatibilityPremiumCount = sumCheckoutPremiumItemsQty(premiumItems);

  const premiumIds = premiumItems.map((item) => item.id);
  const addonIds = addonItems.map((item) => item.id);

  const [premiumDocs, addonDocs] = await Promise.all([
    premiumIds.length ? BuilderProtein.find({ _id: { $in: premiumIds }, isActive: true, isPremium: true }).lean() : Promise.resolve([]),
    addonIds.length ? Addon.find({ _id: { $in: addonIds }, isActive: true }).lean() : Promise.resolve([]),
  ]);

  const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

  let premiumTotalHalala = 0;
  const resolvedPremiumItems = [];
  let premiumCount = 0;
  let premiumUnitPriceHalala = 0;

  for (const item of premiumItems) {
    const doc = premiumById.get(item.id);
    if (!doc) {
      const err = new Error(`Premium protein ${item.id} not found or inactive`);
      err.code = "NOT_FOUND";
      throw err;
    }
    const unit = parseNonNegativeInteger(doc.extraFeeHalala);
    if (unit === null) {
      const err = new Error(`Premium protein ${item.id} has invalid price`);
      err.code = "INVALID_SELECTION";
      throw err;
    }
    assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Premium protein ${item.id} currency`);
    premiumTotalHalala += unit * item.qty;
    resolvedPremiumItems.push({ protein: doc, qty: item.qty, unitExtraFeeHalala: unit, currency: SYSTEM_CURRENCY });
  }

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
    const unit = resolveAddonUnitPriceHalala(doc);
    assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon plan ${item.id} currency`);

    const daysCount = Number(plan.daysCount || 0);
    const lineTotal = unit * daysCount;

    addonsTotalHalala += lineTotal;
    resolvedAddonItems.push({
      addon: doc,
      category: doc.category,
      unitPriceHalala: unit,
      totalHalala: lineTotal,
      currency: SYSTEM_CURRENCY,
    });
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (delivery.slot.window && Array.isArray(windows) && windows.length && !windows.includes(delivery.slot.window)) {
    const err = new Error("Invalid delivery window");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (delivery.type === "pickup" && delivery.pickupLocationId && !delivery.address) {
    const pickupLocations = await getSettingValue("pickup_locations", []);
    const resolvedPickupLocation = resolvePickupLocationSelection(
      pickupLocations,
      delivery.pickupLocationId,
      lang,
      windows
    );
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
    if (!delivery.zoneId) {
      const err = new Error("Delivery zone is required for delivery subscriptions");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

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

  const subtotalHalala = basePlanPriceHalala + premiumTotalHalala + addonsTotalHalala + deliveryFeeHalala;
  const vatPercentageRaw = await getSettingValue("vat_percentage", null);
  const vatPercentage = Number(vatPercentageRaw);
  const vatBreakdown = computeVatBreakdown({
    basePriceHalala: subtotalHalala,
    vatPercentage,
  });

  let quote = {
    plan,
    grams,
    mealsPerDay,
    startDate: startValidation.value,
    delivery,
    premiumCount,
    premiumUnitPriceHalala,
    premiumItems: resolvedPremiumItems,
    addonItems: resolvedAddonItems,
    breakdown: {
      basePlanPriceHalala,
      premiumTotalHalala,
      addonsTotalHalala,
      deliveryFeeHalala,
      subtotalHalala: vatBreakdown.subtotalHalala,
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

  return quote;
}

module.exports = {
  resolveCheckoutQuoteOrThrow,
};
