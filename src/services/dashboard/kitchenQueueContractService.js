"use strict";

const CONTRACT_VERSION = "dashboard_kitchen_queue.v2";
const QUEUE_SCREENS = new Set(["kitchen", "pickup", "courier"]);

const MEAL_TYPE_LABELS = {
  standard_meal: { ar: "وجبة", en: "Standard meal" },
  premium_meal: { ar: "وجبة مميزة", en: "Premium meal" },
  premium_large_salad: { ar: "سلطة كبيرة مميزة", en: "Premium large salad" },
  sandwich: { ar: "ساندويتش", en: "Sandwich" },
};

const FULFILLMENT_LABELS = {
  home_delivery: { ar: "توصيل للمنزل", en: "Home delivery" },
  branch_pickup: { ar: "استلام من الفرع", en: "Branch pickup" },
};

const STATUS_LABELS = {
  open: { ar: "مفتوح", en: "Open" },
  locked: { ar: "مؤكد", en: "Locked" },
  confirmed: { ar: "مؤكد", en: "Confirmed" },
  in_preparation: { ar: "قيد التحضير", en: "In preparation" },
  preparing: { ar: "قيد التحضير", en: "Preparing" },
  ready_for_pickup: { ar: "جاهز للاستلام", en: "Ready for pickup" },
  out_for_delivery: { ar: "خارج للتوصيل", en: "Out for delivery" },
  fulfilled: { ar: "تم التسليم", en: "Fulfilled" },
  delivery_canceled: { ar: "توصيل ملغي", en: "Delivery canceled" },
  canceled_at_branch: { ar: "ملغي في الفرع", en: "Canceled at branch" },
  canceled: { ar: "ملغي", en: "Canceled" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
  no_show: { ar: "لم يحضر", en: "No show" },
};

const PAYMENT_LABELS = {
  not_required: { ar: "غير مطلوب", en: "Not required" },
  reserved: { ar: "محجوز", en: "Reserved" },
  paid: { ar: "مدفوع", en: "Paid" },
  pending: { ar: "بانتظار الدفع", en: "Pending payment" },
  initiated: { ar: "بانتظار الدفع", en: "Initiated" },
  failed: { ar: "فشل الدفع", en: "Failed" },
  expired: { ar: "منتهي", en: "Expired" },
  revision_mismatch: { ar: "تغيير يحتاج تحديث الدفع", en: "Payment revision mismatch" },
};

const REASON_LABELS = {
  PAYMENT_REQUIRED: { ar: "الدفع مطلوب", en: "Payment required" },
  ORDER_PAYMENT_REQUIRED: { ar: "دفع الطلب مطلوب", en: "Order payment required" },
  PAYMENT_SUPERSEDED: { ar: "الدفع قديم", en: "Payment superseded" },
  PAYMENT_REVISION_MISMATCH: { ar: "بيانات الدفع غير مطابقة", en: "Payment revision mismatch" },
  CREDITS_RELEASED: { ar: "تم تحرير الرصيد", en: "Credits released" },
};

const PROTEIN_FALLBACKS = {
  beef: { ar: "لحم", en: "Beef" },
  chicken: { ar: "دجاج", en: "Chicken" },
  fish: { ar: "سمك", en: "Fish" },
  shrimp: { ar: "روبيان", en: "Shrimp" },
  turkey: { ar: "ديك رومي", en: "Turkey" },
};

const WARNING_MESSAGES = {
  MISSING_PRODUCT: ["بيانات الوجبة غير موجودة", "Meal product data is missing"],
  MISSING_SANDWICH: ["بيانات الساندويتش غير موجودة", "Sandwich data is missing"],
  MISSING_PRODUCT_NAME: ["اسم الوجبة غير موجود", "Meal product name is missing"],
  MISSING_PROTEIN_NAME: ["اسم البروتين غير موجود", "Protein name is missing"],
  MISSING_CARB_NAME: ["اسم الكارب غير موجود", "Carb name is missing"],
  MISSING_PLAN: ["بيانات الباقة غير موجودة", "Plan data is missing"],
  MISSING_CUSTOMER: ["بيانات العميل غير موجودة", "Customer data is missing"],
  EMPTY_KITCHEN_MEALS: ["لا توجد وجبات للتحضير", "No kitchen meals to prepare"],
  CANCELED_EMPTY_ROW: ["هذا الطلب ملغي ولا يحتوي وجبات للتحضير", "Canceled row has no meals to prepare"],
};

function asId(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function nameObject(value, fallback = "") {
  if (value && typeof value === "object" && (isNonEmpty(value.ar) || isNonEmpty(value.en))) {
    return {
      ar: String(value.ar || value.en || fallback || ""),
      en: String(value.en || value.ar || fallback || ""),
    };
  }
  if (isNonEmpty(value)) return { ar: String(value), en: String(value) };
  if (isNonEmpty(fallback)) return { ar: String(fallback), en: String(fallback) };
  return { ar: "", en: "" };
}

function displayName(name, fallback = "") {
  const label = nameObject(name, fallback);
  return String(label.ar || label.en || fallback || "");
}

function withWarning(warnings, code, field) {
  const [messageAr, messageEn] = WARNING_MESSAGES[code] || [code, code];
  warnings.push({ code, field, messageAr, messageEn });
}

function sumQuantity(items) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => {
    return total + Math.max(1, asNumber(item && item.quantity, 1));
  }, 0);
}

function buildReference(item) {
  if (item.reference) return String(item.reference);
  if (item.orderNumber) return String(item.orderNumber);
  const id = item.entityId || item.id || item.orderId || item.requestId;
  const prefix = item.entityType === "order"
    ? "ORD"
    : (item.entityType === "subscription_pickup_request" ? "PICK" : "SUB");
  return id ? `${prefix}-${String(id).slice(-6).toUpperCase()}` : null;
}

function sourceTypeFor(item) {
  if (item.entityType === "order" || item.source === "one_time_order") return "one_time_order";
  if (item.entityType === "subscription_pickup_request" || item.source === "subscription_pickup_request") return "pickup_request";
  return "subscription_day";
}

function fulfillmentTypeFor(item) {
  if (item.fulfillmentType === "branch_pickup" || item.fulfillmentType === "pickup_request") return "branch_pickup";
  if (item.fulfillmentType === "home_delivery" || item.fulfillmentType === "delivery") return "home_delivery";
  return item.mode === "pickup" || item.deliveryMode === "pickup" || item.deliveryMethod === "pickup"
    ? "branch_pickup"
    : "home_delivery";
}

function lifecycleGroupFor(status) {
  return ["fulfilled", "delivery_canceled", "canceled_at_branch", "canceled", "cancelled", "no_show"].includes(String(status || ""))
    ? "archived"
    : "active";
}

function buildActions(item, payment) {
  const allowed = Array.isArray(item.allowedActions) ? item.allowedActions : [];
  const ids = new Set(allowed.map((action) => action && action.id).filter(Boolean));
  const canFulfill = Boolean(ids.has("fulfill") && (!payment || payment.canFulfill !== false));

  return {
    allowed: allowed.map((action) => ({
      ...action,
      label: typeof (action && action.label) === "object"
        ? action.label
        : nameObject(action && action.label, action && action.id ? String(action.id) : ""),
    })),
    disabled: [],
    canPrepare: Boolean(ids.has("prepare") && (!payment || payment.canPrepare !== false)),
    canDispatch: ids.has("dispatch"),
    canReadyForPickup: ids.has("ready_for_pickup") || ids.has("set_ready"),
    canFulfill,
    canCancel: ids.has("cancel"),
    canNoShow: ids.has("no_show"),
    canReopen: ids.has("reopen"),
  };
}

function buildIds(item) {
  return {
    entityType: item.entityType || null,
    entityId: asId(item.entityId || item.id),
    subscriptionId: asId(item.subscriptionId || (item.meta && item.meta.subscriptionId)),
    subscriptionDayId: asId(item.subscriptionDayId || (item.meta && item.meta.dayId)),
    orderId: asId(item.orderId || (item.entityType === "order" ? item.entityId || item.id : null)),
    deliveryId: asId(item.delivery && item.delivery.deliveryId),
    pickupRequestId: asId(item.requestId || (item.entityType === "subscription_pickup_request" ? item.entityId || item.id : null) || (item.pickup && item.pickup.pickupRequestId)),
  };
}

function entityPayload({ id, key, name, fallback }) {
  const label = nameObject(name, fallback || key || id || "");
  return {
    id: asId(id),
    key: key || null,
    name: label,
    displayName: displayName(label, key || id || ""),
  };
}

function normalizeOption(option = {}) {
  return {
    ...option,
    name: nameObject(option.name || option.nameI18n || option.optionName || option.label, option.optionKey || option.key || ""),
    displayName: displayName(option.name || option.nameI18n || option.optionName || option.label, option.optionKey || option.key || ""),
  };
}

function normalizeCarb(carb = {}, index, warnings, slotIndex) {
  const fallback = carb.key || carb.carbId || carb.id || "";
  const payload = {
    id: asId(carb.carbId || carb.id),
    key: carb.key ? String(carb.key) : null,
    name: nameObject(carb.nameI18n || carb.name || carb.carbName, fallback),
    displayName: displayName(carb.nameI18n || carb.name || carb.carbName, fallback),
    grams: carb.grams !== undefined && carb.grams !== null ? asNumber(carb.grams, null) : null,
  };
  if (!isNonEmpty(carb.name) && !isNonEmpty(carb.nameI18n && (carb.nameI18n.ar || carb.nameI18n.en))) {
    withWarning(warnings, "MISSING_CARB_NAME", `kitchen.meals[${slotIndex}].carbs[${index}].name`);
  }
  return payload;
}

function normalizeMeal(slot = {}, slotIndex, fulfillmentType, warnings) {
  const mealType = slot.selectionType || slot.mealType || "standard_meal";
  const mealTypeLabel = MEAL_TYPE_LABELS[mealType] || nameObject(mealType, mealType);
  const productFallback = slot.productKey || slot.productId || slot.sandwichKey || slot.sandwichId || mealType;
  const product = entityPayload({
    id: slot.productId || (mealType === "sandwich" ? slot.sandwichId : null),
    key: slot.productKey || slot.sandwichKey,
    name: slot.productNameI18n || slot.productName,
    fallback: productFallback,
  });
  const sandwich = mealType === "sandwich"
    ? entityPayload({
      id: slot.sandwichId || slot.productId,
      key: slot.sandwichKey || slot.productKey,
      name: slot.sandwichNameI18n || slot.sandwichName || slot.productNameI18n || slot.productName,
      fallback: productFallback,
    })
    : null;
  const proteinFallback = slot.proteinKey || slot.proteinFamilyKey || slot.proteinId || "";
  const proteinName = slot.proteinNameI18n || slot.proteinName || PROTEIN_FALLBACKS[String(proteinFallback || "").toLowerCase()];
  const protein = {
    ...entityPayload({
      id: slot.proteinId,
      key: slot.proteinKey || slot.proteinFamilyKey,
      name: proteinName,
      fallback: proteinFallback,
    }),
    grams: slot.proteinGrams === undefined || slot.proteinGrams === null ? null : asNumber(slot.proteinGrams, null),
  };
  const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb, index) => normalizeCarb(carb, index, warnings, slotIndex));
  const sauce = (Array.isArray(slot.sauce) ? slot.sauce : []).map(normalizeOption);
  const sides = (Array.isArray(slot.sides) ? slot.sides : []).map(normalizeOption);
  const options = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : []).map(normalizeOption);
  const badgesAr = [mealTypeLabel.ar, protein.grams ? `${protein.grams}g` : null, slot.isPremium ? "مميز" : null]
    .filter(Boolean);
  const primaryName = mealType === "sandwich" && sandwich ? sandwich.displayName : product.displayName;

  if (!product.id && !product.key) withWarning(warnings, "MISSING_PRODUCT", `kitchen.meals[${slotIndex}].product`);
  if (!slot.productName && !(slot.productNameI18n && (slot.productNameI18n.ar || slot.productNameI18n.en))) {
    withWarning(warnings, "MISSING_PRODUCT_NAME", `kitchen.meals[${slotIndex}].product.name`);
  }
  if (mealType === "sandwich" && (!sandwich || (!sandwich.id && !sandwich.key))) {
    withWarning(warnings, "MISSING_SANDWICH", `kitchen.meals[${slotIndex}].sandwich`);
  }
  if ((slot.proteinId || slot.proteinKey || slot.proteinFamilyKey) && !slot.proteinName && !slot.proteinNameI18n && !PROTEIN_FALLBACKS[String(proteinFallback || "").toLowerCase()]) {
    withWarning(warnings, "MISSING_PROTEIN_NAME", `kitchen.meals[${slotIndex}].protein.name`);
  }

  return {
    slotIndex: slot.slotIndex === undefined || slot.slotIndex === null ? null : asNumber(slot.slotIndex, null),
    slotKey: slot.slotKey || null,
    mealType,
    mealTypeLabel,
    product,
    sandwich,
    protein,
    carbs,
    salad: slot.salad || null,
    sauce,
    sides,
    options,
    premium: {
      isPremium: Boolean(slot.isPremium),
      key: slot.premiumKey || null,
      source: slot.premiumSource || "none",
      labelAr: slot.isPremium ? "مميز" : null,
    },
    quantity: Math.max(1, asNumber(slot.quantity, 1)),
    notes: slot.notes || null,
    display: {
      titleAr: protein.grams ? `${primaryName} - ${protein.grams}g` : primaryName,
      subtitleAr: `${FULFILLMENT_LABELS[fulfillmentType].ar} - ${Math.max(1, asNumber(slot.quantity, 1))} وجبة`,
      preparationTextAr: protein.grams
        ? `حضّر ${primaryName} مع بروتين ${protein.grams}g`
        : `حضّر ${primaryName}`,
      badgesAr,
    },
  };
}

function normalizeAddon(addon = {}) {
  const payload = entityPayload({
    id: addon.id || addon.addonId,
    key: addon.key || addon.addonKey,
    name: addon.nameI18n || addon.name || addon.addonName,
    fallback: addon.key || addon.addonKey || addon.id || addon.addonId || "addon",
  });
  return {
    ...payload,
    quantity: Math.max(1, asNumber(addon.quantity || addon.qty, 1)),
    display: { titleAr: `${payload.displayName} x${Math.max(1, asNumber(addon.quantity || addon.qty, 1))}` },
  };
}

function countTextAr(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizeKitchenQueueItem(item, { includeRaw = false, includeLegacyAliases = false } = {}) {
  const ids = buildIds(item);
  const warnings = [];
  const kitchenDetails = item.kitchenDetails || {};
  const payment = item.paymentValidity || {};
  const fulfillmentType = fulfillmentTypeFor(item);
  const meals = (Array.isArray(kitchenDetails.mealSlots) ? kitchenDetails.mealSlots : [])
    .map((slot, index) => normalizeMeal(slot, index, fulfillmentType, warnings));
  const addons = (Array.isArray(kitchenDetails.addons) ? kitchenDetails.addons : []).map(normalizeAddon);
  const actions = buildActions(item, payment);
  const mealCount = sumQuantity(meals);
  const addonCount = sumQuantity(addons);
  const sourceType = sourceTypeFor(item);
  const delivery = item.delivery || {};
  const pickup = item.pickup || {};
  const timestamps = item.timestamps || {};
  const status = item.status || null;
  const lifecycleGroup = lifecycleGroupFor(status);
  const sourceIsActionable = lifecycleGroup !== "archived" || actions.canReopen || actions.canPrepare || actions.canFulfill;

  if (!((item.customer && item.customer.id) || (item.user && item.user.id))) withWarning(warnings, "MISSING_CUSTOMER", "customer.id");
  if (!item.plan) withWarning(warnings, "MISSING_PLAN", "subscription.plan");
  if (mealCount === 0) withWarning(warnings, "EMPTY_KITCHEN_MEALS", "kitchen.meals");
  if (lifecycleGroup === "archived" && mealCount === 0) withWarning(warnings, "CANCELED_EMPTY_ROW", "source.status");

  const planName = item.plan ? nameObject(item.plan.nameI18n || item.plan.name, item.plan.key || item.plan.id || "") : nameObject("", "");
  const titleAr = meals[0] ? meals[0].display.titleAr : (lifecycleGroup === "archived" ? "طلب ملغي" : "طلب بدون وجبات");
  const fulfillmentLabel = FULFILLMENT_LABELS[fulfillmentType] || nameObject(fulfillmentType, fulfillmentType);
  const paymentStatus = payment.paymentStatus || null;
  const paymentReason = payment.reason || null;

  const clean = {
    ids,
    customer: {
      id: asId((item.customer && item.customer.id) || (item.user && item.user.id) || item.userId),
      name: (item.customer && item.customer.name) || (item.user && item.user.name) || "",
      phone: (item.customer && item.customer.phone) || (item.user && item.user.phone) || "",
    },
    source: {
      type: sourceType,
      reference: buildReference(item),
      date: item.date || (item.context && item.context.date) || delivery.date || null,
      status,
      statusLabel: STATUS_LABELS[status] || nameObject(status, status || ""),
      lifecycleGroup,
      isActionable: Boolean(sourceIsActionable),
    },
    subscription: {
      id: ids.subscriptionId,
      plan: item.plan ? {
        id: asId(item.plan.id),
        key: item.plan.key || null,
        name: planName,
        displayName: displayName(planName, item.plan.key || item.plan.id || ""),
        proteinGrams: item.plan.proteinGrams === undefined || item.plan.proteinGrams === null ? null : asNumber(item.plan.proteinGrams, null),
        portionSize: item.plan.portionSize || null,
        selectedMealsPerDay: item.plan.selectedMealsPerDay === undefined || item.plan.selectedMealsPerDay === null ? null : asNumber(item.plan.selectedMealsPerDay, null),
        totalMeals: asNumber(item.plan.totalMeals, 0),
        remainingMeals: asNumber(item.plan.remainingMeals, 0),
        deliveryMode: item.plan.deliveryMode || null,
      } : null,
    },
    orderSummary: {
      mealCount,
      addonCount,
      itemCount: mealCount + addonCount,
      mealCountTextAr: countTextAr(mealCount, "وجبة", "وجبات"),
      addonCountTextAr: countTextAr(addonCount, "إضافة", "إضافات"),
      itemCountTextAr: countTextAr(mealCount + addonCount, "عنصر", "عناصر"),
      hasPremium: meals.some((meal) => meal.premium && meal.premium.isPremium),
      hasAddons: addonCount > 0,
      notes: item.notes || (item.context && item.context.notes) || null,
      allergies: item.allergies || (item.context && item.context.allergies) || null,
      display: {
        titleAr,
        subtitleAr: `${fulfillmentLabel.ar} - ${countTextAr(mealCount, "وجبة", "وجبات")}`,
        mealCountTextAr: countTextAr(mealCount, "وجبة", "وجبات"),
        itemCountTextAr: countTextAr(mealCount + addonCount, "عنصر", "عناصر"),
        fulfillmentTextAr: fulfillmentLabel.ar,
      },
    },
    kitchen: { meals, addons },
    fulfillment: {
      type: fulfillmentType,
      typeLabel: fulfillmentLabel,
      delivery: {
        deliveryId: asId(delivery.deliveryId),
        date: delivery.date || item.date || null,
        status: delivery.status || null,
        address: delivery.address || null,
        window: delivery.window || delivery.deliveryWindow || (item.context && item.context.window) || null,
        zoneId: asId(delivery.zoneId),
        courierId: asId(delivery.courierId),
      },
      pickup: {
        pickupRequestId: asId(pickup.pickupRequestId || ids.pickupRequestId),
        branchId: asId(pickup.branchId || pickup.pickupLocationId),
        locationId: asId(pickup.locationId || pickup.pickupLocationId),
        mealCount: asNumber(pickup.mealCount || item.mealCount || (item.context && item.context.mealCount), 0),
        reserved: Boolean(pickup.reserved),
        consumed: Boolean(pickup.consumed),
        released: Boolean(pickup.released),
        pickupCodeState: pickup.pickupCodeState || null,
        remainingMeals: pickup.remainingMeals === undefined ? null : asNumber(pickup.remainingMeals, null),
      },
    },
    payment: {
      paymentRequired: Boolean(payment.paymentRequired),
      paymentStatus,
      paymentStatusLabel: PAYMENT_LABELS[paymentStatus] || nameObject(paymentStatus, paymentStatus || ""),
      paymentApplied: Boolean(payment.paymentApplied),
      pendingUnpaid: Boolean(payment.pendingUnpaid),
      superseded: Boolean(payment.superseded),
      revisionMismatch: Boolean(payment.revisionMismatch),
      canPrepare: Boolean(payment.canPrepare),
      canFulfill: Boolean(payment.canFulfill),
      reason: paymentReason,
      reasonLabel: REASON_LABELS[paymentReason] || nameObject(paymentReason, paymentReason || ""),
    },
    actions,
    timestamps: {
      createdAt: timestamps.createdAt || item.createdAt || null,
      updatedAt: timestamps.updatedAt || item.updatedAt || null,
      preparedAt: item.preparedAt || item.pickupPreparedAt || null,
      fulfilledAt: timestamps.fulfilledAt || item.fulfilledAt || null,
    },
    dataQuality: {
      isComplete: warnings.length === 0,
      warnings,
    },
  };

  if (includeLegacyAliases || includeRaw) {
    Object.assign(clean, {
      id: ids.entityId,
      entityId: ids.entityId,
      entityType: ids.entityType,
      subscriptionId: ids.subscriptionId,
      subscriptionDayId: ids.subscriptionDayId,
      orderId: ids.orderId,
      requestId: ids.pickupRequestId,
      date: item.date || (item.context && item.context.date) || null,
      status: item.status || null,
      allowedActions: actions.allowed,
      deprecation: {
        legacyAliases: "Root aliases are deprecated; use ids/source/actions instead.",
      },
    });
  }
  if (includeRaw) clean.raw = item;
  return clean;
}

function shouldIncludeCanceledItem(item) {
  const mealCount = item && item.orderSummary ? item.orderSummary.mealCount : 0;
  return !(item && item.source && item.source.lifecycleGroup === "archived" && mealCount === 0);
}

function normalizeKitchenQueueResponse(data = {}, options = {}) {
  const includeRaw = Boolean(options.includeRaw);
  const includeLegacyAliases = Boolean(options.includeLegacyAliases);
  const includeCanceled = Boolean(options.includeCanceled);
  const items = (Array.isArray(data.items) ? data.items : [])
    .map((item) => normalizeKitchenQueueItem(item, { includeRaw, includeLegacyAliases }))
    .filter((item) => includeCanceled || shouldIncludeCanceledItem(item));
  return {
    contractVersion: CONTRACT_VERSION,
    date: data.date || null,
    businessDate: data.businessDate || options.businessDate || data.date || null,
    count: items.length,
    items,
    filters: data.filters || {},
  };
}

function shouldUseCleanQueueContract(screen, query = {}) {
  return QUEUE_SCREENS.has(String(screen || ""))
    && String(query.view || "").trim().toLowerCase() !== "legacy";
}

function isTruthyQuery(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

module.exports = {
  CONTRACT_VERSION,
  isTruthyQuery,
  normalizeDashboardQueueItem: normalizeKitchenQueueItem,
  normalizeDashboardQueueResponse: normalizeKitchenQueueResponse,
  normalizeKitchenQueueItem,
  normalizeKitchenQueueResponse,
  shouldUseCleanQueueContract,
};
