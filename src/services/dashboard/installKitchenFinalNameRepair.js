"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenFinalNameRepair.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenFinalNameRepair.wrapped");
const MEAL_TYPES = new Set(["standard_meal", "premium_meal"]);

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[object Object\]/gi, "")
    .replace(/\s*\+\s*$/g, "")
    .replace(/^\s*\+\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractPair(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) return { ar: "", en: "" };
  if (["string", "number", "boolean"].includes(typeof value)) {
    const text = cleanText(String(value));
    return { ar: text, en: text };
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const pair = extractPair(entry, depth + 1);
      if (pair.ar || pair.en) return pair;
    }
    return { ar: "", en: "" };
  }
  if (typeof value !== "object") return { ar: "", en: "" };

  for (const key of ["nameI18n", "name", "optionNameI18n", "optionName", "labelI18n", "label", "titleI18n", "title", "text", "value"]) {
    if (value[key] === undefined || value[key] === value) continue;
    const nested = extractPair(value[key], depth + 1);
    if (nested.ar || nested.en) return nested;
  }

  const arPair = extractPair(value.ar, depth + 1);
  const enPair = extractPair(value.en, depth + 1);
  const ar = cleanText(arPair.ar || arPair.en || enPair.ar || enPair.en);
  const en = cleanText(enPair.en || enPair.ar || arPair.en || arPair.ar);
  return { ar, en };
}

function firstPair(...values) {
  for (const value of values) {
    const pair = extractPair(value);
    if (pair.ar || pair.en) {
      return { ar: pair.ar || pair.en, en: pair.en || pair.ar };
    }
  }
  return { ar: "", en: "" };
}

function asId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value === "object" && value._id) return asId(value._id);
  if (value && typeof value.toHexString === "function") return value.toHexString();
  if (["string", "number"].includes(typeof value)) return String(value).trim() || null;
  return null;
}

function asKey(value) {
  return ["string", "number"].includes(typeof value) && String(value).trim()
    ? String(value).trim()
    : null;
}

function mapGet(map, value) {
  const key = asId(value) || asKey(value);
  return map instanceof Map && key ? map.get(String(key)) || null : null;
}

function lookup(catalogMaps = {}, kinds = [], id, key) {
  for (const kind of kinds) {
    const document = mapGet(catalogMaps[`${kind}ById`], id)
      || mapGet(catalogMaps[`${kind}ByKey`], key);
    if (document) return document;
  }
  return null;
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), value);
}

function canonicalGroup(option = {}) {
  return String(option.canonicalGroupKey || option.groupKey || "").trim().toLowerCase();
}

function allOptions(raw = {}) {
  return []
    .concat(Array.isArray(raw.selectedOptions) ? raw.selectedOptions : [])
    .concat(raw.selections && Array.isArray(raw.selections.selectedOptions) ? raw.selections.selectedOptions : [])
    .concat(raw.displaySnapshot && Array.isArray(raw.displaySnapshot.groups) ? raw.displaySnapshot.groups : [])
    .concat(raw.confirmationSnapshot && Array.isArray(raw.confirmationSnapshot.selectedOptions) ? raw.confirmationSnapshot.selectedOptions : []);
}

function proteinOption(raw = {}) {
  return allOptions(raw).find((option) => ["protein", "proteins"].includes(canonicalGroup(option))) || {};
}

function rawEntries(sourceDoc = {}, flow) {
  if (flow === "order") return Array.isArray(sourceDoc.items) ? sourceDoc.items : [];
  if (flow === "pickup_request" && sourceDoc.snapshot && Array.isArray(sourceDoc.snapshot.mealSlots)) {
    return sourceDoc.snapshot.mealSlots;
  }
  return Array.isArray(sourceDoc.mealSlots) ? sourceDoc.mealSlots : [];
}

function matchingEntry(entries, slot = {}, index = 0) {
  const slotKey = asKey(slot.slotKey);
  const slotIndex = Number(slot.slotIndex);
  return entries.find((entry) => slotKey && String(entry && entry.slotKey || "") === slotKey)
    || entries.find((entry) => Number(entry && entry.slotIndex) === slotIndex)
    || entries[index]
    || {};
}

function resolveProtein(slot = {}, raw = {}, catalogMaps = {}) {
  const option = proteinOption(raw);
  const id = asId(
    slot.proteinId
      || raw.proteinId
      || getPath(raw, "selections.proteinId")
      || getPath(raw, "fulfillmentSnapshot.proteinId")
      || option.optionId
      || option.id
      || option._id
  );
  const key = asKey(
    slot.proteinKey
      || slot.proteinFamilyKey
      || raw.proteinKey
      || getPath(raw, "selections.proteinKey")
      || getPath(raw, "confirmationSnapshot.proteinKey")
      || getPath(raw, "fulfillmentSnapshot.proteinKey")
      || option.optionKey
      || option.key
  );
  const document = lookup(catalogMaps, ["protein", "option", "saladItem"], id, key);
  const nameI18n = firstPair(
    document && document.name,
    option.nameI18n,
    option.name,
    option.optionName,
    getPath(raw, "confirmationSnapshot.protein.name"),
    getPath(raw, "displaySnapshot.protein.name"),
    getPath(raw, "fulfillmentSnapshot.proteinName"),
    raw.proteinNameI18n,
    raw.proteinName,
    slot.proteinNameI18n,
    slot.proteinName,
    key
  );
  return {
    id,
    key: key || asKey(document && (document.key || document.proteinFamilyKey)),
    name: nameI18n.ar,
    nameI18n,
  };
}

function rawCarbs(raw = {}) {
  if (raw.selections && Array.isArray(raw.selections.carbs)) return raw.selections.carbs;
  if (Array.isArray(raw.carbSelections)) return raw.carbSelections;
  if (Array.isArray(raw.carbs)) return raw.carbs;
  return raw.carbId ? [{ carbId: raw.carbId, key: raw.carbKey, grams: raw.carbGrams }] : [];
}

function resolveCarb(carb = {}, rawCarb = {}, catalogMaps = {}) {
  const id = asId(carb.carbId || carb.id || rawCarb.carbId || rawCarb.optionId || rawCarb.id || rawCarb._id);
  const key = asKey(carb.key || carb.carbKey || rawCarb.key || rawCarb.optionKey || rawCarb.carbKey);
  const document = lookup(catalogMaps, ["carb", "option"], id, key);
  const nameI18n = firstPair(
    document && document.name,
    rawCarb.nameI18n,
    rawCarb.name,
    rawCarb.carbName,
    rawCarb.optionName,
    carb.nameI18n,
    carb.name,
    carb.carbName,
    key
  );
  return {
    ...carb,
    carbId: id,
    id,
    key: key || asKey(document && document.key),
    name: nameI18n.ar,
    nameI18n,
    grams: carb.grams === undefined || carb.grams === null
      ? (rawCarb.grams === undefined || rawCarb.grams === null ? null : Number(rawCarb.grams || 0))
      : Number(carb.grams || 0),
    quantity: Math.max(1, Number(carb.quantity || rawCarb.quantity || rawCarb.qty || 1)),
  };
}

function mealTitle(protein, carbs, fallback = {}) {
  const ar = [protein.nameI18n.ar, ...carbs.map((carb) => carb.nameI18n.ar)].filter(Boolean).join(" + ");
  const en = [protein.nameI18n.en, ...carbs.map((carb) => carb.nameI18n.en)].filter(Boolean).join(" + ");
  return firstPair({ ar, en }, fallback, "وجبة");
}

function gramText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? ` - ${Math.round(number)} جم` : "";
}

function repairCard(card = {}, slot = {}, protein, carbs) {
  if (!MEAL_TYPES.has(String(card.type || slot.selectionType || ""))) return card;
  const titleI18n = mealTitle(protein, carbs, card.titleI18n || card.title);
  const components = card.components && typeof card.components === "object" ? card.components : {};
  const product = components.product && (components.product.id || components.product.key)
    ? components.product
    : null;
  const lines = [];
  if (protein.name) lines.push(`البروتين المطلوب: ${protein.name}${gramText(slot.proteinGrams || (components.protein && components.protein.grams))}`);
  carbs.forEach((carb, index) => {
    const prefix = carbs.length > 1 ? `الكارب ${index + 1} من ${carbs.length}` : "الكارب";
    lines.push(`${prefix}: ${carb.name || "كارب"}${gramText(carb.grams)}`);
  });
  return {
    ...card,
    title: titleI18n.ar,
    titleI18n,
    lines,
    components: {
      ...components,
      product,
      protein: protein.id || protein.key || protein.name
        ? {
          ...(components.protein || {}),
          id: protein.id,
          key: protein.key,
          name: protein.name,
          nameI18n: protein.nameI18n,
          grams: Number(slot.proteinGrams || (components.protein && components.protein.grams) || 0) || null,
          quantity: 1,
        }
        : null,
      carbs: carbs.map((carb) => ({
        id: carb.id,
        key: carb.key,
        name: carb.name,
        nameI18n: carb.nameI18n,
        grams: carb.grams,
        quantity: carb.quantity,
      })),
    },
  };
}

function repairMappedDto(dto, sourceDoc = {}, catalogMaps = {}, flow = "subscription_day") {
  if (!dto || typeof dto !== "object") return dto;
  const details = dto.kitchenDetails && typeof dto.kitchenDetails === "object" ? dto.kitchenDetails : null;
  if (!details || !Array.isArray(details.mealSlots)) return dto;

  const entries = rawEntries(sourceDoc, flow);
  const repairedSlots = details.mealSlots.map((slot, index) => {
    const raw = matchingEntry(entries, slot, index);
    const protein = resolveProtein(slot, raw, catalogMaps);
    const rawCarbValues = rawCarbs(raw);
    const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb, carbIndex) => {
      const id = asId(carb.carbId || carb.id);
      const matched = rawCarbValues.find((entry) => id && asId(entry && (entry.carbId || entry.id || entry.optionId)) === id)
        || rawCarbValues[carbIndex]
        || {};
      return resolveCarb(carb, matched, catalogMaps);
    });
    return {
      ...slot,
      proteinId: protein.id,
      proteinKey: protein.key,
      proteinName: protein.name,
      proteinNameI18n: protein.nameI18n,
      carbSelections: carbs,
    };
  });

  dto.kitchenDetails = { ...details, mealSlots: repairedSlots };
  if (Array.isArray(dto.kitchenCards)) {
    dto.kitchenCards = dto.kitchenCards.map((card, index) => {
      const slot = repairedSlots[index] || {};
      return repairCard(card, slot, {
        id: slot.proteinId,
        key: slot.proteinKey,
        name: slot.proteinName,
        nameI18n: firstPair(slot.proteinNameI18n, slot.proteinName),
      }, Array.isArray(slot.carbSelections) ? slot.carbSelections : []);
    });
  }
  if (dto.kitchen && Array.isArray(dto.kitchen.cards)) {
    dto.kitchen = {
      ...dto.kitchen,
      cards: dto.kitchen.cards.map((card, index) => {
        const slot = repairedSlots[index] || {};
        return repairCard(card, slot, {
          id: slot.proteinId,
          key: slot.proteinKey,
          name: slot.proteinName,
          nameI18n: firstPair(slot.proteinNameI18n, slot.proteinName),
        }, Array.isArray(slot.carbSelections) ? slot.carbSelections : []);
      }),
    };
  }
  return dto;
}

function mapperCatalogMaps(flow, args) {
  return flow === "order" ? args[5] || {} : (flow === "pickup_request" ? args[5] || {} : args[6] || {});
}

function wrapMapper(service, method, flow) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = function finalKitchenNameMapper(...args) {
    const dto = original.apply(this, args);
    return repairMappedDto(dto, args[0] || {}, mapperCatalogMaps(flow, args), flow);
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function installKitchenFinalNameRepair() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./dashboardDtoService");
  wrapMapper(service, "mapSubscriptionDayToDTO", "subscription_day");
  wrapMapper(service, "mapOrderToDTO", "order");
  wrapMapper(service, "mapSubscriptionPickupRequestToDTO", "pickup_request");
  const verification = Object.freeze({ installed: true, finalDtoNamesRepaired: true });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenFinalNameRepair();

module.exports = {
  cleanText,
  extractPair,
  installKitchenFinalNameRepair,
  repairMappedDto,
};
