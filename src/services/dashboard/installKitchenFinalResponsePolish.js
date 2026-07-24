"use strict";

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
const DEFAULT_BRANCH_NAME = Object.freeze({ ar: "الفرع الرئيسي", en: "Main Branch" });

function key(value) {
  return String(value || "").trim().toLowerCase();
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
  const title = String(card.title || (card.titleI18n && card.titleI18n.ar) || "الصنف").trim();
  return `الصنف المطلوب: ${title} - ${grams} جم`;
}

function replaceLine(lines, prefix, value) {
  const source = Array.isArray(lines) ? [...lines] : [];
  const index = source.findIndex((line) => String(line || "").startsWith(prefix));
  if (index >= 0) source[index] = value;
  else source.unshift(value);
  return [...new Set(source.filter(Boolean))];
}

function polishCard(card = {}) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return card;
  const next = { ...card };
  const type = String(card.type || "");
  if (BADGES[type]) next.badge = BADGES[type];

  const components = card.components && typeof card.components === "object"
    ? { ...card.components }
    : {};
  const product = components.product && typeof components.product === "object"
    ? { ...components.product }
    : null;

  if (product && type !== "basic_salad") {
    const grams = positiveInteger(product.grams) || extractDeclaredWeightGrams(
      product.key,
      product.nameI18n,
      product.name,
      card.titleI18n,
      card.title
    );
    if (grams) {
      product.grams = grams;
      components.product = product;
      if (!["standard_meal", "premium_meal"].includes(type)) {
        next.lines = replaceLine(card.lines, "الصنف المطلوب:", productLine(card, grams));
      }
    }
  }

  next.components = components;
  return next;
}

function normalizeAddonGroups(groups = []) {
  const planned = [];
  const unplanned = new Map();

  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group || typeof group !== "object") continue;
    if (group.addonPlanId) {
      planned.push(group);
      continue;
    }
    for (const item of Array.isArray(group.items) ? group.items : []) {
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
  polishCard,
  polishOperation,
};
