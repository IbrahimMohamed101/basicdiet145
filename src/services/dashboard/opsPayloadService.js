"use strict";

const { pickLang } = require("../../utils/i18n");
const { buildDayCommercialState } = require("../subscription/subscriptionDayCommercialStateService");
const {
  buildChefChoiceMealSlots,
  hasExplicitKitchenMeals,
  isHomeDeliverySubscription,
  isValidHomeDeliveryChefChoiceDay,
  resolveDeliveryAddress,
  resolveDeliveryWindow,
  resolveHomeDeliveryEntitlementCount,
} = require("./homeDeliveryChefChoiceService");

function stringifyId(value) {
  if (!value) return null;
  if (value._id) return String(value._id);
  if (value.id && typeof value.id !== "object") return String(value.id);
  return String(value);
}

function localizedName(value, lang = "en") {
  if (!value) return "";
  if (typeof value === "string") return value;
  const extracted = extractNameValue(value);
  if (!extracted) return "";
  if (typeof extracted === "string") return extracted;
  return pickLang(extracted, lang) || pickLang(extracted, "en") || pickLang(extracted, "ar") || "";
}

function isScalar(value) {
  return ["string", "number", "boolean"].includes(typeof value);
}

function scalarString(value) {
  return isScalar(value) && String(value).trim() !== "" ? String(value) : "";
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

function localizedNameObject(value, fallback = "") {
  const extracted = extractNameValue(value);
  const fallbackExtracted = extractNameValue(fallback);
  if (extracted && typeof extracted === "object") {
    const fallbackText = typeof fallbackExtracted === "string" ? fallbackExtracted : "";
    return {
      ar: extracted.ar || extracted.en || fallbackText,
      en: extracted.en || extracted.ar || fallbackText,
    };
  }
  if (typeof extracted === "string" && extracted) return { ar: extracted, en: extracted };
  if (fallbackExtracted && typeof fallbackExtracted === "object") {
    return {
      ar: fallbackExtracted.ar || fallbackExtracted.en || "",
      en: fallbackExtracted.en || fallbackExtracted.ar || "",
    };
  }
  if (typeof fallbackExtracted === "string" && fallbackExtracted) return { ar: fallbackExtracted, en: fallbackExtracted };
  return { ar: "", en: "" };
}

function hasArabicName(value) {
  const extracted = extractNameValue(value);
  return Boolean(extracted && typeof extracted === "object" && scalarString(extracted.ar));
}

function hasAnyName(value) {
  const extracted = extractNameValue(value);
  return Boolean(
    (typeof extracted === "string" && extracted)
      || (extracted && typeof extracted === "object" && (scalarString(extracted.ar) || scalarString(extracted.en)))
  );
}

function getFromMap(map, id) {
  if (!map || !id) return null;
  return map.get(String(id)) || null;
}

function firstDefinedNumber(...values) {
  const value = values.find((entry) => entry !== undefined && entry !== null && entry !== "");
  return value === undefined ? 0 : Number(value || 0);
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
    nameI18n: localizedNameObject(plan && plan.name, plan && plan.key ? String(plan.key) : ""),
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

function selectedOptionIdentity(option = {}) {
  const groupIdentity = stringifyId(option.groupId)
    || option.canonicalGroupKey
    || option.groupKey
    || option.groupName
    || "";
  const optionIdentity = stringifyId(option.optionId)
    || option.optionKey
    || option.name
    || "";

  if (groupIdentity || optionIdentity) {
    return `${String(groupIdentity)}:${String(optionIdentity)}`;
  }

  return JSON.stringify({
    quantity: Number(option.quantity || option.qty || 1),
    grams: option.grams ?? null,
    unitPriceHalala: Number(option.unitPriceHalala || option.extraPriceHalala || 0),
    totalPriceHalala: Number(option.totalPriceHalala || option.totalHalala || 0),
    extraWeightUnitGrams: Number(option.extraWeightUnitGrams || 0),
    extraWeightPriceHalala: Number(option.extraWeightPriceHalala || 0),
  });
}

function dedupeSelectedOptions(options = []) {
  const seen = new Set();
  const unique = [];

  for (const option of Array.isArray(options) ? options : []) {
    const identity = selectedOptionIdentity(option);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(option);
  }

  return unique;
}

function classifyOptions(options, matcher) {
  return options.filter((option) => {
    const key = String(option.canonicalGroupKey || option.groupKey || "").toLowerCase();
    return matcher(key);
  });
}

function resolveCatalogDoc(catalogMaps = {}, kind, id, key) {
  const byId = getFromMap(catalogMaps[`${kind}ById`], id);
  if (byId) return byId;
  return getFromMap(catalogMaps[`${kind}ByKey`], key);
}

function resolveAnyCatalogDoc(catalogMaps = {}, kinds = [], id, key) {
  for (const kind of kinds) {
    const doc = resolveCatalogDoc(catalogMaps, kind, id, key);
    if (doc) return doc;
  }
  return null;
}

function hydrateSelectedOption(option = {}, catalogMaps = {}, lang = "en") {
  const optionId = stringifyId(option.optionId || option.id || option._id);
  const optionKey = option.optionKey || option.key || null;
  const doc = resolveAnyCatalogDoc(catalogMaps, ["option", "saladItem", "protein", "carb"], optionId, optionKey);
  const nameSource = option.name || option.optionName || option.label || (doc && doc.name);
  return {
    ...option,
    optionId,
    optionKey: optionKey || (doc && doc.key) || null,
    name: localizedName(nameSource, lang),
    nameI18n: localizedNameObject(nameSource, optionKey || (doc && doc.key) || optionId || ""),
  };
}

function hydrateSaladGroupItem(item, groupKey, catalogMaps = {}, lang = "en") {
  const isObject = item && typeof item === "object";
  const id = stringifyId(isObject ? item.id || item._id || item.optionId || item.ingredientId : item);
  const key = isObject ? item.key || item.optionKey || item.ingredientKey || null : null;
  const kinds = groupKey === "protein"
    ? ["protein", "option", "saladItem"]
    : ["saladItem", "option", "protein"];
  const doc = resolveAnyCatalogDoc(catalogMaps, kinds, id, key);
  if (!isObject && !doc) return item;
  const nameSource = (isObject && (item.nameI18n || item.name || item.optionName || item.label)) || (doc && doc.name);
  if (!doc && !nameSource) return item;
  return {
    ...(isObject ? item : {}),
    id,
    key: key || (doc && doc.key) || null,
    name: localizedNameObject(nameSource, key || (doc && doc.key) || id || ""),
  };
}

function hydrateSaladPayload(salad, catalogMaps = {}, lang = "en") {
  if (!salad || typeof salad !== "object") return salad || null;
  const groups = salad.groups && typeof salad.groups === "object" ? salad.groups : {};
  const hydratedGroups = {};
  for (const [groupKey, values] of Object.entries(groups)) {
    hydratedGroups[groupKey] = Array.isArray(values)
      ? values.map((item) => hydrateSaladGroupItem(item, groupKey, catalogMaps, lang))
      : values;
  }
  return { ...salad, groups: hydratedGroups };
}

function buildMealSlotPayload(slot = {}, subscription = {}, lang = "en", catalogMaps = {}) {
  const confirmation = slot.confirmationSnapshot || {};
  const display = slot.displaySnapshot || {};
  const fulfillment = slot.fulfillmentSnapshot || {};
  const selectedOptions = dedupeSelectedOptions(
    (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
      .map((option) => normalizeSelectedOption(hydrateSelectedOption(option, catalogMaps, lang), lang))
  );
  const carbSelections = Array.isArray(slot.carbSelections)
    ? slot.carbSelections
    : (Array.isArray(slot.carbs)
      ? slot.carbs
      : (slot.carbId ? [{ carbId: slot.carbId, grams: null }] : []));
  const product = confirmation.product || display.product || fulfillment.product || {};
  const materializedProduct = slot.materializedMeal || {};
  const premiumSelection = slot.premiumUpgradeSelection || {};
  const premiumSalad = slot.selectionType === "premium_large_salad";
  const initialProductId = stringifyId(
    slot.productId
      || product.id
      || product._id
      || materializedProduct.productId
      || (premiumSalad && (premiumSelection.sourceProductId || premiumSelection.sourceId))
  );
  const initialProductKey = slot.productKey
    || product.key
    || materializedProduct.productKey
    || (premiumSalad && premiumSelection.sourceKey)
    || (premiumSalad ? "premium_large_salad" : null);
  const sandwichId = stringifyId(slot.sandwichId || materializedProduct.sandwichId || (slot.selectionType === "sandwich" ? initialProductId : null));
  const productDoc = resolveCatalogDoc(catalogMaps, "product", initialProductId, initialProductKey);
  const sandwichDoc = resolveCatalogDoc(catalogMaps, "sandwich", sandwichId || initialProductId, slot.sandwichKey || initialProductKey);
  const resolvedProductDoc = productDoc || (slot.selectionType === "sandwich" ? sandwichDoc : null);
  const productId = initialProductId || (resolvedProductDoc && stringifyId(resolvedProductDoc._id)) || (slot.selectionType === "sandwich" ? sandwichId : null);
  const productKey = initialProductKey || (resolvedProductDoc && resolvedProductDoc.key) || null;
  const premiumNameSource = premiumSelection.nameI18n || premiumSelection.name;
  const productNameSource = product.name
    || product.title
    || (premiumSalad && premiumNameSource)
    || (resolvedProductDoc && resolvedProductDoc.name)
    || (sandwichDoc && sandwichDoc.name);
  const sandwichNameSource = (sandwichDoc && sandwichDoc.name) || product.name || product.title || productNameSource;
  const proteinDoc = resolveCatalogDoc(
    catalogMaps,
    "protein",
    slot.proteinId || fulfillment.proteinId || materializedProduct.proteinId,
    fulfillment.proteinKey || confirmation.proteinKey || slot.proteinFamilyKey || materializedProduct.proteinFamilyKey
  );

  const selectionType = slot.selectionType || null;
  const selectionTypeI18n = (() => {
    switch (selectionType) {
      case "standard_meal": return { ar: "وجبة قياسية", en: "Standard Meal" };
      case "premium_meal": return { ar: "وجبة مميزة (بريميوم)", en: "Premium Meal" };
      case "premium_large_salad": return { ar: "سلطة مميزة", en: "Premium Salad" };
      case "sandwich": return { ar: "ساندويتش", en: "Sandwich" };
      case "chef_choice": return { ar: "اختيار الشيف", en: "Chef Choice" };
      default: return { ar: selectionType || "وجبة", en: selectionType || "Meal" };
    }
  })();

  return {
    slotIndex: slot.slotIndex !== undefined ? Number(slot.slotIndex || 0) : null,
    slotKey: slot.slotKey || null,
    selectionType,
    selectionTypeI18n,
    productId,
    productKey,
    productName: localizedName(productNameSource, lang),
    productNameI18n: productNameSource ? localizedNameObject(productNameSource, productKey || sandwichId || "") : undefined,
    sandwichId,
    sandwichKey: slot.sandwichKey || (sandwichDoc && sandwichDoc.key) || productKey || null,
    sandwichName: localizedName(sandwichNameSource, lang),
    sandwichNameI18n: sandwichNameSource ? localizedNameObject(sandwichNameSource, productKey || sandwichId || "") : undefined,
    imageUrl: slot.imageUrl
      || product.imageUrl
      || premiumSelection.imageUrl
      || (resolvedProductDoc && resolvedProductDoc.imageUrl)
      || (sandwichDoc && sandwichDoc.imageUrl)
      || null,
    proteinId: stringifyId(slot.proteinId || fulfillment.proteinId || materializedProduct.proteinId),
    proteinKey: slot.proteinKey
      || fulfillment.proteinKey
      || confirmation.proteinKey
      || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey))
      || slot.proteinFamilyKey
      || null,
    proteinName: snapshotName(confirmation, ["protein", "name"], lang)
      || snapshotName(display, ["protein", "name"], lang)
      || localizedName(fulfillment.proteinName || (proteinDoc && proteinDoc.name), lang),
    proteinNameI18n: localizedNameObject(
      (confirmation.protein && confirmation.protein.name)
        || (display.protein && display.protein.name)
        || fulfillment.proteinName
        || (proteinDoc && proteinDoc.name),
      fulfillment.proteinKey || confirmation.proteinKey || slot.proteinFamilyKey || ""
    ),
    proteinGrams: Number(subscription && subscription.selectedGrams || 0) || null,
    proteinFamilyKey: slot.proteinFamilyKey || null,
    carbSelections: carbSelections.map((carb) => {
      const carbDoc = resolveCatalogDoc(catalogMaps, "carb", carb && carb.carbId, carb && carb.key);
      return {
        carbId: stringifyId(carb && carb.carbId),
        key: (carb && carb.key) || (carbDoc && carbDoc.key) || null,
        name: localizedName((carb && (carb.name || carb.carbName)) || (carbDoc && carbDoc.name) || null, lang),
        nameI18n: localizedNameObject(
          (carb && (carb.name || carb.carbName)) || (carbDoc && carbDoc.name),
          carb && (carb.key || carb.carbId) ? String(carb.key || carb.carbId) : ""
        ),
        grams: carb && carb.grams !== undefined && carb.grams !== null ? Number(carb.grams || 0) : null,
      };
    }),
    salad: hydrateSaladPayload(slot.salad || slot.customSalad || null, catalogMaps, lang),
    sauce: classifyOptions(selectedOptions, (key) => key.includes("sauce")),
    selectedOptions,
    sides: classifyOptions(selectedOptions, (key) => key.includes("side")),
    isPremium: Boolean(slot.isPremium),
    premiumKey: slot.premiumKey || null,
    premiumSource: slot.premiumSource || "none",
    quantity: 1,
    notes: slot.notes || (confirmation.notes || display.notes || fulfillment.notes) || null,
  };
}

function findAddonEntitlement(subscription = {}, addon = {}) {
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const planId = stringifyId(addon.addonPlanId);
  const bucketId = stringifyId(addon.balanceBucketId);
  const entitlementKey = addon.entitlementKey ? String(addon.entitlementKey) : "";
  return entitlements.find((entry) => {
    const entryPlanId = stringifyId(entry.addonPlanId || entry.addonId);
    return (planId && entryPlanId === planId)
      || (bucketId && stringifyId(entry.balanceBucketId) === bucketId)
      || (entitlementKey && String(entry.entitlementKey || "") === entitlementKey);
  }) || null;
}

function findAddonProductSnapshot(entitlement, productId, key) {
  if (!entitlement || !Array.isArray(entitlement.menuProductsSnapshot)) return null;
  return entitlement.menuProductsSnapshot.find((entry) => (
    (productId && stringifyId(entry.id || entry._id) === productId)
      || (key && String(entry.key || "") === String(key))
  )) || null;
}

function buildAddonPayload(addon = {}, lang = "en", catalogMaps = {}, subscription = {}) {
  const legacyId = addon.addonId || addon.productId || addon.menuProductId || addon.id || addon._id || null;
  const rawProductId = addon.productId || addon.menuProductId || addon.addonId || addon.id || addon._id || null;
  const productId = stringifyId(rawProductId);
  const key = addon.key || addon.addonKey || null;
  const productDoc = resolveCatalogDoc(catalogMaps, "product", productId, addon.productKey || key);
  const addonDoc = resolveCatalogDoc(catalogMaps, "addon", addon.addonId || rawProductId, key);
  const doc = productDoc || addonDoc;
  const entitlement = findAddonEntitlement(subscription, addon);
  const addonPlanId = stringifyId(addon.addonPlanId || (entitlement && (entitlement.addonPlanId || entitlement.addonId)));
  const productSnapshot = findAddonProductSnapshot(entitlement, productId, addon.productKey || key);
  const planDoc = getFromMap(catalogMaps.addonPlanById, addonPlanId);
  const snapshotName = addon.name || addon.addonName;
  const catalogName = (productSnapshot && (productSnapshot.nameI18n || productSnapshot.name)) || (doc && doc.name);
  let nameSource = hasArabicName(snapshotName)
    ? snapshotName
    : (hasArabicName(catalogName) ? catalogName : (snapshotName || catalogName));

  if (!hasAnyName(nameSource)) {
    nameSource = { ar: "إضافة (غير متوفرة)", en: "Addon (Unavailable)" };
  }

  return {
    id: stringifyId(legacyId),
    productId,
    key: addon.productKey || key || (productSnapshot && productSnapshot.key) || (doc && doc.key) || null,
    name: localizedName(nameSource, lang),
    nameI18n: localizedNameObject(nameSource, key || (doc && doc.key) || ""),
    quantity: Number(addon.qty || addon.quantity || 1),
    priceHalala: firstDefinedNumber(addon.priceHalala, addon.payableTotalHalala, addon.unitPriceHalala, addon.totalPriceHalala),
    addonPlanId,
    balanceBucketId: stringifyId(addon.balanceBucketId || (entitlement && entitlement.balanceBucketId)),
    entitlementKey: addon.entitlementKey || (entitlement && entitlement.entitlementKey) || null,
    addonPlanNameI18n: localizedNameObject(
      (entitlement && (entitlement.addonPlanNameI18n || entitlement.addonPlanName || entitlement.name))
        || (planDoc && planDoc.name),
      (entitlement && (entitlement.displayKey || entitlement.entitlementKey)) || (planDoc && (planDoc.displayKey || planDoc.category)) || ""
    ),
    productUnitPriceHalala: firstDefinedNumber(
      productSnapshot && productSnapshot.priceHalala,
      productDoc && productDoc.priceHalala,
      addon.productUnitPriceHalala
    ),
    payableTotalHalala: firstDefinedNumber(addon.payableTotalHalala, addon.priceHalala, addon.totalPriceHalala),
    imageUrl: addon.imageUrl || (productSnapshot && productSnapshot.imageUrl) || (doc && doc.imageUrl) || null,
    missingArabicName: hasAnyName(nameSource) && !hasArabicName(nameSource),
  };
}

function buildOrderKitchenDetailsPayload(order = {}, lang = "en", catalogMaps = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const mealSlots = [];
  const addons = [];

  items.forEach((item, index) => {
    const itemType = String(item && (item.itemType || item.type) || "standard_meal");
    if (itemType === "addon_item" || itemType === "drink" || itemType === "dessert") {
      addons.push(buildAddonPayload({
        id: stringifyId((item.catalogRef && item.catalogRef.id) || item.productId || item.mealId || `order_addon_${index + 1}`),
        key: item.productKey || null,
        name: item.name || (item.productSnapshot && item.productSnapshot.name),
        quantity: Number(item.qty || item.quantity || 1),
        priceHalala: Number(item.lineTotalHalala || item.unitPriceHalala || item.unitPrice || 0),
      }, lang, catalogMaps));
      return;
    }

    const selections = item.selections || {};
    const selectedOptions = dedupeSelectedOptions(
      (Array.isArray(item.selectedOptions) ? item.selectedOptions : [])
        .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : [])
        .map((option) => normalizeSelectedOption(hydrateSelectedOption(option, catalogMaps, lang), lang))
    );
    const productId = stringifyId(item.productId || item.mealId || (item.catalogRef && item.catalogRef.id));
    const productKey = item.productKey || (item.productSnapshot && item.productSnapshot.key) || null;
    const productDoc = resolveCatalogDoc(catalogMaps, "product", productId, productKey);
    const proteinDoc = resolveCatalogDoc(catalogMaps, "protein", selections.proteinId, selections.proteinKey);
    const productNameSource = item.name || (item.productSnapshot && item.productSnapshot.name) || (productDoc && productDoc.name);
    const proteinNameSource = selections.proteinName || (proteinDoc && proteinDoc.name);

    const selectionTypeI18n = (() => {
      switch (itemType) {
        case "standard_meal": return { ar: "وجبة قياسية", en: "Standard Meal" };
        case "premium_meal": return { ar: "وجبة مميزة (بريميوم)", en: "Premium Meal" };
        case "premium_large_salad": return { ar: "سلطة مميزة", en: "Premium Salad" };
        case "sandwich": return { ar: "ساندويتش", en: "Sandwich" };
        case "chef_choice": return { ar: "اختيار الشيف", en: "Chef Choice" };
        default: return { ar: itemType || "وجبة", en: itemType || "Meal" };
      }
    })();

    mealSlots.push({
      slotIndex: index + 1,
      slotKey: `order_item_${index + 1}`,
      selectionType: itemType,
      selectionTypeI18n,
      productId,
      productKey,
      productName: localizedName(productNameSource, lang),
      productNameI18n: productNameSource ? localizedNameObject(productNameSource, productKey || productId || "") : undefined,
      proteinId: stringifyId(selections.proteinId),
      proteinKey: selections.proteinKey || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey)) || null,
      proteinName: localizedName(proteinNameSource, lang),
      proteinNameI18n: proteinNameSource ? localizedNameObject(proteinNameSource, selections.proteinKey || selections.proteinId || "") : undefined,
      proteinGrams: null,
      proteinFamilyKey: null,
      carbSelections: (Array.isArray(selections.carbs) ? selections.carbs : []).map((carb) => ({
        carbId: stringifyId(carb.carbId),
        key: carb.key || ((resolveCatalogDoc(catalogMaps, "carb", carb.carbId, carb.key) || {}).key) || null,
        name: localizedName(carb.name || ((resolveCatalogDoc(catalogMaps, "carb", carb.carbId, carb.key) || {}).name), lang),
        nameI18n: localizedNameObject(carb.name || ((resolveCatalogDoc(catalogMaps, "carb", carb.carbId, carb.key) || {}).name), carb.key || carb.carbId || ""),
        grams: carb.grams === undefined || carb.grams === null ? null : Number(carb.grams || 0),
      })),
      salad: hydrateSaladPayload(selections.salad || null, catalogMaps, lang),
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

function buildKitchenDetailsPayload(day = {}, subscription = {}, lang = "en", catalogMaps = {}) {
  const materializedBySlotKey = new Map(
    (Array.isArray(day.materializedMeals) ? day.materializedMeals : [])
      .map((meal) => [String(meal && meal.slotKey || ""), meal])
      .filter(([key]) => key)
  );
  const hasSelectedMeals = hasExplicitKitchenMeals(day);
  const premiumSelectionBySlotKey = new Map(
    (Array.isArray(day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : [])
      .map((selection) => [String(selection && selection.baseSlotKey || ""), selection])
      .filter(([key]) => key)
  );
  let mealSlots = Array.isArray(day.mealSlots) && hasSelectedMeals
    ? day.mealSlots.map((slot) => buildMealSlotPayload({
      ...slot,
      materializedMeal: materializedBySlotKey.get(String(slot && slot.slotKey || "")) || null,
      premiumUpgradeSelection: premiumSelectionBySlotKey.get(String(slot && slot.slotKey || "")) || null,
    }, subscription, lang, catalogMaps))
    : [];
  let selectionMode = hasSelectedMeals ? "customer_selected" : "none";
  if (mealSlots.length === 0 && isValidHomeDeliveryChefChoiceDay(day, subscription)) {
    mealSlots = buildChefChoiceMealSlots(resolveHomeDeliveryEntitlementCount(day, subscription));
    selectionMode = "chef_choice";
  } else if (mealSlots.length > 0) {
    const requiredCount = resolveHomeDeliveryEntitlementCount(day, subscription);
    const missingCount = Math.max(0, requiredCount - mealSlots.length);
    if (
      missingCount > 0
      && isHomeDeliverySubscription(subscription)
      && resolveDeliveryWindow(day, subscription)
      && resolveDeliveryAddress(day, subscription)
    ) {
      const maxSlotIndex = mealSlots.reduce((max, slot) => Math.max(max, Number(slot && slot.slotIndex || 0)), 0);
      mealSlots = mealSlots.concat(buildChefChoiceMealSlots(missingCount, { startIndex: maxSlotIndex + 1 }));
      selectionMode = "mixed_customer_and_chef_choice";
    }
  }
  const addonSources = []
    .concat(Array.isArray(day.addonSelections) ? day.addonSelections : [])
    .concat(Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : [])
    .concat(Array.isArray(day.recurringAddons) ? day.recurringAddons : []);

  return {
    mealSlots,
    addons: addonSources.map((addon) => buildAddonPayload(addon, lang, catalogMaps, subscription)),
    selectionMode,
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
  const rawPaymentStatus = premiumPayment.status || (requirement.requiresPayment ? "pending" : "not_required");
  const paymentStatus = rawPaymentStatus === "none" && !requirement.requiresPayment ? "not_required" : rawPaymentStatus;
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
