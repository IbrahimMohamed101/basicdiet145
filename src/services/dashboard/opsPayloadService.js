"use strict";

const { pickLang } = require("../../utils/i18n");
const { buildDayCommercialState } = require("../subscription/subscriptionDayCommercialStateService");

function stringifyId(value) {
  return value ? String(value) : null;
}

function localizedName(value, lang = "en") {
  if (!value) return "";
  if (typeof value === "string") return value;
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function resolvePlanDocument(subscription = {}) {
  return subscription && subscription.planId && typeof subscription.planId === "object"
    ? subscription.planId
    : null;
}

function buildPlanPayload(subscription = {}, lang = "en") {
  const plan = resolvePlanDocument(subscription);
  const proteinGrams = Number(subscription && subscription.selectedGrams || 0) || null;
  return {
    id: stringifyId((plan && plan._id) || (subscription && subscription.planId)),
    key: plan && plan.key ? String(plan.key) : null,
    name: localizedName(plan && plan.name, lang),
    daysCount: plan && plan.daysCount !== undefined ? Number(plan.daysCount || 0) : null,
    durationDays: plan && plan.durationDays !== undefined ? Number(plan.durationDays || 0) : null,
    totalMeals: Number(subscription && subscription.totalMeals || 0),
    remainingMeals: Number(subscription && subscription.remainingMeals || 0),
    selectedMealsPerDay: subscription && subscription.selectedMealsPerDay !== undefined
      ? Number(subscription.selectedMealsPerDay || 0)
      : null,
    deliveryMode: subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
    proteinGrams,
    portionSize: proteinGrams ? `${proteinGrams}g` : null,
  };
}

function snapshotName(snapshot, path, lang = "en") {
  let current = snapshot;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = current[key];
  }
  return localizedName(current, lang);
}

function normalizeSelectedOption(option = {}, lang = "en") {
  return {
    groupId: stringifyId(option.groupId),
    groupKey: option.groupKey || null,
    canonicalGroupKey: option.canonicalGroupKey || null,
    groupName: localizedName(option.groupName || option.groupLabel || option.group, lang),
    optionId: stringifyId(option.optionId),
    optionKey: option.optionKey || null,
    name: localizedName(option.name || option.optionName || option.label, lang),
    quantity: Number(option.quantity || option.qty || 1),
    grams: option.grams === undefined || option.grams === null ? null : Number(option.grams || 0),
    unitPriceHalala: Number(option.unitPriceHalala || option.extraPriceHalala || 0),
    totalPriceHalala: Number(option.totalPriceHalala || option.totalHalala || 0),
    extraWeightUnitGrams: Number(option.extraWeightUnitGrams || 0),
    extraWeightPriceHalala: Number(option.extraWeightPriceHalala || 0),
  };
}

function classifyOptions(options, matcher) {
  return options.filter((option) => {
    const key = String(option.canonicalGroupKey || option.groupKey || "").toLowerCase();
    return matcher(key);
  });
}

function buildMealSlotPayload(slot = {}, subscription = {}, lang = "en") {
  const confirmation = slot.confirmationSnapshot || {};
  const display = slot.displaySnapshot || {};
  const fulfillment = slot.fulfillmentSnapshot || {};
  const selectedOptions = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
    .map((option) => normalizeSelectedOption(option, lang));
  const carbSelections = Array.isArray(slot.carbSelections)
    ? slot.carbSelections
    : (Array.isArray(slot.carbs)
      ? slot.carbs
      : (slot.carbId ? [{ carbId: slot.carbId, grams: null }] : []));
  const product = confirmation.product || display.product || fulfillment.product || {};

  return {
    slotIndex: slot.slotIndex !== undefined ? Number(slot.slotIndex || 0) : null,
    slotKey: slot.slotKey || null,
    selectionType: slot.selectionType || null,
    productId: stringifyId(slot.productId || product.id || product._id),
    productKey: slot.productKey || product.key || null,
    productName: localizedName(product.name || product.title, lang),
    proteinId: stringifyId(slot.proteinId || fulfillment.proteinId),
    proteinKey: fulfillment.proteinKey || confirmation.proteinKey || null,
    proteinName: snapshotName(confirmation, ["protein", "name"], lang)
      || snapshotName(display, ["protein", "name"], lang)
      || localizedName(fulfillment.proteinName, lang),
    proteinGrams: Number(subscription && subscription.selectedGrams || 0) || null,
    proteinFamilyKey: slot.proteinFamilyKey || null,
    carbSelections: carbSelections.map((carb) => ({
      carbId: stringifyId(carb && carb.carbId),
      key: carb && carb.key ? String(carb.key) : null,
      name: localizedName((carb && (carb.name || carb.carbName)) || null, lang),
      grams: carb && carb.grams !== undefined && carb.grams !== null ? Number(carb.grams || 0) : null,
    })),
    salad: slot.salad || slot.customSalad || null,
    sauce: classifyOptions(selectedOptions, (key) => key.includes("sauce")),
    selectedOptions,
    sides: classifyOptions(selectedOptions, (key) => key.includes("side")),
    sandwichId: stringifyId(slot.sandwichId),
    isPremium: Boolean(slot.isPremium),
    premiumKey: slot.premiumKey || null,
    premiumSource: slot.premiumSource || "none",
    quantity: 1,
    notes: slot.notes || (confirmation.notes || display.notes || fulfillment.notes) || null,
  };
}

function buildAddonPayload(addon = {}, lang = "en") {
  const id = addon.addonId || addon.id || addon._id || null;
  return {
    id: stringifyId(id),
    key: addon.key || addon.addonKey || null,
    name: localizedName(addon.name || addon.addonName, lang),
    quantity: Number(addon.qty || addon.quantity || 1),
    priceHalala: Number(addon.priceHalala || addon.unitPriceHalala || addon.totalPriceHalala || 0),
  };
}

function buildOrderKitchenDetailsPayload(order = {}, lang = "en") {
  const items = Array.isArray(order.items) ? order.items : [];
  const mealSlots = [];
  const addons = [];

  items.forEach((item, index) => {
    const itemType = String(item && (item.itemType || item.type) || "standard_meal");
    if (itemType === "addon_item" || itemType === "drink" || itemType === "dessert") {
      addons.push({
        id: stringifyId((item.catalogRef && item.catalogRef.id) || item.productId || item.mealId || `order_addon_${index + 1}`),
        key: item.productKey || null,
        name: localizedName(item.name || (item.productSnapshot && item.productSnapshot.name), lang),
        quantity: Number(item.qty || item.quantity || 1),
        priceHalala: Number(item.lineTotalHalala || item.unitPriceHalala || item.unitPrice || 0),
      });
      return;
    }

    const selections = item.selections || {};
    const selectedOptions = (Array.isArray(item.selectedOptions) ? item.selectedOptions : [])
      .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : [])
      .map((option) => normalizeSelectedOption(option, lang));

    mealSlots.push({
      slotIndex: index + 1,
      slotKey: `order_item_${index + 1}`,
      selectionType: itemType,
      productId: stringifyId(item.productId || item.mealId || (item.catalogRef && item.catalogRef.id)),
      productKey: item.productKey || (item.productSnapshot && item.productSnapshot.key) || null,
      productName: localizedName(item.name || (item.productSnapshot && item.productSnapshot.name), lang),
      proteinId: stringifyId(selections.proteinId),
      proteinKey: null,
      proteinName: localizedName(selections.proteinName, lang),
      proteinGrams: null,
      proteinFamilyKey: null,
      carbSelections: (Array.isArray(selections.carbs) ? selections.carbs : []).map((carb) => ({
        carbId: stringifyId(carb.carbId),
        key: carb.key || null,
        name: localizedName(carb.name, lang),
        grams: carb.grams === undefined || carb.grams === null ? null : Number(carb.grams || 0),
      })),
      salad: selections.salad || null,
      sauce: classifyOptions(selectedOptions, (key) => key.includes("sauce")),
      selectedOptions,
      sides: classifyOptions(selectedOptions, (key) => key.includes("side")),
      sandwichId: stringifyId(selections.sandwichId),
      isPremium: Boolean(item.isPremium || item.premiumKey),
      premiumKey: item.premiumKey || null,
      premiumSource: item.premiumSource || "none",
      quantity: Number(item.qty || item.quantity || 1),
      notes: item.notes || null,
    });
  });

  return { mealSlots, addons };
}

function buildKitchenDetailsPayload(day = {}, subscription = {}, lang = "en") {
  const mealSlots = Array.isArray(day.mealSlots)
    ? day.mealSlots.map((slot) => buildMealSlotPayload(slot, subscription, lang))
    : [];
  const addonSources = []
    .concat(Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .concat(Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [])
    .concat(Array.isArray(day.recurringAddons) ? day.recurringAddons : []);

  return {
    mealSlots,
    addons: addonSources.map((addon) => buildAddonPayload(addon, lang)),
  };
}

function buildPaymentValidityPayload(day = {}) {
  const commercialState = buildDayCommercialState(day || {});
  const requirement = commercialState.paymentRequirement || {};
  const premiumPayment = commercialState.premiumExtraPayment || {};
  const rawPayment = day && day.premiumExtraPayment && typeof day.premiumExtraPayment === "object" ? day.premiumExtraPayment : {};
  const rawMetadata = rawPayment.metadata && typeof rawPayment.metadata === "object" ? rawPayment.metadata : {};
  const hasPendingSlotPayment = (Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .some((slot) => slot && slot.premiumSource === "pending_payment");
  const hasPendingAddonPayment = (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .some((addon) => addon && addon.source === "pending_payment");
  const paymentStatus = premiumPayment.status || (requirement.requiresPayment ? "pending" : "not_required");
  const revisionMismatch = paymentStatus === "revision_mismatch" || requirement.blockingReason === "PAYMENT_REVISION_MISMATCH";
  const pendingUnpaid = Boolean(
    (requirement.requiresPayment && !["paid", "satisfied", "not_required"].includes(paymentStatus))
      || hasPendingSlotPayment
      || hasPendingAddonPayment
  );
  const superseded = Boolean(
    premiumPayment.superseded
      || premiumPayment.isSuperseded
      || premiumPayment.supersededAt
      || (premiumPayment.metadata && (premiumPayment.metadata.isSuperseded || premiumPayment.metadata.supersededAt))
      || rawPayment.superseded
      || rawPayment.isSuperseded
      || rawPayment.supersededAt
      || rawMetadata.isSuperseded
      || rawMetadata.supersededAt
  );
  const paymentApplied = paymentStatus === "paid" && !revisionMismatch && !superseded;
  const paymentOk = !pendingUnpaid && !revisionMismatch && !superseded;
  const status = String(day && day.status || "open");

  return {
    paymentRequired: Boolean(requirement.requiresPayment || hasPendingSlotPayment || hasPendingAddonPayment),
    paymentStatus,
    paymentApplied,
    pendingUnpaid,
    superseded,
    revisionMismatch,
    canPrepare: Boolean(paymentOk && ["open", "locked"].includes(status)),
    canFulfill: Boolean(paymentOk && ["out_for_delivery", "ready_for_pickup"].includes(status)),
    reason: revisionMismatch
      ? "PAYMENT_REVISION_MISMATCH"
      : (superseded
        ? "PAYMENT_SUPERSEDED"
        : (pendingUnpaid ? requirement.blockingReason || "PAYMENT_REQUIRED" : null)),
  };
}

function buildDeliveryPayload(delivery = null, fallback = {}) {
  const source = delivery || {};
  return {
    deliveryId: stringifyId(source._id),
    date: source.date || fallback.date || null,
    status: source.status || fallback.status || null,
    address: source.address || fallback.address || null,
    window: source.window || fallback.window || null,
    zoneId: stringifyId(source.zoneId || fallback.zoneId),
    courierId: stringifyId(source.courierId || fallback.courierId),
  };
}

function buildPickupPayload({ pickupRequest = null, subscription = {}, day = {} } = {}) {
  const request = pickupRequest || {};
  return {
    pickupRequestId: stringifyId(request._id),
    branchId: subscription.pickupLocationId || null,
    locationId: subscription.pickupLocationId || null,
    mealCount: Number(request.mealCount || 0),
    reserved: Boolean(request.creditsReserved),
    consumed: Boolean(request.creditsConsumedAt),
    released: Boolean(request.creditsReleasedAt),
    pickupCodeState: request.pickupCode
      ? (request.creditsConsumedAt ? "consumed" : "issued")
      : (day.pickupCode ? "issued" : "not_issued"),
    remainingMeals: Number(subscription.remainingMeals || 0),
  };
}

module.exports = {
  buildDeliveryPayload,
  buildKitchenDetailsPayload,
  buildOrderKitchenDetailsPayload,
  buildPaymentValidityPayload,
  buildPickupPayload,
  buildPlanPayload,
  localizedName,
  stringifyId,
};
