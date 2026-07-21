"use strict";

const crypto = require("crypto");

const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const { buildKitchenDetailsPayload } = require("../dashboard/opsPayloadService");
const { buildDayCommercialState, evaluateAddonChoicePayment } = require("./subscriptionDayCommercialStateService");
const { hydrateSubscriptionDayMealSources } = require("./subscriptionDayMealSourceService");

const ACTIVE_OR_CONSUMING_PICKUP_STATUSES = ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "no_show"];

const EMPTY_TEXT_PAIR = Object.freeze({ ar: "", en: "" });
const PICKUP_COPY = Object.freeze({
  available: { ar: "متاح للاستلام", en: "Available for pickup" },
  selectItem: { ar: "اختر هذا العنصر للاستلام", en: "Select this item for pickup" },
  reservedItem: { ar: "تم طلب استلام هذا العنصر بالفعل", en: "This item has already been requested for pickup" },
  reservedMeal: { ar: "تم طلب استلام هذه الوجبة بالفعل", en: "This meal has already been requested for pickup" },
  reservedAddon: { ar: "تم طلب استلام هذه الإضافة بالفعل", en: "This add-on has already been requested for pickup" },
  fulfilledItem: { ar: "تم استلام هذا العنصر", en: "This item has been picked up" },
  noShowItem: { ar: "تم احتساب هذا العنصر كعدم حضور", en: "This item was marked as no-show" },
  premiumPaymentRequired: { ar: "يجب إتمام دفع ترقية الوجبة أولاً", en: "Premium meal upgrade payment is required first" },
  addonPaymentRequired: { ar: "يجب إتمام دفع الإضافات أولاً", en: "Add-on payment is required first" },
  includedAddon: { ar: "إضافة مشمولة", en: "Included add-on" },
  paidAddon: { ar: "إضافة مدفوعة", en: "Paid add-on" },
  premiumBadge: { ar: "وجبة مميزة", en: "Premium" },
  paidBadge: { ar: "مدفوعة", en: "Paid" },
  paymentPendingBadge: { ar: "بانتظار الدفع", en: "Payment pending" },
});

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

function normalizeSelectedPickupItemIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw createServiceError("INVALID_SELECTED_PICKUP_ITEM_IDS", "selectedPickupItemIds must be an array", 400);
  }
  const ids = value.map(normalizeSlotId).filter(Boolean);
  if (ids.length !== value.length) {
    throw createServiceError("INVALID_SELECTED_PICKUP_ITEM_IDS", "selectedPickupItemIds must contain non-empty values", 400);
  }
  if (new Set(ids).size !== ids.length) {
    throw createServiceError("DUPLICATE_SELECTED_PICKUP_ITEM_IDS", "selectedPickupItemIds must not contain duplicates", 400);
  }
  return ids;
}

function dedupeSorted(values = []) {
  return [...new Set(values.map(normalizeSlotId).filter(Boolean))].sort();
}

function buildPickupRequestPayloadHash({ date, mealCount, selectedMealSlotIds = [], selectedPickupItemIds = [] }) {
  const normalized = {
    date: String(date || ""),
    mealCount: Number(mealCount || 0),
    selectedMealSlotIds: dedupeSorted(normalizeSelectedMealSlotIds(selectedMealSlotIds)),
    selectedPickupItemIds: dedupeSorted(normalizeSelectedPickupItemIds(selectedPickupItemIds)),
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

function bilingualPair(value, fallback = EMPTY_TEXT_PAIR) {
  const pair = localizedPair(value);
  const fallbackPair = localizedPair(fallback, "");
  const ar = pair.ar || pair.en || fallbackPair.ar || fallbackPair.en || "";
  const en = pair.en || pair.ar || fallbackPair.en || fallbackPair.ar || "";
  return { ar: String(ar), en: String(en) };
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

function resolveReasonCopy(reason, itemType = "item") {
  if (reason === "SLOT_ALREADY_RESERVED") {
    if (itemType === "addon") return PICKUP_COPY.reservedAddon;
    if (["meal", "premium_meal"].includes(itemType)) return PICKUP_COPY.reservedMeal;
    return PICKUP_COPY.reservedItem;
  }
  const copies = {
    SLOT_ALREADY_FULFILLED: PICKUP_COPY.fulfilledItem,
    SLOT_ALREADY_CONSUMED: {
      ar: "تم استخدام هذا العنصر بالفعل",
      en: "This item has already been consumed",
    },
    SLOT_ALREADY_NO_SHOW: PICKUP_COPY.noShowItem,
    PREMIUM_PAYMENT_REQUIRED: PICKUP_COPY.premiumPaymentRequired,
    ADDON_PAYMENT_REQUIRED: PICKUP_COPY.addonPaymentRequired,
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
  const name = bilingualPair(firstLocalizedPair(
    productDoc && productDoc.name,
    kitchenPair(kitchenSlot, "productName"),
    product.name,
    product.title,
    display.productName,
    fulfillment.productName,
    slot.productName,
    fallbackLabel
  ), fallbackLabel);
  const description = bilingualPair(firstLocalizedPair(product.description, productDoc && productDoc.description, kitchen.productDescriptionI18n, display.description, confirmation.description), EMPTY_TEXT_PAIR);
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
  const name = bilingualPair(firstLocalizedPair(option.nameI18n, option.name, option.optionName, option.label, optionDoc && optionDoc.name), { ar: "عنصر", en: "Item" });
  const groupName = bilingualPair(firstLocalizedPair(option.groupNameI18n, groupDoc && groupDoc.name, option.groupName, option.groupLabel, option.group), { ar: "المكونات", en: "Components" });
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
    id: stringifyId(addon.addonId || addon.productId || addon.menuProductId || addon.id || addon._id),
    key: addon.key || addon.addonKey || null,
    name: bilingualPair(firstLocalizedPair(addon.name, addon.addonName), { ar: "إضافة", en: "Add-on" }),
    quantity: Number(addon.quantity || addon.qty || 1),
    price: moneyFromHalala(addon.priceHalala || addon.unitPriceHalala || addon.totalPriceHalala),
    paymentStatus: canonicalPaymentStatus({ required: paymentRequired, paid }),
    paymentRequired,
    addonScope: "day",
    inheritedFromDay: true,
  };
}

function buildPaymentPayload({ slot = {}, day = {}, reason = null, addons = [] }) {
  const premiumRequired = reason === "PREMIUM_PAYMENT_REQUIRED";
  const addonRequired = reason === "ADDON_PAYMENT_REQUIRED";
  const required = premiumRequired || addonRequired || reason === "PAYMENT_REQUIRED";
  const reasonLabel = required && reason ? bilingualPair(resolveReasonCopy(reason), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR };
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
  const title = bilingualPair(firstLocalizedPair(meal.title, product.name), label);
  const subtitle = bilingualPair(firstLocalizedPair(meal.subtitle, product.description), EMPTY_TEXT_PAIR);
  const unavailableCopy = unavailableReason ? bilingualPair(resolveReasonCopy(unavailableReason, itemTypeForSelectionType(slot.selectionType, slot.isPremium)), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR };
  const badgesAr = [];
  const badgesEn = [];
  if (slot.isPremium) {
    badgesAr.push(PICKUP_COPY.premiumBadge.ar);
    badgesEn.push(PICKUP_COPY.premiumBadge.en);
  }
  if (payment.required) {
    badgesAr.push(PICKUP_COPY.paymentPendingBadge.ar);
    badgesEn.push(PICKUP_COPY.paymentPendingBadge.en);
  } else if (slot.isPremium && ["balance", "paid", "paid_extra"].includes(slot.premiumSource)) {
    badgesAr.push(PICKUP_COPY.paidBadge.ar);
    badgesEn.push(PICKUP_COPY.paidBadge.en);
  }
  return {
    titleAr: title.ar,
    titleEn: title.en,
    subtitleAr: subtitle.ar,
    subtitleEn: subtitle.en,
    image: meal.image || product.image || null,
    badgesAr,
    badgesEn,
    statusTextAr: available ? PICKUP_COPY.available.ar : unavailableCopy.ar,
    statusTextEn: available ? PICKUP_COPY.available.en : unavailableCopy.en,
    selectionTextAr: available ? PICKUP_COPY.selectItem.ar : "",
    selectionTextEn: available ? PICKUP_COPY.selectItem.en : "",
    unavailableTextAr: available ? "" : unavailableCopy.ar,
    unavailableTextEn: available ? "" : unavailableCopy.en,
  };
}

function buildClientSlotDetails({ slot = {}, day = {}, available, unavailableReason, kitchenSlot = null, productDoc = null, catalogMaps = {} }) {
  const product = buildProductPayload(slot, kitchenSlot, productDoc);
  const label = selectionTypeLabel(slot.selectionType, slot.isPremium);
  const mealTitle = bilingualPair(firstLocalizedPair(
    productDoc && productDoc.name,
    kitchenPair(kitchenSlot, "productName"),
    asObject(slot.displaySnapshot).title,
    asObject(slot.confirmationSnapshot).title,
    product.name,
    label
  ), label);
  const mealSubtitle = bilingualPair(firstLocalizedPair(
    asObject(slot.displaySnapshot).subtitle,
    asObject(slot.confirmationSnapshot).subtitle,
    product.description
  ), EMPTY_TEXT_PAIR);
  const meal = {
    title: mealTitle,
    subtitle: mealSubtitle,
    image: product.image,
    mealType: slot.selectionType || "standard_meal",
    quantity: 1,
  };
  const options = optionSources(slot, kitchenSlot).map((option) => buildOptionPayload(option, catalogMaps));
  const addons = (Array.isArray(slot && slot.addons) ? slot.addons : []).map(buildAddonPayload);
  const paymentAddons = (Array.isArray(day && day.addonSelections) ? day.addonSelections : []).map(buildAddonPayload);
  const payment = buildPaymentPayload({ slot, day, reason: unavailableReason, addons: paymentAddons });
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

function itemTypeForSelectionType(selectionType, isPremium = false) {
  const type = String(selectionType || "").trim();
  if (type === "premium_large_salad") return "large_salad";
  if (type === "sandwich") return "sandwich";
  if (type === "premium_meal" || isPremium) return "premium_meal";
  if (type === "standard_meal" || type === "basic_meal") return "meal";
  if (type === "protein" || type === "protein_extra") return "protein_extra";
  if (type === "addon") return "addon";
  return "unknown";
}

function categoryKeyForItemType(itemType) {
  const map = {
    meal: "meals",
    premium_meal: "premium_meals",
    large_salad: "salads",
    protein_extra: "proteins",
    sandwich: "sandwiches",
    addon: "addons",
  };
  return map[itemType] || "meals";
}

function componentTypeFromGroup(groupKey, itemType = "unknown") {
  const key = String(groupKey || "").toLowerCase();
  if (key.includes("protein")) return "protein";
  if (key.includes("carb")) return "carb";
  if (key.includes("sauce")) return "sauce";
  if (key.includes("side")) return "side";
  if (key.includes("addon")) return "addon";
  return itemType === "addon" ? "addon" : "side";
}

function buildComponentsFromOptions(options = []) {
  return (Array.isArray(options) ? options : []).map((option) => ({
    id: option.id || null,
    key: option.key || null,
    type: componentTypeFromGroup(option.groupKey),
    name: bilingualPair(option.name, { ar: "عنصر", en: "Item" }),
    groupKey: option.groupKey || null,
    groupName: bilingualPair(option.groupName, { ar: "المكونات", en: "Components" }),
    quantity: Number(option.quantity || 1),
  }));
}

function buildPickupItemFromSlot(slot = {}) {
  const itemType = itemTypeForSelectionType(slot.selectionType, slot.isPremium);
  const state = slot.availabilityState || (slot.available ? "available" : "payment_required");
  const reasonLabel = slot.unavailableReason ? bilingualPair(resolveReasonCopy(slot.unavailableReason, itemType), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR };
  const title = bilingualPair(slot.meal && slot.meal.title ? slot.meal.title : { ar: slot.display && slot.display.titleAr || null, en: slot.display && slot.display.titleEn || null }, selectionTypeLabel(slot.selectionType, slot.isPremium));
  const subtitle = bilingualPair(slot.meal && slot.meal.subtitle ? slot.meal.subtitle : { ar: slot.display && slot.display.subtitleAr || null, en: slot.display && slot.display.subtitleEn || null }, EMPTY_TEXT_PAIR);
  return {
    itemId: slot.slotId,
    itemType,
    source: "mealSlot",
    sourceId: slot.slotId,
    slotId: slot.slotId,
    slotKey: slot.slotKey,
    slotIndex: Number(slot.slotIndex || 0),
    selectionType: slot.selectionType || (itemType === "meal" ? "standard_meal" : itemType),
    categoryKey: categoryKeyForItemType(itemType),
    quantity: Number(slot.meal && slot.meal.quantity || 1),
    title,
    subtitle,
    image: slot.meal && slot.meal.image || slot.product && slot.product.image || slot.display && slot.display.image || null,
    product: slot.product || null,
    components: buildComponentsFromOptions(slot.options),
    payment: slot.payment || null,
    availability: {
      state,
      available: Boolean(slot.available),
      canSelect: Boolean(slot.canSelect),
      unavailableReason: slot.unavailableReason || null,
      reasonLabel,
      reservedByPickupRequestId: slot.reservedByPickupRequestId || null,
      fulfilledByPickupRequestId: ["fulfilled", "no_show"].includes(state) ? slot.reservedByPickupRequestId || null : null,
      reasons: Array.isArray(slot.reasons) ? slot.reasons : [],
    },
    display: slot.display || null,
    selectionMode: "independent",
  };
}

function buildDisplayFromAddon({ addon, paymentRequired }) {
  const unavailableCopy = paymentRequired ? bilingualPair(resolveReasonCopy("ADDON_PAYMENT_REQUIRED", "addon"), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR };
  const title = bilingualPair(addon.name, { ar: "إضافة", en: "Add-on" });
  return {
    titleAr: title.ar,
    titleEn: title.en,
    subtitleAr: paymentRequired ? "" : (addon.paymentStatus === "paid" ? PICKUP_COPY.paidAddon.ar : PICKUP_COPY.includedAddon.ar),
    subtitleEn: paymentRequired ? "" : (addon.paymentStatus === "paid" ? PICKUP_COPY.paidAddon.en : PICKUP_COPY.includedAddon.en),
    image: addon.image || null,
    badgesAr: paymentRequired ? [PICKUP_COPY.paymentPendingBadge.ar] : [addon.paymentStatus === "paid" ? PICKUP_COPY.paidAddon.ar : PICKUP_COPY.includedAddon.ar],
    badgesEn: paymentRequired ? [PICKUP_COPY.paymentPendingBadge.en] : [addon.paymentStatus === "paid" ? PICKUP_COPY.paidAddon.en : PICKUP_COPY.includedAddon.en],
    statusTextAr: paymentRequired ? unavailableCopy.ar : PICKUP_COPY.available.ar,
    statusTextEn: paymentRequired ? unavailableCopy.en : PICKUP_COPY.available.en,
    selectionTextAr: paymentRequired ? "" : PICKUP_COPY.selectItem.ar,
    selectionTextEn: paymentRequired ? "" : PICKUP_COPY.selectItem.en,
    unavailableTextAr: paymentRequired ? unavailableCopy.ar : "",
    unavailableTextEn: paymentRequired ? unavailableCopy.en : "",
  };
}

function normalizeAddonCategoryAllowance(row = {}) {
  return {
    category: row.category || null,
    remainingIncludedQty: Math.max(0, Math.floor(Number(row.remainingIncludedQty || 0))),
    includedTotalQty: Math.max(0, Math.floor(Number(row.includedTotalQty || 0))),
    consumedQty: Math.max(0, Math.floor(Number(row.consumedQty || 0))),
    reservedQty: Math.max(0, Math.floor(Number(row.reservedQty || 0))),
    overageUnitPriceHalala: Math.max(0, Math.floor(Number(row.overageUnitPriceHalala || 0))),
    currency: row.currency || "SAR",
    allowanceScope: row.allowanceScope || "category_aggregate",
    sourceOfTruth: row.sourceOfTruth === true,
    spendable: row.spendable === true,
    aggregateCompatibilityOnly: row.aggregateCompatibilityOnly !== false,
  };
}

function normalizeAddonSubscriptionAllowance(row = {}) {
  return {
    ...normalizeAddonCategoryAllowance({ ...row, category: row.allowanceCategory || row.entitlementCategory || row.category }),
    addonPlanId: normalizeSlotId(row.addonPlanId || row.addonId),
    balanceBucketId: normalizeSlotId(row.balanceBucketId),
    entitlementKey: normalizeSlotId(row.entitlementKey),
    displayKey: normalizeSlotId(row.displayKey || row.displayCategory),
    displayCategory: normalizeSlotId(row.displayCategory || row.displayKey),
    allowanceCategory: normalizeSlotId(row.allowanceCategory || row.entitlementCategory || row.category),
    allowanceScope: "addon_subscription",
    sourceOfTruth: true,
    spendable: true,
    aggregateCompatibilityOnly: false,
  };
}

function resolveAddonSubscriptionAllowance(choice, group, allowances) {
  const rows = (Array.isArray(allowances) ? allowances : []).map(normalizeAddonSubscriptionAllowance);
  const unique = (predicate) => {
    const matches = rows.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  };
  const balanceBucketId = normalizeSlotId(choice.balanceBucketId || group.balanceBucketId);
  if (balanceBucketId) return unique((row) => row.balanceBucketId === balanceBucketId);
  const addonPlanId = normalizeSlotId(choice.addonPlanId || group.addonPlanId || group.groupId);
  if (addonPlanId) return unique((row) => row.addonPlanId === addonPlanId);
  const entitlementKey = normalizeSlotId(choice.entitlementKey);
  if (entitlementKey) return unique((row) => row.entitlementKey === entitlementKey);
  const displayKey = normalizeSlotId(group.displayKey || group.displayCategory || choice.displayCategory);
  if (displayKey) {
    const displayMatch = unique((row) => row.displayKey === displayKey || row.displayCategory === displayKey);
    if (displayMatch) return displayMatch;
  }
  const allowanceCategory = normalizeSlotId(group.allowanceCategory || choice.allowanceCategory || choice.entitlementCategory);
  return allowanceCategory ? unique((row) => row.allowanceCategory === allowanceCategory) : null;
}

function buildAddonChoicePickupItem(choice = {}, subscriptionAllowance = {}, index = 0, group = {}) {
  const allowance = normalizeAddonCategoryAllowance({
    ...subscriptionAllowance,
    category: subscriptionAllowance.allowanceCategory || choice.allowanceCategory || choice.entitlementCategory || null,
    currency: subscriptionAllowance.currency || choice.currency || "SAR",
  });
  const addonPlanId = normalizeSlotId(choice.addonPlanId || group.addonPlanId || group.groupId);
  const balanceBucketId = normalizeSlotId(choice.balanceBucketId || subscriptionAllowance.balanceBucketId);
  const entitlementKey = normalizeSlotId(choice.entitlementKey || subscriptionAllowance.entitlementKey);

  const paymentEvaluation = evaluateAddonChoicePayment({ choice, subscriptionAllowance: allowance });
  const paymentRequired = paymentEvaluation.required;
  const paymentStatus = paymentEvaluation.status;
  const remainingIncludedQty = allowance.remainingIncludedQty;
  const priceHalala = paymentEvaluation.amountDueHalala; // if they want the total price, wait, amountDueHalala is 0 if not required.
  // Actually, priceHalala is the product's base price, which we still need for `addon.price`.
  const basePriceHalala = Math.max(0, Math.floor(Number(choice.priceHalala || 0)));

  const addon = {
    id: choice.id || choice._id || null,
    key: choice.key || null,
    name: bilingualPair(choice.nameI18n || { ar: choice.nameAr, en: choice.name }, { ar: "إضافة", en: "Add-on" }),
    price: moneyFromHalala(basePriceHalala),
    paymentStatus,
    image: choice.imageUrl || choice.image || null,
  };
  const itemId = addon.id
    ? `addon_choice_${addonPlanId || "catalog"}_${addon.id}`
    : `addon_choice_${addonPlanId || allowance.category || "unknown"}_${index + 1}`;
  const display = buildDisplayFromAddon({ addon, paymentRequired });
  const payment = {
    required: paymentRequired,
    status: paymentStatus,
    reason: paymentEvaluation.reason,
    reasonLabel: paymentRequired ? bilingualPair(resolveReasonCopy("ADDON_PAYMENT_REQUIRED", "addon"), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR },
    amountDue: paymentRequired ? moneyFromHalala(paymentEvaluation.amountDueHalala) : 0,
    amountDueHalala: paymentEvaluation.amountDueHalala,
    currency: paymentEvaluation.currency,
    premiumRequired: false,
    addonRequired: paymentRequired,
  };
  const availability = {
    state: paymentRequired ? "payment_required" : "available",
    available: true,
    canSelect: true,
    unavailableReason: paymentRequired ? "ADDON_PAYMENT_REQUIRED" : null,
    reasonLabel: paymentRequired ? bilingualPair(resolveReasonCopy("ADDON_PAYMENT_REQUIRED", "addon"), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR },
    reservedByPickupRequestId: null,
    fulfilledByPickupRequestId: null,
    reasons: paymentRequired ? ["ADDON_PAYMENT_REQUIRED"] : [],
    remainingIncludedQty,
    includedTotalQty: allowance.includedTotalQty,
    overageUnitPriceHalala: allowance.overageUnitPriceHalala,
    currency: allowance.currency,
  };

  return {
    itemId,
    itemType: "addon",
    source: "addonChoice",
    sourceId: addon.id,
    addonId: addon.id,
    addonPlanId: addonPlanId || null,
    groupId: normalizeSlotId(group.groupId || addonPlanId) || null,
    balanceBucketId: balanceBucketId || null,
    entitlementKey: entitlementKey || null,
    addonKey: addon.key,
    slotId: null,
    slotKey: null,
    slotIndex: null,
    selectionType: "addon",
    categoryKey: "addons",
    category: allowance.category,
    quantity: 1,
    title: addon.name,
    subtitle: paymentRequired ? { ...EMPTY_TEXT_PAIR } : {
      ar: PICKUP_COPY.includedAddon.ar,
      en: PICKUP_COPY.includedAddon.en,
    },
    image: addon.image,
    price: addon.price,
    priceHalala,
    currency: choice.currency || allowance.currency || "SAR",
    product: {
      id: addon.id,
      key: addon.key,
      name: addon.name,
      description: bilingualPair(choice.descriptionI18n || { ar: "", en: choice.description || "" }, EMPTY_TEXT_PAIR),
      image: addon.image,
      calories: Number(choice.calories || 0),
      macros: { protein: 0, carbs: 0, fat: 0 },
    },
    components: [{
      id: addon.id,
      key: addon.key,
      type: "addon",
      name: addon.name,
      groupKey: allowance.category || "addons",
      groupName: { ar: "الإضافات", en: "Add-ons" },
      quantity: 1,
    }],
    payment,
    availability,
    display,
    selectionMode: "independent",
    addonScope: "subscription",
    inheritedFromDay: false,
    remainingBalance: {
      addonPlanId: addonPlanId || null,
      balanceBucketId: balanceBucketId || null,
      entitlementKey: entitlementKey || null,
      category: allowance.category,
      remainingIncludedQty,
      includedTotalQty: allowance.includedTotalQty,
      overageUnitPriceHalala: allowance.overageUnitPriceHalala,
      currency: allowance.currency,
    },
    addonSubscriptionAllowance: {
      ...allowance,
      addonPlanId: addonPlanId || null,
      balanceBucketId: balanceBucketId || null,
      entitlementKey: entitlementKey || null,
      allowanceScope: "addon_subscription",
      sourceOfTruth: true,
    },
  };
}

function buildAddonChoicePickupItems({ addonChoiceGroups = [], addonSubscriptionAllowances = [] } = {}) {
  const items = [];
  for (const group of Array.isArray(addonChoiceGroups) ? addonChoiceGroups : []) {
    const choices = Array.isArray(group && group.choices) ? group.choices : [];
    for (const choice of choices) {
      const allowance = resolveAddonSubscriptionAllowance(choice, group, addonSubscriptionAllowances) || {};
      items.push(buildAddonChoicePickupItem({
        ...choice,
        addonCategory: group.displayCategory || group.displayKey || choice.category,
      }, allowance, items.length, group));
    }
  }
  return items;
}

function buildPickupItemFromDayAddonUnit(addon = {}, index = 0, unitIndex = 1) {
  const normalized = buildAddonPayload(addon);
  const itemId = normalized.id ? `addon_${normalized.id}_${unitIndex}` : `addon_${index + 1}_${unitIndex}`;
  const paymentRequired = Boolean(normalized.paymentRequired);
  const product = {
    id: normalized.id,
    key: normalized.key,
    name: normalized.name,
    description: { ...EMPTY_TEXT_PAIR },
    image: null,
    calories: 0,
    macros: { protein: 0, carbs: 0, fat: 0 },
  };
  const display = buildDisplayFromAddon({ addon: normalized, paymentRequired });
  return {
    itemId,
    itemType: "addon",
    source: "dayAddon",
    sourceId: normalized.id,
    addonId: normalized.id,
    addonKey: normalized.key,
    slotId: null,
    slotKey: null,
    slotIndex: null,
    selectionType: "addon",
    categoryKey: "addons",
    category: addon.category || null,
    quantity: 1,
    title: normalized.name,
    subtitle: paymentRequired ? { ...EMPTY_TEXT_PAIR } : {
      ar: normalized.paymentStatus === "paid" ? PICKUP_COPY.paidAddon.ar : PICKUP_COPY.includedAddon.ar,
      en: normalized.paymentStatus === "paid" ? PICKUP_COPY.paidAddon.en : PICKUP_COPY.includedAddon.en,
    },
    image: null,
    product,
    components: [{
      id: normalized.id,
      key: normalized.key,
      type: "addon",
      name: normalized.name,
      groupKey: "addons",
      groupName: { ar: "الإضافات", en: "Add-ons" },
      quantity: 1,
    }],
    payment: {
      required: paymentRequired,
      status: normalized.paymentStatus,
      reason: paymentRequired ? "ADDON_PAYMENT_REQUIRED" : null,
      reasonLabel: paymentRequired ? bilingualPair(resolveReasonCopy("ADDON_PAYMENT_REQUIRED", "addon"), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR },
      amountDue: paymentRequired ? Number(normalized.price || 0) : 0,
      currency: addon.currency || "SAR",
      premiumRequired: false,
      addonRequired: paymentRequired,
    },
    availability: {
      state: paymentRequired ? "payment_required" : "available",
      available: !paymentRequired,
      canSelect: !paymentRequired,
      unavailableReason: paymentRequired ? "ADDON_PAYMENT_REQUIRED" : null,
      reasonLabel: paymentRequired ? bilingualPair(resolveReasonCopy("ADDON_PAYMENT_REQUIRED", "addon"), EMPTY_TEXT_PAIR) : { ...EMPTY_TEXT_PAIR },
      reservedByPickupRequestId: null,
      fulfilledByPickupRequestId: null,
      reasons: paymentRequired ? ["ADDON_PAYMENT_REQUIRED"] : [],
    },
    display,
    selectionMode: "independent",
    addonScope: "day",
    inheritedFromDay: false,
    remainingBalance: null,
  };
}

function expandDayAddonPickupItems(addonSelections = []) {
  const counts = new Map();
  return (Array.isArray(addonSelections) ? addonSelections : []).flatMap((addon, index) => {
    const aid = String(addon.addonId || addon.id || addon._id || "");
    const currentCount = counts.get(aid) || 0;
    const quantity = Math.max(1, Number(addon && (addon.quantity || addon.qty) || 1));
    counts.set(aid, currentCount + quantity);
    return Array.from({ length: quantity }, (_, unitIndex) => {
      return buildPickupItemFromDayAddonUnit(addon, index, currentCount + unitIndex + 1);
    });
  });
}

const SECTION_DEFS = [
  { sectionKey: "meals", titleAr: "الوجبات", titleEn: "Meals" },
  { sectionKey: "premium_meals", titleAr: "الوجبات المميزة", titleEn: "Premium Meals" },
  { sectionKey: "salads", titleAr: "السلطات", titleEn: "Salads" },
  { sectionKey: "proteins", titleAr: "البروتين الإضافي", titleEn: "Extra Protein" },
  { sectionKey: "sandwiches", titleAr: "الساندوتشات", titleEn: "Sandwiches" },
  { sectionKey: "addons", titleAr: "الإضافات", titleEn: "Add-ons" },
];

function buildSections(pickupItems = [], availableAddonChoices = []) {
  return SECTION_DEFS.map((section) => ({
    ...section,
    items: section.sectionKey === "addons"
      ? (Array.isArray(availableAddonChoices) ? availableAddonChoices : [])
      : pickupItems.filter((item) => item.categoryKey === section.sectionKey && item.categoryKey !== "addons"),
  }));
}

function buildAddonSummary(dayAddons = []) {
  const totalCount = dayAddons.reduce((sum, addon) => sum + Number(addon.quantity || 1), 0);
  const pendingCount = dayAddons.filter((addon) => Boolean(addon.paymentRequired || (addon.payment && addon.payment.required))).length;
  const amountDue = dayAddons
    .filter((addon) => Boolean(addon.paymentRequired || (addon.payment && addon.payment.required)))
    .reduce((sum, addon) => sum + Number(addon.price || (addon.payment && addon.payment.amountDue) || 0), 0);
  return {
    totalCount,
    pendingCount,
    paidCount: dayAddons.filter((addon) => addon.paymentStatus === "paid" || (addon.payment && addon.payment.status === "paid")).length,
    includedCount: dayAddons.filter((addon) => addon.paymentStatus === "not_required" || (addon.payment && addon.payment.status === "not_required")).length,
    availableCount: dayAddons.filter((addon) => addon.availability && addon.availability.available && addon.availability.canSelect).length,
    amountDue,
    currency: "SAR",
  };
}

function resolveCanonicalPaymentReason(day = {}, subscription = null) {
  const commercial = buildDayCommercialState(day || {}, { subscription });
  return (commercial.paymentRequirement && commercial.paymentRequirement.blockingReason)
    || (commercial.paymentRequirement && commercial.paymentRequirement.requiresPayment ? "PAYMENT_REQUIRED" : null);
}

function buildSlotReservationMap(pickupRequests = []) {
  const map = new Map();
  for (const request of pickupRequests) {
    const ids = [
      ...(Array.isArray(request && request.selectedMealSlotIds) ? request.selectedMealSlotIds : []),
      ...(Array.isArray(request && request.selectedPickupItemIds) ? request.selectedPickupItemIds : []),
    ];
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

function buildPickupItemReservationMap(pickupRequests = []) {
  const map = new Map();
  for (const request of pickupRequests) {
    const itemIds = Array.isArray(request && request.selectedPickupItemIds)
      ? request.selectedPickupItemIds
      : Array.isArray(request && request.selectedMealSlotIds)
        ? request.selectedMealSlotIds
        : [];
    for (const id of itemIds.map(normalizeSlotId).filter(Boolean)) {
      map.set(id, {
        requestId: String(request._id),
        status: request.status,
        consumed: Boolean(request.creditsConsumedAt || request.status === "fulfilled" || request.status === "no_show"),
      });
    }
  }
  return map;
}

function resolveReservationReason(reservation) {
  if (!reservation) return null;
  if (reservation.status === "fulfilled") return "SLOT_ALREADY_FULFILLED";
  if (reservation.status === "no_show") return "SLOT_ALREADY_NO_SHOW";
  return reservation.consumed ? "SLOT_ALREADY_CONSUMED" : "SLOT_ALREADY_RESERVED";
}

function stateForReason(reason) {
  if (!reason) return "available";
  if (["PREMIUM_PAYMENT_REQUIRED", "ADDON_PAYMENT_REQUIRED", "PAYMENT_REQUIRED"].includes(reason)) return "payment_required";
  if (reason === "SLOT_ALREADY_FULFILLED" || reason === "SLOT_ALREADY_CONSUMED") return "fulfilled";
  if (reason === "SLOT_ALREADY_NO_SHOW") return "no_show";
  if (reason === "SLOT_ALREADY_RESERVED") return "reserved";
  return "canceled";
}

function applyReservationToPickupItem(item, reservation) {
  if (!item || !reservation) return item;
  const reason = resolveReservationReason(reservation);
  const state = stateForReason(reason);
  const copy = bilingualPair(resolveReasonCopy(reason, item.itemType), EMPTY_TEXT_PAIR);
  return {
    ...item,
    payment: {
      ...(item.payment || {}),
      reasonLabel: { ...EMPTY_TEXT_PAIR },
    },
    availability: {
      ...(item.availability || {}),
      state,
      available: false,
      canSelect: false,
      unavailableReason: reason,
      reasonLabel: copy,
      reservedByPickupRequestId: reservation.requestId,
      fulfilledByPickupRequestId: ["fulfilled", "no_show"].includes(state) ? reservation.requestId : null,
      reasons: [...new Set([...(item.availability && item.availability.reasons || []), reason])],
    },
    display: {
      ...(item.display || {}),
      statusTextAr: copy.ar,
      statusTextEn: copy.en,
      selectionTextAr: "",
      selectionTextEn: "",
      unavailableTextAr: copy.ar,
      unavailableTextEn: copy.en,
    },
  };
}

function isVisibleByDefault(item) {
  const state = item && item.availability && item.availability.state || "available";
  return state === "available" || state === "payment_required";
}

function filterAvailabilityForVisibility(availability, { includeUnavailable = false, includeHistory = false } = {}) {
  const showAll = Boolean(includeUnavailable || includeHistory);
  if (showAll) return availability;
  const pickupItems = (availability.pickupItems || []).filter(isVisibleByDefault);
  const dayAddons = (availability.dayAddons || []).filter(isVisibleByDefault);
  const availableAddonChoices = (availability.availableAddonChoices || []).filter(isVisibleByDefault);
  const visibleSlotIds = new Set(pickupItems.filter((item) => item.slotId).map((item) => item.slotId));
  const slots = (availability.slots || []).filter((slot) => {
    const itemState = stateForReason(slot.unavailableReason);
    return visibleSlotIds.has(slot.slotId) || itemState === "available" || itemState === "payment_required";
  });
  return {
    ...availability,
    slots,
    dayAddons,
    availableAddonChoices,
    addonSummary: buildAddonSummary(dayAddons),
    pickupItems,
    sections: buildSections(pickupItems, availableAddonChoices),
    availableSlotIds: slots.filter((slot) => slot.available).map((slot) => slot.slotId),
    unavailableSlotIds: slots.filter((slot) => !slot.available).map((slot) => slot.slotId),
  };
}

function buildAvailabilityFromDay({ day, pickupRequests = [], subscription = {}, catalogMaps = {}, addonChoiceGroups = null }) {
  const hydratedDay = hydrateSubscriptionDayMealSources(day || {});
  const resolvedDay = enrichDayMealSlotsWithResolvedSnapshots(hydratedDay, catalogMaps);
  const commercialState = buildDayCommercialState(resolvedDay || {}, { subscription });
  const addonCategoryAllowances = Array.isArray(commercialState.addonCategoryAllowances)
    ? commercialState.addonCategoryAllowances.map(normalizeAddonCategoryAllowance)
    : [];
  const addonSubscriptionAllowances = Array.isArray(commercialState.addonSubscriptionAllowances)
    ? commercialState.addonSubscriptionAllowances.map(normalizeAddonSubscriptionAllowance)
    : [];
  const reservationMap = buildSlotReservationMap(pickupRequests);
  const itemReservationMap = buildPickupItemReservationMap(pickupRequests);
  const addonPaymentReason = dayHasUnpaidAddons(resolvedDay) ? resolveCanonicalPaymentReason(resolvedDay, subscription) || "ADDON_PAYMENT_REQUIRED" : null;
  const kitchenSlots = buildKitchenSlotMap({ day: resolvedDay, subscription, catalogMaps });
  const slots = (Array.isArray(resolvedDay && resolvedDay.mealSlots) ? resolvedDay.mealSlots : []).map((slot) => {
    const slotId = resolveSlotId(slot);
    const kitchenSlot = kitchenSlots.get(slotId) || null;
    const productDoc = resolveCatalogProduct(slot, catalogMaps);
    const reservation = reservationMap.get(slotId);
    const paymentReason = slotHasUnpaidPremium(slot) ? resolveCanonicalPaymentReason(day, subscription) || "PREMIUM_PAYMENT_REQUIRED" : null;
    const reasons = [];
    if (!slotId) reasons.push("INVALID_SLOT");
    if (String(slot.status || "complete") !== "complete") reasons.push("PLANNING_INCOMPLETE");
    if (paymentReason) reasons.push(paymentReason);
    if (reservation) reasons.push(resolveReservationReason(reservation));
    const available = reasons.length === 0;
    const unavailableReason = available ? null : reasons[0];
    const availabilityState = stateForReason(unavailableReason);
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
      availabilityState,
      ...buildClientSlotDetails({ slot, day: resolvedDay, available, unavailableReason, kitchenSlot, productDoc, catalogMaps }),
    };
  });
  const dayAddons = expandDayAddonPickupItems(Array.isArray(resolvedDay && resolvedDay.addonSelections) ? resolvedDay.addonSelections : [])
    .map((item) => applyReservationToPickupItem(item, itemReservationMap.get(item.itemId)));
  const availableAddonChoices = addonChoiceGroups
    ? buildAddonChoicePickupItems({ addonChoiceGroups, addonSubscriptionAllowances })
    : [];
  const pickupItems = [
    ...slots.map(buildPickupItemFromSlot),
    ...dayAddons,
  ].map((item) => applyReservationToPickupItem(item, itemReservationMap.get(item.itemId)));
  const sections = buildSections(pickupItems, availableAddonChoices);

  return {
    date: resolvedDay ? resolvedDay.date : null,
    subscriptionDayId: resolvedDay && resolvedDay._id ? String(resolvedDay._id) : null,
    paymentReason: addonPaymentReason || resolveCanonicalPaymentReason(resolvedDay, subscription),
    paymentRequirement: commercialState.paymentRequirement,
    commercialState: commercialState.commercialState,
    addonCategoryAllowances,
    addonSubscriptionAllowances,
    slots,
    dayAddons,
    availableAddonChoices,
    addonSummary: {
      ...buildAddonSummary(dayAddons),
      availableChoiceCount: availableAddonChoices.length,
      categoryAllowances: addonCategoryAllowances,
      subscriptionAllowances: addonSubscriptionAllowances,
    },
    pickupItems,
    sections,
    availableSlotIds: slots.filter((slot) => slot.available).map((slot) => slot.slotId),
    unavailableSlotIds: slots.filter((slot) => !slot.available).map((slot) => slot.slotId),
  };
}

async function findBlockingPickupRequests({ subscriptionId, date, session = null }) {
  const query = SubscriptionPickupRequest.find({
    subscriptionId,
    date,
    status: { $in: ACTIVE_OR_CONSUMING_PICKUP_STATUSES },
  });
  if (session) query.session(session);
  return query.lean();
}

async function assertSelectedPickupItemsAvailable({
  subscriptionId,
  day,
  selectedPickupItemIds,
  session = null,
  subscription = {},
  catalogMaps = {},
}) {
  const normalizedIds = normalizeSelectedPickupItemIds(selectedPickupItemIds);
  if (normalizedIds.length === 0) {
    throw createServiceError("SELECTED_PICKUP_ITEM_IDS_REQUIRED", "selectedPickupItemIds is required", 400);
  }
  if (!day) {
    throw createServiceError("DAY_NOT_FOUND", "Subscription day not found", 404);
  }
  const pickupRequests = await findBlockingPickupRequests({ subscriptionId, date: day.date, session });
  const availability = buildAvailabilityFromDay({ day, pickupRequests, subscription, catalogMaps });
  const byId = new Map(availability.pickupItems.map((item) => [item.itemId, item]));
  const invalid = [];
  const blocked = [];
  for (const id of normalizedIds) {
    const item = byId.get(id);
    if (!item) {
      invalid.push(id);
      continue;
    }
    if (!(item.availability && item.availability.available && item.availability.canSelect)) blocked.push(item);
  }
  if (invalid.length) {
    throw createServiceError("PICKUP_ITEM_NOT_FOUND", "Selected pickup item was not found", 422, { selectedPickupItemIds: invalid });
  }
  if (blocked.length) {
    const firstReason = blocked[0].availability && blocked[0].availability.unavailableReason || "PICKUP_ITEM_UNAVAILABLE";
    const code = firstReason === "PREMIUM_PAYMENT_REQUIRED" || firstReason === "ADDON_PAYMENT_REQUIRED" || firstReason === "PAYMENT_REQUIRED"
      ? firstReason
      : "PICKUP_ITEM_UNAVAILABLE";
    throw createServiceError(code, "Selected pickup item is unavailable for pickup", 422, { pickupItems: blocked });
  }
  return {
    selectedPickupItemIds: normalizedIds,
    selectedPickupItems: normalizedIds.map((id) => byId.get(id)),
    selectedMealSlotIds: normalizedIds.filter((id) => {
      const item = byId.get(id);
      return item && item.slotId && ["meal", "premium_meal", "large_salad", "sandwich"].includes(item.itemType);
    }),
    mealCreditCount: normalizedIds.filter((id) => {
      const item = byId.get(id);
      return item && ["meal", "premium_meal"].includes(item.itemType);
    }).length,
    availability,
  };
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
  assertSelectedPickupItemsAvailable,
  buildAvailabilityFromDay,
  buildPickupRequestPayloadHash,
  createServiceError,
  enrichDayMealSlotsWithResolvedSnapshots,
  enrichMealSlotWithResolvedSnapshots,
  findBlockingPickupRequests,
  filterAvailabilityForVisibility,
  normalizeSelectedMealSlotIds,
  normalizeSelectedPickupItemIds,
  resolveCanonicalPaymentReason,
  resolveSlotId,
  expandDayAddonPickupItems,
};
