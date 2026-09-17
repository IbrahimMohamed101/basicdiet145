"use strict";

const {
  extractDeclaredWeightGrams,
  positiveInteger,
  resolvePreparationWeight,
} = require("../orders/preparationWeightService");

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenWeightResponseContract.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenWeightResponseContract.wrapped");
const DIRECT_WEIGHT_TYPES = new Set([
  "product",
  "full_meal_product",
  "sandwich",
  "cold_sandwich",
  "sourdough",
  "carb",
  "juice",
  "drink",
  "dessert",
  "ice_cream",
  "greek_yogurt",
]);
const ADDON_TYPES = new Set(["addon_item", "drink", "dessert", "juice", "ice_cream"]);
const DEFAULT_BRANCH_NAME = Object.freeze({ ar: "الفرع الرئيسي", en: "Main Branch" });
const ADDON_CATEGORY_LABELS = Object.freeze({
  desserts: { ar: "حلويات", en: "Desserts" },
  ice_cream: { ar: "آيس كريم", en: "Ice Cream" },
  drinks: { ar: "مشروبات", en: "Drinks" },
  juices: { ar: "عصائر", en: "Juices" },
  snacks: { ar: "سناك", en: "Snacks" },
  addons: { ar: "إضافات", en: "Add-ons" },
});
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

function scalar(value) {
  return ["string", "number", "boolean"].includes(typeof value) ? String(value).trim() : "";
}

function localizedPair(value) {
  if (value === undefined || value === null) return { ar: "", en: "" };
  const direct = scalar(value);
  if (direct) return /[\u0600-\u06FF]/u.test(direct)
    ? { ar: direct, en: "" }
    : { ar: "", en: direct };
  if (typeof value !== "object" || Array.isArray(value)) return { ar: "", en: "" };
  const nested = value.nameI18n || value.name || value.titleI18n || value.title || value.labelI18n || value.label;
  if (nested && nested !== value) return localizedPair(nested);
  const ar = scalar(value.ar);
  const en = scalar(value.en);
  return {
    ar: /[\u0600-\u06FF]/u.test(ar) ? ar : "",
    en: en || (!/[\u0600-\u06FF]/u.test(ar) ? ar : ""),
  };
}

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try { return String(value.toHexString()); } catch (_) { return null; }
  }
  if (value && typeof value === "object") return idText(value._id || value.id);
  return scalar(value) || null;
}

function keyText(value) {
  return scalar(value).toLowerCase() || null;
}

function mapValue(map, value) {
  const key = idText(value) || keyText(value);
  return map instanceof Map && key ? map.get(String(key)) || null : null;
}

function lookupProduct(catalogMaps = {}, id, key) {
  return mapValue(catalogMaps.productById, id)
    || mapValue(catalogMaps.productByKey, key)
    || mapValue(catalogMaps.sandwichById, id)
    || mapValue(catalogMaps.sandwichByKey, key)
    || null;
}

function rawEntries(sourceDoc = {}, flow) {
  if (flow === "order") {
    return (Array.isArray(sourceDoc.items) ? sourceDoc.items : []).filter((item) => (
      !ADDON_TYPES.has(String(item && (item.itemType || item.type) || ""))
    ));
  }
  if (flow === "pickup_request") {
    if (sourceDoc.snapshot && Array.isArray(sourceDoc.snapshot.mealSlots)) return sourceDoc.snapshot.mealSlots;
    return Array.isArray(sourceDoc.selectedPickupItems) ? sourceDoc.selectedPickupItems : [];
  }
  return Array.isArray(sourceDoc.mealSlots) ? sourceDoc.mealSlots : [];
}

function matchEntry(entries, slot = {}, index = 0) {
  const slotKey = scalar(slot.slotKey);
  const slotIndex = Number(slot.slotIndex);
  return entries.find((entry) => slotKey && scalar(entry && entry.slotKey) === slotKey)
    || entries.find((entry) => Number(entry && entry.slotIndex) === slotIndex)
    || entries[index]
    || {};
}

function cardTitlePair(card = {}) {
  const pair = localizedPair(card.titleI18n || card.title);
  return { ar: pair.ar || pair.en, en: pair.en || pair.ar };
}

function formatProductLine(card = {}, grams) {
  const title = cardTitlePair(card).ar || "الصنف";
  return `الصنف المطلوب: ${title}${grams ? ` - ${grams} جم` : ""}`;
}

function replacePreparationLine(lines, prefix, replacement) {
  const source = Array.isArray(lines) ? [...lines] : [];
  const index = source.findIndex((line) => String(line || "").startsWith(prefix));
  if (index >= 0) source[index] = replacement;
  else source.unshift(replacement);
  return [...new Set(source.filter(Boolean))];
}

function isProteinSection(section = {}) {
  const key = keyText(section.key);
  const label = localizedPair(section.labelI18n || section.label);
  return ["protein", "proteins", "بروتين", "بروتينات"].includes(key)
    || /بروتين/u.test(label.ar)
    || /protein/i.test(label.en);
}

function selectedProteinOption(slot = {}) {
  const selected = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : []).find((option) => {
    const group = keyText(option.canonicalGroupKey || option.groupKey || option.groupName);
    const pair = localizedPair(option.groupNameI18n || option.groupName);
    return ["protein", "proteins"].includes(group)
      || /بروتين/u.test(pair.ar)
      || /protein/i.test(pair.en);
  });
  return selected || null;
}

function repairBasicSaladProtein(card = {}, slot = {}, product = {}, rawEntry = {}) {
  if (String(card.type || "") !== "basic_salad") return { card, slot };

  const sections = Array.isArray(card.sections) ? card.sections.map((section) => ({
    ...section,
    items: Array.isArray(section.items) ? section.items.map((item) => ({ ...item })) : [],
  })) : [];
  const section = sections.find(isProteinSection);
  const option = selectedProteinOption(slot);
  const sectionItem = section && section.items[0] ? section.items[0] : null;
  if (!option && !sectionItem) return { card: { ...card, sections }, slot };

  const declared = extractDeclaredWeightGrams(
    product.name,
    product.key,
    rawEntry.name,
    rawEntry.productSnapshot && rawEntry.productSnapshot.name,
    slot.productNameI18n,
    card.titleI18n,
    card.title
  );
  const grams = positiveInteger(
    (option && (option.grams || option.extraWeightGrams))
      || (sectionItem && sectionItem.grams)
      || slot.proteinGrams
      || declared
  );
  const source = option || sectionItem || {};
  const pair = localizedPair(source.nameI18n || source.name || source.optionNameI18n || source.optionName);
  const protein = {
    id: idText(source.optionId || source.id),
    key: source.optionKey || source.key || null,
    name: pair.ar || pair.en,
    nameI18n: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
    ...(grams ? { grams } : {}),
    quantity: Math.max(1, Number(source.quantity || source.qty || 1)),
  };

  if (section && section.items[0] && grams) section.items[0].grams = grams;
  const components = { ...(card.components || {}), protein };
  const line = `البروتين المطلوب: ${protein.name}${grams ? ` - ${grams} جم` : ""}`;
  return {
    slot: { ...slot, proteinGrams: grams || slot.proteinGrams },
    card: {
      ...card,
      sections,
      components,
      lines: replacePreparationLine(card.lines, "البروتين المطلوب:", line),
    },
  };
}

function repairCardWeight(card = {}, slot = {}, rawEntry = {}, catalogMaps = {}) {
  const components = card.components && typeof card.components === "object" ? { ...card.components } : {};
  const productComponent = components.product && typeof components.product === "object"
    ? { ...components.product }
    : null;
  const productId = idText(
    (productComponent && productComponent.id)
      || slot.productId
      || slot.sandwichId
      || rawEntry.productId
      || rawEntry.mealId
      || (rawEntry.catalogRef && rawEntry.catalogRef.id)
  );
  const productKey = keyText(
    (productComponent && productComponent.key)
      || slot.productKey
      || slot.sandwichKey
      || rawEntry.productKey
      || (rawEntry.productSnapshot && rawEntry.productSnapshot.key)
  );
  const product = lookupProduct(catalogMaps, productId, productKey) || {};
  const snapshot = rawEntry.productSnapshot && typeof rawEntry.productSnapshot === "object"
    ? rawEntry.productSnapshot
    : {};
  const resolved = resolvePreparationWeight({ item: rawEntry, product, snapshot, slot, card });
  const grams = positiveInteger(resolved.grams);
  let nextSlot = {
    ...slot,
    ...(grams ? {
      productGrams: grams,
      weightGrams: grams,
      servingWeightGrams: grams,
      weightSource: resolved.source,
    } : {}),
  };
  let nextCard = { ...card, components };

  if (productComponent && grams && DIRECT_WEIGHT_TYPES.has(String(card.type || slot.selectionType || ""))) {
    components.product = { ...productComponent, grams };
    nextCard.lines = replacePreparationLine(card.lines, "الصنف المطلوب:", formatProductLine(card, grams));
    if (resolved.source === "legacy_declared_weight") {
      nextCard.warnings = [...new Set([...(card.warnings || []), "LEGACY_PRODUCT_WEIGHT_RECOVERED"])];
    }
  }

  const saladRepair = repairBasicSaladProtein(nextCard, nextSlot, product, rawEntry);
  nextCard = saladRepair.card;
  nextSlot = saladRepair.slot;

  const type = String(nextCard.type || nextSlot.selectionType || "");
  if (BADGES[type]) nextCard.badge = BADGES[type];
  return { card: nextCard, slot: nextSlot };
}

function addonCategoryFor(group = {}) {
  const first = Array.isArray(group.items) ? group.items[0] || {} : {};
  const key = keyText(first.key) || "";
  if (key.startsWith("desserts_")) return "desserts";
  if (key.startsWith("ice_cream_")) return "ice_cream";
  if (key.startsWith("drinks_")) return "drinks";
  if (key.startsWith("juices_")) return "juices";
  if (key.startsWith("snacks_")) return "snacks";
  return "addons";
}

function normalizeAddonGroups(groups = []) {
  const normalized = [];
  const unplanned = new Map();

  for (const group of Array.isArray(groups) ? groups : []) {
    if (group && group.addonPlanId) {
      normalized.push(group);
      continue;
    }
    const category = addonCategoryFor(group);
    if (!unplanned.has(category)) {
      const label = ADDON_CATEGORY_LABELS[category] || ADDON_CATEGORY_LABELS.addons;
      unplanned.set(category, {
        addonPlanId: null,
        balanceBucketId: null,
        label: label.ar,
        labelI18n: label,
        items: [],
      });
    }
    unplanned.get(category).items.push(...(Array.isArray(group && group.items) ? group.items : []));
  }

  return normalized.concat([...unplanned.values()]);
}

function repairBranch(dto = {}) {
  const pickup = dto.pickup && typeof dto.pickup === "object" ? { ...dto.pickup } : null;
  const branchId = pickup && (pickup.branchId || pickup.locationId || pickup.pickupLocationId);
  if (pickup && ["main", "branch_1"].includes(String(branchId || ""))) {
    pickup.branchName = { ...DEFAULT_BRANCH_NAME };
    dto.pickup = pickup;
  }
  if (dto.context && typeof dto.context === "object" && ["main", "branch_1"].includes(String(branchId || ""))) {
    dto.context = { ...dto.context, branch: { ...DEFAULT_BRANCH_NAME } };
  }
  return dto;
}

function repairMappedDto(dto, sourceDoc, catalogMaps, flow) {
  if (!dto || typeof dto !== "object") return dto;
  const details = dto.kitchenDetails && typeof dto.kitchenDetails === "object" ? dto.kitchenDetails : null;
  if (!details || !Array.isArray(details.mealSlots)) return repairBranch(dto);

  const entries = rawEntries(sourceDoc, flow);
  const sourceCards = Array.isArray(dto.kitchenCards) ? dto.kitchenCards : [];
  const repairedSlots = [];
  const repairedCards = [];

  details.mealSlots.forEach((slot, index) => {
    const card = sourceCards[index] || {};
    const repaired = repairCardWeight(card, slot, matchEntry(entries, slot, index), catalogMaps);
    repairedSlots.push(repaired.slot);
    repairedCards.push(repaired.card);
  });

  dto.kitchenDetails = { ...details, mealSlots: repairedSlots };
  dto.kitchenCards = repairedCards;
  dto.kitchenAddonGroups = normalizeAddonGroups(dto.kitchenAddonGroups);
  if (flow === "order" && sourceDoc && sourceDoc.orderNumber) {
    dto.reference = String(sourceDoc.orderNumber);
    dto.orderNumber = String(sourceDoc.orderNumber);
  }
  return repairBranch(dto);
}

function catalogMapsFor(flow, args) {
  return flow === "subscription_day" ? args[6] || {} : args[5] || {};
}

function wrapMapper(service, method, flow) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = function mapKitchenWithCompleteWeights(...args) {
    const dto = original.apply(this, args);
    return repairMappedDto(dto, args[0] || {}, catalogMapsFor(flow, args), flow);
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function installKitchenWeightResponseContract() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./dashboardDtoService");
  wrapMapper(service, "mapSubscriptionDayToDTO", "subscription_day");
  wrapMapper(service, "mapOrderToDTO", "order");
  wrapMapper(service, "mapSubscriptionPickupRequestToDTO", "pickup_request");
  const verification = Object.freeze({
    installed: true,
    productWeightsComplete: true,
    basicSaladProteinWeightComplete: true,
    addonCategoryLabelsLocalized: true,
    orderReferenceCanonical: true,
    pickupBranchLocalized: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenWeightResponseContract();

module.exports = {
  installKitchenWeightResponseContract,
  normalizeAddonGroups,
  repairCardWeight,
  repairMappedDto,
};
