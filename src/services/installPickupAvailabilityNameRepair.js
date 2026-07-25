"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.pickupAvailabilityNameRepair.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.pickupAvailabilityNameRepair.wrapped");

const FALLBACK_NAMES = Object.freeze({
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

const NESTED_FIELDS = Object.freeze([
  "nameI18n", "name", "titleI18n", "title", "optionNameI18n",
  "optionName", "labelI18n", "label", "valueI18n", "value",
  "textI18n", "text", "localized", "i18n",
]);

function scalar(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  const text = String(value).trim();
  return text && !/\[object\s+(?:Object|Array)\]/i.test(text) ? text : "";
}

function hasArabic(value) {
  return /[\u0600-\u06FF]/u.test(String(value || ""));
}

function mergePair(primary = {}, fallback = {}) {
  const ar = scalar(primary.ar) || scalar(fallback.ar) || scalar(primary.en) || scalar(fallback.en);
  const en = scalar(primary.en) || scalar(fallback.en) || scalar(primary.ar) || scalar(fallback.ar);
  return { ar, en };
}

function localizedPair(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value === undefined || value === null) return { ar: "", en: "" };
  const direct = scalar(value);
  if (direct) return hasArabic(direct) ? { ar: direct, en: "" } : { ar: "", en: direct };
  if (Array.isArray(value)) {
    return value.reduce((result, entry) => mergePair(result, localizedPair(entry, depth + 1, seen)), { ar: "", en: "" });
  }
  if (typeof value !== "object" || seen.has(value)) return { ar: "", en: "" };
  seen.add(value);

  let result = { ar: "", en: "" };
  for (const candidate of [value.ar, value.arabic, value.nameAr, value.titleAr]) {
    const current = localizedPair(candidate, depth + 1, seen);
    const ar = scalar(current.ar) || (hasArabic(current.en) ? scalar(current.en) : "");
    if (ar) { result.ar = ar; break; }
  }
  for (const candidate of [value.en, value.english, value.nameEn, value.titleEn]) {
    const current = localizedPair(candidate, depth + 1, seen);
    const en = scalar(current.en) || (!hasArabic(current.ar) ? scalar(current.ar) : "");
    if (en) { result.en = en; break; }
  }
  for (const field of NESTED_FIELDS) {
    if (!value[field] || value[field] === value) continue;
    result = mergePair(result, localizedPair(value[field], depth + 1, seen));
    if (result.ar && result.en) break;
  }
  seen.delete(value);
  return result;
}

function idText(value) {
  if (value === undefined || value === null) return "";
  if (value && typeof value.toHexString === "function") {
    try { return scalar(value.toHexString()); } catch (_) { return ""; }
  }
  if (value && typeof value === "object") return idText(value._id || value.id);
  return scalar(value);
}

function keyText(value) {
  return scalar(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function mapGet(map, value) {
  const key = idText(value) || keyText(value);
  return map instanceof Map && key ? map.get(key) || null : null;
}

function componentKind(component = {}) {
  const text = [component.type, component.groupKey, component.canonicalGroupKey, component.groupName, component.groupNameI18n]
    .map((value) => JSON.stringify(value || "")).join(" ").toLowerCase();
  if (text.includes("protein") || text.includes("بروتين")) return "protein";
  if (text.includes("carb") || text.includes("كارب") || text.includes("نشوي")) return "carb";
  if (text.includes("addon") || text.includes("add-on") || text.includes("إضاف")) return "addon";
  return keyText(component.type) || "other";
}

function fallbackName(component = {}, document = null) {
  const values = [
    component.optionKey, component.key, component.carbKey, component.proteinKey,
    document && document.key,
  ];
  for (const value of values) {
    const key = keyText(value).replace(/^carbs_/, "");
    if (key && FALLBACK_NAMES[key]) return { ...FALLBACK_NAMES[key] };
  }
  return { ar: "", en: "" };
}

function catalogDocument(component = {}, maps = {}) {
  const kind = componentKind(component);
  const id = component.optionId || component.id || component._id || component.carbId || component.proteinId;
  const key = component.optionKey || component.key || component.carbKey || component.proteinKey;
  const sources = kind === "protein"
    ? ["option", "protein"]
    : kind === "carb"
      ? ["option", "carb"]
      : kind === "addon"
        ? ["product", "option"]
        : ["option", "product", "protein", "carb"];
  for (const source of sources) {
    const byId = mapGet(maps[`${source}ById`], id);
    if (byId) return byId;
    const byKey = mapGet(maps[`${source}ByKey`], key);
    if (byKey) return byKey;
    const normalized = keyText(key).replace(/^carbs_/, "");
    const byNormalizedKey = mapGet(maps[`${source}ByKey`], normalized);
    if (byNormalizedKey) return byNormalizedKey;
  }
  return null;
}

function repairComponent(component = {}, maps = {}) {
  if (!component || typeof component !== "object") return component;
  const document = catalogDocument(component, maps);
  const catalog = localizedPair(document && (document.nameI18n || document.name || document.titleI18n || document.title));
  const stored = localizedPair(component.nameI18n || component.name || component.optionNameI18n || component.optionName || component.label);
  const name = mergePair(mergePair(catalog, stored), fallbackName(component, document));
  const kind = componentKind(component);
  const groupFallback = kind === "protein"
    ? { ar: "البروتين", en: "Protein" }
    : kind === "carb"
      ? { ar: "الكارب", en: "Carbs" }
      : { ar: "المكونات", en: "Components" };
  const groupName = mergePair(localizedPair(component.groupNameI18n || component.groupName), groupFallback);
  return { ...component, type: kind, name, nameI18n: name, groupName, groupNameI18n: groupName };
}

function joinComponents(components, kinds) {
  const wanted = new Set(kinds);
  const rows = [];
  const seen = new Set();
  for (const component of components) {
    if (!wanted.has(componentKind(component))) continue;
    const name = localizedPair(component.nameI18n || component.name);
    if (!name.ar && !name.en) continue;
    const identity = `${name.ar}\u0000${name.en}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    rows.push(name);
  }
  return {
    ar: rows.map((row) => row.ar || row.en).filter(Boolean).join(" + "),
    en: rows.map((row) => row.en || row.ar).filter(Boolean).join(" + "),
  };
}

function itemKind(item = {}) {
  const selectionType = keyText(item.selectionType);
  if (selectionType === "full_meal_product" || selectionType === "sandwich") return "direct";
  if (selectionType === "premium_large_salad") return "large_salad";
  if (["standard_meal", "basic_meal", "premium_meal"].includes(selectionType)) return "meal";
  const itemType = keyText(item.itemType);
  if (itemType === "sandwich") return "direct";
  if (itemType === "large_salad") return "large_salad";
  if (["meal", "premium_meal"].includes(itemType)) return "meal";
  return itemType || "unknown";
}

function productCatalogPair(item = {}, maps = {}) {
  const product = item.product && typeof item.product === "object" ? item.product : {};
  const document = mapGet(maps.productById, product.id || item.productId)
    || mapGet(maps.productByKey, product.key || item.productKey)
    || mapGet(maps.sandwichById, product.id || item.productId)
    || mapGet(maps.sandwichByKey, product.key || item.productKey);
  return mergePair(
    localizedPair(document && (document.nameI18n || document.name || document.titleI18n || document.title)),
    localizedPair(product.nameI18n || product.name)
  );
}

function repairPickupItem(item = {}, maps = {}) {
  if (!item || typeof item !== "object") return item;
  const sourceComponents = Array.isArray(item.components) ? item.components : (Array.isArray(item.options) ? item.options : []);
  const components = sourceComponents.map((component) => repairComponent(component, maps));
  const existingTitle = mergePair(
    localizedPair(item.title || (item.meal && item.meal.title)),
    localizedPair(item.display && { ar: item.display.titleAr, en: item.display.titleEn })
  );
  const productTitle = productCatalogPair(item, maps);
  const composed = joinComponents(components, ["protein", "carb"]);
  const kind = itemKind(item);
  let title;
  if (kind === "meal" && (composed.ar || composed.en)) title = mergePair(composed, existingTitle);
  else if (kind === "direct") title = mergePair(productTitle, existingTitle);
  else if (kind === "large_salad") title = mergePair(existingTitle, productTitle);
  else title = mergePair(productTitle, mergePair(existingTitle, composed));
  if (!title.ar && !title.en) title = kind === "addon" ? { ar: "إضافة", en: "Add-on" } : { ar: "وجبة", en: "Meal" };

  const subtitle = mergePair(
    localizedPair(item.subtitle || (item.meal && item.meal.subtitle)),
    localizedPair(item.display && { ar: item.display.subtitleAr, en: item.display.subtitleEn })
  );
  const product = item.product && typeof item.product === "object" ? item.product : {};
  const meal = item.meal && typeof item.meal === "object" ? item.meal : {};
  const display = item.display && typeof item.display === "object" ? item.display : {};
  return {
    ...item,
    title,
    label: title.ar || title.en || scalar(item.label),
    subtitle,
    product: { ...product, name: title, nameI18n: title },
    meal: { ...meal, title, subtitle },
    components,
    options: Array.isArray(item.options) ? components : item.options,
    display: { ...display, titleAr: title.ar, titleEn: title.en, subtitleAr: subtitle.ar, subtitleEn: subtitle.en },
  };
}

function repairSlot(slot = {}, maps = {}) {
  if (!slot || typeof slot !== "object") return slot;
  const repaired = repairPickupItem({
    ...slot,
    itemType: slot.itemType || slot.selectionType,
    components: Array.isArray(slot.options) ? slot.options : slot.components,
  }, maps);
  return {
    ...slot,
    title: repaired.title,
    product: repaired.product,
    meal: repaired.meal,
    options: repaired.components,
    components: Array.isArray(slot.components) ? repaired.components : slot.components,
    display: repaired.display,
  };
}

function repairAvailability(value = {}, maps = {}) {
  if (!value || typeof value !== "object") return value;
  const pickupItems = (Array.isArray(value.pickupItems) ? value.pickupItems : []).map((item) => repairPickupItem(item, maps));
  const dayAddons = (Array.isArray(value.dayAddons) ? value.dayAddons : []).map((item) => repairPickupItem(item, maps));
  const availableAddonChoices = (Array.isArray(value.availableAddonChoices) ? value.availableAddonChoices : []).map((item) => repairPickupItem(item, maps));
  const byId = new Map([...pickupItems, ...dayAddons, ...availableAddonChoices]
    .map((item) => [idText(item && item.itemId), item]).filter(([id]) => id));
  return {
    ...value,
    slots: (Array.isArray(value.slots) ? value.slots : []).map((slot) => repairSlot(slot, maps)),
    pickupItems,
    dayAddons,
    availableAddonChoices,
    sections: (Array.isArray(value.sections) ? value.sections : []).map((section) => ({
      ...section,
      items: (Array.isArray(section.items) ? section.items : []).map((item) => byId.get(idText(item && item.itemId)) || repairPickupItem(item, maps)),
    })),
  };
}

function wrap(service, methodName, asyncMode, transform) {
  const original = service && service[methodName];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = asyncMode
    ? async function pickupAvailabilityNameRepairAsync(...args) { return transform(await original.apply(this, args), args); }
    : function pickupAvailabilityNameRepair(...args) { return transform(original.apply(this, args), args); };
  Object.defineProperty(wrapped, WRAPPED_MARK, { value: true });
  Object.defineProperty(wrapped, "__original", { value: original });
  service[methodName] = wrapped;
}

function installPickupAvailabilityNameRepair() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./subscription/subscriptionPickupSlotService");
  wrap(service, "buildAvailabilityFromDay", false, (result, args) => repairAvailability(result, args[0] && args[0].catalogMaps || {}));
  wrap(service, "assertSelectedPickupItemsAvailable", true, (result, args) => {
    if (!result || typeof result !== "object") return result;
    const maps = args[0] && args[0].catalogMaps || {};
    return {
      ...result,
      availability: repairAvailability(result.availability, maps),
      selectedPickupItems: (Array.isArray(result.selectedPickupItems) ? result.selectedPickupItems : []).map((item) => repairPickupItem(item, maps)),
    };
  });
  wrap(service, "assertSelectedSlotsAvailableForPickup", true, (result, args) => {
    if (!result || typeof result !== "object") return result;
    const maps = args[0] && args[0].catalogMaps || {};
    return {
      ...result,
      availability: repairAvailability(result.availability, maps),
      selectedSlots: (Array.isArray(result.selectedSlots) ? result.selectedSlots : []).map((slot) => repairSlot(slot, maps)),
    };
  });
  const state = { installed: true, service };
  globalThis[INSTALL_MARK] = state;
  return state;
}

installPickupAvailabilityNameRepair();

module.exports = {
  FALLBACK_NAMES,
  INSTALL_MARK,
  WRAPPED_MARK,
  installPickupAvailabilityNameRepair,
  localizedPair,
  repairAvailability,
  repairPickupItem,
  repairSlot,
};
