"use strict";

const SECTION_LABELS = {
  protein: { ar: "بروتين", en: "Protein" },
  leafy_greens: { ar: "ورقيات", en: "Leafy greens" },
  vegetables: { ar: "خضار", en: "Vegetables" },
  cheese_nuts: { ar: "جبن ومكسرات", en: "Cheese & nuts" },
  fruits: { ar: "فواكه", en: "Fruits" },
  sauce: { ar: "صوص", en: "Sauce" },
};

const SECTION_ORDER = ["protein", "leafy_greens", "vegetables", "cheese_nuts", "fruits", "sauce"];

function asId(value) {
  if (!value) return null;
  if (value._id) return String(value._id);
  return String(value);
}

function nameI18n(value, fallback = "") {
  if (!value) return { ar: fallback, en: fallback };
  if (typeof value === "string") return { ar: value, en: value };
  if (typeof value === "object") {
    const nested = value.nameI18n || value.name || value.labelI18n || value.label;
    if (nested && nested !== value) return nameI18n(nested, fallback);
    const ar = String(value.ar || value.en || fallback || "");
    const en = String(value.en || value.ar || fallback || "");
    return { ar, en };
  }
  return { ar: String(value), en: String(value) };
}

function component(item = {}, { idField = "id", keyField = "key", fallbackName = "" } = {}) {
  const localized = nameI18n(item.nameI18n || item.name, fallbackName);
  return {
    id: asId(item[idField] || item.id || item._id),
    key: item[keyField] || item.key || null,
    name: localized.ar,
    nameI18n: localized,
  };
}

function saladSectionItems(values) {
  return (Array.isArray(values) ? values : []).map((item) => {
    if (item && typeof item === "object") return component(item);
    const value = String(item || "");
    return { id: null, key: null, name: value, nameI18n: { ar: value, en: value } };
  }).filter((item) => item.name);
}

function buildSaladSections(slot = {}) {
  const groups = slot.salad && slot.salad.groups && typeof slot.salad.groups === "object"
    ? slot.salad.groups
    : {};
  const keys = SECTION_ORDER.concat(Object.keys(groups).filter((key) => !SECTION_ORDER.includes(key)));
  const sections = [];

  for (const key of keys) {
    let items = saladSectionItems(groups[key]);
    if (key === "sauce" && items.length === 0) {
      items = (Array.isArray(slot.sauce) ? slot.sauce : []).map((item) => component(item, {
        idField: "optionId",
        keyField: "optionKey",
      })).filter((item) => item.name);
    }
    if (items.length === 0) continue;
    const labelI18n = SECTION_LABELS[key] || { ar: key, en: key };
    sections.push({ key, label: labelI18n.ar, labelI18n, items });
  }

  return sections;
}

function basicSaladGroupIdentity(option = {}) {
  const groupName = nameI18n(option.groupNameI18n || option.groupName).ar;
  return String(
    option.canonicalGroupKey
      || option.groupKey
      || groupName
      || asId(option.groupId)
      || "other"
  );
}

function buildBasicSaladSections(slot = {}) {
  const groups = new Map();

  (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : []).forEach((option) => {
    if (!option || typeof option !== "object") return;
    const key = basicSaladGroupIdentity(option);
    const labelI18n = nameI18n(
      option.groupNameI18n || option.groupName,
      key
    );
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: labelI18n.ar,
        labelI18n,
        items: [],
        seenOptions: new Map(),
      });
    }

    const group = groups.get(key);
    const optionId = asId(option.optionId || option.id || option._id);
    const optionKey = option.optionKey || option.key || null;
    const dedupeKey = [asId(option.groupId) || "", optionId || "", optionKey || ""].join(":");
    const quantity = Math.max(1, Number(option.quantity || option.qty || 1));
    const existingIndex = group.seenOptions.get(dedupeKey);

    if (existingIndex !== undefined) {
      // Both one-time order snapshot locations can contain the same option.
      // Preserve an explicitly requested quantity without counting the snapshot twice.
      group.items[existingIndex].quantity = Math.max(group.items[existingIndex].quantity, quantity);
      return;
    }

    const item = {
      ...component({
        id: optionId,
        key: optionKey,
        nameI18n: option.nameI18n || option.name || option.optionName || option.label,
      }),
      quantity,
      grams: option.grams === undefined || option.grams === null ? null : Number(option.grams || 0),
      unitPriceHalala: Number(option.unitPriceHalala || option.extraPriceHalala || 0),
      totalPriceHalala: Number(option.totalPriceHalala || option.totalHalala || 0),
    };
    group.seenOptions.set(dedupeKey, group.items.length);
    group.items.push(item);
  });

  return [...groups.values()].map(({ seenOptions, ...group }) => group);
}

function badgeFor(type) {
  if (["premium_meal", "premium_large_salad"].includes(type)) return "Premium";
  if (type === "sandwich") return "ساندويتش";
  if (type === "standard_meal") return "وجبة قياسية";
  if (type === "chef_choice") return "اختيار الشيف";
  return "وجبة";
}

function buildKitchenCard(slot = {}, index = 0) {
  const isBasicSalad = slot.selectionType === "basic_salad" || slot.productKey === "basic_salad";
  const type = isBasicSalad ? "basic_salad" : (slot.selectionType || "meal");
  const protein = component({
    id: slot.proteinId,
    key: slot.proteinKey,
    nameI18n: slot.proteinNameI18n || slot.proteinName,
  });
  const carbs = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb) => ({
    ...component(carb, { idField: "carbId" }),
    grams: carb.grams === undefined || carb.grams === null ? null : Number(carb.grams || 0),
  }));
  const product = component({
    id: slot.productId || slot.sandwichId,
    key: slot.productKey || slot.sandwichKey,
    nameI18n: slot.productNameI18n || slot.sandwichNameI18n || slot.productName || slot.sandwichName,
  });
  const grams = slot.proteinGrams === undefined || slot.proteinGrams === null ? null : Number(slot.proteinGrams || 0);
  const sections = type === "premium_large_salad"
    ? buildSaladSections(slot)
    : (isBasicSalad ? buildBasicSaladSections(slot) : []);
  const lines = [];
  let titleI18n;

  if (isBasicSalad) {
    titleI18n = product.name
      ? product.nameI18n
      : { ar: "سلطة", en: "Salad" };
    sections.forEach((section) => {
      const itemNames = section.items.map((item) => (
        item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name
      ));
      lines.push(`${section.label}: ${itemNames.join("، ")}`);
    });
  } else if (type === "sandwich") {
    titleI18n = product.nameI18n;
    if (product.name) lines.push(`ساندويتش: ${product.name}`);
  } else if (type === "premium_large_salad") {
    titleI18n = product.name
      ? product.nameI18n
      : { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" };
    sections.forEach((section) => {
      lines.push(`${section.label}: ${section.items.map((item) => item.name).join("، ")}`);
    });
  } else {
    const proteinName = protein.name;
    if (type === "premium_meal") {
      titleI18n = {
        ar: `وجبة مميزة${proteinName ? ` - ${proteinName}` : ""}`,
        en: `Premium Meal${protein.nameI18n.en ? ` - ${protein.nameI18n.en}` : ""}`,
      };
      if (proteinName) lines.push(`بروتين مميز: ${proteinName}${grams ? ` - ${grams}g` : ""}`);
    } else if (type === "chef_choice") {
      titleI18n = { ar: "اختيار الشيف", en: "Chef Choice" };
    } else {
      titleI18n = {
        ar: `وجبة${proteinName ? ` ${proteinName}` : ""}${grams ? ` ${grams}g` : ""}`,
        en: `Meal${protein.nameI18n.en ? ` ${protein.nameI18n.en}` : ""}${grams ? ` ${grams}g` : ""}`,
      };
      if (proteinName) lines.push(`بروتين: ${proteinName}${grams ? ` - ${grams}g` : ""}`);
    }
    carbs.forEach((carb) => {
      if (carb.name) lines.push(`كارب: ${carb.name}${carb.grams ? ` ${carb.grams}g` : ""}`);
    });
  }

  const warnings = [];
  if (type === "sandwich" && (!product.id || !product.key || !product.name)) warnings.push("UNRESOLVED_SANDWICH");
  if (["standard_meal", "premium_meal"].includes(type) && !protein.key) warnings.push("UNRESOLVED_PROTEIN_KEY");
  if (carbs.some((carb) => !carb.key)) warnings.push("UNRESOLVED_CARB_KEY");
  if (type === "premium_large_salad" && (!product.id || !product.key || !product.name)) warnings.push("UNRESOLVED_PREMIUM_SALAD_PRODUCT");

  return {
    cardId: String(slot.slotKey || `slot_${slot.slotIndex || index + 1}`),
    slotIndex: slot.slotIndex === undefined || slot.slotIndex === null ? index + 1 : Number(slot.slotIndex),
    slotKey: slot.slotKey || null,
    type,
    title: titleI18n.ar,
    titleI18n,
    badge: isBasicSalad ? "سلطة" : badgeFor(type),
    quantity: Number(slot.quantity || 1),
    notes: slot.notes || null,
    imageUrl: slot.imageUrl || null,
    lines,
    sections,
    components: {
      product: product.id || product.key || product.name ? product : null,
      protein: protein.id || protein.key || protein.name ? { ...protein, grams } : null,
      carbs,
      salad: isBasicSalad || sections.length > 0 ? { sections } : null,
    },
    warnings,
    rawSelection: slot,
  };
}

function buildKitchenAddonGroups(addons = []) {
  const groups = new Map();

  (Array.isArray(addons) ? addons : []).forEach((addon, index) => {
    const addonPlanId = asId(addon.addonPlanId);
    const groupKey = addonPlanId || `unplanned:${addon.balanceBucketId || addon.entitlementKey || addon.id || index}`;
    const labelI18n = nameI18n(
      addon.addonPlanNameI18n,
      addon.entitlementKey || addon.key || "إضافات"
    );
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        addonPlanId,
        balanceBucketId: asId(addon.balanceBucketId),
        label: labelI18n.ar,
        labelI18n,
        items: [],
      });
    }
    const localized = nameI18n(addon.nameI18n || addon.name, addon.key || "إضافة");
    groups.get(groupKey).items.push({
      productId: asId(addon.productId || addon.id),
      key: addon.key || null,
      name: localized.ar,
      nameI18n: localized,
      quantity: Number(addon.quantity || 1),
      productUnitPriceHalala: Number(addon.productUnitPriceHalala || 0),
      payableTotalHalala: Number(addon.payableTotalHalala || 0),
    });
  });

  return [...groups.values()];
}

function buildKitchenProjection(kitchenDetails = {}) {
  return {
    kitchenProjectionVersion: "v1",
    kitchenCards: (Array.isArray(kitchenDetails.mealSlots) ? kitchenDetails.mealSlots : [])
      .map((slot, index) => buildKitchenCard(slot, index)),
    kitchenAddonGroups: buildKitchenAddonGroups(kitchenDetails.addons),
  };
}

module.exports = {
  buildKitchenAddonGroups,
  buildKitchenCard,
  buildKitchenProjection,
};
