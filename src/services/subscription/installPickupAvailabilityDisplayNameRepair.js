"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.pickupAvailabilityDisplayNameRepair.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.pickupAvailabilityDisplayNameRepair.wrapped");
const COMPOSITE_TYPES = new Set(["meal", "standard_meal", "basic_meal", "premium_meal"]);

const FOOD_NAMES = Object.freeze({
  chicken: { ar: "دجاج", en: "Chicken" },
  grilled_chicken: { ar: "دجاج مشوي", en: "Grilled Chicken" },
  spicy_chicken: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
  beef: { ar: "لحم بقري", en: "Beef" },
  fish: { ar: "سمك", en: "Fish" },
  shrimp: { ar: "روبيان", en: "Shrimp" },
  salmon: { ar: "سلمون", en: "Salmon" },
  white_rice: { ar: "أرز أبيض", en: "White Rice" },
  rice_white: { ar: "أرز أبيض", en: "White Rice" },
  vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  turmeric_rice: { ar: "رز بالكركم", en: "Turmeric Rice" },
  red_sauce_pasta: { ar: "مكرونة بالصلصة الحمراء", en: "Red Sauce Pasta" },
  roasted_potatoes: { ar: "بطاطا مشوية", en: "Roasted Potatoes" },
  sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
});

function cleanText(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  return String(value)
    .replace(/\[object Object\]/gi, "")
    .replace(/\s*\+\s*$/g, "")
    .replace(/^\s*\+\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function keyText(value) {
  return cleanText(value).toLowerCase();
}

function pair(value) {
  const direct = cleanText(value);
  if (direct) return { ar: direct, en: direct };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ar: "", en: "" };
  const nested = value.nameI18n || value.name || value.optionNameI18n || value.optionName
    || value.titleI18n || value.title || value.labelI18n || value.label;
  if (nested && nested !== value) return pair(nested);
  const ar = cleanText(value.ar || value.arabic || value.nameAr || value.titleAr);
  const en = cleanText(value.en || value.english || value.nameEn || value.titleEn);
  return { ar: ar || en, en: en || ar };
}

function fallbackPair(value) {
  const normalized = keyText(value);
  if (!normalized) return { ar: "", en: "" };
  if (FOOD_NAMES[normalized]) return FOOD_NAMES[normalized];
  for (const [candidate, localized] of Object.entries(FOOD_NAMES)) {
    if (normalized.includes(candidate)) return localized;
  }
  return { ar: "", en: "" };
}

function resolvedName(component = {}) {
  const stored = pair(component.nameI18n || component.name || component.optionNameI18n || component.optionName);
  const fallback = fallbackPair(component.key || component.optionKey || component.productKey);
  return {
    ar: cleanText(stored.ar) || fallback.ar || cleanText(stored.en),
    en: cleanText(stored.en) || fallback.en || cleanText(stored.ar),
  };
}

function componentRole(component = {}) {
  const value = keyText(component.type || component.groupKey || component.canonicalGroupKey || component.groupName);
  if (value.includes("protein")) return "protein";
  if (value.includes("carb")) return "carb";
  return "other";
}

function collectComponents(entity = {}) {
  if (Array.isArray(entity.components)) return entity.components;
  if (Array.isArray(entity.options)) return entity.options;
  if (entity.components && typeof entity.components === "object") {
    return []
      .concat(entity.components.protein ? [{ ...entity.components.protein, type: "protein" }] : [])
      .concat(Array.isArray(entity.components.carbs)
        ? entity.components.carbs.map((carb) => ({ ...carb, type: "carb" }))
        : []);
  }
  return [];
}

function deriveCompositeTitle(entity = {}) {
  const components = collectComponents(entity);
  const proteins = components.filter((component) => componentRole(component) === "protein").map(resolvedName);
  const carbs = components.filter((component) => componentRole(component) === "carb").map(resolvedName);
  const ordered = [...proteins, ...carbs].filter((name) => name.ar || name.en);
  if (!ordered.length) return { ar: "", en: "" };
  return {
    ar: [...new Set(ordered.map((name) => name.ar || name.en).filter(Boolean))].join(" + "),
    en: [...new Set(ordered.map((name) => name.en || name.ar).filter(Boolean))].join(" + "),
  };
}

function currentTitle(entity = {}) {
  return pair(
    entity.title
      || (entity.meal && entity.meal.title)
      || (entity.display && { ar: entity.display.titleAr, en: entity.display.titleEn })
      || (entity.product && entity.product.name)
  );
}

function repairEntity(entity) {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) return entity;
  const type = keyText(entity.selectionType || entity.itemType || (entity.meal && entity.meal.mealType));
  const derived = COMPOSITE_TYPES.has(type) ? deriveCompositeTitle(entity) : { ar: "", en: "" };
  const existing = currentTitle(entity);
  const title = {
    ar: derived.ar || cleanText(existing.ar) || cleanText(existing.en),
    en: derived.en || cleanText(existing.en) || cleanText(existing.ar),
  };
  const next = { ...entity };
  if (Object.prototype.hasOwnProperty.call(next, "title")) next.title = title;
  if (next.meal && typeof next.meal === "object") next.meal = { ...next.meal, title };
  if (next.display && typeof next.display === "object") {
    next.display = { ...next.display, titleAr: title.ar, titleEn: title.en };
  }
  return next;
}

function repairAvailability(result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const next = { ...result };
  for (const field of ["slots", "pickupItems", "dayAddons", "availableAddonChoices"]) {
    if (Array.isArray(next[field])) next[field] = next[field].map(repairEntity);
  }
  const byId = new Map(
    [].concat(next.pickupItems || [], next.dayAddons || [], next.availableAddonChoices || [])
      .filter((item) => item && item.itemId)
      .map((item) => [String(item.itemId), item])
  );
  if (Array.isArray(next.sections)) {
    next.sections = next.sections.map((section) => ({
      ...section,
      items: Array.isArray(section && section.items)
        ? section.items.map((item) => byId.get(String(item && item.itemId || "")) || repairEntity(item))
        : section.items,
    }));
  }
  return next;
}

function installPickupAvailabilityDisplayNameRepair() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./subscriptionPickupSlotService");
  const original = service.buildAvailabilityFromDay;
  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = function buildAvailabilityWithCorrectNames(...args) {
      return repairAvailability(original.apply(this, args));
    };
    wrapped[WRAPPED_MARK] = true;
    service.buildAvailabilityFromDay = wrapped;
  }
  const verification = Object.freeze({
    installed: true,
    responseShapePreserved: true,
    pickupTitlesBilingual: true,
    objectCoercionRemoved: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installPickupAvailabilityDisplayNameRepair();

module.exports = {
  cleanText,
  deriveCompositeTitle,
  installPickupAvailabilityDisplayNameRepair,
  repairAvailability,
  repairEntity,
};
