"use strict";

require("./installKitchenLegacyComponentCatalogResolution");

const { extractDeclaredWeightGrams, positiveInteger } = require("../orders/preparationWeightService");

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenFinalResponsePolish.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenFinalResponsePolish.wrapped");
const BADGES = Object.freeze({
  basic_salad: "سلطة",
  premium_large_salad: "سلطة",
  sandwich: "ساندويتش",
  cold_sandwich: "ساندويتش",
  sourdough: "ساندويتش",
  carb: "كارب",
  juice: "عصير",
  drink: "مشروب",
  dessert: "حلى",
  ice_cream: "آيس كريم",
});
const CATEGORY_LABELS = Object.freeze({
  desserts: { ar: "حلويات", en: "Desserts" },
  ice_cream: { ar: "آيس كريم", en: "Ice Cream" },
  drinks: { ar: "مشروبات", en: "Drinks" },
  juices: { ar: "عصائر", en: "Juices" },
  snacks: { ar: "سناك", en: "Snacks" },
  addons: { ar: "إضافات", en: "Add-ons" },
});
const COMPONENT_NAMES = Object.freeze({
  chicken: { ar: "دجاج", en: "Chicken" },
  grilled_chicken: { ar: "دجاج مشوي", en: "Grilled Chicken" },
  spicy_chicken: { ar: "دجاج سبايسي", en: "Spicy Chicken" },
  beef: { ar: "لحم بقري", en: "Beef" },
  steak: { ar: "ستيك لحم", en: "Beef Steak" },
  shrimp: { ar: "روبيان", en: "Shrimp" },
  salmon: { ar: "سلمون", en: "Salmon" },
  fish: { ar: "سمك", en: "Fish" },
  white_rice: { ar: "أرز أبيض", en: "White Rice" },
  rice_white: { ar: "أرز أبيض", en: "White Rice" },
  vermicelli_rice: { ar: "رز بالشعيرية", en: "Vermicelli Rice" },
  turmeric_rice: { ar: "رز بالكركم", en: "Turmeric Rice" },
  red_sauce_pasta: { ar: "مكرونة بالصلصة الحمراء", en: "Red Sauce Pasta" },
  roasted_potatoes: { ar: "بطاطا مشوية", en: "Roasted Potatoes" },
  sweet_potatoes: { ar: "بطاطا حلوة", en: "Sweet Potatoes" },
});
const DEFAULT_BRANCH_NAME = Object.freeze({ ar: "الفرع الرئيسي", en: "Main Branch" });

function key(value) {
  return String(value || "").trim().toLowerCase();
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
  return String(value).trim() || null;
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/u.test(String(value || ""));
}

function scalar(value) {
  return ["string", "number", "boolean"].includes(typeof value) ? String(value).trim() : "";
}

function localizedPair(value) {
  if (value === undefined || value === null) return { ar: "", en: "" };
  const direct = scalar(value);
  if (direct) return containsArabic(direct) ? { ar: direct, en: "" } : { ar: "", en: direct };
  if (typeof value !== "object" || Array.isArray(value)) return { ar: "", en: "" };

  const nested = value.nameI18n || value.name || value.titleI18n || value.title
    || value.labelI18n || value.label || value.optionNameI18n || value.optionName;
  if (nested && nested !== value) return localizedPair(nested);

  const rawAr = scalar(value.ar);
  const rawEn = scalar(value.en);
  const ar = containsArabic(rawAr) ? rawAr : (containsArabic(rawEn) ? rawEn : "");
  const en = !containsArabic(rawEn) ? rawEn : (!containsArabic(rawAr) ? rawAr : "");
  return { ar, en };
}

function fallbackPair(value) {
  const normalized = key(value);
  if (!normalized) return { ar: "", en: "" };
  if (COMPONENT_NAMES[normalized]) return COMPONENT_NAMES[normalized];
  for (const [candidate, pair] of Object.entries(COMPONENT_NAMES)) {
    if (normalized.includes(candidate)) return pair;
  }
  return { ar: "", en: "" };
}

function normalizeFoodText(value) {
  return String(value || "")
    .replace(/\[object Object\]/gi, "")
    .replace(/ساندوتش\s+ساندويش/gu, "ساندويش")
    .replace(/ساندويتش\s+ساندويش/gu, "ساندويش")
    .replace(/ساندوتش\s+ساندويتش/gu, "ساندويتش")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function categoryForItem(item = {}) {
  const value = key(item.key);
  if (value.startsWith("desserts_")) return "desserts";
  if (value.startsWith("ice_cream_")) return "ice_cream";
  if (value.startsWith("drinks_")) return "drinks";
  if (value.startsWith("juices_")) return "juices";
  if (value.startsWith("snacks_")) return "snacks";
  return "addons";
}

function productLine(card = {}, grams) {
  const title = normalizeFoodText(card.title || (card.titleI18n && card.titleI18n.ar) || "الصنف");
  return `الصنف المطلوب: ${title}${grams ? ` - ${grams} جم` : ""}`;
}

function replaceLine(lines, prefix, value) {
  const source = Array.isArray(lines) ? [...lines] : [];
  const index = source.findIndex((line) => String(line || "").startsWith(prefix));
  if (index >= 0) source[index] = value;
  else source.unshift(value);
  return [...new Set(source.filter(Boolean).map(normalizeFoodText))];
}

function matchingSectionItem(card = {}, component = {}) {
  const componentId = idText(component.id || component._id);
  const componentKey = key(component.key);
  for (const section of Array.isArray(card.sections) ? card.sections : []) {
    for (const item of Array.isArray(section && section.items) ? section.items : []) {
      const itemId = idText(item && (item.id || item._id));
      const itemKey = key(item && item.key);
      if ((componentId && itemId === componentId) || (componentKey && itemKey === componentKey)) return item;
    }
  }
  return null;
}

function repairNamedComponent(component, source = null) {
  if (!component || typeof component !== "object" || Array.isArray(component)) return component;
  const stored = localizedPair(component.nameI18n || component.name);
  const linked = localizedPair(source && (source.nameI18n || source.name));
  const fallback = fallbackPair(component.key || (source && source.key));
  const ar = linked.ar || stored.ar || fallback.ar || stored.en || linked.en;
  const en = linked.en || fallback.en || stored.en || linked.ar || stored.ar;
  return {
    ...component,
    name: normalizeFoodText(ar || en),
    nameI18n: {
      ar: normalizeFoodText(ar || en),
      en: normalizeFoodText(en || ar),
    },
  };
}

function repairMealComponents(card = {}, components = {}) {
  const type = String(card.type || "");
  const next = { ...components };

  if (next.protein && typeof next.protein === "object") {
    next.protein = repairNamedComponent(next.protein, matchingSectionItem(card, next.protein));
  }
  if (Array.isArray(next.carbs)) {
    next.carbs = next.carbs.map((carb) => repairNamedComponent(carb, matchingSectionItem(card, carb)));
  }

  if (["standard_meal", "premium_meal"].includes(type)) {
    const proteinPair = localizedPair(next.protein && next.protein.nameI18n);
    const carbPairs = (Array.isArray(next.carbs) ? next.carbs : []).map((carb) => localizedPair(carb.nameI18n || carb.name));
    const title = {
      ar: [proteinPair.ar, ...carbPairs.map((pair) => pair.ar)].filter(Boolean).join(" + "),
      en: [proteinPair.en, ...carbPairs.map((pair) => pair.en)].filter(Boolean).join(" + "),
    };
    if (title.ar || title.en) {
      card.title = normalizeFoodText(title.ar || title.en);
      card.titleI18n = {
        ar: normalizeFoodText(title.ar || title.en),
        en: normalizeFoodText(title.en || title.ar),
      };
      if (next.product && typeof next.product === "object") {
        next.product = {
          ...next.product,
          name: card.title,
          nameI18n: { ...card.titleI18n },
        };
      }
      const lines = [];
      if (next.protein && next.protein.name) {
        lines.push(`البروتين المطلوب: ${next.protein.name}${positiveInteger(next.protein.grams) ? ` - ${positiveInteger(next.protein.grams)} جم` : ""}`);
      }
      next.carbs.forEach((carb, index) => {
        if (!carb || !carb.name) return;
        const prefix = next.carbs.length > 1 ? `الكارب ${index + 1} من ${next.carbs.length}` : "الكارب";
        lines.push(`${prefix}: ${carb.name}${positiveInteger(carb.grams) ? ` - ${positiveInteger(carb.grams)} جم` : ""}`);
      });
      if (lines.length) card.lines = lines;
    }
  }

  return next;
}

function resolveFinalProductGrams(product = {}, card = {}) {
  const current = positiveInteger(product.grams);
  const declared = extractDeclaredWeightGrams(
    product.key,
    product.nameI18n,
    product.name,
    card.titleI18n,
    card.title
  );
  if (!current) return declared;
  if (declared && current < declared) return declared;
  return current;
}

function polishCard(card = {}) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return card;
  const next = { ...card };
  const type = String(card.type || "");
  if (BADGES[type]) next.badge = BADGES[type];

  next.title = normalizeFoodText(card.title);
  if (card.titleI18n && typeof card.titleI18n === "object") {
    next.titleI18n = {
      ...card.titleI18n,
      ar: normalizeFoodText(card.titleI18n.ar || next.title),
      en: normalizeFoodText(card.titleI18n.en || card.titleI18n.ar || next.title),
    };
  }
  next.lines = Array.isArray(card.lines) ? card.lines.map(normalizeFoodText) : card.lines;

  let components = card.components && typeof card.components === "object"
    ? { ...card.components }
    : {};
  const product = components.product && typeof components.product === "object"
    ? repairNamedComponent({ ...components.product })
    : null;

  if (product) {
    product.name = normalizeFoodText(product.name);
    if (product.nameI18n) {
      product.nameI18n = {
        ...product.nameI18n,
        ar: normalizeFoodText(product.nameI18n.ar || product.name),
        en: normalizeFoodText(product.nameI18n.en || product.nameI18n.ar || product.name),
      };
    }
    const grams = type === "basic_salad" ? null : resolveFinalProductGrams(product, next);
    if (grams) {
      product.grams = grams;
      if (!["standard_meal", "premium_meal"].includes(type)) {
        next.lines = replaceLine(next.lines, "الصنف المطلوب:", productLine(next, grams));
      }
    }
    components.product = product;
  }

  components = repairMealComponents(next, components);
  next.components = components;
  return next;
}

function repairAddonItem(item = {}, addonPlanId = null) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const planId = idText(addonPlanId);
  const productId = idText(item.productId || item.id);
  if (planId && productId && planId === productId) {
    return {
      ...item,
      productId: null,
      ...(Object.prototype.hasOwnProperty.call(item, "id") ? { id: null } : {}),
      key: null,
      name: "لم يتم تحديد منتج الإضافة",
      nameI18n: { ar: "لم يتم تحديد منتج الإضافة", en: "Addon product not selected" },
    };
  }
  return repairNamedComponent(item);
}

function normalizeAddonGroups(groups = []) {
  const planned = [];
  const unplanned = new Map();

  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group || typeof group !== "object") continue;
    const items = (Array.isArray(group.items) ? group.items : []).map((item) => repairAddonItem(item, group.addonPlanId));
    if (group.addonPlanId) {
      planned.push({ ...group, items });
      continue;
    }
    for (const item of items) {
      const category = categoryForItem(item);
      if (!unplanned.has(category)) {
        const label = CATEGORY_LABELS[category] || CATEGORY_LABELS.addons;
        unplanned.set(category, {
          addonPlanId: null,
          balanceBucketId: null,
          label: label.ar,
          labelI18n: label,
          items: [],
        });
      }
      unplanned.get(category).items.push(item);
    }
  }

  return planned.concat([...unplanned.values()]);
}

function polishBranch(operation = {}) {
  const pickup = operation.pickup && typeof operation.pickup === "object"
    ? { ...operation.pickup }
    : null;
  const fulfillment = operation.fulfillment && typeof operation.fulfillment === "object"
    ? { ...operation.fulfillment }
    : null;
  const fulfillmentPickup = fulfillment && fulfillment.pickup && typeof fulfillment.pickup === "object"
    ? { ...fulfillment.pickup }
    : null;
  const branchId = (pickup && (pickup.branchId || pickup.locationId))
    || (fulfillmentPickup && (fulfillmentPickup.branchId || fulfillmentPickup.locationId));

  if (["main", "branch_1"].includes(String(branchId || ""))) {
    if (pickup) {
      pickup.branchName = { ...DEFAULT_BRANCH_NAME };
      operation.pickup = pickup;
    }
    if (fulfillmentPickup) {
      fulfillmentPickup.branchName = { ...DEFAULT_BRANCH_NAME };
      fulfillment.pickup = fulfillmentPickup;
      operation.fulfillment = fulfillment;
    }
  }
  return operation;
}

function polishOperation(operation = {}) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return operation;
  const next = { ...operation };
  if (next.entityType === "order" && next.orderNumber) next.reference = String(next.orderNumber);
  if (next.kitchen && typeof next.kitchen === "object") {
    const cards = (Array.isArray(next.kitchen.cards) ? next.kitchen.cards : []).map(polishCard);
    next.kitchen = {
      ...next.kitchen,
      cards,
      mealCount: cards.reduce((sum, card) => sum + Math.max(1, Number(card.quantity || 1)), 0),
      addonGroups: normalizeAddonGroups(next.kitchen.addonGroups),
    };
  }
  return polishBranch(next);
}

function installKitchenFinalResponsePolish() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./kitchenOperationsContractService");
  const original = service.serializeKitchenOperation;
  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = function serializePolishedKitchenOperation(...args) {
      return polishOperation(original.apply(this, args));
    };
    wrapped[WRAPPED_MARK] = true;
    service.serializeKitchenOperation = wrapped;
    service.serializeKitchenOperationsCollection = function serializePolishedKitchenCollection(data = {}, options = {}) {
      const items = (Array.isArray(data.items) ? data.items : []).map((item) => wrapped(item, options));
      return { ...data, contractVersion: "kitchen_operations.v2", count: items.length, items };
    };
  }
  const verification = Object.freeze({
    installed: true,
    finalWeightsGuarded: true,
    staleFixedWeightsCorrected: true,
    componentLocalesGuarded: true,
    duplicateSandwichNamesRemoved: true,
    addonPlanProductCollisionsRemoved: true,
    badgesLocalized: true,
    addonGroupsLocalizedAndMerged: true,
    orderReferenceCanonical: true,
    pickupBranchLocalized: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenFinalResponsePolish();

module.exports = {
  installKitchenFinalResponsePolish,
  normalizeAddonGroups,
  normalizeFoodText,
  polishCard,
  polishOperation,
  repairAddonItem,
  repairNamedComponent,
  resolveFinalProductGrams,
};
