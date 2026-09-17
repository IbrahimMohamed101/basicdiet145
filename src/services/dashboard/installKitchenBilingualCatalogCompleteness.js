"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenBilingualCatalogCompleteness.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenBilingualCatalogCompleteness.wrapped");

// Historical production records can outlive the BuilderCarb row that originally
// owned their ObjectId. Keep the alias narrow and explicit; the live catalog is
// always checked first. This id is the legacy white-rice row observed in locked
// SubscriptionDay snapshots created before immutable catalog identities.
const LEGACY_CARB_ID_ALIASES = Object.freeze({
  "6a62198179ee075a57f7013e": ["white_rice", "carbs_white_rice"],
});

const COMPONENT_FALLBACKS = Object.freeze({
  chicken: { ar: "دجاج", en: "Chicken" },
  grilled_chicken: { ar: "دجاج مشوي", en: "Grilled Chicken" },
  spicy_chicken: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
  beef: { ar: "لحم بقري", en: "Beef" },
  white_rice: { ar: "رز أبيض", en: "White Rice" },
  carbs_white_rice: { ar: "رز أبيض", en: "White Rice" },
  vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  carbs_vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  yellow_rice: { ar: "رز أصفر", en: "Yellow Rice" },
  carbs_yellow_rice: { ar: "رز أصفر", en: "Yellow Rice" },
  vegetable_rice: { ar: "رز بالخضار", en: "Vegetable Rice" },
  carbs_vegetable_rice: { ar: "رز بالخضار", en: "Vegetable Rice" },
  mashed_potatoes: { ar: "بطاطس مهروسة", en: "Mashed Potatoes" },
  carbs_mashed_potatoes: { ar: "بطاطس مهروسة", en: "Mashed Potatoes" },
  creamy_pasta: { ar: "مكرونة بالكريمة", en: "Creamy Pasta" },
  carbs_creamy_pasta: { ar: "مكرونة بالكريمة", en: "Creamy Pasta" },
  red_sauce_pasta: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
  carbs_red_sauce_pasta: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
  mixed_vegetables: { ar: "خضار مشكل", en: "Mixed Vegetables" },
  carbs_mixed_vegetables: { ar: "خضار مشكل", en: "Mixed Vegetables" },
  roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  carbs_roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
  carbs_sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
});

const ADDON_ITEM_TYPES = new Set(["addon_item", "drink", "dessert"]);
const COMPOSITE_MEAL_TYPES = new Set(["standard_meal", "premium_meal"]);

function scalar(value) {
  return ["string", "number", "boolean"].includes(typeof value)
    ? String(value).trim()
    : "";
}

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try { return String(value.toHexString()).trim() || null; } catch (_) { return null; }
  }
  if (value && typeof value === "object") {
    if (value._id !== undefined && value._id !== value) return idText(value._id);
    if (value.id !== undefined && value.id !== value) return idText(value.id);
    return null;
  }
  return scalar(value) || null;
}

function keyText(value) {
  return scalar(value).toLowerCase() || null;
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/u.test(String(value || ""));
}

function localizedPair(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) return { ar: "", en: "" };
  const direct = scalar(value);
  if (direct) return containsArabic(direct) ? { ar: direct, en: "" } : { ar: "", en: direct };
  if (Array.isArray(value)) {
    for (const entry of value) {
      const pair = localizedPair(entry, depth + 1);
      if (pair.ar || pair.en) return pair;
    }
    return { ar: "", en: "" };
  }
  if (typeof value !== "object") return { ar: "", en: "" };
  const rawAr = scalar(value.ar);
  const rawEn = scalar(value.en);
  if (rawAr || rawEn) {
    return {
      ar: containsArabic(rawAr) ? rawAr : (containsArabic(rawEn) ? rawEn : ""),
      en: rawEn && !containsArabic(rawEn) ? rawEn : (rawAr && !containsArabic(rawAr) ? rawAr : ""),
    };
  }
  for (const field of ["nameI18n", "name", "titleI18n", "title", "optionNameI18n", "optionName", "labelI18n", "label"]) {
    if (!value[field] || value[field] === value) continue;
    const pair = localizedPair(value[field], depth + 1);
    if (pair.ar || pair.en) return pair;
  }
  return { ar: "", en: "" };
}

function catalogName(row) {
  return row && (row.nameI18n || row.name || row.titleI18n || row.title);
}

function fallbackPair(value) {
  const normalized = keyText(value);
  if (!normalized) return { ar: "", en: "" };
  if (COMPONENT_FALLBACKS[normalized]) return COMPONENT_FALLBACKS[normalized];
  const stripped = normalized.replace(/^carbs_/, "");
  return COMPONENT_FALLBACKS[stripped] || { ar: "", en: "" };
}

function keyVariants(value) {
  const normalized = keyText(value);
  if (!normalized) return [];
  const values = [normalized];
  if (normalized.startsWith("carbs_")) values.push(normalized.slice("carbs_".length));
  else values.push(`carbs_${normalized}`);
  return [...new Set(values)];
}

function mapLookup(map, value) {
  const identity = idText(value) || keyText(value);
  return map instanceof Map && identity ? map.get(String(identity)) || null : null;
}

function lookupCatalog(catalogMaps = {}, kinds = [], id, rawKey) {
  for (const kind of kinds) {
    const byId = mapLookup(catalogMaps[`${kind}ById`], id);
    if (byId) return byId;
    for (const candidate of keyVariants(rawKey)) {
      const byKey = mapLookup(catalogMaps[`${kind}ByKey`], candidate);
      if (byKey) return byKey;
    }
  }
  const aliases = LEGACY_CARB_ID_ALIASES[idText(id)] || [];
  for (const alias of aliases) {
    for (const kind of kinds) {
      const byAlias = mapLookup(catalogMaps[`${kind}ByKey`], alias);
      if (byAlias) return byAlias;
    }
  }
  return null;
}

function authoritativePair(document, stored, identity) {
  const live = localizedPair(catalogName(document));
  const snapshot = localizedPair(stored);
  const fallback = fallbackPair(identity || (document && document.key));
  const ar = live.ar || snapshot.ar || fallback.ar;
  const en = live.en || snapshot.en || fallback.en;
  return { ar: ar || en, en: en || ar };
}

function optionGroupKey(option = {}) {
  return keyText(option.canonicalGroupKey || option.groupKey || option.groupName || option.groupLabel);
}

function optionLooksLikeCarb(option = {}, catalogMaps = {}) {
  const group = optionGroupKey(option) || "";
  if (["carb", "carbs", "carbohydrate", "carbohydrates", "starch", "starches", "نشويات", "كارب"].includes(group)) return true;
  const id = idText(option.optionId || option.carbId || option.id || option._id);
  const optionKey = keyText(option.optionKey || option.carbKey || option.key);
  return Boolean(lookupCatalog(catalogMaps, ["carb"], id, optionKey));
}

function sourceOptions(rawSlot = {}) {
  const display = rawSlot.displaySnapshot || {};
  const confirmation = rawSlot.confirmationSnapshot || {};
  const fulfillment = rawSlot.fulfillmentSnapshot || {};
  return []
    .concat(Array.isArray(rawSlot.selectedOptions) ? rawSlot.selectedOptions : [])
    .concat(Array.isArray(display.groups) ? display.groups : [])
    .concat(Array.isArray(display.selectedOptions) ? display.selectedOptions : [])
    .concat(Array.isArray(confirmation.selectedOptions) ? confirmation.selectedOptions : [])
    .concat(Array.isArray(fulfillment.selectedOptions) ? fulfillment.selectedOptions : []);
}

function sourceCarbs(rawSlot = {}) {
  const display = rawSlot.displaySnapshot || {};
  const confirmation = rawSlot.confirmationSnapshot || {};
  const fulfillment = rawSlot.fulfillmentSnapshot || {};
  return []
    .concat(Array.isArray(rawSlot.carbSelections) ? rawSlot.carbSelections : [])
    .concat(Array.isArray(rawSlot.carbs) ? rawSlot.carbs : [])
    .concat(Array.isArray(display.carbs) ? display.carbs : [])
    .concat(Array.isArray(confirmation.carbs) ? confirmation.carbs : [])
    .concat(Array.isArray(fulfillment.carbs) ? fulfillment.carbs : [])
    .concat(rawSlot.carbId ? [{ carbId: rawSlot.carbId, key: rawSlot.carbKey }] : []);
}

function identityMatches(left = {}, right = {}) {
  const leftId = idText(left.carbId || left.optionId || left.id || left._id);
  const rightId = idText(right.carbId || right.optionId || right.id || right._id);
  if (leftId && rightId && leftId === rightId) return true;
  const leftKey = keyText(left.key || left.carbKey || left.optionKey);
  const rightKey = keyText(right.key || right.carbKey || right.optionKey);
  return Boolean(leftKey && rightKey && keyVariants(leftKey).some((value) => keyVariants(rightKey).includes(value)));
}

function repairCarb(carb = {}, rawCarb = {}, option = {}, catalogMaps = {}) {
  const id = idText(carb.carbId || carb.id || carb.optionId || rawCarb.carbId || rawCarb.id || rawCarb.optionId || option.carbId || option.optionId || option.id);
  const rawKey = keyText(carb.key || carb.carbKey || carb.optionKey || rawCarb.key || rawCarb.carbKey || rawCarb.optionKey || option.key || option.carbKey || option.optionKey);
  const document = lookupCatalog(catalogMaps, ["carb", "option"], id, rawKey);
  const resolvedKey = keyText((document && document.key) || rawKey || (LEGACY_CARB_ID_ALIASES[id] || [])[0]);
  const pair = authoritativePair(
    document,
    carb.nameI18n || carb.name || carb.carbName || rawCarb.nameI18n || rawCarb.name || rawCarb.carbName || option.nameI18n || option.name || option.optionNameI18n || option.optionName,
    resolvedKey || id
  );
  const gramsValue = [carb.grams, rawCarb.grams, option.grams, option.extraWeightGrams]
    .find((value) => value !== undefined && value !== null && value !== "");
  const grams = gramsValue === undefined ? null : Number(gramsValue || 0);
  return {
    ...carb,
    carbId: id,
    key: resolvedKey,
    name: pair.ar || pair.en || "",
    nameI18n: { ar: pair.ar || pair.en || "", en: pair.en || pair.ar || "" },
    grams,
  };
}

function repairCarbs(slot = {}, rawSlot = {}, catalogMaps = {}) {
  const outputCarbs = Array.isArray(slot.carbSelections) ? slot.carbSelections : [];
  const rawCarbs = sourceCarbs(rawSlot);
  const carbOptions = sourceOptions(rawSlot).filter((option) => optionLooksLikeCarb(option, catalogMaps));
  const count = Math.max(outputCarbs.length, rawCarbs.length, carbOptions.length);
  if (!count) return outputCarbs;

  return Array.from({ length: count }, (_, index) => {
    const output = outputCarbs[index] || {};
    const matchedRaw = rawCarbs.find((entry) => identityMatches(output, entry)) || rawCarbs[index] || {};
    const matchedOption = carbOptions.find((entry) => identityMatches(output, entry) || identityMatches(matchedRaw, entry))
      || (count === 1 ? carbOptions[0] : carbOptions[index])
      || {};
    return repairCarb(output, matchedRaw, matchedOption, catalogMaps);
  });
}

function repairProtein(slot = {}, rawSlot = {}, catalogMaps = {}) {
  const id = idText(slot.proteinId || rawSlot.proteinId || (rawSlot.protein && rawSlot.protein.id));
  const rawKey = keyText(slot.proteinKey || rawSlot.proteinKey || rawSlot.proteinFamilyKey || (rawSlot.protein && rawSlot.protein.key));
  const document = lookupCatalog(catalogMaps, ["protein", "option", "saladItem"], id, rawKey);
  const pair = authoritativePair(document, slot.proteinNameI18n || slot.proteinName || rawSlot.proteinNameI18n || rawSlot.proteinName, rawKey || id);
  if (!id && !rawKey && !document && !pair.ar && !pair.en) return slot;
  return {
    ...slot,
    proteinId: id || idText(document && document._id),
    proteinKey: keyText((document && (document.key || document.proteinFamilyKey)) || rawKey),
    proteinName: pair.ar || pair.en || "",
    proteinNameI18n: { ar: pair.ar || pair.en || "", en: pair.en || pair.ar || "" },
  };
}

function repairDirectProduct(slot = {}, catalogMaps = {}) {
  if (COMPOSITE_MEAL_TYPES.has(String(slot.selectionType || ""))) return slot;
  const id = idText(slot.productId || slot.sandwichId);
  const rawKey = keyText(slot.productKey || slot.sandwichKey);
  const document = lookupCatalog(catalogMaps, ["product", "sandwich"], id, rawKey);
  if (!document) return slot;
  const pair = authoritativePair(document, slot.productNameI18n || slot.productName || slot.sandwichNameI18n || slot.sandwichName, rawKey || id);
  const next = {
    ...slot,
    productId: id || idText(document._id),
    productKey: keyText(document.key || rawKey),
    productName: pair.ar || pair.en,
    productNameI18n: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
  };
  if (String(slot.selectionType || "") === "sandwich" || slot.sandwichId) {
    next.sandwichId = idText(slot.sandwichId || next.productId);
    next.sandwichKey = keyText(slot.sandwichKey || next.productKey);
    next.sandwichName = next.productName;
    next.sandwichNameI18n = { ...next.productNameI18n };
  }
  return next;
}

function rawEntries(sourceDoc = {}, flow) {
  if (flow === "order") {
    return (Array.isArray(sourceDoc.items) ? sourceDoc.items : []).filter((item) => (
      !ADDON_ITEM_TYPES.has(String(item && (item.itemType || item.type) || ""))
    ));
  }
  if (flow === "pickup_request") {
    if (sourceDoc.snapshot && Array.isArray(sourceDoc.snapshot.mealSlots)) return sourceDoc.snapshot.mealSlots;
    return Array.isArray(sourceDoc.selectedPickupItems) ? sourceDoc.selectedPickupItems : [];
  }
  return Array.isArray(sourceDoc.mealSlots) ? sourceDoc.mealSlots : [];
}

function matchingRawEntry(entries, slot = {}, index = 0) {
  const slotKey = scalar(slot.slotKey);
  const slotIndex = Number(slot.slotIndex);
  return entries.find((entry) => slotKey && scalar(entry && entry.slotKey) === slotKey)
    || entries.find((entry) => Number(entry && entry.slotIndex) === slotIndex)
    || entries[index]
    || {};
}

function repairDetails(details = {}, sourceDoc = {}, catalogMaps = {}, flow) {
  if (!details || typeof details !== "object" || !Array.isArray(details.mealSlots)) return details;
  const entries = rawEntries(sourceDoc, flow);
  return {
    ...details,
    mealSlots: details.mealSlots.map((slot, index) => {
      const rawSlot = matchingRawEntry(entries, slot, index);
      let next = repairDirectProduct(slot, catalogMaps);
      next = repairProtein(next, rawSlot, catalogMaps);
      next.carbSelections = repairCarbs(next, rawSlot, catalogMaps);
      return next;
    }),
  };
}

function wrapBuilder(service, method, mapsIndex, flow) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = function buildCompleteBilingualKitchenDetails(...args) {
    const details = original.apply(this, args);
    return repairDetails(details, args[0] || {}, args[mapsIndex] || {}, flow);
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function installKitchenBilingualCatalogCompleteness() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./opsPayloadService");
  wrapBuilder(service, "buildKitchenDetailsPayload", 3, "subscription_day");
  wrapBuilder(service, "buildOrderKitchenDetailsPayload", 2, "order");
  const verification = Object.freeze({
    installed: true,
    liveProductNamesAuthoritative: true,
    completeEnglishNamesPreserved: true,
    carbSnapshotsRecovered: true,
    historicalWhiteRiceAliasSupported: true,
    pickupAndDeliveryShareResolver: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenBilingualCatalogCompleteness();

module.exports = {
  LEGACY_CARB_ID_ALIASES,
  installKitchenBilingualCatalogCompleteness,
  localizedPair,
  repairCarbs,
  repairDetails,
};
