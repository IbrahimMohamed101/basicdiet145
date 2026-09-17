"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.pickupAvailabilityResponseFinalRepair.installed");
const WRAP_MARK = Symbol.for("basicdiet.pickupAvailabilityResponseFinalRepair.wrapped");
const MALFORMED_TEXT = /\[object\s+(?:Object|Array)\]/i;
const GENERIC_TITLES = new Set([
  "", "وجبة", "وجبة عادية", "وجبة قياسية", "وجبة مميزة", "سلطة مميزة",
  "ساندويتش", "ساندوتش", "إضافة", "عنصر", "meal", "standard meal",
  "premium meal", "premium salad", "sandwich", "add-on", "addon", "item",
]);

const KNOWN_NAMES = Object.freeze({
  chicken: { ar: "دجاج", en: "Chicken" },
  grilled_chicken: { ar: "دجاج مشوي", en: "Grilled Chicken" },
  spicy_chicken: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
  beef: { ar: "لحم بقري", en: "Beef" },
  fish: { ar: "سمك", en: "Fish" },
  salmon: { ar: "سلمون", en: "Salmon" },
  shrimp: { ar: "روبيان", en: "Shrimp" },
  white_rice: { ar: "رز أبيض", en: "White Rice" },
  vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  yellow_rice: { ar: "رز أصفر", en: "Yellow Rice" },
  vegetable_rice: { ar: "رز بالخضار", en: "Vegetable Rice" },
  mashed_potatoes: { ar: "بطاطس مهروسة", en: "Mashed Potatoes" },
  creamy_pasta: { ar: "مكرونة بالكريمة", en: "Creamy Pasta" },
  red_sauce_pasta: { ar: "مكرونة حمراء", en: "Red Sauce Pasta" },
  mixed_vegetables: { ar: "خضار مشكل", en: "Mixed Vegetables" },
  roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
});

function scalar(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  const result = String(value).trim();
  return result && !MALFORMED_TEXT.test(result) ? result : "";
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasArabic(value) {
  return /[\u0600-\u06FF]/u.test(String(value || ""));
}

function mergePair(primary = {}, fallback = {}) {
  const primaryAr = scalar(primary.ar);
  const primaryEn = scalar(primary.en);
  const fallbackAr = scalar(fallback.ar);
  const fallbackEn = scalar(fallback.en);
  return {
    ar: (primaryAr && hasArabic(primaryAr) ? primaryAr : "")
      || (fallbackAr && hasArabic(fallbackAr) ? fallbackAr : "")
      || primaryAr || fallbackAr || primaryEn || fallbackEn,
    en: (primaryEn && !hasArabic(primaryEn) ? primaryEn : "")
      || (fallbackEn && !hasArabic(fallbackEn) ? fallbackEn : "")
      || (primaryAr && !hasArabic(primaryAr) ? primaryAr : "")
      || (fallbackAr && !hasArabic(fallbackAr) ? fallbackAr : "")
      || primaryEn || fallbackEn || primaryAr || fallbackAr,
  };
}

function localizedPair(value, depth = 0, seen = new WeakSet()) {
  if (depth > 10 || value === undefined || value === null) return { ar: "", en: "" };
  const direct = scalar(value);
  if (direct) return hasArabic(direct) ? { ar: direct, en: "" } : { ar: "", en: direct };
  if (Array.isArray(value)) {
    return value.reduce(
      (result, entry) => mergePair(result, localizedPair(entry, depth + 1, seen)),
      { ar: "", en: "" }
    );
  }
  if (typeof value !== "object" || seen.has(value)) return { ar: "", en: "" };
  seen.add(value);
  const arRaw = scalar(value.ar || value.arabic || value.nameAr || value.titleAr);
  const enRaw = scalar(value.en || value.english || value.nameEn || value.titleEn);
  let result = {
    ar: arRaw && hasArabic(arRaw) ? arRaw : (enRaw && hasArabic(enRaw) ? enRaw : ""),
    en: enRaw && !hasArabic(enRaw) ? enRaw : (arRaw && !hasArabic(arRaw) ? arRaw : ""),
  };
  for (const field of [
    "nameI18n", "titleI18n", "optionNameI18n", "labelI18n", "valueI18n",
    "name", "title", "optionName", "label", "value", "textI18n", "text",
    "localized", "i18n",
  ]) {
    if (!value[field] || value[field] === value) continue;
    result = mergePair(result, localizedPair(value[field], depth + 1, seen));
    if (result.ar && result.en) break;
  }
  seen.delete(value);
  return result;
}

function normalizedKey(value) {
  return scalar(value).toLowerCase().replace(/[\s-]+/g, "_").replace(/^carbs_/, "");
}

function isOnlyGeneric(value) {
  const localized = localizedPair(value);
  const rows = [localized.ar, localized.en].map((entry) => scalar(entry).toLowerCase()).filter(Boolean);
  return rows.length > 0 && rows.every((entry) => GENERIC_TITLES.has(entry));
}

function componentKind(component = {}) {
  const source = asRecord(component) || {};
  const text = [
    source.type, source.groupKey, source.canonicalGroupKey, source.categoryKey,
    source.groupName, source.groupNameI18n,
  ].map((entry) => JSON.stringify(entry || "")).join(" ").toLowerCase();
  if (text.includes("protein") || text.includes("بروتين")) return "protein";
  if (text.includes("carb") || text.includes("كارب") || text.includes("نشوي")) return "carb";
  return "other";
}

function knownComponentName(component = {}) {
  const source = asRecord(component) || {};
  for (const value of [source.optionKey, source.key, source.carbKey, source.proteinKey]) {
    const key = normalizedKey(value);
    if (key && KNOWN_NAMES[key]) return KNOWN_NAMES[key];
  }
  return { ar: "", en: "" };
}

function componentName(component = {}) {
  const source = asRecord(component) || {};
  const stored = localizedPair(
    source.nameI18n || source.name || source.optionNameI18n || source.optionName
      || source.labelI18n || source.label || source.valueI18n || source.value
  );
  return mergePair(knownComponentName(source), stored);
}

function composedMealTitle(entry = {}) {
  const source = asRecord(entry) || {};
  const components = Array.isArray(source.components)
    ? source.components
    : (Array.isArray(source.options)
      ? source.options
      : (Array.isArray(source.selectedOptions) ? source.selectedOptions : []));
  const rows = [];
  for (const wantedKind of ["protein", "carb"]) {
    for (const component of components) {
      if (componentKind(component) !== wantedKind) continue;
      const name = componentName(component);
      if (!name.ar && !name.en) continue;
      const identity = `${name.ar}\u0000${name.en}`;
      if (rows.some((row) => row.identity === identity)) continue;
      rows.push({ ...name, identity });
    }
  }
  return {
    ar: rows.map((row) => row.ar || row.en).filter(Boolean).join(" + "),
    en: rows.map((row) => row.en || row.ar).filter(Boolean).join(" + "),
  };
}

function isBuilderMeal(entry = {}) {
  const source = asRecord(entry) || {};
  const selectionType = normalizedKey(source.selectionType);
  const itemType = normalizedKey(source.itemType);
  return ["standard_meal", "basic_meal", "premium_meal"].includes(selectionType)
    || ["meal", "premium_meal"].includes(itemType);
}

function currentTitle(entry = {}) {
  const source = asRecord(entry) || {};
  const product = asRecord(source.product);
  const meal = asRecord(source.meal);
  const display = asRecord(source.display);
  let result = { ar: "", en: "" };
  for (const value of [
    source.canonicalTitleI18n,
    source.titleI18n,
    source.title,
    meal && meal.title,
    display && { ar: display.titleAr, en: display.titleEn },
    product && (product.nameI18n || product.name),
    source.productNameI18n,
    source.productName,
  ]) {
    const candidate = localizedPair(value);
    if ((!candidate.ar && !candidate.en) || isOnlyGeneric(candidate)) continue;
    result = mergePair(result, candidate);
    if (result.ar && result.en) break;
  }
  return result;
}

function resolveFinalTitle(entry = {}) {
  const composed = composedMealTitle(entry);
  if (isBuilderMeal(entry) && (composed.ar || composed.en)) return composed;
  const current = currentTitle(entry);
  if (current.ar || current.en) return current;
  if (composed.ar || composed.en) return composed;
  return { ar: "وجبة", en: "Meal" };
}

function repairEntry(entry) {
  const source = asRecord(entry);
  if (!source) return entry;
  const title = resolveFinalTitle(source);
  source.title = title;
  source.titleI18n = title;
  source.titleAr = title.ar;
  source.titleEn = title.en;
  source.label = title.ar || title.en;
  source.productNameI18n = title;
  source.productName = title.en || title.ar;
  source.canonicalTitleI18n = title;
  const display = asRecord(source.display) || {};
  display.titleAr = title.ar;
  display.titleEn = title.en;
  source.display = display;
  const meal = asRecord(source.meal);
  if (meal) meal.title = title;
  const product = asRecord(source.product);
  if (product) {
    product.name = title;
    product.nameI18n = title;
  }
  return source;
}

function repairAvailability(data) {
  const source = asRecord(data);
  if (!source) return data;
  const byId = new Map();
  const repairList = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((entry) => {
      const repaired = repairEntry(entry);
      const record = asRecord(repaired);
      const id = scalar(record && (record.itemId || record.slotId || record.slotKey || record.slotIndex));
      if (id) byId.set(id, repaired);
    });
  };
  repairList(source.slots);
  repairList(source.pickupItems);
  repairList(source.dayAddons);
  repairList(source.availableAddonChoices);
  for (const section of Array.isArray(source.sections) ? source.sections : []) {
    if (!section || !Array.isArray(section.items)) continue;
    section.items = section.items.map((entry) => {
      const id = scalar(entry && (entry.itemId || entry.slotId || entry.slotKey || entry.slotIndex));
      return (id && byId.get(id)) || repairEntry(entry);
    });
  }
  return source;
}

function installPickupAvailabilityResponseFinalRepair() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const responseModule = require("../utils/pickupProductNameResponse");
  const original = responseModule.normalizePickupProductNamesResponse;
  if (typeof original !== "function") {
    throw new Error("pickupProductNameResponse.normalizePickupProductNamesResponse is missing");
  }
  if (!original[WRAP_MARK]) {
    const wrapped = function pickupAvailabilityResponseFinalRepair(payload, requestUrl = "") {
      const result = original(payload, requestUrl);
      const path = String(requestUrl).split("?")[0];
      if (/^\/api\/subscriptions\/[^/]+\/pickup-availability$/.test(path)) {
        repairAvailability(asRecord(result && result.data) || result);
      }
      return result;
    };
    Object.defineProperty(wrapped, WRAP_MARK, { value: true });
    Object.defineProperty(wrapped, "__original", { value: original });
    responseModule.normalizePickupProductNamesResponse = wrapped;
  }
  const state = { installed: true, responseModule };
  globalThis[INSTALL_MARK] = state;
  return state;
}

installPickupAvailabilityResponseFinalRepair();

module.exports = {
  INSTALL_MARK,
  KNOWN_NAMES,
  WRAP_MARK,
  installPickupAvailabilityResponseFinalRepair,
  localizedPair,
  repairAvailability,
  repairEntry,
  resolveFinalTitle,
};
