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

const OPERATION_CONTAINER_KEYS = Object.freeze([
  "data",
  "item",
  "items",
  "result",
  "results",
  "operation",
  "operations",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim();
  } catch (_err) {
    return "";
  }
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pair(value) {
  const source = asRecord(value);
  if (source) {
    const nested = source.nameI18n
      || source.titleI18n
      || source.name
      || source.title
      || source.labelI18n
      || source.label;
    if (nested && nested !== source) return pair(nested);
    const ar = clean(source.ar || source.nameAr || source.titleAr || source.arabic);
    const en = clean(source.en || source.nameEn || source.titleEn || source.english);
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

function componentKind(component) {
  const sourceComponent = asRecord(component);
  if (!sourceComponent) return "other";
  const source = [
    sourceComponent.type,
    sourceComponent.groupKey,
    sourceComponent.canonicalGroupKey,
    sourceComponent.categoryKey,
    sourceComponent.groupName,
    sourceComponent.groupNameI18n,
  ].map((value) => {
    const localized = pair(value);
    return `${localized.ar} ${localized.en}`.toLowerCase();
  }).join(" ");
  if (source.includes("protein") || source.includes("بروتين")) return "protein";
  if (source.includes("carb") || source.includes("كارب") || source.includes("نشوي")) return "carb";
  return "other";
}

function componentName(component) {
  const source = asRecord(component);
  if (!source) return { ar: "", en: "" };
  return usefulPair(
    source.nameI18n,
    source.name,
    source.optionName,
    source.label,
    { ar: source.nameAr, en: source.nameEn }
  );
}

function composedMealTitle(entry = {}) {
  const source = asRecord(entry) || {};
  const components = Array.isArray(source.components)
    ? source.components
    : (Array.isArray(source.options)
      ? source.options
      : (Array.isArray(source.selectedOptions) ? source.selectedOptions : []));
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
  const source = asRecord(entry) || {};
  const product = asRecord(source.product);
  return usefulPair(
    product && product.nameI18n,
    product && product.name,
    source.productNameI18n,
    source.sandwichNameI18n,
    source.productName,
    source.sandwichName
  );
}

function resolveEntryTitle(entry = {}) {
  const source = asRecord(entry) || {};
  const product = productTitle(source);
  if (product.ar || product.en) return product;
  const meal = asRecord(source.meal);
  const display = asRecord(source.display);
  const current = usefulPair(
    source.canonicalTitleI18n,
    source.titleI18n,
    source.title,
    meal && meal.title,
    display && { ar: display.titleAr, en: display.titleEn }
  );
  if (current.ar || current.en) return current;
  return composedMealTitle(source);
}

function applyAvailabilityEntry(entry) {
  const source = asRecord(entry);
  if (!source) return entry;
  try {
    const title = resolveEntryTitle(source);
    if (!title.ar && !title.en) return entry;

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
    return source;
  } catch (_err) {
    return entry;
  }
}

function normalizeAvailability(data) {
  const source = asRecord(data);
  if (!source) return data;
  const byId = new Map();
  const normalizeList = (value) => {
    if (!Array.isArray(value)) return;
    value.forEach((entry) => {
      const normalized = applyAvailabilityEntry(entry);
      const record = asRecord(normalized);
      const id = clean(record && (record.itemId || record.slotId || record.slotKey || record.slotIndex));
      if (id) byId.set(id, normalized);
    });
  };

  normalizeList(source.slots);
  normalizeList(source.pickupItems);
  normalizeList(source.dayAddons);
  normalizeList(source.availableAddonChoices);

  for (const section of Array.isArray(source.sections) ? source.sections : []) {
    const sectionRecord = asRecord(section);
    if (!sectionRecord || !Array.isArray(sectionRecord.items)) continue;
    try {
      sectionRecord.items = sectionRecord.items.map((entry) => {
        const record = asRecord(entry);
        const id = clean(record && (record.itemId || record.slotId || record.slotKey || record.slotIndex));
        return (id && byId.get(id)) || applyAvailabilityEntry(entry);
      });
    } catch (_err) {
      // Fail open: naming must never break the client response.
    }
  }
  return source;
}

function cardProductTitle(card = {}) {
  const source = asRecord(card) || {};
  const components = asRecord(source.components);
  const product = components && asRecord(components.product);
  return usefulPair(
    product && product.nameI18n,
    product && product.name,
    source.productNameI18n,
    source.productName
  );
}

function applyKitchenCard(card, slot = null) {
  const source = asRecord(card);
  if (!source) return card;
  try {
    const slotRecord = asRecord(slot);
    const title = usefulPair(
      cardProductTitle(source),
      slotRecord && productTitle(slotRecord),
      slotRecord && slotRecord.canonicalTitleI18n,
      source.titleI18n,
      source.title,
      slotRecord && composedMealTitle(slotRecord)
    );
    if (!title.ar && !title.en) return card;
    source.title = title.ar || title.en;
    source.titleI18n = title;
    return source;
  } catch (_err) {
    return card;
  }
}

function normalizeOperationalItem(item) {
  const source = asRecord(item);
  if (!source) return item;
  try {
    const kitchenDetails = asRecord(source.kitchenDetails);
    const slots = kitchenDetails && Array.isArray(kitchenDetails.mealSlots)
      ? kitchenDetails.mealSlots
      : [];
    slots.forEach(applyAvailabilityEntry);

    const normalizeCards = (cards) => {
      if (!Array.isArray(cards)) return;
      cards.forEach((card, index) => applyKitchenCard(card, slots[index] || null));
    };
    normalizeCards(source.kitchenCards);
    const kitchen = asRecord(source.kitchen);
    if (kitchen) normalizeCards(kitchen.cards);
  } catch (_err) {
    // Fail open: the original operational item is still safe to return.
  }
  return source;
}

function looksLikeOperationalItem(value) {
  const source = asRecord(value);
  return Boolean(source && (source.kitchen || source.kitchenDetails || source.kitchenCards));
}

function normalizeOperationalPayload(payload) {
  const queue = [payload];
  const visited = new WeakSet();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((entry) => queue.push(entry));
      continue;
    }

    if (looksLikeOperationalItem(current)) normalizeOperationalItem(current);
    for (const key of OPERATION_CONTAINER_KEYS) {
      if (Object.prototype.hasOwnProperty.call(current, key)) queue.push(current[key]);
    }
  }
  return payload;
}

function normalizePickupProductNamesResponse(payload, requestUrl = "") {
  if (!payload || typeof payload !== "object") return payload;
  try {
    const path = String(requestUrl).split("?")[0];
    if (/^\/api\/subscriptions\/[^/]+\/pickup-availability$/.test(path)) {
      normalizeAvailability(asRecord(payload.data) || payload);
    }
    if (/^\/api\/dashboard\/ops(?:\/|$)/.test(path)) {
      normalizeOperationalPayload(payload);
    }
  } catch (_err) {
    // This is a response presentation fallback. It must never turn a valid API response into a 500.
  }
  return payload;
}

module.exports = {
  normalizeAvailability,
  normalizeOperationalItem,
  normalizePickupProductNamesResponse,
  resolveEntryTitle,
};
