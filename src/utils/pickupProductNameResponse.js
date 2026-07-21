"use strict";

const GENERIC_TITLES = new Set([
  "",
  "وجبة",
  "وجبة عادية",
  "وجبة قياسية",
  "وجبة مميزة",
  "سلطة مميزة",
  "سلطة كبيرة",
  "ساندويتش",
  "ساندوتش",
  "إضافة",
  "عنصر",
  "meal",
  "standard meal",
  "premium meal",
  "premium salad",
  "large salad",
  "sandwich",
  "add-on",
  "addon",
  "item",
  "unknown",
  "غير معروف",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function pair(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
    return { ar: "", en: "" };
  }
  const text = clean(value);
  return { ar: text, en: text };
}

function isGeneric(value) {
  return GENERIC_TITLES.has(clean(value).toLowerCase());
}

function isUseful(candidate) {
  const localized = pair(candidate);
  return Boolean(
    (localized.ar && !isGeneric(localized.ar))
      || (localized.en && !isGeneric(localized.en))
  );
}

function usefulPair(...values) {
  for (const value of values) {
    if (isUseful(value)) return pair(value);
  }
  return { ar: "", en: "" };
}

function componentKind(component = {}) {
  const source = [
    component.type,
    component.groupKey,
    component.canonicalGroupKey,
    component.categoryKey,
    component.groupName,
    component.groupNameI18n,
  ].map((value) => {
    const localized = pair(value);
    return `${localized.ar} ${localized.en}`.toLowerCase();
  }).join(" ");
  if (source.includes("protein") || source.includes("بروتين")) return "protein";
  if (source.includes("carb") || source.includes("كارب") || source.includes("نشوي")) return "carb";
  return "other";
}

function componentName(component = {}) {
  return usefulPair(
    component.nameI18n,
    component.name,
    component.optionName,
    component.label,
    { ar: component.nameAr, en: component.nameEn }
  );
}

function composedMealTitle(entry = {}) {
  const components = Array.isArray(entry.components)
    ? entry.components
    : (Array.isArray(entry.options)
      ? entry.options
      : (Array.isArray(entry.selectedOptions) ? entry.selectedOptions : []));
  const rows = [];
  const seen = new Set();
  for (const component of components) {
    const kind = componentKind(component);
    if (kind !== "protein" && kind !== "carb") continue;
    const localized = componentName(component);
    if (!localized.ar && !localized.en) continue;
    const key = `${localized.ar}\u0000${localized.en}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(localized);
  }
  return {
    ar: rows.map((row) => row.ar || row.en).filter(Boolean).join(" + "),
    en: rows.map((row) => row.en || row.ar).filter(Boolean).join(" + "),
  };
}

function productTitle(entry = {}) {
  return usefulPair(
    entry.product && entry.product.nameI18n,
    entry.product && entry.product.name,
    entry.productNameI18n,
    entry.sandwichNameI18n,
    entry.productName,
    entry.sandwichName
  );
}

function resolveEntryTitle(entry = {}) {
  const product = productTitle(entry);
  if (product.ar || product.en) return product;
  const current = usefulPair(
    entry.canonicalTitleI18n,
    entry.titleI18n,
    entry.title,
    entry.meal && entry.meal.title,
    entry.display && { ar: entry.display.titleAr, en: entry.display.titleEn }
  );
  if (current.ar || current.en) return current;
  return composedMealTitle(entry);
}

function applyAvailabilityEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const title = resolveEntryTitle(entry);
  if (!title.ar && !title.en) return entry;

  entry.title = title;
  entry.titleI18n = title;
  entry.titleAr = title.ar;
  entry.titleEn = title.en;
  entry.label = title.ar || title.en;
  entry.productNameI18n = title;
  entry.productName = title.en || title.ar;
  entry.canonicalTitleI18n = title;

  entry.display = entry.display && typeof entry.display === "object" && !Array.isArray(entry.display)
    ? entry.display
    : {};
  entry.display.titleAr = title.ar;
  entry.display.titleEn = title.en;

  if (entry.meal && typeof entry.meal === "object" && !Array.isArray(entry.meal)) {
    entry.meal.title = title;
  }
  return entry;
}

function normalizeAvailability(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const byId = new Map();
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      applyAvailabilityEntry(entry);
      const id = clean(entry && (entry.itemId || entry.slotId || entry.slotKey || entry.slotIndex));
      if (id) byId.set(id, entry);
    });
  };

  normalizeList(data.slots);
  normalizeList(data.pickupItems);
  normalizeList(data.dayAddons);
  normalizeList(data.availableAddonChoices);

  for (const section of Array.isArray(data.sections) ? data.sections : []) {
    if (!section || !Array.isArray(section.items)) continue;
    section.items = section.items.map((entry) => {
      const id = clean(entry && (entry.itemId || entry.slotId || entry.slotKey || entry.slotIndex));
      return (id && byId.get(id)) || applyAvailabilityEntry(entry);
    });
  }
  return data;
}

function cardProductTitle(card = {}) {
  const product = card.components && card.components.product;
  return usefulPair(
    product && product.nameI18n,
    product && product.name,
    card.productNameI18n,
    card.productName
  );
}

function applyKitchenCard(card, slot = null) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return card;
  const title = usefulPair(
    cardProductTitle(card),
    slot && productTitle(slot),
    slot && slot.canonicalTitleI18n,
    card.titleI18n,
    card.title,
    slot && composedMealTitle(slot)
  );
  if (!title.ar && !title.en) return card;
  card.title = title.ar || title.en;
  card.titleI18n = title;
  return card;
}

function normalizeOperationalItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const slots = item.kitchenDetails && Array.isArray(item.kitchenDetails.mealSlots)
    ? item.kitchenDetails.mealSlots
    : [];
  slots.forEach(applyAvailabilityEntry);

  const normalizeCards = (cards) => {
    if (!Array.isArray(cards)) return;
    cards.forEach((card, index) => applyKitchenCard(card, slots[index] || null));
  };
  normalizeCards(item.kitchenCards);
  if (item.kitchen && typeof item.kitchen === "object") normalizeCards(item.kitchen.cards);
  return item;
}

function walkOperationalPayload(value, visited = new WeakSet()) {
  if (!value || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => walkOperationalPayload(entry, visited));
    return value;
  }
  if (value.kitchen || value.kitchenDetails || value.kitchenCards) normalizeOperationalItem(value);
  Object.values(value).forEach((child) => walkOperationalPayload(child, visited));
  return value;
}

function normalizePickupProductNamesResponse(payload, requestUrl = "") {
  if (!payload || typeof payload !== "object") return payload;
  const path = String(requestUrl).split("?")[0];
  if (/^\/api\/subscriptions\/[^/]+\/pickup-availability$/.test(path)) {
    normalizeAvailability(payload.data && typeof payload.data === "object" ? payload.data : payload);
  }
  if (/^\/api\/dashboard\/ops(?:\/|$)/.test(path)) {
    walkOperationalPayload(payload);
  }
  return payload;
}

module.exports = {
  normalizeAvailability,
  normalizeOperationalItem,
  normalizePickupProductNamesResponse,
  resolveEntryTitle,
};
