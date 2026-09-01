"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.pickupAvailabilityNameCompatibility.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.pickupAvailabilityNameCompatibility.wrapped");
const COMPOSITE_TYPES = new Set(["standard_meal", "premium_meal", "basic_meal"]);

const {
  LEGACY_CARB_ID_ALIASES,
  localizedPair,
} = require("./dashboard/installKitchenBilingualCatalogCompleteness");
const {
  normalizeAvailability,
} = require("../utils/pickupProductNameResponse");

const FALLBACK_NAMES = Object.freeze({
  chicken: { ar: "دجاج", en: "Chicken" },
  grilled_chicken: { ar: "دجاج مشوي", en: "Grilled Chicken" },
  spicy_chicken: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
  beef: { ar: "لحم بقري", en: "Beef" },
  fish: { ar: "سمك", en: "Fish" },
  salmon: { ar: "سلمون", en: "Salmon" },
  shrimp: { ar: "روبيان", en: "Shrimp" },
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
  roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  carbs_roasted_potatoes: { ar: "بطاطس مشوية", en: "Roasted Potatoes" },
  sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
  carbs_sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
});

function scalar(value) {
  return ["string", "number", "boolean"].includes(typeof value)
    ? String(value).trim()
    : "";
}

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try {
      return String(value.toHexString()).trim() || null;
    } catch (_err) {
      return null;
    }
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

function pair(value) {
  const resolved = localizedPair(value);
  const ar = scalar(resolved && resolved.ar);
  const en = scalar(resolved && resolved.en);
  return { ar: ar || en, en: en || ar };
}

function fallbackPair(value) {
  const normalized = keyText(value);
  if (!normalized) return { ar: "", en: "" };
  if (FALLBACK_NAMES[normalized]) return FALLBACK_NAMES[normalized];
  const stripped = normalized.replace(/^carbs_/, "");
  return FALLBACK_NAMES[stripped] || { ar: "", en: "" };
}

function mapValue(map, value) {
  const identity = idText(value) || keyText(value);
  return map instanceof Map && identity ? map.get(String(identity)) || null : null;
}

function keyVariants(value) {
  const normalized = keyText(value);
  if (!normalized) return [];
  return [...new Set([
    normalized,
    normalized.startsWith("carbs_") ? normalized.slice("carbs_".length) : `carbs_${normalized}`,
  ])];
}

function lookupCatalog(catalogMaps = {}, kinds = [], id, rawKey) {
  for (const kind of kinds) {
    const byId = mapValue(catalogMaps[`${kind}ById`], id);
    if (byId) return byId;
    for (const candidate of keyVariants(rawKey)) {
      const byKey = mapValue(catalogMaps[`${kind}ByKey`], candidate);
      if (byKey) return byKey;
    }
  }
  const aliases = LEGACY_CARB_ID_ALIASES[idText(id)] || [];
  for (const alias of aliases) {
    for (const kind of kinds) {
      const byAlias = mapValue(catalogMaps[`${kind}ByKey`], alias);
      if (byAlias) return byAlias;
    }
  }
  return null;
}

function authoritativePair(document, stored, identity) {
  const live = pair(document && (document.nameI18n || document.name || document.titleI18n || document.title));
  const snapshot = pair(stored);
  const fallback = fallbackPair(identity || (document && document.key));
  const ar = live.ar || snapshot.ar || fallback.ar;
  const en = live.en || snapshot.en || fallback.en;
  return { ar: ar || en || "", en: en || ar || "" };
}

function composePair(proteinName, carbs = []) {
  const protein = pair(proteinName);
  const carbPairs = (Array.isArray(carbs) ? carbs : []).map((carb) => pair(carb && (carb.nameI18n || carb.name)));
  const rows = [protein, ...carbPairs].filter((row) => row.ar || row.en);
  return {
    ar: rows.map((row) => row.ar || row.en).filter(Boolean).join(" + "),
    en: rows.map((row) => row.en || row.ar).filter(Boolean).join(" + "),
  };
}

function repairCarb(carb = {}, catalogMaps = {}) {
  const id = idText(carb.carbId || carb.optionId || carb.id || carb._id);
  const rawKey = keyText(carb.key || carb.carbKey || carb.optionKey);
  const document = lookupCatalog(catalogMaps, ["carb", "option"], id, rawKey);
  const aliasKey = (LEGACY_CARB_ID_ALIASES[id] || [])[0] || null;
  const resolvedKey = keyText((document && document.key) || rawKey || aliasKey);
  const name = authoritativePair(
    document,
    carb.nameI18n || carb.name || carb.carbName || carb.optionNameI18n || carb.optionName,
    resolvedKey || id
  );
  return {
    ...carb,
    carbId: id,
    key: resolvedKey,
    name: name.ar || name.en || "",
    nameI18n: name,
  };
}

function repairSelectedOption(option = {}, catalogMaps = {}) {
  if (!option || typeof option !== "object" || Array.isArray(option)) return option;
  const id = idText(option.optionId || option.carbId || option.id || option._id);
  const rawKey = keyText(option.optionKey || option.carbKey || option.key);
  const groupKey = keyText(option.canonicalGroupKey || option.groupKey || option.groupName || option.groupLabel);
  const isCarb = Boolean(
    ["carb", "carbs", "carbohydrate", "carbohydrates", "starch", "starches", "نشويات", "كارب"].includes(groupKey)
      || lookupCatalog(catalogMaps, ["carb"], id, rawKey)
  );
  const kinds = isCarb ? ["carb", "option"] : ["protein", "option", "saladItem"];
  const document = lookupCatalog(catalogMaps, kinds, id, rawKey);
  const aliasKey = isCarb ? (LEGACY_CARB_ID_ALIASES[id] || [])[0] : null;
  const resolvedKey = keyText((document && document.key) || rawKey || aliasKey);
  const name = authoritativePair(
    document,
    option.nameI18n || option.name || option.optionNameI18n || option.optionName || option.label,
    resolvedKey || id
  );
  return {
    ...option,
    optionId: id,
    optionKey: resolvedKey,
    name: name.ar || name.en || "",
    nameI18n: name,
    optionName: name.ar || name.en || "",
    optionNameI18n: name,
  };
}

function repairSnapshot(snapshot, title, selectedOptions) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const product = snapshot.product && typeof snapshot.product === "object" && !Array.isArray(snapshot.product)
    ? { ...snapshot.product, name: title, nameI18n: title }
    : snapshot.product;
  return {
    ...snapshot,
    title,
    titleI18n: title,
    product,
    productName: title,
    productNameI18n: title,
    selectedOptions: Array.isArray(snapshot.selectedOptions) ? selectedOptions : snapshot.selectedOptions,
    groups: Array.isArray(snapshot.groups) ? selectedOptions : snapshot.groups,
  };
}

function repairMealSlot(slot = {}, catalogMaps = {}) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) return slot;
  const id = idText(slot.proteinId || (slot.protein && slot.protein.id));
  const rawKey = keyText(slot.proteinKey || slot.proteinFamilyKey || slot.premiumKey || (slot.protein && slot.protein.key));
  const document = lookupCatalog(catalogMaps, ["protein", "option", "saladItem"], id, rawKey);
  const proteinName = authoritativePair(
    document,
    slot.proteinNameI18n || slot.proteinName || (slot.protein && (slot.protein.nameI18n || slot.protein.name)),
    rawKey || id
  );
  const rawCarbs = Array.isArray(slot.carbSelections)
    ? slot.carbSelections
    : (Array.isArray(slot.carbs)
      ? slot.carbs
      : (slot.carbId ? [{ carbId: slot.carbId, key: slot.carbKey, grams: slot.carbGrams }] : []));
  const carbs = rawCarbs.map((carb) => repairCarb(carb, catalogMaps));
  const selectedOptions = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
    .map((option) => repairSelectedOption(option, catalogMaps));
  const composite = COMPOSITE_TYPES.has(String(slot.selectionType || ""));
  const composed = composePair(proteinName, carbs);
  const title = composite && proteinName.ar && carbs.length > 0 && composed.ar
    ? composed
    : authoritativePair(
      lookupCatalog(catalogMaps, ["product", "sandwich"], slot.productId || slot.sandwichId, slot.productKey || slot.sandwichKey),
      slot.productNameI18n || slot.productName || slot.sandwichNameI18n || slot.sandwichName,
      slot.productKey || slot.sandwichKey
    );
  const finalTitle = title.ar || title.en ? title : composed;
  return {
    ...slot,
    proteinName: proteinName.ar || proteinName.en || "",
    proteinNameI18n: proteinName,
    carbs,
    carbSelections: carbs,
    selectedOptions,
    productName: finalTitle.ar || finalTitle.en || "",
    productNameI18n: finalTitle,
    displaySnapshot: repairSnapshot(slot.displaySnapshot, finalTitle, selectedOptions),
    confirmationSnapshot: repairSnapshot(slot.confirmationSnapshot, finalTitle, selectedOptions),
    fulfillmentSnapshot: repairSnapshot(slot.fulfillmentSnapshot, finalTitle, selectedOptions),
  };
}

function repairDay(day = {}, catalogMaps = {}) {
  if (!day || typeof day !== "object" || Array.isArray(day)) return day;
  return {
    ...day,
    mealSlots: (Array.isArray(day.mealSlots) ? day.mealSlots : [])
      .map((slot) => repairMealSlot(slot, catalogMaps)),
  };
}

function componentKind(component = {}) {
  const source = [
    component.type,
    component.groupKey,
    component.canonicalGroupKey,
    component.categoryKey,
    component.groupName,
  ].map((value) => JSON.stringify(value || "").toLowerCase()).join(" ");
  if (source.includes("protein") || source.includes("بروتين")) return "protein";
  if (source.includes("carb") || source.includes("كارب") || source.includes("نشوي")) return "carb";
  return "other";
}

function composeFromEntry(entry = {}) {
  const rows = Array.isArray(entry.components)
    ? entry.components
    : (Array.isArray(entry.options) ? entry.options : []);
  const proteins = rows.filter((row) => componentKind(row) === "protein");
  const carbs = rows.filter((row) => componentKind(row) === "carb");
  if (!proteins.length || !carbs.length) return { ar: "", en: "" };
  return composePair(
    proteins[0] && (proteins[0].nameI18n || proteins[0].name),
    carbs.map((row) => ({ nameI18n: row.nameI18n || row.name }))
  );
}

function applyTitle(entry = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const selectionType = String(entry.selectionType || "");
  if (!COMPOSITE_TYPES.has(selectionType)) return entry;
  const title = composeFromEntry(entry);
  if (!title.ar && !title.en) return entry;
  entry.title = title;
  entry.titleI18n = title;
  entry.label = title.ar || title.en;
  entry.productName = title.en || title.ar;
  entry.productNameI18n = title;
  entry.display = {
    ...(entry.display || {}),
    titleAr: title.ar || title.en,
    titleEn: title.en || title.ar,
  };
  if (entry.meal && typeof entry.meal === "object") {
    entry.meal = { ...entry.meal, title };
  }
  if (entry.product && typeof entry.product === "object") {
    entry.product = { ...entry.product, name: title, nameI18n: title };
  }
  return entry;
}

function repairAvailability(availability = {}) {
  if (!availability || typeof availability !== "object" || Array.isArray(availability)) return availability;
  normalizeAvailability(availability);
  const byId = new Map();
  for (const key of ["slots", "pickupItems"]) {
    if (!Array.isArray(availability[key])) continue;
    availability[key] = availability[key].map((entry) => {
      const repaired = applyTitle(entry);
      const identity = idText(repaired && (repaired.itemId || repaired.slotId || repaired.slotKey));
      if (identity) byId.set(identity, repaired);
      return repaired;
    });
  }
  if (Array.isArray(availability.sections)) {
    availability.sections = availability.sections.map((section) => ({
      ...section,
      items: (Array.isArray(section && section.items) ? section.items : []).map((entry) => {
        const identity = idText(entry && (entry.itemId || entry.slotId || entry.slotKey));
        return (identity && byId.get(identity)) || applyTitle(entry);
      }),
    }));
  }
  return availability;
}

function installPickupAvailabilityNameCompatibility() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./subscription/subscriptionPickupSlotService");
  const original = service.buildAvailabilityFromDay;
  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = function buildNamedPickupAvailability(input = {}) {
      const catalogMaps = input && input.catalogMaps || {};
      const repairedInput = {
        ...(input || {}),
        day: repairDay(input && input.day || {}, catalogMaps),
      };
      return repairAvailability(original.call(this, repairedInput));
    };
    wrapped[WRAPPED_MARK] = true;
    service.buildAvailabilityFromDay = wrapped;
  }
  const verification = Object.freeze({
    installed: true,
    responseShapeChanged: false,
    flutterDisplayTitlesScalar: true,
    legacyCarbNamesRecovered: true,
    compositeMealNamesBilingual: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installPickupAvailabilityNameCompatibility();

module.exports = {
  applyTitle,
  installPickupAvailabilityNameCompatibility,
  repairAvailability,
  repairDay,
  repairMealSlot,
};
