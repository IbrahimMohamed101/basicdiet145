"use strict";

const GENERIC_TITLES = new Set([
  "",
  "وجبة",
  "وجبة عادية",
  "وجبة قياسية",
  "وجبة مميزة",
  "meal",
  "standard meal",
  "premium meal",
  "item",
  "عنصر",
]);

function clean(value) {
  if (value === undefined || value === null) return "";
  try {
    return String(value).trim();
  } catch (_error) {
    return "";
  }
}

function idOf(value) {
  if (value === undefined || value === null || value === "") return "";
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") {
      try {
        return clean(value.toHexString());
      } catch (_error) {
        return "";
      }
    }
    if (value._id !== undefined && value._id !== value) return idOf(value._id);
    if (value.id !== undefined && value.id !== value) return idOf(value.id);
  }
  return clean(value);
}

function pair(value, fallback = null) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n
      || value.titleI18n
      || value.name
      || value.title
      || value.labelI18n
      || value.label;
    if (nested && nested !== value) return pair(nested, fallback);
    const ar = clean(value.ar || value.nameAr || value.titleAr || value.arabic);
    const en = clean(value.en || value.nameEn || value.titleEn || value.english);
    if (ar || en) return { ar: ar || en, en: en || ar };
  }
  const text = clean(value || fallback);
  return { ar: text, en: text };
}

function usefulPair(...values) {
  let fallback = { ar: "", en: "" };
  for (const value of values) {
    const current = pair(value);
    if (!fallback.ar && !fallback.en && (current.ar || current.en)) fallback = current;
    const arUseful = current.ar && !GENERIC_TITLES.has(current.ar.toLowerCase());
    const enUseful = current.en && !GENERIC_TITLES.has(current.en.toLowerCase());
    if (arUseful || enUseful) return current;
  }
  return fallback;
}

function numericGrams(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberLabel(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return Number.isInteger(parsed)
    ? String(parsed)
    : String(Math.round(parsed * 100) / 100);
}

function gramsLabelI18n(grams) {
  const amount = numericGrams(grams);
  if (amount === null) return { ar: "", en: "" };
  const label = numberLabel(amount);
  return {
    ar: `${label} جم`,
    en: `${label} g`,
  };
}

function appendGrams(name, grams) {
  const source = pair(name);
  const label = gramsLabelI18n(grams);
  if (!label.ar && !label.en) return source;
  return {
    ar: source.ar ? `${source.ar} ${label.ar}` : label.ar,
    en: source.en ? `${source.en} ${label.en}` : label.en,
  };
}

function componentKind(component = {}, fallback = "") {
  const explicit = clean(component.type || fallback).toLowerCase();
  if (["protein", "carb", "addon", "sauce", "salad", "side"].includes(explicit)) {
    return explicit;
  }
  const source = [
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
  if (source.includes("addon") || source.includes("add-on") || source.includes("إضاف")) return "addon";
  if (source.includes("sauce") || source.includes("صوص")) return "sauce";
  if (source.includes("salad") || source.includes("سلط")) return "salad";
  if (source.includes("side") || source.includes("جانبي")) return "side";
  return explicit || "other";
}

function componentName(component = {}) {
  return usefulPair(
    component.nameI18n,
    component.name,
    component.optionName,
    component.carbName,
    component.proteinName,
    component.title,
    component.label,
    { ar: component.nameAr, en: component.nameEn }
  );
}

function normalizeComponent(component = {}, fallbackType = "") {
  const type = componentKind(component, fallbackType);
  const id = idOf(
    component.id
      || component.optionId
      || component.carbId
      || component.proteinId
      || component._id
  );
  const key = clean(
    component.key
      || component.optionKey
      || component.carbKey
      || component.proteinKey
      || component.premiumKey
  );
  const name = componentName(component);
  const grams = numericGrams(
    component.grams !== undefined
      ? component.grams
      : (component.weightGrams !== undefined ? component.weightGrams : component.selectedGrams)
  );
  return {
    ...component,
    id: id || null,
    optionId: idOf(component.optionId || component.id || component.carbId || component.proteinId || component._id) || null,
    key: key || null,
    optionKey: clean(component.optionKey || component.key || component.carbKey || component.proteinKey) || null,
    type,
    groupKey: clean(component.groupKey || component.canonicalGroupKey) || type,
    canonicalGroupKey: clean(component.canonicalGroupKey || component.groupKey) || type,
    name,
    nameI18n: name,
    grams,
    quantity: Math.max(1, Number(component.quantity || component.qty || 1)),
  };
}

function componentAliases(component = {}) {
  const normalized = normalizeComponent(component);
  const aliases = [];
  if (normalized.id) aliases.push(`${normalized.type}:id:${normalized.id}`);
  if (normalized.optionId) aliases.push(`${normalized.type}:id:${normalized.optionId}`);
  if (normalized.key) aliases.push(`${normalized.type}:key:${normalized.key}`);
  if (normalized.optionKey) aliases.push(`${normalized.type}:key:${normalized.optionKey}`);
  if (normalized.name.ar || normalized.name.en) {
    aliases.push(`${normalized.type}:name:${normalized.name.ar}\u0000${normalized.name.en}`);
  }
  return aliases;
}

function mergeComponent(base, incoming) {
  const left = normalizeComponent(base);
  const right = normalizeComponent(incoming, left.type);
  const name = usefulPair(left.name, right.name);
  const grams = left.grams !== null ? left.grams : right.grams;
  return normalizeComponent({
    ...right,
    ...left,
    id: left.id || right.id,
    optionId: left.optionId || right.optionId,
    key: left.key || right.key,
    optionKey: left.optionKey || right.optionKey,
    type: left.type !== "other" ? left.type : right.type,
    groupKey: left.groupKey !== "other" ? left.groupKey : right.groupKey,
    canonicalGroupKey: left.canonicalGroupKey !== "other" ? left.canonicalGroupKey : right.canonicalGroupKey,
    name,
    nameI18n: name,
    grams,
    quantity: Math.max(left.quantity || 1, right.quantity || 1),
  });
}

function mergeComponents(rows = []) {
  const components = [];
  const aliasToIndex = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const normalized = normalizeComponent(row);
    const aliases = componentAliases(normalized);
    let index = aliases.map((alias) => aliasToIndex.get(alias)).find((value) => value !== undefined);
    if (index === undefined) {
      index = components.length;
      components.push(normalized);
    } else {
      components[index] = mergeComponent(components[index], normalized);
    }
    for (const alias of componentAliases(components[index])) aliasToIndex.set(alias, index);
  }
  return components;
}

function snapshotOptions(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];
  return [
    ...(Array.isArray(snapshot.selectedOptions) ? snapshot.selectedOptions : []),
    ...(Array.isArray(snapshot.groups) ? snapshot.groups : []),
    ...(Array.isArray(snapshot.components) ? snapshot.components : []),
  ];
}

function collectMealComponents(source = {}) {
  const rows = [];
  rows.push(...(Array.isArray(source.components) ? source.components : []));
  rows.push(...(Array.isArray(source.options) ? source.options : []));
  rows.push(...snapshotOptions(source.confirmationSnapshot));
  rows.push(...snapshotOptions(source.displaySnapshot));
  rows.push(...snapshotOptions(source.fulfillmentSnapshot));
  rows.push(...(Array.isArray(source.selectedOptions) ? source.selectedOptions : []));

  const proteinSnapshot = source.confirmationSnapshot && source.confirmationSnapshot.protein;
  if (source.proteinId || source.proteinKey || source.premiumKey || source.proteinName || source.proteinNameI18n || proteinSnapshot) {
    rows.push({
      ...(proteinSnapshot && typeof proteinSnapshot === "object" ? proteinSnapshot : {}),
      type: "protein",
      groupKey: "protein",
      canonicalGroupKey: "protein",
      optionId: source.proteinId || (proteinSnapshot && (proteinSnapshot.id || proteinSnapshot._id)),
      optionKey: source.proteinKey || source.premiumKey || (proteinSnapshot && proteinSnapshot.key),
      nameI18n: source.proteinNameI18n || source.proteinName || (proteinSnapshot && proteinSnapshot.name),
      grams: source.proteinGrams,
    });
  }

  const carbs = []
    .concat(Array.isArray(source.carbSelections) ? source.carbSelections : [])
    .concat(Array.isArray(source.carbs) ? source.carbs : [])
    .concat(source.carbId ? [{ carbId: source.carbId, grams: source.carbGrams }] : []);
  for (const carb of carbs) {
    if (!carb || typeof carb !== "object") continue;
    rows.push({
      ...carb,
      type: "carb",
      groupKey: "carbs",
      canonicalGroupKey: "carbs",
      optionId: carb.optionId || carb.carbId || carb.id || carb._id,
      optionKey: carb.optionKey || carb.carbKey || carb.key,
      nameI18n: carb.nameI18n || carb.name || carb.carbName,
      grams: carb.grams,
    });
  }

  return mergeComponents(rows);
}

function decorateComponent(component = {}) {
  const normalized = normalizeComponent(component);
  const displayNameI18n = normalized.type === "carb"
    ? appendGrams(normalized.name, normalized.grams)
    : normalized.name;
  return {
    ...normalized,
    displayNameI18n,
    displayNameAr: displayNameI18n.ar,
    displayNameEn: displayNameI18n.en,
    displayName: displayNameI18n.en || displayNameI18n.ar,
    gramsLabelI18n: gramsLabelI18n(normalized.grams),
  };
}

function joinPairs(values, separator = " + ") {
  const rows = (Array.isArray(values) ? values : [])
    .map((value) => pair(value))
    .filter((value) => value.ar || value.en);
  return {
    ar: rows.map((row) => row.ar || row.en).filter(Boolean).join(separator),
    en: rows.map((row) => row.en || row.ar).filter(Boolean).join(separator),
  };
}

function mealItemType(source = {}) {
  const itemType = clean(source.itemType).toLowerCase();
  const selectionType = clean(source.selectionType).toLowerCase();
  if (itemType) return itemType;
  if (selectionType === "premium_meal" || source.isPremium === true) return "premium_meal";
  if (["standard_meal", "basic_meal", "full_meal_product"].includes(selectionType)) return "meal";
  if (selectionType === "sandwich") return "sandwich";
  if (selectionType === "premium_large_salad") return "large_salad";
  return "meal";
}

function fallbackTitle(source = {}) {
  const displaySnapshot = source.displaySnapshot && typeof source.displaySnapshot === "object"
    ? source.displaySnapshot
    : {};
  const confirmationSnapshot = source.confirmationSnapshot && typeof source.confirmationSnapshot === "object"
    ? source.confirmationSnapshot
    : {};
  return usefulPair(
    source.canonicalTitleI18n,
    source.title,
    source.meal && source.meal.title,
    source.display && { ar: source.display.titleAr, en: source.display.titleEn },
    displaySnapshot.title,
    confirmationSnapshot.title,
    displaySnapshot.product && displaySnapshot.product.name,
    confirmationSnapshot.product && confirmationSnapshot.product.name,
    source.product && source.product.name,
    source.productNameI18n,
    source.productName
  );
}

function buildMealTitle(source = {}, components = null) {
  const itemType = mealItemType(source);
  const fallback = fallbackTitle(source);
  if (!["meal", "premium_meal"].includes(itemType)) return fallback;
  const rows = (components || collectMealComponents(source)).map(decorateComponent);
  const proteins = rows.filter((row) => row.type === "protein" && (row.name.ar || row.name.en));
  const carbs = rows.filter((row) => row.type === "carb" && (row.displayNameI18n.ar || row.displayNameI18n.en));
  const composed = joinPairs([
    ...proteins.map((row) => row.name),
    ...carbs.map((row) => row.displayNameI18n),
  ]);
  if (composed.ar || composed.en) return composed;
  return fallback.ar || fallback.en
    ? fallback
    : (itemType === "premium_meal"
      ? { ar: "وجبة مميزة", en: "Premium Meal" }
      : { ar: "وجبة", en: "Meal" });
}

function decoratePickupItem(item = {}) {
  if (!item || typeof item !== "object") return item;
  const components = collectMealComponents(item).map(decorateComponent);
  const title = buildMealTitle(item, components);
  const currentMeal = item.meal && typeof item.meal === "object" ? item.meal : {};
  const currentDisplay = item.display && typeof item.display === "object" ? item.display : {};
  return {
    ...item,
    components,
    options: Array.isArray(item.options) ? components : item.options,
    title,
    canonicalTitleI18n: title,
    label: title.ar || title.en || item.label,
    meal: {
      ...currentMeal,
      title,
    },
    display: {
      ...currentDisplay,
      titleAr: title.ar,
      titleEn: title.en,
    },
  };
}

function componentForCarb(carb, components) {
  const normalized = normalizeComponent({
    ...(carb || {}),
    type: "carb",
    optionId: carb && (carb.optionId || carb.carbId || carb.id || carb._id),
    optionKey: carb && (carb.optionKey || carb.carbKey || carb.key),
  });
  const aliases = new Set(componentAliases(normalized));
  return (Array.isArray(components) ? components : []).find((component) => (
    component.type === "carb" && componentAliases(component).some((alias) => aliases.has(alias))
  )) || normalized;
}

function decorateCarbRows(rows, components) {
  return (Array.isArray(rows) ? rows : []).map((carb) => {
    const component = decorateComponent(componentForCarb(carb, components));
    return {
      ...carb,
      carbId: idOf(carb && (carb.carbId || carb.optionId || carb.id || carb._id)) || null,
      grams: numericGrams(carb && carb.grams),
      nameI18n: component.name,
      displayNameI18n: component.displayNameI18n,
      displayNameAr: component.displayNameAr,
      displayNameEn: component.displayNameEn,
      displayName: component.displayName,
      gramsLabelI18n: component.gramsLabelI18n,
    };
  });
}

function decorateSelectedOptions(rows, components) {
  return (Array.isArray(rows) ? rows : []).map((option) => {
    const normalized = normalizeComponent(option);
    const aliases = new Set(componentAliases(normalized));
    const matching = components.find((component) => componentAliases(component).some((alias) => aliases.has(alias)));
    const component = decorateComponent(matching || normalized);
    return {
      ...option,
      name: component.name,
      nameI18n: component.name,
      optionName: component.name,
      displayNameI18n: component.displayNameI18n,
      displayNameAr: component.displayNameAr,
      displayNameEn: component.displayNameEn,
      displayName: component.displayName,
      gramsLabelI18n: component.gramsLabelI18n,
    };
  });
}

function decorateSnapshot(snapshot, title, components) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const selectedOptions = Array.isArray(snapshot.selectedOptions)
    ? decorateSelectedOptions(snapshot.selectedOptions, components)
    : snapshot.selectedOptions;
  const groups = Array.isArray(snapshot.groups)
    ? decorateSelectedOptions(snapshot.groups, components)
    : snapshot.groups;
  return {
    ...snapshot,
    title,
    canonicalTitleI18n: title,
    ...(selectedOptions !== undefined ? { selectedOptions } : {}),
    ...(groups !== undefined ? { groups } : {}),
  };
}

function decorateMealSlot(slot = {}) {
  if (!slot || typeof slot !== "object") return slot;
  const components = collectMealComponents(slot).map(decorateComponent);
  const title = buildMealTitle(slot, components);
  const currentMeal = slot.meal && typeof slot.meal === "object" ? slot.meal : null;
  const currentDisplay = slot.display && typeof slot.display === "object" ? slot.display : null;
  const sourceCarbs = Array.isArray(slot.carbs) ? slot.carbs : [];
  const sourceCarbSelections = Array.isArray(slot.carbSelections) ? slot.carbSelections : [];
  const selectedOptions = Array.isArray(slot.selectedOptions)
    ? decorateSelectedOptions(slot.selectedOptions, components)
    : slot.selectedOptions;
  return {
    ...slot,
    canonicalTitleI18n: title,
    canonicalTitle: title.en || title.ar,
    displayTitleI18n: title,
    components,
    carbs: decorateCarbRows(sourceCarbs, components),
    carbSelections: decorateCarbRows(sourceCarbSelections, components),
    ...(selectedOptions !== undefined ? { selectedOptions } : {}),
    displaySnapshot: decorateSnapshot(slot.displaySnapshot, title, components),
    confirmationSnapshot: decorateSnapshot(slot.confirmationSnapshot, title, components),
    fulfillmentSnapshot: decorateSnapshot(slot.fulfillmentSnapshot, title, components),
    ...(currentMeal ? { meal: { ...currentMeal, title } } : {}),
    ...(currentDisplay ? { display: { ...currentDisplay, titleAr: title.ar, titleEn: title.en } } : {}),
  };
}

function decorateDayMealDisplay(day = {}) {
  if (!day || typeof day !== "object" || Array.isArray(day)) return day;
  const decorated = {
    ...day,
    mealSlots: Array.isArray(day.mealSlots)
      ? day.mealSlots.map(decorateMealSlot)
      : day.mealSlots,
  };
  for (const key of ["lockedSnapshot", "fulfilledSnapshot"]) {
    const snapshot = day[key];
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      decorated[key] = {
        ...snapshot,
        mealSlots: Array.isArray(snapshot.mealSlots)
          ? snapshot.mealSlots.map(decorateMealSlot)
          : snapshot.mealSlots,
      };
    }
  }
  return decorated;
}

function decorateTimelineMealDisplay(timeline = {}) {
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) return timeline;
  return {
    ...timeline,
    days: Array.isArray(timeline.days)
      ? timeline.days.map(decorateDayMealDisplay)
      : timeline.days,
  };
}

function decoratePickupAvailability(availability = {}) {
  if (!availability || typeof availability !== "object" || Array.isArray(availability)) return availability;
  const pickupItems = (Array.isArray(availability.pickupItems) ? availability.pickupItems : [])
    .map(decoratePickupItem);
  const dayAddons = (Array.isArray(availability.dayAddons) ? availability.dayAddons : [])
    .map(decoratePickupItem);
  const availableAddonChoices = (Array.isArray(availability.availableAddonChoices) ? availability.availableAddonChoices : [])
    .map(decoratePickupItem);
  const slots = (Array.isArray(availability.slots) ? availability.slots : [])
    .map((slot) => {
      const decorated = decoratePickupItem({ ...slot, components: slot.options || slot.components });
      return {
        ...slot,
        title: decorated.title,
        canonicalTitleI18n: decorated.title,
        meal: decorated.meal,
        options: decorated.components,
        display: decorated.display,
      };
    });
  const byId = new Map([...pickupItems, ...availableAddonChoices]
    .filter(Boolean)
    .map((item) => [clean(item.itemId), item]));
  const sections = (Array.isArray(availability.sections) ? availability.sections : []).map((section) => ({
    ...section,
    items: (Array.isArray(section && section.items) ? section.items : []).map((item) => (
      byId.get(clean(item && item.itemId)) || decoratePickupItem(item)
    )),
  }));
  return {
    ...availability,
    slots,
    pickupItems,
    dayAddons,
    availableAddonChoices,
    sections,
  };
}

module.exports = {
  appendGrams,
  buildMealTitle,
  collectMealComponents,
  decorateComponent,
  decorateDayMealDisplay,
  decorateMealSlot,
  decoratePickupAvailability,
  decoratePickupItem,
  decorateTimelineMealDisplay,
  gramsLabelI18n,
  numericGrams,
  pair,
};
