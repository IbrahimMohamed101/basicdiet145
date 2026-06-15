"use strict";

const crypto = require("crypto");

const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const { buildKitchenDetailsPayload } = require("../dashboard/opsPayloadService");
const { buildDayCommercialState } = require("./subscriptionDayCommercialStateService");

const ACTIVE_OR_CONSUMING_PICKUP_STATUSES = ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "no_show"];

function createServiceError(code, message, status = 400, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeSlotId(value) {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  return raw || "";
}

function resolveSlotId(slot = {}) {
  return normalizeSlotId(slot.slotKey || slot.slotIndex);
}

function normalizeSelectedMealSlotIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw createServiceError("INVALID_SELECTED_MEAL_SLOT_IDS", "selectedMealSlotIds must be an array", 400);
  }
  const ids = value.map(normalizeSlotId).filter(Boolean);
  if (ids.length !== value.length) {
    throw createServiceError("INVALID_SELECTED_MEAL_SLOT_IDS", "selectedMealSlotIds must contain non-empty values", 400);
  }
  if (new Set(ids).size !== ids.length) {
    throw createServiceError("DUPLICATE_SELECTED_MEAL_SLOT_IDS", "selectedMealSlotIds must not contain duplicates", 400);
  }
  return ids;
}

function buildPickupRequestPayloadHash({ date, mealCount, selectedMealSlotIds = [] }) {
  const normalized = {
    date: String(date || ""),
    mealCount: Number(mealCount || 0),
    selectedMealSlotIds: normalizeSelectedMealSlotIds(selectedMealSlotIds).sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function slotHasUnpaidPremium(slot = {}) {
  return Boolean(slot && slot.isPremium && slot.premiumSource === "pending_payment");
}

function dayHasUnpaidAddons(day = {}) {
  return (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .some((addon) => addon && addon.source === "pending_payment");
}

function stringifyId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  if (value && value._id) return stringifyId(value._id);
  return String(value);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toPlainObject(value) {
  if (!value || typeof value !== "object") return value || {};
  if (typeof value.toObject === "function") return value.toObject({ depopulate: false });
  return value;
}

function localizedPair(value, fallback = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const en = value.en || value.english || value.nameEn || value.titleEn || value.ar || value.name || fallback;
    const ar = value.ar || value.arabic || value.nameAr || value.titleAr || value.en || value.name || fallback;
    return { ar: ar || null, en: en || null };
  }
  const text = value === undefined || value === null ? fallback : String(value);
  return { ar: text || null, en: text || null };
}

function firstLocalizedPair(...values) {
  for (const value of values) {
    const pair = localizedPair(value);
    if (pair.ar || pair.en) return pair;
  }
  return { ar: null, en: null };
}

function hasLocalizedText(value) {
  const pair = localizedPair(value);
  return Boolean(pair.ar || pair.en);
}

function selectionTypeLabel(selectionType, isPremium = false) {
  const type = String(selectionType || "").trim();
  if (type === "premium_meal" || isPremium) return { ar: "وجبة مميزة", en: "Premium meal" };
  if (type === "premium_large_salad") return { ar: "سلطة مميزة", en: "Premium salad" };
  if (type === "sandwich") return { ar: "ساندويتش", en: "Sandwich" };
  return { ar: "وجبة عادية", en: "Standard meal" };
}

function moneyFromHalala(value) {
  const halala = Number(value || 0);
  return halala > 0 ? halala / 100 : 0;
}

function canonicalPaymentStatus({ required, paid }) {
  if (required) return "pending";
  if (paid) return "paid";
  return "not_required";
}

function resolveReasonCopy(reason) {
  const copies = {
    SLOT_ALREADY_RESERVED: {
      ar: "تم طلب استلام هذه الوجبة بالفعل",
      en: "This meal has already been requested for pickup",
    },
    SLOT_ALREADY_FULFILLED: {
      ar: "تم استلام هذه الوجبة",
      en: "This meal has already been picked up",
    },
    SLOT_ALREADY_CONSUMED: {
      ar: "تم استخدام هذه الوجبة بالفعل",
      en: "This meal has already been consumed",
    },
    PREMIUM_PAYMENT_REQUIRED: {
      ar: "يجب إتمام دفع ترقية الوجبة أولاً",
      en: "Premium upgrade payment must be completed first",
    },
    ADDON_PAYMENT_REQUIRED: {
      ar: "يجب إتمام دفع الإضافات أولاً",
      en: "Addon payment must be completed first",
    },
    PAYMENT_REQUIRED: {
      ar: "يجب إتمام الدفع أولاً",
      en: "Payment must be completed first",
    },
    PLANNING_INCOMPLETE: {
      ar: "يجب إكمال اختيار الوجبة أولاً",
      en: "Meal selection must be completed first",
    },
    INVALID_SLOT: {
      ar: "هذه الوجبة غير متاحة للاستلام",
      en: "This meal is not available for pickup",
    },
  };
  return copies[reason] || {
    ar: "هذه الوجبة غير متاحة للاستلام",
    en: "This meal is not available for pickup",
  };
}

function combineKitchenSlots(arSlot = null, enSlot = null) {
  if (!arSlot && !enSlot) return null;
  return {
    ar: arSlot || {},
    en: enSlot || {},
    base: enSlot || arSlot || {},
  };
}

function buildKitchenSlotMap({ day = {}, subscription = {}, catalogMaps = {} }) {
  let arSlots = [];
  let enSlots = [];
  try {
    arSlots = buildKitchenDetailsPayload(day || {}, subscription || {}, "ar", catalogMaps || {}).mealSlots || [];
    enSlots = buildKitchenDetailsPayload(day || {}, subscription || {}, "en", catalogMaps || {}).mealSlots || [];
  } catch (err) {
    arSlots = [];
    enSlots = [];
  }
  const arByKey = new Map(arSlots.map((slot) => [resolveSlotId(slot), slot]).filter(([key]) => key));
  const enByKey = new Map(enSlots.map((slot) => [resolveSlotId(slot), slot]).filter(([key]) => key));
  const keys = new Set([...arByKey.keys(), ...enByKey.keys()]);
  return new Map([...keys].map((key) => [key, combineKitchenSlots(arByKey.get(key), enByKey.get(key))]));
}

function kitchenPair(kitchenSlot, field, i18nField = `${field}I18n`) {
  if (!kitchenSlot) return { ar: null, en: null };
  return firstLocalizedPair(
    kitchenSlot.base && kitchenSlot.base[i18nField],
    {
      ar: kitchenSlot.ar && kitchenSlot.ar[field],
      en: kitchenSlot.en && kitchenSlot.en[field],
    }
  );
}

function getFromMap(map, value) {
  if (!map || value === undefined || value === null) return null;
  return map.get(String(value)) || null;
}

function resolveCatalogProduct(slot = {}, catalogMaps = {}) {
  return getFromMap(catalogMaps.productById, slot.productId)
    || getFromMap(catalogMaps.productByKey, slot.productKey)
    || null;
}

function resolveCatalogOption(option = {}, catalogMaps = {}) {
  return getFromMap(catalogMaps.optionById, option.optionId || option.id || option._id)
    || getFromMap(catalogMaps.optionByKey, option.optionKey || option.key)
    || null;
}

function resolveCatalogGroup(option = {}, catalogMaps = {}) {
  return getFromMap(catalogMaps.groupById, option.groupId)
    || getFromMap(catalogMaps.groupByKey, option.groupKey || option.canonicalGroupKey)
    || null;
}

function resolveLegacyProtein(slot = {}, catalogMaps = {}) {
  return getFromMap(catalogMaps.proteinById, slot.proteinId)
    || getFromMap(catalogMaps.proteinByKey, slot.proteinKey || slot.premiumKey || slot.proteinFamilyKey)
    || null;
}

function resolveLegacyCarbs(slot = {}, catalogMaps = {}) {
  const carbs = Array.isArray(slot.carbs)
    ? slot.carbs
    : (Array.isArray(slot.carbSelections)
      ? slot.carbSelections
      : (slot.carbId ? [{ carbId: slot.carbId, grams: null }] : []));
  return carbs.map((carb) => ({
    source: carb,
    doc: getFromMap(catalogMaps.carbById, carb && carb.carbId)
      || getFromMap(catalogMaps.carbByKey, carb && (carb.key || carb.carbKey)),
  }));
}

function joinPairs(pairs, separator = " / ") {
  const present = pairs.filter((pair) => pair && (pair.ar || pair.en));
  if (!present.length) return { ar: null, en: null };
  return {
    ar: present.map((pair) => pair.ar || pair.en).filter(Boolean).join(separator) || null,
    en: present.map((pair) => pair.en || pair.ar).filter(Boolean).join(separator) || null,
  };
}

function legacyMealPair(slot = {}, catalogMaps = {}) {
  const protein = resolveLegacyProtein(slot, catalogMaps);
  const carbPairs = resolveLegacyCarbs(slot, catalogMaps).map(({ source, doc }) => firstLocalizedPair(doc && doc.name, source && (source.name || source.carbName)));
  return joinPairs([
    firstLocalizedPair(protein && protein.name, slot.proteinName, slot.proteinId ? slot.premiumKey : null),
    ...carbPairs,
  ]);
}

function legacyOptionRows(slot = {}, catalogMaps = {}) {
  const rows = [];
  const protein = resolveLegacyProtein(slot, catalogMaps);
  if (protein || slot.proteinId) {
    rows.push({
      optionId: slot.proteinId || (protein && protein._id),
      optionKey: (protein && (protein.key || protein.premiumKey)) || slot.proteinKey || slot.premiumKey || slot.proteinFamilyKey || null,
      nameI18n: firstLocalizedPair(protein && protein.name, slot.proteinName, slot.premiumKey),
      groupKey: "protein",
      groupNameI18n: { ar: "البروتين", en: "Protein" },
      quantity: 1,
    });
  }
  resolveLegacyCarbs(slot, catalogMaps).forEach(({ source, doc }) => {
    if (!doc && !(source && source.carbId)) return;
    rows.push({
      optionId: source && source.carbId || (doc && doc._id),
      optionKey: (doc && doc.key) || (source && (source.key || source.carbKey)) || null,
      nameI18n: firstLocalizedPair(doc && doc.name, source && (source.name || source.carbName)),
      groupKey: "carbs",
      groupNameI18n: { ar: "الكارب", en: "Carbs" },
      quantity: 1,
    });
  });
  return rows;
}

function buildLegacySnapshots(slot = {}, catalogMaps = {}) {
  const hasLegacySelection = Boolean(
    slot.proteinId
      || slot.carbId
      || (Array.isArray(slot.carbs) && slot.carbs.length > 0)
      || (Array.isArray(slot.carbSelections) && slot.carbSelections.length > 0)
  );
  if (!hasLegacySelection) return {};
  const protein = resolveLegacyProtein(slot, catalogMaps);
  const legacyName = legacyMealPair(slot, catalogMaps);
  if (!protein && !legacyName.ar && !legacyName.en) return {};
  const carbNutrition = resolveLegacyCarbs(slot, catalogMaps).reduce((sum, { doc }) => {
    const nutrition = asObject(doc && doc.nutrition);
    return {
      calories: sum.calories + Number(nutrition.calories || 0),
      proteinGrams: sum.proteinGrams + Number(nutrition.proteinGrams || 0),
      carbGrams: sum.carbGrams + Number(nutrition.carbGrams || 0),
      fatGrams: sum.fatGrams + Number(nutrition.fatGrams || 0),
    };
  }, { calories: 0, proteinGrams: 0, carbGrams: 0, fatGrams: 0 });
  const proteinNutrition = asObject(protein && protein.nutrition);
  const product = {
    id: stringifyId(slot.proteinId || (protein && protein._id)),
    key: (protein && (protein.key || protein.premiumKey)) || slot.proteinKey || slot.premiumKey || slot.proteinFamilyKey || null,
    name: legacyName,
    description: firstLocalizedPair(protein && protein.description),
    imageUrl: (protein && protein.imageUrl) || "",
    calories: Number(proteinNutrition.calories || 0) + carbNutrition.calories,
    macros: {
      protein: Number(proteinNutrition.proteinGrams || 0) + carbNutrition.proteinGrams,
      carbs: Number(proteinNutrition.carbGrams || 0) + carbNutrition.carbGrams,
      fat: Number(proteinNutrition.fatGrams || 0) + carbNutrition.fatGrams,
    },
  };
  const groups = legacyOptionRows(slot, catalogMaps).map((row) => ({
    groupId: row.groupId || null,
    groupKey: row.groupKey,
    groupName: row.groupNameI18n,
    optionId: stringifyId(row.optionId),
    optionKey: row.optionKey,
    optionName: row.nameI18n,
    quantity: Number(row.quantity || 1),
  }));
  return {
    displaySnapshot: {
      product,
      groups,
    },
    confirmationSnapshot: {
      product,
      selectedOptions: groups,
      protein: protein ? {
        id: stringifyId(protein._id),
        key: protein.key || protein.premiumKey || null,
        name: firstLocalizedPair(protein.name),
      } : undefined,
    },
  };
}

function enrichMealSlotWithResolvedSnapshots(slot = {}, catalogMaps = {}) {
  const plainSlot = toPlainObject(slot);
  const legacy = buildLegacySnapshots(plainSlot, catalogMaps);
  if (!legacy.displaySnapshot && !legacy.confirmationSnapshot) return plainSlot;
  return {
    ...plainSlot,
    displaySnapshot: plainSlot.displaySnapshot || legacy.displaySnapshot,
    confirmationSnapshot: plainSlot.confirmationSnapshot || legacy.confirmationSnapshot,
  };
}

function enrichDayMealSlotsWithResolvedSnapshots(day = {}, catalogMaps = {}) {
  const plainDay = toPlainObject(day);
  if (!plainDay || !Array.isArray(plainDay.mealSlots)) return plainDay;
  return {
    ...plainDay,
    mealSlots: plainDay.mealSlots.map((slot) => enrichMealSlotWithResolvedSnapshots(slot, catalogMaps)),
  };
}

function buildProductPayload(slot = {}, kitchenSlot = null, productDoc = null) {
  const confirmation = asObject(slot.confirmationSnapshot);
  const display = asObject(slot.displaySnapshot);
  const fulfillment = asObject(slot.fulfillmentSnapshot);
  const product = asObject(confirmation.product || display.product || fulfillment.product);
  const kitchen = kitchenSlot && kitchenSlot.base ? kitchenSlot.base : {};
  const macros = asObject(product.macros || display.macros || confirmation.macros || fulfillment.macros);
  const fallbackLabel = selectionTypeLabel(slot.selectionType, slot.isPremium);
  const name = firstLocalizedPair(
    product.name,
    product.title,
    productDoc && productDoc.name,
    kitchenPair(kitchenSlot, "productName"),
    display.productName,
    fulfillment.productName,
    slot.productName,
    fallbackLabel
  );
  const description = firstLocalizedPair(product.description, productDoc && productDoc.description, kitchen.productDescriptionI18n, display.description, confirmation.description);
  return {
    id: stringifyId(slot.productId || product.id || product._id || kitchen.productId || (productDoc && productDoc._id)),
    key: slot.productKey || product.key || kitchen.productKey || (productDoc && productDoc.key) || null,
    name,
    description,
    image: product.image || product.imageUrl || product.photo || display.image || confirmation.image || fulfillment.image || kitchen.image || (productDoc && productDoc.imageUrl) || null,
    calories: Number(product.calories || display.calories || confirmation.calories || fulfillment.calories || 0),
    macros: {
      protein: Number(macros.protein || macros.proteinGrams || 0),
      carbs: Number(macros.carbs || macros.carbsGrams || 0),
      fat: Number(macros.fat || macros.fatGrams || 0),
    },
  };
}

function mergeKitchenOptions(kitchenSlot = null) {
  if (!kitchenSlot) return [];
  const arOptions = Array.isArray(kitchenSlot.ar && kitchenSlot.ar.selectedOptions) ? kitchenSlot.ar.selectedOptions : [];
  const enOptions = Array.isArray(kitchenSlot.en && kitchenSlot.en.selectedOptions) ? kitchenSlot.en.selectedOptions : [];
  const max = Math.max(arOptions.length, enOptions.length);
  const merged = [];
  for (let index = 0; index < max; index += 1) {
    const ar = arOptions[index] || {};
    const en = enOptions[index] || {};
    merged.push({
      ...(en || ar),
      nameI18n: { ar: ar.name || null, en: en.name || null },
      groupNameI18n: { ar: ar.groupName || null, en: en.groupName || null },
    });
  }
  return merged;
}

function optionSources(slot = {}, kitchenSlot = null) {
  const confirmation = asObject(slot.confirmationSnapshot);
  const display = asObject(slot.displaySnapshot);
  const sources = [
    Array.isArray(confirmation.selectedOptions) ? confirmation.selectedOptions : [],
    Array.isArray(display.groups) ? display.groups : [],
    mergeKitchenOptions(kitchenSlot),
    Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [],
  ];
  return sources.find((items) => items.some((item) => hasLocalizedText(item.nameI18n || item.name || item.optionName || item.label)))
    || sources.find((items) => items.length > 0)
    || [];
}

function buildOptionPayload(option = {}, catalogMaps = {}) {
  const optionDoc = resolveCatalogOption(option, catalogMaps);
  const groupDoc = resolveCatalogGroup(option, catalogMaps);
  const name = firstLocalizedPair(option.nameI18n, option.name, option.optionName, option.label, optionDoc && optionDoc.name, option.optionKey);
  const groupName = firstLocalizedPair(option.groupNameI18n, groupDoc && groupDoc.name, option.groupName, option.groupLabel, option.group, option.groupKey);
  return {
    id: stringifyId(option.optionId || option.id || option._id || (optionDoc && optionDoc._id)),
    key: option.optionKey || option.key || (optionDoc && optionDoc.key) || null,
    name,
    groupKey: option.groupKey || option.canonicalGroupKey || (groupDoc && groupDoc.key) || null,
    groupName,
    quantity: Number(option.quantity || option.qty || 1),
  };
}

function buildAddonPayload(addon = {}) {
  const paymentRequired = addon.source === "pending_payment";
  const paid = addon.source === "paid" || addon.source === "wallet" || addon.source === "subscription";
  return {
    id: stringifyId(addon.addonId || addon.id || addon._id),
    key: addon.key || addon.addonKey || null,
    name: firstLocalizedPair(addon.name, addon.addonName, addon.key || addon.addonKey),
    quantity: Number(addon.quantity || addon.qty || 1),
    price: moneyFromHalala(addon.priceHalala || addon.unitPriceHalala || addon.totalPriceHalala),
    paymentStatus: canonicalPaymentStatus({ required: paymentRequired, paid }),
    paymentRequired,
  };
}

function buildPaymentPayload({ slot = {}, day = {}, reason = null, addons = [] }) {
  const premiumRequired = reason === "PREMIUM_PAYMENT_REQUIRED";
  const addonRequired = reason === "ADDON_PAYMENT_REQUIRED" || addons.some((addon) => addon.paymentRequired);
  const required = premiumRequired || addonRequired || reason === "PAYMENT_REQUIRED";
  const reasonLabel = reason ? localizedPair(resolveReasonCopy(reason)) : { ar: null, en: null };
  const premiumDue = premiumRequired
    ? moneyFromHalala(slot.premiumExtraFeeHalala || (day.premiumExtraPayment && day.premiumExtraPayment.amountHalala))
    : 0;
  const addonDue = addonRequired
    ? addons.filter((addon) => addon.paymentRequired).reduce((sum, addon) => sum + Number(addon.price || 0), 0)
    : 0;
  return {
    required,
    status: required ? "pending" : (slot.isPremium && ["paid", "paid_extra", "balance"].includes(slot.premiumSource) ? "paid" : "not_required"),
    reason: required ? reason : null,
    reasonLabel,
    amountDue: premiumDue + addonDue,
    currency: (day.premiumExtraPayment && day.premiumExtraPayment.currency) || "SAR",
    premiumRequired,
    addonRequired,
  };
}

function buildDisplayPayload({ product, meal, slot = {}, available, unavailableReason, payment }) {
  const label = selectionTypeLabel(slot.selectionType, slot.isPremium);
  const titleAr = meal.title.ar || product.name.ar || meal.title.en || product.name.en || label.ar || slot.slotKey || "وجبة";
  const titleEn = meal.title.en || product.name.en || meal.title.ar || product.name.ar || label.en || slot.slotKey || "Meal";
  const subtitleAr = meal.subtitle.ar || product.description.ar || null;
  const subtitleEn = meal.subtitle.en || product.description.en || null;
  const unavailableCopy = unavailableReason ? resolveReasonCopy(unavailableReason) : { ar: null, en: null };
  const badgesAr = [];
  const badgesEn = [];
  if (slot.isPremium) {
    badgesAr.push("وجبة مميزة");
    badgesEn.push("Premium");
  }
  if (payment.required) {
    badgesAr.push("بانتظار الدفع");
    badgesEn.push("Payment pending");
  } else if (slot.isPremium && ["balance", "paid", "paid_extra"].includes(slot.premiumSource)) {
    badgesAr.push("مدفوعة");
    badgesEn.push("Paid");
  }
  return {
    titleAr,
    titleEn,
    subtitleAr,
    subtitleEn,
    image: meal.image || product.image || null,
    badgesAr,
    badgesEn,
    statusTextAr: available ? "متاحة للاستلام" : unavailableCopy.ar,
    statusTextEn: available ? "Available for pickup" : unavailableCopy.en,
    selectionTextAr: available ? "اختر هذه الوجبة للاستلام" : null,
    selectionTextEn: available ? "Select this meal for pickup" : null,
    unavailableTextAr: available ? null : unavailableCopy.ar,
    unavailableTextEn: available ? null : unavailableCopy.en,
  };
}

function buildClientSlotDetails({ slot = {}, day = {}, available, unavailableReason, kitchenSlot = null, productDoc = null, catalogMaps = {} }) {
  const product = buildProductPayload(slot, kitchenSlot, productDoc);
  const label = selectionTypeLabel(slot.selectionType, slot.isPremium);
  const mealTitle = firstLocalizedPair(
    asObject(slot.displaySnapshot).title,
    asObject(slot.confirmationSnapshot).title,
    kitchenPair(kitchenSlot, "productName"),
    product.name,
    label
  );
  const mealSubtitle = firstLocalizedPair(
    asObject(slot.displaySnapshot).subtitle,
    asObject(slot.confirmationSnapshot).subtitle,
    product.description
  );
  const meal = {
    title: mealTitle,
    subtitle: mealSubtitle,
    image: product.image,
    mealType: slot.selectionType || "standard_meal",
    quantity: 1,
  };
  const options = optionSources(slot, kitchenSlot).map((option) => buildOptionPayload(option, catalogMaps));
  const addons = (Array.isArray(day && day.addonSelections) ? day.addonSelections : []).map(buildAddonPayload);
  const payment = buildPaymentPayload({ slot, day, reason: unavailableReason, addons });
  return {
    canSelect: Boolean(available),
    product,
    meal,
    options,
    addons,
    payment,
    display: buildDisplayPayload({ product, meal, slot, available, unavailableReason, payment }),
  };
}

function resolveCanonicalPaymentReason(day = {}) {
  const commercial = buildDayCommercialState(day || {});
  return (commercial.paymentRequirement && commercial.paymentRequirement.blockingReason)
    || (commercial.paymentRequirement && commercial.paymentRequirement.requiresPayment ? "PAYMENT_REQUIRED" : null);
}

function buildSlotReservationMap(pickupRequests = []) {
  const map = new Map();
  for (const request of pickupRequests) {
    const ids = Array.isArray(request && request.selectedMealSlotIds) ? request.selectedMealSlotIds : [];
    for (const id of ids.map(normalizeSlotId).filter(Boolean)) {
      map.set(id, {
        requestId: String(request._id),
        status: request.status,
        consumed: Boolean(request.creditsConsumedAt || request.status === "fulfilled" || request.status === "no_show"),
      });
    }
  }
  return map;
}

function buildAvailabilityFromDay({ day, pickupRequests = [], subscription = {}, catalogMaps = {} }) {
  const resolvedDay = enrichDayMealSlotsWithResolvedSnapshots(day || {}, catalogMaps);
  const selectedIds = new Set();
  const reservationMap = buildSlotReservationMap(pickupRequests);
  const addonPaymentReason = dayHasUnpaidAddons(resolvedDay) ? resolveCanonicalPaymentReason(resolvedDay) || "ADDON_PAYMENT_REQUIRED" : null;
  const kitchenSlots = buildKitchenSlotMap({ day: resolvedDay, subscription, catalogMaps });
  const slots = (Array.isArray(resolvedDay && resolvedDay.mealSlots) ? resolvedDay.mealSlots : []).map((slot) => {
    const slotId = resolveSlotId(slot);
    const kitchenSlot = kitchenSlots.get(slotId) || null;
    const productDoc = resolveCatalogProduct(slot, catalogMaps);
    const reservation = reservationMap.get(slotId);
    const paymentReason = slotHasUnpaidPremium(slot) ? resolveCanonicalPaymentReason(day) || "PREMIUM_PAYMENT_REQUIRED" : addonPaymentReason;
    const reasons = [];
    if (!slotId) reasons.push("INVALID_SLOT");
    if (String(slot.status || "complete") !== "complete") reasons.push("PLANNING_INCOMPLETE");
    if (paymentReason) reasons.push(paymentReason);
    if (reservation) {
      reasons.push(reservation.status === "fulfilled"
        ? "SLOT_ALREADY_FULFILLED"
        : (reservation.consumed ? "SLOT_ALREADY_CONSUMED" : "SLOT_ALREADY_RESERVED"));
    }
    const available = reasons.length === 0;
    selectedIds.add(slotId);
    const unavailableReason = available ? null : reasons[0];
    return {
      slotId,
      slotKey: slot.slotKey || null,
      slotIndex: Number(slot.slotIndex || 0),
      selectionType: slot.selectionType || null,
      isPremium: Boolean(slot.isPremium),
      premiumSource: slot.premiumSource || "none",
      available,
      unavailableReason,
      reasons,
      reservedByPickupRequestId: reservation ? reservation.requestId : null,
      ...buildClientSlotDetails({ slot, day: resolvedDay, available, unavailableReason, kitchenSlot, productDoc, catalogMaps }),
    };
  });

  return {
    date: resolvedDay ? resolvedDay.date : null,
    subscriptionDayId: resolvedDay && resolvedDay._id ? String(resolvedDay._id) : null,
    paymentReason: addonPaymentReason || resolveCanonicalPaymentReason(resolvedDay),
    slots,
    availableSlotIds: slots.filter((slot) => slot.available).map((slot) => slot.slotId),
    unavailableSlotIds: slots.filter((slot) => !slot.available).map((slot) => slot.slotId),
  };
}

async function findBlockingPickupRequests({ subscriptionId, date, session = null }) {
  const query = SubscriptionPickupRequest.find({
    subscriptionId,
    date,
    status: { $in: ACTIVE_OR_CONSUMING_PICKUP_STATUSES },
    selectedMealSlotIds: { $exists: true, $ne: [] },
  });
  if (session) query.session(session);
  return query.lean();
}

async function assertSelectedSlotsAvailableForPickup({
  subscriptionId,
  day,
  selectedMealSlotIds,
  session = null,
}) {
  const normalizedIds = normalizeSelectedMealSlotIds(selectedMealSlotIds);
  if (normalizedIds.length === 0) {
    throw createServiceError("SELECTED_MEAL_SLOT_IDS_REQUIRED", "selectedMealSlotIds is required", 400);
  }
  if (!day) {
    throw createServiceError("DAY_NOT_FOUND", "Subscription day not found", 404);
  }
  const pickupRequests = await findBlockingPickupRequests({ subscriptionId, date: day.date, session });
  const availability = buildAvailabilityFromDay({ day, pickupRequests });
  const byId = new Map(availability.slots.map((slot) => [slot.slotId, slot]));
  const invalid = [];
  const blocked = [];
  for (const id of normalizedIds) {
    const slot = byId.get(id);
    if (!slot) {
      invalid.push(id);
      continue;
    }
    if (!slot.available) blocked.push(slot);
  }
  if (invalid.length) {
    throw createServiceError("MEAL_SLOT_NOT_FOUND", "Selected meal slot was not found", 422, { selectedMealSlotIds: invalid });
  }
  if (blocked.length) {
    const firstReason = blocked[0].unavailableReason || "MEAL_SLOT_UNAVAILABLE";
    const code = firstReason === "PREMIUM_PAYMENT_REQUIRED" || firstReason === "ADDON_PAYMENT_REQUIRED" || firstReason === "PAYMENT_REQUIRED"
      ? firstReason
      : "MEAL_SLOT_UNAVAILABLE";
    throw createServiceError(code, "Selected meal slot is unavailable for pickup", 422, { slots: blocked });
  }
  return {
    selectedMealSlotIds: normalizedIds,
    selectedSlots: normalizedIds.map((id) => byId.get(id)),
    availability,
  };
}

module.exports = {
  ACTIVE_OR_CONSUMING_PICKUP_STATUSES,
  assertSelectedSlotsAvailableForPickup,
  buildAvailabilityFromDay,
  buildPickupRequestPayloadHash,
  createServiceError,
  enrichDayMealSlotsWithResolvedSnapshots,
  enrichMealSlotWithResolvedSnapshots,
  findBlockingPickupRequests,
  normalizeSelectedMealSlotIds,
  resolveCanonicalPaymentReason,
  resolveSlotId,
};
