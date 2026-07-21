"use strict";

const GENERIC_TITLES = new Set([
  "",
  "وجبة",
  "وجبة عادية",
  "وجبة قياسية",
  "وجبة مميزة",
  "سلطة مميزة",
  "ساندويتش",
  "ساندوتش",
  "إضافة",
  "عنصر",
  "meal",
  "standard meal",
  "premium meal",
  "premium salad",
  "sandwich",
  "add-on",
  "addon",
  "item",
  "unknown",
  "غير معروف",
]);

const MEAL_ITEM_TYPES = new Set(["meal", "premium_meal", "large_salad", "sandwich"]);
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

function clean(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value === "object" && value._id) return asId(value._id);
  const text = clean(value);
  return text || null;
}

function pair(value, fallback = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.titleI18n || value.name || value.title || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested, fallback);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}

function isGeneric(value) {
  return GENERIC_TITLES.has(clean(value).toLowerCase());
}

function usefulPair(...values) {
  let fallback = { ar: "", en: "" };
  for (const value of values) {
    const current = pair(value);
    if (!fallback.ar && !fallback.en && (current.ar || current.en)) fallback = current;
    const arUseful = current.ar && !isGeneric(current.ar);
    const enUseful = current.en && !isGeneric(current.en);
    if (arUseful || enUseful) return current;
  }
  return fallback;
}

function joinPairs(values, separator = " + ") {
  const rows = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const current = pair(value);
    if (!current.ar && !current.en) continue;
    const key = `${current.ar}\u0000${current.en}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(current);
  }
  return {
    ar: rows.map((row) => row.ar || row.en).filter(Boolean).join(separator),
    en: rows.map((row) => row.en || row.ar).filter(Boolean).join(separator),
  };
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
    return `${clean(localized.ar)} ${clean(localized.en)}`.toLowerCase();
  }).join(" ");
  if (source.includes("protein") || source.includes("بروتين")) return "protein";
  if (source.includes("carb") || source.includes("كارب") || source.includes("نشوي")) return "carb";
  if (source.includes("addon") || source.includes("add-on") || source.includes("إضاف")) return "addon";
  if (source.includes("sauce") || source.includes("صوص")) return "sauce";
  if (source.includes("salad") || source.includes("سلط")) return "salad";
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

function normalizedComponents(item = {}) {
  const source = Array.isArray(item.components)
    ? item.components
    : (Array.isArray(item.options)
      ? item.options
      : (Array.isArray(item.selectedOptions) ? item.selectedOptions : []));
  const rows = [];
  const seen = new Set();
  for (const component of source) {
    if (!component || typeof component !== "object") continue;
    const name = componentName(component);
    const id = asId(component.id || component.optionId || component._id);
    const key = clean(component.key || component.optionKey) || null;
    const kind = componentKind(component);
    const identity = `${kind}:${id || ""}:${key || ""}:${name.ar}:${name.en}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    rows.push({
      ...component,
      id,
      optionId: asId(component.optionId || component.id || component._id),
      key,
      optionKey: clean(component.optionKey || component.key) || null,
      type: kind,
      name,
      nameI18n: name,
      groupKey: clean(component.groupKey || component.canonicalGroupKey) || kind,
      canonicalGroupKey: clean(component.canonicalGroupKey || component.groupKey) || kind,
      groupName: pair(component.groupNameI18n || component.groupName, kind === "protein"
        ? { ar: "البروتين", en: "Protein" }
        : kind === "carb"
          ? { ar: "الكارب", en: "Carbs" }
          : { ar: "المكونات", en: "Components" }),
      quantity: Math.max(1, Number(component.quantity || component.qty || 1)),
      grams: component.grams === undefined || component.grams === null ? null : Number(component.grams || 0),
    });
  }
  return rows;
}

function productPair(item = {}) {
  return usefulPair(
    item.product && item.product.name,
    item.product && item.product.nameI18n,
    item.productNameI18n,
    item.sandwichNameI18n,
    item.meal && item.meal.title,
    item.title,
    item.display && { ar: item.display.titleAr, en: item.display.titleEn }
  );
}

function productHints(item = {}) {
  const product = item.product && typeof item.product === "object" ? item.product : {};
  const title = productPair(item);
  return [
    item.itemType,
    item.selectionType,
    item.categoryKey,
    item.productKey,
    item.sandwichKey,
    product.itemType,
    product.cardVariant,
    product.key,
    title.ar,
    title.en,
  ].map((value) => clean(value).toLowerCase()).join(" ");
}

function isSandwichLike(item = {}) {
  const selectionType = clean(item.selectionType).toLowerCase();
  const itemType = clean(item.itemType).toLowerCase();
  if (selectionType === "sandwich" || itemType === "sandwich") return true;
  const hints = productHints(item);
  return hints.includes("cold_sandwich")
    || hints.includes("sandwich_card")
    || hints.includes("sandwich")
    || hints.includes("sourdough")
    || /ساند(?:وتش|ويتش)/.test(hints);
}

function canonicalItemType(item = {}) {
  const selectionType = clean(item.selectionType).toLowerCase();
  const itemType = clean(item.itemType).toLowerCase();
  if (selectionType === "addon" || itemType === "addon") return "addon";
  if (["protein", "protein_extra"].includes(selectionType) || itemType === "protein_extra") return "protein_extra";
  if (selectionType === "premium_large_salad" || itemType === "large_salad") return "large_salad";
  if (selectionType === "premium_meal" || itemType === "premium_meal" || item.isPremium === true) return "premium_meal";
  if (isSandwichLike(item)) return "sandwich";
  if (["standard_meal", "basic_meal", "full_meal_product"].includes(selectionType)) return "meal";
  if (["meal", "unknown", ""].includes(itemType) && (item.slotId || item.slotKey || item.product)) return "meal";
  return itemType || "unknown";
}

function sandwichTitle(base) {
  const source = pair(base);
  const ar = clean(source.ar);
  const en = clean(source.en);
  return {
    ar: /ساند(?:وتش|ويتش)/.test(ar) ? ar : (ar ? `ساندوتش ${ar}` : "ساندوتش"),
    en: /\bsandwich\b/i.test(en) ? en : (en ? `${en} Sandwich` : "Sandwich"),
  };
}

function canonicalTitle(item = {}) {
  const itemType = canonicalItemType(item);
  const title = productPair(item);
  const components = normalizedComponents(item);
  const proteins = components.filter((component) => component.type === "protein").map(componentName);
  const carbs = components.filter((component) => component.type === "carb").map(componentName);

  if (itemType === "addon") {
    const addon = usefulPair(title, ...components.filter((component) => component.type === "addon").map(componentName));
    return addon.ar || addon.en ? addon : { ar: "إضافة", en: "Add-on" };
  }
  if (itemType === "large_salad") {
    const protein = joinPairs(proteins);
    return {
      ar: protein.ar ? `سلطة كبيرة + ${protein.ar}` : "سلطة كبيرة",
      en: protein.en ? `Large Salad + ${protein.en}` : "Large Salad",
    };
  }
  if (itemType === "sandwich") return sandwichTitle(title);
  if (["meal", "premium_meal"].includes(itemType)) {
    const composed = joinPairs([...proteins, ...carbs]);
    if (composed.ar || composed.en) return composed;
    if ((title.ar && !isGeneric(title.ar)) || (title.en && !isGeneric(title.en))) return title;
    return itemType === "premium_meal"
      ? { ar: "وجبة مميزة", en: "Premium Meal" }
      : { ar: "وجبة", en: "Meal" };
  }
  return title.ar || title.en ? title : { ar: "عنصر", en: "Item" };
}

function categoryKeyFor(itemType) {
  const map = {
    meal: "meals",
    premium_meal: "premium_meals",
    large_salad: "salads",
    protein_extra: "proteins",
    sandwich: "sandwiches",
    addon: "addons",
  };
  return map[itemType] || "meals";
}

function realProductId(item = {}) {
  const candidates = [
    item.product && (item.product.id || item.product._id),
    item.productId,
    item.sandwichId,
    item.menuProductId,
    item.sourceProductId,
  ];
  for (const value of candidates) {
    const id = asId(value);
    if (id && OBJECT_ID_RE.test(id)) return id;
  }
  return null;
}

function normalizePickupItem(item = {}, rawSlot = null) {
  const source = { ...item };
  if (rawSlot && typeof rawSlot === "object") {
    source.selectionType = source.selectionType || rawSlot.selectionType;
    source.productId = source.productId || rawSlot.productId || rawSlot.sandwichId;
    source.productKey = source.productKey || rawSlot.productKey || rawSlot.sandwichKey;
    source.sandwichId = source.sandwichId || rawSlot.sandwichId;
    source.sandwichKey = source.sandwichKey || rawSlot.sandwichKey;
  }
  const components = normalizedComponents(source);
  const itemType = canonicalItemType({ ...source, components });
  const title = canonicalTitle({ ...source, itemType, components });
  const currentProduct = source.product && typeof source.product === "object" ? source.product : {};
  const currentMeal = source.meal && typeof source.meal === "object" ? source.meal : {};
  const currentDisplay = source.display && typeof source.display === "object" ? source.display : {};
  const productName = usefulPair(currentProduct.name, title);
  return {
    ...source,
    itemType,
    categoryKey: categoryKeyFor(itemType),
    selectionType: source.selectionType || (itemType === "sandwich" ? "sandwich" : itemType === "large_salad" ? "premium_large_salad" : itemType === "addon" ? "addon" : "standard_meal"),
    title,
    label: title.ar || title.en,
    product: {
      ...currentProduct,
      id: realProductId(source) || asId(currentProduct.id || currentProduct._id),
      key: currentProduct.key || source.productKey || source.sandwichKey || null,
      itemType: currentProduct.itemType || (rawSlot && rawSlot.itemType) || null,
      name: productName,
    },
    meal: {
      ...currentMeal,
      title,
      quantity: Math.max(1, Number(currentMeal.quantity || source.quantity || 1)),
    },
    components,
    display: {
      ...currentDisplay,
      titleAr: title.ar,
      titleEn: title.en,
    },
  };
}

function slotLookup(day = {}) {
  const map = new Map();
  for (const slot of Array.isArray(day.mealSlots) ? day.mealSlots : []) {
    const keys = [slot.slotKey, slot.slotId, slot.slotIndex].map(clean).filter(Boolean);
    for (const key of keys) map.set(key, slot);
  }
  return map;
}

function normalizeAvailability(availability = {}, day = {}) {
  const lookup = slotLookup(day);
  const normalizedSlots = (Array.isArray(availability.slots) ? availability.slots : []).map((slot) => {
    const raw = lookup.get(clean(slot.slotKey || slot.slotId || slot.slotIndex)) || null;
    const normalized = normalizePickupItem({
      ...slot,
      itemType: canonicalItemType({ ...slot, product: slot.product }),
    }, raw);
    return {
      ...slot,
      selectionType: normalized.selectionType,
      product: normalized.product,
      meal: normalized.meal,
      options: normalized.components,
      display: normalized.display,
    };
  });
  const slotById = new Map(normalizedSlots.map((slot) => [clean(slot.slotId || slot.slotKey || slot.slotIndex), slot]));
  const normalizeItem = (item) => {
    const key = clean(item.slotId || item.slotKey || item.itemId || item.slotIndex);
    const matchingSlot = slotById.get(key);
    const matchingComponents = matchingSlot
      && Array.isArray(matchingSlot.options)
      && matchingSlot.options.length > 0
      ? matchingSlot.options
      : item.components;
    return normalizePickupItem({
      ...item,
      ...(matchingSlot ? {
        selectionType: matchingSlot.selectionType,
        product: matchingSlot.product,
        meal: matchingSlot.meal,
        components: matchingComponents,
        display: matchingSlot.display,
      } : {}),
    }, lookup.get(key) || null);
  };
  const pickupItems = (Array.isArray(availability.pickupItems) ? availability.pickupItems : []).map(normalizeItem);
  const dayAddons = (Array.isArray(availability.dayAddons) ? availability.dayAddons : []).map(normalizeItem);
  const availableAddonChoices = (Array.isArray(availability.availableAddonChoices) ? availability.availableAddonChoices : []).map(normalizeItem);
  const itemById = new Map([...pickupItems, ...availableAddonChoices].map((item) => [clean(item.itemId), item]));
  const sections = (Array.isArray(availability.sections) ? availability.sections : []).map((section) => ({
    ...section,
    items: (Array.isArray(section.items) ? section.items : []).map((item) => itemById.get(clean(item.itemId)) || normalizeItem(item)),
  }));
  return {
    ...availability,
    slots: normalizedSlots,
    pickupItems,
    dayAddons,
    availableAddonChoices,
    sections,
  };
}

function selectedSourceItems(pickupRequest = {}) {
  const direct = Array.isArray(pickupRequest.selectedPickupItems) ? pickupRequest.selectedPickupItems : [];
  const snapshot = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.selectedPickupItems)
    ? pickupRequest.snapshot.selectedPickupItems
    : [];
  return direct.length ? direct : snapshot;
}

function componentToSelectedOption(component) {
  const normalized = normalizedComponents({ components: [component] })[0] || component;
  return {
    groupId: asId(normalized.groupId),
    groupKey: normalized.groupKey || normalized.type || null,
    canonicalGroupKey: normalized.canonicalGroupKey || normalized.groupKey || normalized.type || null,
    groupName: normalized.groupName,
    groupNameI18n: normalized.groupName,
    optionId: asId(normalized.optionId || normalized.id),
    optionKey: normalized.optionKey || normalized.key || null,
    name: normalized.name,
    nameI18n: normalized.name,
    optionName: normalized.name,
    quantity: Math.max(1, Number(normalized.quantity || 1)),
    grams: normalized.grams === undefined ? null : normalized.grams,
  };
}

function pickupItemToKitchenSlot(item = {}, index = 0) {
  const normalized = normalizePickupItem(item);
  if (normalized.itemType === "addon") return null;
  const components = normalized.components;
  const protein = components.find((component) => component.type === "protein") || null;
  const carbs = components.filter((component) => component.type === "carb");
  const selectedOptions = components.map(componentToSelectedOption);
  const saladGroups = {};
  if (normalized.itemType === "large_salad") {
    for (const component of components) {
      const key = component.canonicalGroupKey || component.groupKey || component.type || "other";
      if (!saladGroups[key]) saladGroups[key] = [];
      saladGroups[key].push({
        id: component.id || component.optionId,
        key: component.key || component.optionKey,
        name: component.name,
        nameI18n: component.name,
        quantity: component.quantity,
      });
    }
  }
  const productId = realProductId(normalized);
  const selectionType = normalized.itemType === "sandwich"
    ? "sandwich"
    : normalized.itemType === "large_salad"
      ? "premium_large_salad"
      : normalized.itemType === "premium_meal"
        ? "premium_meal"
        : (normalized.selectionType === "full_meal_product" ? "full_meal_product" : "standard_meal");
  return {
    slotIndex: Number(normalized.slotIndex || index + 1),
    slotKey: normalized.slotKey || normalized.slotId || normalized.itemId || `pickup_item_${index + 1}`,
    selectionType,
    sourceSelectionType: normalized.selectionType || null,
    productId,
    productKey: normalized.product && normalized.product.key || normalized.productKey || null,
    productName: normalized.title.en || normalized.title.ar,
    productNameI18n: normalized.title,
    sandwichId: normalized.itemType === "sandwich" ? productId : null,
    sandwichKey: normalized.itemType === "sandwich" ? (normalized.product && normalized.product.key || normalized.sandwichKey || null) : null,
    sandwichName: normalized.itemType === "sandwich" ? (normalized.title.en || normalized.title.ar) : "",
    sandwichNameI18n: normalized.itemType === "sandwich" ? normalized.title : undefined,
    proteinId: protein ? asId(protein.optionId || protein.id) : null,
    proteinKey: protein ? (protein.optionKey || protein.key || null) : null,
    proteinName: protein ? (protein.name.en || protein.name.ar) : "",
    proteinNameI18n: protein ? protein.name : { ar: "", en: "" },
    proteinGrams: protein && protein.grams !== null ? protein.grams : null,
    proteinFamilyKey: protein ? (protein.optionKey || protein.key || null) : null,
    carbSelections: carbs.map((carb) => ({
      carbId: asId(carb.optionId || carb.id),
      key: carb.optionKey || carb.key || null,
      name: carb.name.en || carb.name.ar,
      nameI18n: carb.name,
      grams: carb.grams,
    })),
    salad: normalized.itemType === "large_salad" ? { groups: saladGroups } : null,
    sauce: selectedOptions.filter((option) => clean(option.groupKey).toLowerCase().includes("sauce")),
    selectedOptions,
    sides: selectedOptions.filter((option) => clean(option.groupKey).toLowerCase().includes("side")),
    isPremium: normalized.itemType === "premium_meal" || normalized.itemType === "large_salad",
    premiumKey: normalized.premiumKey || null,
    premiumSource: normalized.premiumSource || "none",
    quantity: Math.max(1, Number(normalized.quantity || 1)),
    notes: normalized.notes || null,
    imageUrl: normalized.image || (normalized.product && normalized.product.image) || null,
    canonicalTitleI18n: normalized.title,
  };
}

function pickupItemToAddon(item = {}) {
  const normalized = normalizePickupItem(item);
  if (normalized.itemType !== "addon") return null;
  return {
    addonId: realProductId(normalized) || asId(normalized.addonId || normalized.sourceId),
    productId: realProductId(normalized),
    key: normalized.product && normalized.product.key || normalized.addonKey || null,
    name: normalized.title,
    nameI18n: normalized.title,
    quantity: Math.max(1, Number(normalized.quantity || 1)),
    addonPlanId: asId(normalized.addonPlanId || normalized.groupId),
    balanceBucketId: asId(normalized.balanceBucketId),
    entitlementKey: normalized.entitlementKey || null,
    addonPlanNameI18n: normalized.groupName || { ar: "الإضافات", en: "Add-ons" },
    productUnitPriceHalala: Number(normalized.productUnitPriceHalala || normalized.unitPriceHalala || 0),
    payableTotalHalala: Number(normalized.payableTotalHalala || normalized.totalPriceHalala || 0),
  };
}

function selectedSlotIds(pickupRequest = {}) {
  return new Set([
    ...(Array.isArray(pickupRequest.selectedMealSlotIds) ? pickupRequest.selectedMealSlotIds : []),
    ...(Array.isArray(pickupRequest.selectedPickupItemIds) ? pickupRequest.selectedPickupItemIds : []),
    ...(pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.selectedMealSlotIds) ? pickupRequest.snapshot.selectedMealSlotIds : []),
    ...(pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.selectedPickupItemIds) ? pickupRequest.snapshot.selectedPickupItemIds : []),
  ].map(clean).filter(Boolean));
}

function sourceSlotsForPickupRequest(pickupRequest = {}, sourceDay = null) {
  const snapshotSlots = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.mealSlots)
    ? pickupRequest.snapshot.mealSlots
    : [];
  if (snapshotSlots.length) return snapshotSlots;
  const daySlots = sourceDay && Array.isArray(sourceDay.mealSlots) ? sourceDay.mealSlots : [];
  if (!daySlots.length) return [];
  const ids = selectedSlotIds(pickupRequest);
  if (!ids.size) return daySlots.slice(0, Math.max(0, Number(pickupRequest.mealCount || daySlots.length)));
  return daySlots.filter((slot) => [slot.slotKey, slot.slotId, slot.slotIndex].map(clean).some((value) => ids.has(value)));
}

function buildCanonicalKitchenDetails({
  pickupRequest = {},
  sourceDay = null,
  subscription = {},
  lang = "ar",
  catalogMaps = {},
  buildKitchenDetailsPayload,
} = {}) {
  const sourceSlots = sourceSlotsForPickupRequest(pickupRequest, sourceDay);
  const selectedItems = selectedSourceItems(pickupRequest).map((item) => normalizePickupItem(item));
  let mealSlots = [];
  let addons = [];
  if (sourceSlots.length && typeof buildKitchenDetailsPayload === "function") {
    const sourceAddons = pickupRequest.snapshot && Array.isArray(pickupRequest.snapshot.addons)
      ? pickupRequest.snapshot.addons
      : (sourceDay && Array.isArray(sourceDay.addonSelections) ? sourceDay.addonSelections : []);
    const built = buildKitchenDetailsPayload({ mealSlots: sourceSlots, addonSelections: sourceAddons }, subscription, lang, catalogMaps);
    mealSlots = Array.isArray(built && built.mealSlots) ? built.mealSlots : [];
    addons = Array.isArray(built && built.addons) ? built.addons : [];
  }
  if (!mealSlots.length) {
    mealSlots = selectedItems.map(pickupItemToKitchenSlot).filter(Boolean);
  }
  const selectedAddons = selectedItems.map(pickupItemToAddon).filter(Boolean);
  if (selectedAddons.length) addons = selectedAddons;
  const selectedBySlot = new Map(selectedItems.filter((item) => item.itemType !== "addon").map((item) => [
    clean(item.slotKey || item.slotId || item.itemId || item.slotIndex),
    item,
  ]));
  mealSlots = mealSlots.map((slot, index) => {
    const key = clean(slot.slotKey || slot.slotId || slot.slotIndex);
    const selected = selectedBySlot.get(key) || null;
    const synthetic = selected ? pickupItemToKitchenSlot(selected, index) : null;
    const merged = { ...(synthetic || {}), ...slot };
    if (synthetic) {
      for (const field of ["productId", "productKey", "productName", "productNameI18n", "sandwichId", "sandwichKey", "sandwichName", "sandwichNameI18n", "proteinId", "proteinKey", "proteinName", "proteinNameI18n", "proteinGrams", "carbSelections", "selectedOptions", "salad", "canonicalTitleI18n"]) {
        const current = merged[field];
        const empty = current === undefined || current === null || current === "" || (Array.isArray(current) && current.length === 0);
        if (empty && synthetic[field] !== undefined) merged[field] = synthetic[field];
      }
    }
    return merged;
  });
  return { mealSlots, addons };
}

function normalizeKitchenCard(card = {}, slot = {}) {
  const pseudo = normalizePickupItem({
    itemType: card.type,
    selectionType: slot.sourceSelectionType || slot.selectionType || card.type,
    product: {
      id: card.components && card.components.product && card.components.product.id,
      key: card.components && card.components.product && card.components.product.key,
      name: card.components && card.components.product && card.components.product.nameI18n,
    },
    title: slot.canonicalTitleI18n || card.titleI18n,
    components: [
      ...(card.components && card.components.protein ? [{
        ...card.components.protein,
        type: "protein",
        groupKey: "protein",
      }] : []),
      ...(card.components && Array.isArray(card.components.carbs) ? card.components.carbs.map((carb) => ({
        ...carb,
        type: "carb",
        groupKey: "carbs",
      })) : []),
      ...(Array.isArray(slot.selectedOptions) ? slot.selectedOptions : []),
    ],
  });
  const itemType = canonicalItemType(pseudo);
  const type = itemType === "meal"
    ? (slot.selectionType === "full_meal_product" ? "full_meal_product" : "standard_meal")
    : itemType === "large_salad"
      ? "premium_large_salad"
      : itemType;
  const badge = itemType === "sandwich"
    ? "ساندوتش"
    : itemType === "large_salad"
      ? "سلطة كبيرة"
      : itemType === "premium_meal"
        ? "Premium"
        : itemType === "addon"
          ? "إضافة"
          : "وجبة";
  const lines = [];
  const protein = pseudo.components.find((component) => component.type === "protein");
  const carbs = pseudo.components.filter((component) => component.type === "carb");
  if (protein) lines.push(`بروتين: ${protein.name.ar || protein.name.en}${protein.grams ? ` - ${protein.grams}g` : ""}`);
  for (const carb of carbs) lines.push(`كارب: ${carb.name.ar || carb.name.en}${carb.grams ? ` - ${carb.grams}g` : ""}`);
  return {
    ...card,
    type,
    title: pseudo.title.ar || pseudo.title.en,
    titleI18n: pseudo.title,
    badge,
    lines: lines.length ? lines : (Array.isArray(card.lines) ? card.lines : []),
    warnings: (Array.isArray(card.warnings) ? card.warnings : []).filter((warning) => !["UNRESOLVED_SANDWICH", "UNRESOLVED_PROTEIN_KEY", "UNRESOLVED_CARB_KEY"].includes(warning)),
  };
}

function isMealPickupItem(item) {
  return MEAL_ITEM_TYPES.has(canonicalItemType(item));
}

module.exports = {
  buildCanonicalKitchenDetails,
  canonicalItemType,
  canonicalTitle,
  isMealPickupItem,
  isSandwichLike,
  normalizeAvailability,
  normalizeKitchenCard,
  normalizePickupItem,
  pickupItemToAddon,
  pickupItemToKitchenSlot,
  realProductId,
};
