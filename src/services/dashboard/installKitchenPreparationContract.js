"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenPreparationContract.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenPreparationContract.wrapped");
const DIRECT_PRODUCT_TYPES = new Set([
  "product",
  "basic_meal",
  "full_meal_product",
  "cold_sandwich",
  "sandwich",
  "sourdough",
]);
const ADDON_ITEM_TYPES = new Set(["addon_item", "drink", "dessert", "juice", "ice_cream"]);
const FINANCIAL_KEY_PATTERN = /(price|pricing|halala|currency|vat|tax|discount|payment|payable)/i;

function asId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && value._id) return String(value._id);
  return String(value);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function localizedPair(value, fallback = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.name || value.labelI18n || value.label || value.titleI18n || value.title;
    if (nested && nested !== value) return localizedPair(nested, fallback);
    const ar = cleanText(value.ar) || cleanText(value.en) || cleanText(fallback);
    const en = cleanText(value.en) || cleanText(value.ar) || cleanText(fallback);
    return { ar, en };
  }
  const scalar = value === undefined || value === null ? "" : String(value).trim();
  const resolved = scalar || cleanText(fallback);
  return { ar: resolved, en: resolved };
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => (
    current && typeof current === "object" ? current[key] : undefined
  ), value);
}

function lookupCatalog(catalogMaps = {}, kind, id, key) {
  const byId = catalogMaps[`${kind}ById`];
  const byKey = catalogMaps[`${kind}ByKey`];
  return (byId && id ? byId.get(String(id)) : null)
    || (byKey && key ? byKey.get(String(key)) : null)
    || null;
}

function rawOptionIdentity(option = {}) {
  return asId(option.optionId || option.id || option._id)
    || String(option.optionKey || option.key || "").trim()
    || null;
}

function collectRawOptions(raw = {}) {
  const selections = raw && raw.selections && typeof raw.selections === "object" ? raw.selections : {};
  const display = raw && raw.displaySnapshot && typeof raw.displaySnapshot === "object" ? raw.displaySnapshot : {};
  const confirmation = raw && raw.confirmationSnapshot && typeof raw.confirmationSnapshot === "object" ? raw.confirmationSnapshot : {};
  return []
    .concat(Array.isArray(raw && raw.selectedOptions) ? raw.selectedOptions : [])
    .concat(Array.isArray(selections.selectedOptions) ? selections.selectedOptions : [])
    .concat(Array.isArray(display.groups) ? display.groups : [])
    .concat(Array.isArray(confirmation.selectedOptions) ? confirmation.selectedOptions : [])
    .concat(Array.isArray(raw && raw.components) ? raw.components : []);
}

function enrichSelectedOptions(options = [], raw = {}, catalogMaps = {}) {
  const rawOptions = collectRawOptions(raw);
  const rawByIdentity = new Map();
  rawOptions.forEach((option) => {
    const identity = rawOptionIdentity(option);
    if (identity && !rawByIdentity.has(identity)) rawByIdentity.set(identity, option);
  });

  return (Array.isArray(options) ? options : []).map((option) => {
    const identity = rawOptionIdentity(option);
    const snapshot = identity ? rawByIdentity.get(identity) || {} : {};
    const optionId = asId(option.optionId || option.id || snapshot.optionId || snapshot.id || snapshot._id);
    const optionKey = option.optionKey || option.key || snapshot.optionKey || snapshot.key || null;
    const optionDoc = lookupCatalog(catalogMaps, "option", optionId, optionKey)
      || lookupCatalog(catalogMaps, "saladItem", optionId, optionKey)
      || lookupCatalog(catalogMaps, "protein", optionId, optionKey)
      || lookupCatalog(catalogMaps, "carb", optionId, optionKey);
    const nameSource = snapshot.nameI18n || snapshot.name || snapshot.optionName || snapshot.label
      || option.nameI18n || option.name || option.optionName || option.label
      || (optionDoc && optionDoc.name)
      || optionKey
      || optionId
      || "مكوّن";
    const groupSource = snapshot.groupNameI18n || snapshot.groupName || snapshot.groupLabel
      || option.groupNameI18n || option.groupName || option.groupLabel
      || option.groupKey
      || "اختيارات";

    return {
      ...option,
      optionId,
      optionKey: optionKey || (optionDoc && optionDoc.key) || null,
      name: localizedPair(nameSource).ar,
      optionName: localizedPair(nameSource).ar,
      nameI18n: localizedPair(nameSource),
      optionNameI18n: localizedPair(nameSource),
      groupName: localizedPair(groupSource).ar,
      groupNameI18n: localizedPair(groupSource),
      quantity: Math.max(1, Number(option.quantity || option.qty || snapshot.quantity || snapshot.qty || 1)),
      grams: firstPositiveNumber(
        option.grams,
        snapshot.grams,
        snapshot.extraWeightGrams,
        option.extraWeightGrams
      ),
    };
  });
}

function resolveSubscriptionProteinGrams(sourceDoc = {}, subscription = {}, rawSlot = {}, slot = {}) {
  return firstPositiveNumber(
    slot.proteinGrams,
    rawSlot.proteinGrams,
    rawSlot.selectedGrams,
    rawSlot.portionGrams,
    getPath(rawSlot, "confirmationSnapshot.protein.grams"),
    getPath(rawSlot, "displaySnapshot.protein.grams"),
    getPath(sourceDoc, "lockedSnapshot.proteinGrams"),
    getPath(sourceDoc, "lockedSnapshot.selectedGrams"),
    getPath(sourceDoc, "lockedSnapshot.grams"),
    getPath(sourceDoc, "fulfilledSnapshot.proteinGrams"),
    getPath(sourceDoc, "fulfilledSnapshot.selectedGrams"),
    subscription.selectedGrams,
    getPath(subscription, "contractSnapshot.selectedOptions.grams"),
    getPath(subscription, "contractSnapshot.selectedGrams"),
    getPath(subscription, "contractSnapshot.grams")
  );
}

function resolveOrderProteinGrams(rawItem = {}, slot = {}) {
  const proteinOption = collectRawOptions(rawItem).find((option) => {
    const key = String(option && (option.canonicalGroupKey || option.groupKey || "")).toLowerCase();
    return key === "protein" || key === "proteins";
  });
  return firstPositiveNumber(
    slot.proteinGrams,
    rawItem.proteinGrams,
    getPath(rawItem, "selections.proteinGrams"),
    getPath(rawItem, "selections.selectedGrams"),
    proteinOption && proteinOption.grams,
    proteinOption && proteinOption.extraWeightGrams
  );
}

function resolveProductGrams(rawItem = {}, slot = {}) {
  return firstPositiveNumber(
    slot.productGrams,
    slot.weightGrams,
    rawItem.productGrams,
    rawItem.weightGrams,
    getPath(rawItem, "productSnapshot.weightGrams"),
    getPath(rawItem, "pricingSnapshot.weightPricing.selectedWeightGrams"),
    getPath(rawItem, "pricingSnapshot.weightPricing.weightGrams"),
    getPath(rawItem, "selections.weightGrams")
  );
}

function rawMealEntries(sourceDoc = {}, flow) {
  if (flow === "order") {
    return (Array.isArray(sourceDoc.items) ? sourceDoc.items : []).filter((item) => (
      !ADDON_ITEM_TYPES.has(String(item && (item.itemType || item.type) || ""))
    ));
  }
  if (flow === "pickup_request") {
    if (sourceDoc.snapshot && Array.isArray(sourceDoc.snapshot.mealSlots) && sourceDoc.snapshot.mealSlots.length) {
      return sourceDoc.snapshot.mealSlots;
    }
    return Array.isArray(sourceDoc.selectedPickupItems) ? sourceDoc.selectedPickupItems : [];
  }
  return Array.isArray(sourceDoc.mealSlots) ? sourceDoc.mealSlots : [];
}

function matchRawEntry(entries, slot, index) {
  const slotKey = slot && slot.slotKey ? String(slot.slotKey) : "";
  const slotIndex = Number(slot && slot.slotIndex);
  return entries.find((entry) => slotKey && String(entry && entry.slotKey || "") === slotKey)
    || entries.find((entry) => Number(entry && entry.slotIndex) === slotIndex)
    || entries[index]
    || {};
}

function enrichMealSlot(slot = {}, rawEntry = {}, sourceDoc = {}, subscription = {}, catalogMaps = {}, flow) {
  const rawCarbs = Array.isArray(getPath(rawEntry, "selections.carbs"))
    ? getPath(rawEntry, "selections.carbs")
    : (Array.isArray(rawEntry.carbs) ? rawEntry.carbs : (Array.isArray(rawEntry.carbSelections) ? rawEntry.carbSelections : []));
  const carbSelections = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb, index) => {
    const rawCarb = rawCarbs.find((entry) => (
      asId(entry && entry.carbId) && asId(entry.carbId) === asId(carb && carb.carbId)
    )) || rawCarbs[index] || {};
    return {
      ...carb,
      nameI18n: localizedPair(carb.nameI18n || carb.name || rawCarb.name || carb.key || "كارب"),
      name: localizedPair(carb.nameI18n || carb.name || rawCarb.name || carb.key || "كارب").ar,
      grams: firstPositiveNumber(carb.grams, rawCarb.grams),
      quantity: Math.max(1, Number(carb.quantity || rawCarb.quantity || rawCarb.qty || 1)),
    };
  });
  const productGrams = resolveProductGrams(rawEntry, slot);
  const proteinGrams = flow === "order"
    ? resolveOrderProteinGrams(rawEntry, slot)
    : resolveSubscriptionProteinGrams(sourceDoc, subscription, rawEntry, slot);

  return {
    ...slot,
    productNameI18n: localizedPair(slot.productNameI18n || slot.productName || slot.productKey || ""),
    proteinNameI18n: localizedPair(slot.proteinNameI18n || slot.proteinName || slot.proteinKey || ""),
    productGrams,
    weightGrams: productGrams,
    proteinGrams,
    carbSelections,
    selectedOptions: enrichSelectedOptions(slot.selectedOptions, rawEntry, catalogMaps),
  };
}

function formatGramLine(value) {
  const grams = firstPositiveNumber(value);
  return grams ? `${grams} جم` : "";
}

function buildPreparationLines(slot = {}, card = {}) {
  const lines = [];
  const type = String(card.type || slot.selectionType || "");
  const product = localizedPair(slot.productNameI18n || (card.components && card.components.product && card.components.product.nameI18n) || card.titleI18n || card.title);
  const protein = localizedPair(slot.proteinNameI18n || (card.components && card.components.protein && card.components.protein.nameI18n));
  const productGrams = firstPositiveNumber(slot.productGrams, slot.weightGrams);
  const proteinGrams = firstPositiveNumber(slot.proteinGrams);
  const carbs = Array.isArray(slot.carbSelections) ? slot.carbSelections : [];

  if (DIRECT_PRODUCT_TYPES.has(type) && product.ar) {
    lines.push(`الصنف المطلوب: ${product.ar}${productGrams ? ` - ${formatGramLine(productGrams)}` : ""}`);
  }
  if (protein.ar) {
    lines.push(`البروتين المطلوب: ${protein.ar}${proteinGrams ? ` - ${formatGramLine(proteinGrams)}` : ""}`);
  } else if (type === "chef_choice" && proteinGrams) {
    lines.push(`حصة البروتين المطلوبة: ${formatGramLine(proteinGrams)}`);
  }
  carbs.forEach((carb, index) => {
    const name = localizedPair(carb.nameI18n || carb.name || carb.key || "كارب").ar;
    const prefix = carbs.length > 1 ? `الكارب ${index + 1} من ${carbs.length}` : "الكارب";
    const grams = formatGramLine(carb.grams);
    const quantity = Math.max(1, Number(carb.quantity || 1));
    lines.push(`${prefix}: ${name}${grams ? ` - ${grams}` : ""}${quantity > 1 ? ` ×${quantity}` : ""}`);
  });
  if (Number(card.quantity || slot.quantity || 1) > 1) {
    lines.push(`عدد الوحدات: ${Math.max(1, Number(card.quantity || slot.quantity || 1))}`);
  }
  return [...new Set(lines.filter(Boolean))];
}

function titleForSlot(slot = {}, card = {}) {
  const type = String(card.type || slot.selectionType || "");
  const existing = localizedPair(card.titleI18n || card.title || "");
  const product = localizedPair(slot.productNameI18n || slot.productName || "");
  const protein = localizedPair(slot.proteinNameI18n || slot.proteinName || "");
  const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb) => (
    localizedPair(carb.nameI18n || carb.name || "")
  ));

  if (DIRECT_PRODUCT_TYPES.has(type) && (product.ar || product.en)) return product;
  if (["standard_meal", "premium_meal"].includes(type) && (protein.ar || carbs.length)) {
    return {
      ar: [protein.ar, ...carbs.map((carb) => carb.ar)].filter(Boolean).join(" + "),
      en: [protein.en, ...carbs.map((carb) => carb.en)].filter(Boolean).join(" + "),
    };
  }
  return existing;
}

function stripFinancialFields(value) {
  if (Array.isArray(value)) return value.map(stripFinancialFields);
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FINANCIAL_KEY_PATTERN.test(key)) continue;
    clean[key] = stripFinancialFields(entry);
  }
  return clean;
}

function enhanceProjectedCard(card = {}, slot = {}) {
  const titleI18n = titleForSlot(slot, card);
  const sourceComponents = card.components && typeof card.components === "object" ? card.components : {};
  const product = sourceComponents.product
    ? {
      ...sourceComponents.product,
      nameI18n: localizedPair(sourceComponents.product.nameI18n || sourceComponents.product.name || slot.productNameI18n),
      name: localizedPair(sourceComponents.product.nameI18n || sourceComponents.product.name || slot.productNameI18n).ar,
      grams: firstPositiveNumber(slot.productGrams, slot.weightGrams),
      quantity: Math.max(1, Number(card.quantity || slot.quantity || 1)),
    }
    : null;
  const protein = sourceComponents.protein
    ? {
      ...sourceComponents.protein,
      nameI18n: localizedPair(sourceComponents.protein.nameI18n || sourceComponents.protein.name || slot.proteinNameI18n),
      name: localizedPair(sourceComponents.protein.nameI18n || sourceComponents.protein.name || slot.proteinNameI18n).ar,
      grams: firstPositiveNumber(slot.proteinGrams, sourceComponents.protein.grams),
      quantity: 1,
    }
    : null;
  const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb) => ({
    id: asId(carb.carbId || carb.id),
    key: carb.key || null,
    name: localizedPair(carb.nameI18n || carb.name || carb.key || "كارب").ar,
    nameI18n: localizedPair(carb.nameI18n || carb.name || carb.key || "كارب"),
    grams: firstPositiveNumber(carb.grams),
    quantity: Math.max(1, Number(carb.quantity || 1)),
  }));

  return stripFinancialFields({
    ...card,
    title: titleI18n.ar || card.title || "وجبة",
    titleI18n,
    lines: buildPreparationLines(slot, card),
    components: {
      product,
      protein,
      carbs,
      salad: sourceComponents.salad || null,
    },
  });
}

function enhanceMappedDto(dto, sourceDoc, subscription, catalogMaps, flow) {
  if (!dto || typeof dto !== "object") return dto;
  const details = dto.kitchenDetails && typeof dto.kitchenDetails === "object"
    ? dto.kitchenDetails
    : { mealSlots: [], addons: [] };
  const entries = rawMealEntries(sourceDoc, flow);
  const mealSlots = (Array.isArray(details.mealSlots) ? details.mealSlots : []).map((slot, index) => (
    enrichMealSlot(slot, matchRawEntry(entries, slot, index), sourceDoc, subscription, catalogMaps, flow)
  ));
  const cleanDetails = stripFinancialFields({
    ...details,
    mealSlots,
    addons: Array.isArray(details.addons) ? details.addons : [],
  });

  const projectionService = require("./kitchenProjectionService");
  const projection = projectionService.buildKitchenProjection(cleanDetails);
  dto.kitchenDetails = cleanDetails;
  dto.kitchenProjectionVersion = "v2";
  dto.kitchenCards = (projection.kitchenCards || []).map((card, index) => (
    enhanceProjectedCard(card, mealSlots[index] || {})
  ));
  dto.kitchenAddonGroups = stripFinancialFields(projection.kitchenAddonGroups || []);

  if (flow === "order") {
    for (const key of ["items", "pricing", "payment", "paymentStatus", "paymentValidity", "orderSummary"]) {
      delete dto[key];
    }
  }
  return dto;
}

function preparationComponent(item) {
  if (!item || typeof item !== "object") return null;
  const clean = {
    id: asId(item.id || item.productId || item.optionId || item.carbId),
    key: item.key || item.productKey || item.optionKey || null,
    name: localizedPair(item.nameI18n || item.name || item.label).ar,
    nameI18n: localizedPair(item.nameI18n || item.name || item.label),
  };
  const grams = firstPositiveNumber(item.grams, item.weightGrams, item.productGrams);
  if (grams) clean.grams = grams;
  if (item.quantity !== undefined && item.quantity !== null) {
    clean.quantity = Math.max(1, Number(item.quantity || 1));
  }
  return clean;
}

function preparationSection(section = {}) {
  return {
    key: section.key || null,
    label: localizedPair(section.labelI18n || section.label || section.title).ar,
    labelI18n: localizedPair(section.labelI18n || section.label || section.title),
    items: (Array.isArray(section.items) ? section.items : []).map((item) => preparationComponent(item)).filter(Boolean),
  };
}

function preparationCard(card = {}) {
  const components = card.components && typeof card.components === "object" ? card.components : {};
  const sections = (Array.isArray(card.sections) ? card.sections : []).map(preparationSection);
  const salad = components.salad
    ? {
      sectionCount: sections.length,
      itemCount: sections.reduce((sum, section) => sum + section.items.length, 0),
    }
    : null;
  return {
    cardId: card.cardId || card.id || card.slotKey || null,
    slotIndex: card.slotIndex === undefined || card.slotIndex === null ? null : Number(card.slotIndex),
    slotKey: card.slotKey || null,
    type: card.type || "meal",
    title: localizedPair(card.titleI18n || card.title || "وجبة").ar,
    titleI18n: localizedPair(card.titleI18n || card.title || "وجبة"),
    badge: card.badge || null,
    quantity: Math.max(1, Number(card.quantity || 1)),
    notes: card.notes || null,
    imageUrl: card.imageUrl || null,
    lines: (Array.isArray(card.lines) ? card.lines : []).map(String).filter(Boolean),
    sections,
    components: {
      product: preparationComponent(components.product),
      protein: preparationComponent(components.protein),
      carbs: (Array.isArray(components.carbs) ? components.carbs : []).map(preparationComponent).filter(Boolean),
      salad,
    },
    warnings: Array.isArray(card.warnings) ? card.warnings : [],
  };
}

function preparationAddonGroup(group = {}) {
  return {
    addonPlanId: asId(group.addonPlanId),
    balanceBucketId: asId(group.balanceBucketId),
    label: localizedPair(group.labelI18n || group.label || group.title || "إضافات").ar,
    labelI18n: localizedPair(group.labelI18n || group.label || group.title || "إضافات"),
    items: (Array.isArray(group.items) ? group.items : []).map((item) => ({
      productId: asId(item.productId || item.id),
      key: item.key || null,
      name: localizedPair(item.nameI18n || item.name || "إضافة").ar,
      nameI18n: localizedPair(item.nameI18n || item.name || "إضافة"),
      quantity: Math.max(1, Number(item.quantity || 1)),
      ...(firstPositiveNumber(item.grams, item.weightGrams) ? { grams: firstPositiveNumber(item.grams, item.weightGrams) } : {}),
    })),
  };
}

function sanitizeCanonicalOperation(operation = {}, sourceItem = operation) {
  const clean = { ...operation };
  const sourceKitchen = sourceItem && sourceItem.kitchen && sourceItem.kitchen.version === "v2"
    ? sourceItem.kitchen
    : {};
  const sourceCards = Array.isArray(sourceItem && sourceItem.kitchenCards)
    ? sourceItem.kitchenCards
    : (Array.isArray(sourceKitchen.cards) ? sourceKitchen.cards : (clean.kitchen && clean.kitchen.cards) || []);
  const sourceAddonGroups = Array.isArray(sourceItem && sourceItem.kitchenAddonGroups)
    ? sourceItem.kitchenAddonGroups
    : (Array.isArray(sourceKitchen.addonGroups) ? sourceKitchen.addonGroups : (clean.kitchen && clean.kitchen.addonGroups) || []);
  const cards = sourceCards.map(preparationCard);
  const addonGroups = sourceAddonGroups.map(preparationAddonGroup);
  const warnings = Array.isArray(sourceKitchen.warnings)
    ? sourceKitchen.warnings
    : (clean.kitchen && Array.isArray(clean.kitchen.warnings) ? clean.kitchen.warnings : []);

  clean.kitchen = {
    version: "v2",
    purpose: "meal_preparation",
    financialDataIncluded: false,
    mealCount: cards.reduce((sum, card) => sum + card.quantity, 0),
    cards,
    addonGroups,
    warnings,
  };

  if (clean.kitchenDetails) clean.kitchenDetails = stripFinancialFields(clean.kitchenDetails);
  if (clean.kitchenCards) clean.kitchenCards = cards;
  if (clean.kitchenAddonGroups) clean.kitchenAddonGroups = addonGroups;

  const source = String(clean.source || sourceItem.source || "");
  const entityType = String(clean.entityType || sourceItem.entityType || "");
  if (source === "one_time_order" || entityType === "order") {
    for (const key of ["items", "pricing", "payment", "paymentStatus", "paymentValidity", "orderSummary"]) {
      delete clean[key];
    }
  }
  return clean;
}

function wrapMapper(service, method, flow) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = function wrappedKitchenPreparationMapper(...args) {
    const dto = original.apply(this, args);
    const sourceDoc = args[0] || {};
    const subscription = flow === "order" ? {} : (flow === "pickup_request" ? args[1] || {} : args[2] || {});
    const catalogMaps = flow === "order" ? args[5] || {} : (flow === "pickup_request" ? args[5] || {} : args[6] || {});
    return enhanceMappedDto(dto, sourceDoc, subscription, catalogMaps, flow);
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function wrapReadService(service) {
  if (!service || typeof service.getEnrichedDTO !== "function" || service.getEnrichedDTO[WRAPPED_MARK]) return;
  const original = service.getEnrichedDTO;
  const wrapped = async function getEnrichedKitchenPreparationDTO(...args) {
    const dto = await original.apply(this, args);
    if (!dto) return dto;
    const contractService = require("./kitchenOperationsContractService");
    return contractService.serializeKitchenOperation(dto);
  };
  wrapped[WRAPPED_MARK] = true;
  service.getEnrichedDTO = wrapped;
}

function installKitchenPreparationContract() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];

  const dashboardDtoService = require("./dashboardDtoService");
  wrapMapper(dashboardDtoService, "mapSubscriptionDayToDTO", "subscription_day");
  wrapMapper(dashboardDtoService, "mapOrderToDTO", "order");
  wrapMapper(dashboardDtoService, "mapSubscriptionPickupRequestToDTO", "pickup_request");

  const contractService = require("./kitchenOperationsContractService");
  const originalSerialize = contractService.serializeKitchenOperation;
  if (!originalSerialize[WRAPPED_MARK]) {
    const wrappedSerialize = function serializeFoodOnlyKitchenOperation(item = {}, options = {}) {
      const alreadyCanonical = item && item.kitchen && item.kitchen.version === "v2";
      const serialized = alreadyCanonical ? { ...item } : originalSerialize(item, options);
      return sanitizeCanonicalOperation(serialized, item);
    };
    wrappedSerialize[WRAPPED_MARK] = true;
    contractService.serializeKitchenOperation = wrappedSerialize;
    contractService.serializeKitchenOperationsCollection = function serializeFoodOnlyCollection(data = {}, options = {}) {
      const items = (Array.isArray(data.items) ? data.items : []).map((item) => wrappedSerialize(item, options));
      return { ...data, contractVersion: "kitchen_operations.v2", count: items.length, items };
    };
  }

  // Action responses historically used the older read service directly. Wrap both
  // readers so list, search, and every action response return the same canonical DTO.
  wrapReadService(require("./opsReadService"));
  wrapReadService(require("./opsReadServiceV2"));

  const verification = Object.freeze({
    installed: true,
    dtoMappersWrapped: true,
    serializerWrapped: true,
    actionReadsWrapped: true,
    flutterTouched: false,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenPreparationContract();

module.exports = {
  enhanceMappedDto,
  installKitchenPreparationContract,
  sanitizeCanonicalOperation,
  stripFinancialFields,
};
