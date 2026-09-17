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

function scalarText(value) {
  if (["string", "number", "boolean"].includes(typeof value)) {
    return cleanText(String(value));
  }
  return "";
}

function localizedPair(value) {
  const direct = scalarText(value);
  if (direct) return { ar: direct, en: direct };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ar: "", en: "" };
  }

  const nested = value.nameI18n || value.name || value.optionNameI18n
    || value.optionName || value.labelI18n || value.label
    || value.titleI18n || value.title;
  if (nested && nested !== value) {
    const nestedDirect = scalarText(nested);
    if (nestedDirect) return { ar: nestedDirect, en: nestedDirect };
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedAr = scalarText(nested.ar);
      const nestedEn = scalarText(nested.en);
      return {
        ar: nestedAr || nestedEn,
        en: nestedEn || nestedAr,
      };
    }
  }

  const ar = scalarText(value.ar);
  const en = scalarText(value.en);
  return {
    ar: ar || en,
    en: en || ar,
  };
}

function idText(value) {
  if (value === undefined || value === null || value === "") return null;

  let candidate = value;
  if (
    candidate
    && typeof candidate === "object"
    && candidate._id !== undefined
    && candidate._id !== null
    && candidate._id !== candidate
  ) {
    candidate = candidate._id;
  }

  if (candidate && typeof candidate.toHexString === "function") {
    try {
      const hex = candidate.toHexString();
      return scalarText(hex) || null;
    } catch (_) {
      return null;
    }
  }

  const direct = scalarText(candidate);
  if (direct) return direct;

  try {
    const converted = cleanText(String(candidate));
    return converted && converted !== "[object Object]" ? converted : null;
  } catch (_) {
    return null;
  }
}

function keyText(value) {
  return scalarText(value) || null;
}

function mapValue(map, value) {
  const key = idText(value) || keyText(value);
  if (!(map instanceof Map) || !key) return null;
  return map.get(String(key)) || null;
}

function lookupCatalog(catalogMaps = {}, kinds = [], id, key) {
  for (const kind of kinds) {
    const byId = mapValue(catalogMaps[`${kind}ById`], id);
    if (byId) return byId;
    const byKey = mapValue(catalogMaps[`${kind}ByKey`], key);
    if (byKey) return byKey;
  }
  return null;
}

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function assignExistingName(target, pair) {
  if (!target || typeof target !== "object" || (!pair.ar && !pair.en)) return target;
  const next = { ...target };
  if (hasOwn(target, "name")) next.name = pair.ar || pair.en;
  if (hasOwn(target, "nameI18n")) next.nameI18n = { ar: pair.ar || pair.en, en: pair.en || pair.ar };
  if (hasOwn(target, "optionName")) next.optionName = pair.ar || pair.en;
  if (hasOwn(target, "optionNameI18n")) next.optionNameI18n = { ar: pair.ar || pair.en, en: pair.en || pair.ar };
  if (hasOwn(target, "carbName")) next.carbName = pair.ar || pair.en;
  return next;
}

function resolveProteinPair(slot = {}, catalogMaps = {}) {
  const id = idText(slot.proteinId || (slot.protein && (slot.protein.id || slot.protein._id)));
  const key = keyText(slot.proteinKey || slot.proteinFamilyKey || (slot.protein && slot.protein.key));
  const document = lookupCatalog(catalogMaps, ["protein", "option", "saladItem"], id, key);
  const catalogName = localizedPair(document && (document.nameI18n || document.name));
  if (catalogName.ar || catalogName.en) return catalogName;
  return localizedPair(slot.proteinNameI18n || slot.proteinName);
}

function resolveCarbPair(carb = {}, catalogMaps = {}) {
  const id = idText(carb.carbId || carb.id || carb.optionId || carb._id);
  const key = keyText(carb.key || carb.carbKey || carb.optionKey);
  const document = lookupCatalog(catalogMaps, ["carb", "option"], id, key);
  const catalogName = localizedPair(document && (document.nameI18n || document.name));
  if (catalogName.ar || catalogName.en) return catalogName;
  return localizedPair(carb.nameI18n || carb.name || carb.carbName || carb.optionName);
}

function slotTitle(slot = {}) {
  const protein = localizedPair(slot.proteinNameI18n || slot.proteinName);
  const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : [])
    .map((carb) => localizedPair(carb.nameI18n || carb.name || carb.carbName || carb.optionName));
  return {
    ar: [protein.ar, ...carbs.map((carb) => carb.ar)].filter(Boolean).join(" + "),
    en: [protein.en, ...carbs.map((carb) => carb.en)].filter(Boolean).join(" + "),
  };
}

function patchSlot(slot = {}, catalogMaps = {}) {
  if (!slot || typeof slot !== "object") return slot;
  const proteinPair = resolveProteinPair(slot, catalogMaps);
  const next = { ...slot };

  if (proteinPair.ar || proteinPair.en) {
    if (hasOwn(slot, "proteinName")) next.proteinName = proteinPair.ar || proteinPair.en;
    if (hasOwn(slot, "proteinNameI18n")) {
      next.proteinNameI18n = {
        ar: proteinPair.ar || proteinPair.en,
        en: proteinPair.en || proteinPair.ar,
      };
    }
  }

  if (Array.isArray(slot.carbSelections)) {
    next.carbSelections = slot.carbSelections.map((carb) => {
      const pair = resolveCarbPair(carb, catalogMaps);
      return assignExistingName(carb, pair);
    });
  }

  if (MEAL_TYPES.has(String(slot.selectionType || ""))) {
    const title = slotTitle(next);
    if (title.ar || title.en) {
      if (hasOwn(slot, "productName")) next.productName = title.ar || title.en;
      if (hasOwn(slot, "productNameI18n")) {
        next.productNameI18n = { ar: title.ar || title.en, en: title.en || title.ar };
      }
    }
  }

  return next;
}

function gramSuffix(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? ` - ${Math.round(number)} جم` : "";
}

function repairedLines(card = {}, slot = {}) {
  if (!Array.isArray(card.lines)) return card.lines;
  const generated = [];
  const protein = localizedPair(slot.proteinNameI18n || slot.proteinName);
  const proteinGrams = slot.proteinGrams
    || (card.components && card.components.protein && card.components.protein.grams);
  if (protein.ar) generated.push(`البروتين المطلوب: ${protein.ar}${gramSuffix(proteinGrams)}`);

  const carbs = Array.isArray(slot.carbSelections) ? slot.carbSelections : [];
  carbs.forEach((carb, index) => {
    const name = localizedPair(carb.nameI18n || carb.name || carb.carbName || carb.optionName).ar;
    const prefix = carbs.length > 1 ? `الكارب ${index + 1} من ${carbs.length}` : "الكارب";
    if (name) generated.push(`${prefix}: ${name}${gramSuffix(carb.grams)}`);
  });

  if (!generated.length) return card.lines.map((line) => cleanText(String(line)));
  return card.lines.map((line, index) => generated[index] || cleanText(String(line)));
}

function patchCard(card = {}, slot = {}) {
  if (!card || typeof card !== "object") return card;
  const type = String(card.type || slot.selectionType || "");
  if (!MEAL_TYPES.has(type)) return card;

  const title = slotTitle(slot);
  const next = { ...card };
  if ((title.ar || title.en) && hasOwn(card, "title")) next.title = title.ar || title.en;
  if ((title.ar || title.en) && hasOwn(card, "titleI18n")) {
    next.titleI18n = { ar: title.ar || title.en, en: title.en || title.ar };
  }
  if (Array.isArray(card.lines)) next.lines = repairedLines(card, slot);

  if (card.components && typeof card.components === "object") {
    const components = { ...card.components };
    if (components.product && typeof components.product === "object") {
      components.product = assignExistingName(components.product, title);
    }
    if (components.protein && typeof components.protein === "object") {
      components.protein = assignExistingName(
        components.protein,
        localizedPair(slot.proteinNameI18n || slot.proteinName)
      );
    }
    if (Array.isArray(components.carbs) && Array.isArray(slot.carbSelections)) {
      components.carbs = components.carbs.map((component, index) => {
        const carb = slot.carbSelections[index] || {};
        return assignExistingName(
          component,
          localizedPair(carb.nameI18n || carb.name || carb.carbName || carb.optionName)
        );
      });
    }
    next.components = components;
  }

  return next;
}

function patchCards(cards, slots) {
  if (!Array.isArray(cards)) return cards;
  return cards.map((card, index) => patchCard(card, slots[index] || {}));
}

function repairMappedDto(dto, catalogMaps = {}) {
  if (!dto || typeof dto !== "object") return dto;
  const details = dto.kitchenDetails;
  if (!details || typeof details !== "object" || !Array.isArray(details.mealSlots)) return dto;

  const slots = details.mealSlots.map((slot) => patchSlot(slot, catalogMaps));
  dto.kitchenDetails = { ...details, mealSlots: slots };

  if (Array.isArray(dto.kitchenCards)) {
    dto.kitchenCards = patchCards(dto.kitchenCards, slots);
  }

  if (dto.kitchen && typeof dto.kitchen === "object" && Array.isArray(dto.kitchen.cards)) {
    dto.kitchen = { ...dto.kitchen, cards: patchCards(dto.kitchen.cards, slots) };
  }

  return dto;
}

function mapperCatalogMaps(flow, args) {
  if (flow === "subscription_day") return args[6] || {};
  return args[5] || {};
}

function wrapMapper(service, method, flow) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;

  const wrapped = function finalKitchenNameMapper(...args) {
    const dto = original.apply(this, args);
    return repairMappedDto(dto, mapperCatalogMaps(flow, args));
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

  const verification = Object.freeze({
    installed: true,
    namesOnly: true,
    responseShapeChanged: false,
    recursiveTraversal: false,
    existingFieldsOnly: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenFinalNameRepair();

module.exports = {
  cleanText,
  installKitchenFinalNameRepair,
  repairMappedDto,
};
