"use strict";

const CONTRACT_VERSION = "dashboard_kitchen_queue.v2";
const QUEUE_SCREENS = new Set(["kitchen", "pickup", "courier"]);

const MEAL_TYPE_LABELS = {
  standard_meal: { ar: "وجبة", en: "Standard meal" },
  basic_meal: { ar: "وجبة بيسك", en: "Basic Meal" },
  premium_meal: { ar: "وجبة مميزة", en: "Premium meal" },
  premium_large_salad: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
  basic_salad: { ar: "سلطة", en: "Salad" },
  sandwich: { ar: "ساندويتش", en: "Sandwich" },
};

// Meal types whose product identity is fully determined by the semantic mealType label.
// No catalog product id/key or explicit productName is required for these types —
// the label itself constitutes a complete, display-valid product description.
// NOTE: "sandwich" is intentionally excluded — a sandwich slot still requires an actual
// sandwich product selection (sandwichId/sandwichKey/sandwichNameI18n) and must still
// emit MISSING_PRODUCT/MISSING_PRODUCT_NAME warnings when no sandwich data is provided.
const SEMANTIC_PRODUCT_COMPLETE_TYPES = new Set([
  "standard_meal",
  "premium_meal",
  "premium_large_salad",
]);

const SEMANTIC_LABELS = {
  ...MEAL_TYPE_LABELS,
  addon: { ar: "إضافة", en: "Add-on" },
  sauce: { ar: "صوص", en: "Sauce" },
  side: { ar: "جانب", en: "Side" },
  carb: { ar: "كارب", en: "Carb" },
  protein: { ar: "بروتين", en: "Protein" },
};

const UNKNOWN_ITEM_LABEL = { ar: "عنصر غير معروف", en: "Unknown item" };

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
  PICKUP_REQUEST_REQUIRED: { ar: "طلب الاستلام مطلوب", en: "Pickup request required" },
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
  UNRESOLVED_OPTION_NAME: ["تعذر تحديد اسم العنصر من الكتالوج", "Could not resolve option name from catalog"],
  UNRESOLVED_ADDON_NAME: ["تعذر تحديد اسم الإضافة من الكتالوج", "Could not resolve add-on name from catalog"],
  MISSING_ARABIC_ADDON_NAME: ["اسم الإضافة العربي غير موجود", "Arabic add-on name is missing"],
  UNRESOLVED_SALAD_GROUP_ITEM: ["تعذر تحديد اسم مكون السلطة من الكتالوج", "Could not resolve salad group item name from catalog"],
  FALLBACK_DISPLAY_NAME_USED: ["تم استخدام اسم بديل للعرض", "Fallback display name was used"],
};

function asId(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isScalar(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function scalarString(value) {
  return isScalar(value) && String(value).trim() !== "" ? String(value) : "";
}

function isNonEmpty(value) {
  return scalarString(value) !== "";
}

function isObjectIdLike(value) {
  return /^[a-f\d]{24}$/i.test(String(value || ""));
}

function humanizeKey(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractNameValue(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) return null;
  if (isScalar(value)) return scalarString(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const extracted = extractNameValue(entry, depth + 1);
      if (extracted) return extracted;
    }
    return null;
  }
  if (typeof value === "object") {
    const arValue = extractNameValue(value.ar, depth + 1);
    const enValue = extractNameValue(value.en, depth + 1);
    if (arValue || enValue) {
      return {
        ar: (arValue && typeof arValue === "object" ? arValue.ar || arValue.en : arValue)
          || (enValue && typeof enValue === "object" ? enValue.ar || enValue.en : enValue)
          || "",
        en: (enValue && typeof enValue === "object" ? enValue.en || enValue.ar : enValue)
          || (arValue && typeof arValue === "object" ? arValue.en || arValue.ar : arValue)
          || "",
      };
    }
    for (const key of ["displayName", "name", "title", "label", "value", "text"]) {
      const extracted = extractNameValue(value[key], depth + 1);
      if (extracted) return extracted;
    }
  }
  return null;
}

function nameObject(value, fallback = "") {
  const extracted = extractNameValue(value);
  const fallbackExtracted = extractNameValue(fallback);
  if (extracted && typeof extracted === "object") {
    return {
      ar: extracted.ar || extracted.en || scalarString(fallbackExtracted) || "",
      en: extracted.en || extracted.ar || scalarString(fallbackExtracted) || "",
    };
  }
  if (isNonEmpty(extracted)) return { ar: String(extracted), en: String(extracted) };
  if (fallbackExtracted && typeof fallbackExtracted === "object") {
    return {
      ar: fallbackExtracted.ar || fallbackExtracted.en || "",
      en: fallbackExtracted.en || fallbackExtracted.ar || "",
    };
  }
  if (isNonEmpty(fallbackExtracted)) return { ar: String(fallbackExtracted), en: String(fallbackExtracted) };
  return { ar: "", en: "" };
}

function displayName(name, fallback = "") {
  const label = nameObject(name, fallback);
  return String(label.ar || label.en || fallback || "");
}

function semanticLabelFor(key) {
  const normalized = String(key || "").trim().toLowerCase();
  return SEMANTIC_LABELS[normalized] || null;
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
      label: nameObject(action && action.label, action && action.id ? String(action.id) : ""),
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
  const semanticFallback = semanticLabelFor(key) || semanticLabelFor(fallback);
  const fallbackText = fallback || key || id || "";
  const fallbackValue = semanticFallback
    || (fallbackText && typeof fallbackText === "object" ? fallbackText : null)
    || (isObjectIdLike(fallbackText) ? UNKNOWN_ITEM_LABEL : humanizeKey(fallbackText));
  const label = nameObject(name, fallbackValue);
  return {
    id: asId(id),
    key: key || null,
    name: label,
    displayName: displayName(label, fallbackValue),
  };
}

function normalizeOption(option = {}) {
  const key = option.optionKey || option.key || null;
  const id = option.optionId || option.id || null;
  const fallback = key || id || "option";
  const name = option.name || option.nameI18n || option.optionName || option.label;
  const unresolved = !extractNameValue(name) && isObjectIdLike(fallback);
  const label = unresolved ? UNKNOWN_ITEM_LABEL : nameObject(name, semanticLabelFor(key) || humanizeKey(fallback));
  return {
    ...option,
    id: asId(id),
    key,
    name: label,
    displayName: displayName(label, fallback),
  };
}

function normalizeCarb(carb = {}, index, warnings, slotIndex) {
  const fallback = carb.key || carb.carbId || carb.id || "";
  const name = carb.nameI18n || carb.name || carb.carbName;
  const unresolved = !extractNameValue(name) && isObjectIdLike(fallback);
  const label = unresolved ? UNKNOWN_ITEM_LABEL : nameObject(name, semanticLabelFor(carb.key) || humanizeKey(fallback));
  const payload = {
    id: asId(carb.carbId || carb.id),
    key: carb.key ? String(carb.key) : null,
    name: label,
    displayName: displayName(label, fallback),
    grams: carb.grams !== undefined && carb.grams !== null ? asNumber(carb.grams, null) : null,
  };
  if (unresolved) {
    withWarning(warnings, "MISSING_CARB_NAME", `kitchen.meals[${slotIndex}].carbs[${index}].name`);
    withWarning(warnings, "UNRESOLVED_OPTION_NAME", `kitchen.meals[${slotIndex}].carbs[${index}]`);
  } else if (!isNonEmpty(carb.name) && !isNonEmpty(carb.nameI18n && (carb.nameI18n.ar || carb.nameI18n.en))) {
    withWarning(warnings, "MISSING_CARB_NAME", `kitchen.meals[${slotIndex}].carbs[${index}].name`);
    withWarning(warnings, "FALLBACK_DISPLAY_NAME_USED", `kitchen.meals[${slotIndex}].carbs[${index}].name`);
  }
  return payload;
}

function normalizeSaladGroupItem(item, groupKey, itemIndex, warnings, slotIndex) {
  if (item && typeof item === "object") {
    const key = item.key || item.optionKey || item.ingredientKey || null;
    const id = item.id || item._id || item.optionId || item.ingredientId || item;
    const name = item.nameI18n || item.name || item.optionName || item.label;
    const unresolved = !extractNameValue(name) && isObjectIdLike(key || id);
    const payload = entityPayload({
      id,
      key,
      name: unresolved ? UNKNOWN_ITEM_LABEL : name,
      fallback: key || id || groupKey,
    });
    if (unresolved) withWarning(warnings, "UNRESOLVED_SALAD_GROUP_ITEM", `kitchen.meals[${slotIndex}].salad.groups.${groupKey}[${itemIndex}]`);
    return payload;
  }
  const id = asId(item);
  const unresolved = isObjectIdLike(id);
  if (unresolved) withWarning(warnings, "UNRESOLVED_SALAD_GROUP_ITEM", `kitchen.meals[${slotIndex}].salad.groups.${groupKey}[${itemIndex}]`);
  return entityPayload({
    id,
    key: unresolved ? null : String(item || groupKey),
    name: unresolved ? UNKNOWN_ITEM_LABEL : null,
    fallback: unresolved ? "unknown_item" : item || groupKey,
  });
}

function normalizeSalad(salad, mealType, warnings, slotIndex) {
  if (!salad && mealType !== "premium_large_salad" && mealType !== "basic_salad") return null;
  const source = salad && typeof salad === "object" ? salad : {};
  const presetKey = source.presetKey || source.key || mealType || "basic_salad";
  const presetLabel = semanticLabelFor(presetKey) || semanticLabelFor(mealType) || nameObject(source.name, presetKey);
  const groupsSource = source.groups && typeof source.groups === "object" ? source.groups : {};
  const groupKeys = Array.from(new Set(["leafy_greens", "vegetables", "protein", "cheese_nuts", "fruits", "sauce"].concat(Object.keys(groupsSource))));
  const groups = {};
  const rawIds = {};
  groupKeys.forEach((groupKey) => {
    const values = Array.isArray(groupsSource[groupKey]) ? groupsSource[groupKey] : [];
    groups[groupKey] = values.map((item, itemIndex) => normalizeSaladGroupItem(item, groupKey, itemIndex, warnings, slotIndex));
    rawIds[groupKey] = values.map((item) => asId(item && typeof item === "object" ? item.id || item._id || item.optionId || item.ingredientId : item)).filter(Boolean);
  });
  return {
    ...source,
    presetKey,
    name: nameObject(source.name || presetLabel, presetLabel),
    displayName: displayName(source.name || presetLabel, presetKey),
    groups,
    rawIds,
  };
}

function normalizeMeal(slot = {}, slotIndex, fulfillmentType, warnings) {
  const mealType = slot.selectionType || slot.mealType || "standard_meal";
  const mealTypeLabel = MEAL_TYPE_LABELS[mealType] || nameObject(null, humanizeKey(mealType));
  const productFallback = slot.productKey || slot.productId || slot.sandwichKey || slot.sandwichId || mealType;
  const fallbackProductName = semanticLabelFor(slot.productKey) || semanticLabelFor(mealType) || humanizeKey(productFallback);
  const product = entityPayload({
    id: slot.productId || (mealType === "sandwich" ? slot.sandwichId : null),
    key: slot.productKey || slot.sandwichKey,
    name: slot.productNameI18n || slot.productName,
    fallback: fallbackProductName,
  });
  const sandwich = mealType === "sandwich"
    ? entityPayload({
      id: slot.sandwichId || slot.productId,
      key: slot.sandwichKey || slot.productKey,
      name: slot.sandwichNameI18n || slot.sandwichName || slot.productNameI18n || slot.productName,
      fallback: fallbackProductName,
    })
    : null;
  const proteinFallback = slot.proteinKey || slot.proteinFamilyKey || slot.proteinId || "";
  const proteinName = slot.proteinNameI18n || slot.proteinName || PROTEIN_FALLBACKS[String(proteinFallback || "").toLowerCase()];
  const hasProteinComponent = Boolean(slot.proteinId || slot.proteinKey || slot.proteinFamilyKey || extractNameValue(proteinName));
  const protein = hasProteinComponent
    ? {
      ...entityPayload({
        id: slot.proteinId,
        key: slot.proteinKey || slot.proteinFamilyKey,
        name: proteinName,
        fallback: proteinFallback,
      }),
      grams: slot.proteinGrams === undefined || slot.proteinGrams === null ? null : asNumber(slot.proteinGrams, null),
    }
    : null;
  const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb, index) => normalizeCarb(carb, index, warnings, slotIndex));
  const sauce = (Array.isArray(slot.sauce) ? slot.sauce : []).map(normalizeOption);
  const sides = (Array.isArray(slot.sides) ? slot.sides : []).map(normalizeOption);
  const options = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : []).map(normalizeOption);
  const salad = normalizeSalad(slot.salad, mealType, warnings, slotIndex);
  const proteinGrams = protein && protein.grams ? protein.grams : null;
  const badgesAr = [mealTypeLabel.ar, proteinGrams ? `${proteinGrams}g` : null, slot.isPremium ? "مميز" : null]
    .filter(Boolean);
  const primaryName = mealType === "sandwich" && sandwich ? sandwich.displayName : product.displayName;
  const semanticProductComplete = SEMANTIC_PRODUCT_COMPLETE_TYPES.has(String(slot.productKey || ""))
    || SEMANTIC_PRODUCT_COMPLETE_TYPES.has(String(mealType || ""));

  if (!semanticProductComplete && !product.id && !product.key) withWarning(warnings, "MISSING_PRODUCT", `kitchen.meals[${slotIndex}].product`);
  if (!semanticProductComplete && !slot.productName && !(slot.productNameI18n && (slot.productNameI18n.ar || slot.productNameI18n.en))) {
    withWarning(warnings, "MISSING_PRODUCT_NAME", `kitchen.meals[${slotIndex}].product.name`);
    withWarning(warnings, "FALLBACK_DISPLAY_NAME_USED", `kitchen.meals[${slotIndex}].product.name`);
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
    salad,
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
      titleAr: proteinGrams ? `${primaryName} - ${proteinGrams}g` : primaryName,
      subtitleAr: `${FULFILLMENT_LABELS[fulfillmentType].ar} - ${Math.max(1, asNumber(slot.quantity, 1))} وجبة`,
      preparationTextAr: proteinGrams
        ? `حضّر ${primaryName} مع بروتين ${proteinGrams}g`
        : `حضّر ${primaryName}`,
      badgesAr,
    },
  };
}

function normalizeAddon(addon = {}, index, warnings) {
  const name = addon.nameI18n || addon.name || addon.addonName;
  const fallback = addon.key || addon.addonKey || addon.id || addon.addonId || "addon";
  const unresolved = !extractNameValue(name) && isObjectIdLike(fallback);
  if (unresolved) withWarning(warnings, "UNRESOLVED_ADDON_NAME", `kitchen.addons[${index}]`);
  const extractedName = extractNameValue(name);
  const rawMissingArabic = name && typeof name === "object"
    && !Array.isArray(name)
    && !scalarString(name.ar)
    && scalarString(name.en);
  if (addon.missingArabicName || (!unresolved && rawMissingArabic) || (!unresolved && extractedName && typeof extractedName === "object" && !extractedName.ar && extractedName.en)) {
    withWarning(warnings, "MISSING_ARABIC_ADDON_NAME", `kitchen.addons[${index}].name.ar`);
  }
  const payload = entityPayload({
    id: addon.id || addon.addonId,
    key: addon.key || addon.addonKey,
    name: unresolved ? UNKNOWN_ITEM_LABEL : name,
    fallback,
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
  const payment = { ...(item.paymentValidity || {}) };
  const fulfillmentType = fulfillmentTypeFor(item);
  const meals = (Array.isArray(kitchenDetails.mealSlots) ? kitchenDetails.mealSlots : [])
    .map((slot, index) => normalizeMeal(slot, index, fulfillmentType, warnings));
  const addons = (Array.isArray(kitchenDetails.addons) ? kitchenDetails.addons : []).map((addon, index) => normalizeAddon(addon, index, warnings));
  const actions = buildActions(item, payment);
  const sourceType = sourceTypeFor(item);
  const pickup = item.pickup || {};
  const pickupMealCount = asNumber(pickup.mealCount || item.mealCount || (item.context && item.context.mealCount), 0);
  const mealCount = sourceType === "pickup_request" && meals.length === 0
    ? pickupMealCount
    : sumQuantity(meals);
  const addonCount = sumQuantity(addons);
  const delivery = item.delivery || {};
  const timestamps = item.timestamps || {};
  const status = item.status || null;
  const lifecycleGroup = lifecycleGroupFor(status);
  const sourceIsActionable = lifecycleGroup !== "archived" || actions.canReopen || actions.canPrepare || actions.canFulfill;

  if (!((item.customer && item.customer.id) || (item.user && item.user.id))) withWarning(warnings, "MISSING_CUSTOMER", "customer.id");
  if (!item.plan) withWarning(warnings, "MISSING_PLAN", "subscription.plan");
  if (mealCount === 0) withWarning(warnings, "EMPTY_KITCHEN_MEALS", "kitchen.meals");
  if (lifecycleGroup === "archived" && mealCount === 0) withWarning(warnings, "CANCELED_EMPTY_ROW", "source.status");
  if (mealCount === 0 && sourceType !== "pickup_request") {
    payment.canPrepare = false;
    actions.allowed = actions.allowed.filter((action) => action && action.id !== "prepare");
    actions.canPrepare = false;
  }

  // Final Branch Pickup rule: Branch Pickup is balance-based.
  // A planned subscription_day is not enough to prepare/ready/fulfill pickup.
  // Operational transitions for branch pickup MUST run on entityType = subscription_pickup_request
  // or have a valid pickupRequestId link.
  if (fulfillmentType === "branch_pickup" && sourceType === "subscription_day" && !ids.pickupRequestId) {
    payment.canPrepare = false;
    actions.canPrepare = false;
    actions.canReadyForPickup = false;
    actions.canFulfill = false;
    actions.allowed = actions.allowed.filter(
      (action) => action && !["prepare", "ready_for_pickup", "fulfill", "no_show"].includes(action.id)
    );
    actions.disabled.push({
      id: "prepare",
      reason: "PICKUP_REQUEST_REQUIRED",
      label: REASON_LABELS.PICKUP_REQUEST_REQUIRED,
    });
  }

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
