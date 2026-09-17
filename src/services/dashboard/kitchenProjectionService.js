"use strict";

const SECTION_LABELS = {
  protein: { ar: "بروتين", en: "Protein" },
  leafy_greens: { ar: "ورقيات", en: "Leafy greens" },
  vegetables: { ar: "خضار", en: "Vegetables" },
  vegetables_legumes: { ar: "خضروات وبقوليات", en: "Vegetables & legumes" },
  cheese_nuts: { ar: "جبن ومكسرات", en: "Cheese & nuts" },
  fruits: { ar: "فواكه", en: "Fruits" },
  sauce: { ar: "صوص", en: "Sauce" },
};

const SECTION_ORDER = ["leafy_greens", "vegetables_legumes", "protein", "cheese_nuts", "fruits", "sauce"];
const VEGETABLE_GROUP_ALIASES = new Set(["vegetables", "vegetables_legumes"]);
const PREMIUM_LARGE_SALAD_PRODUCT = Object.freeze({
  key: "premium_large_salad",
  nameI18n: { ar: "سلطة كبيرة مميزة", en: "Premium Large Salad" },
});

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

function saladItemIdentity(item) {
  if (!item || typeof item !== "object") return String(item || "");
  return String(item.id || item._id || item.optionId || item.ingredientId
    || item.key || item.optionKey || item.ingredientKey || item.name || "");
}

function mergeSaladGroupValues(groups, keys) {
  const merged = [];
  const seen = new Set();
  keys.forEach((key) => {
    (Array.isArray(groups[key]) ? groups[key] : []).forEach((item) => {
      const identity = saladItemIdentity(item);
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      merged.push(item);
    });
  });
  return merged;
}

function canonicalPremiumSaladGroupKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return "";
  if (VEGETABLE_GROUP_ALIASES.has(key)) return "vegetables_legumes";
  if (key === "proteins") return "protein";
  if (key === "sauces") return "sauce";
  return key;
}

function premiumSaladSelectionLookupKeys(option = {}) {
  const groupId = asId(option.groupId) || "";
  const optionId = asId(option.optionId || option.id || option._id || option.ingredientId) || "";
  const groupKey = canonicalPremiumSaladGroupKey(option.canonicalGroupKey || option.groupKey);
  const optionKey = String(option.optionKey || option.key || option.ingredientKey || "").trim();
  return [
    groupId && optionId ? `id:${groupId}:${optionId}` : "",
    optionId ? `option:${optionId}` : "",
    groupKey && optionKey ? `key:${groupKey}:${optionKey}` : "",
    optionKey ? `optionKey:${optionKey}` : "",
  ].filter(Boolean);
}

function addPremiumSaladLookupEntry(lookup, option) {
  if (!option || typeof option !== "object") return;
  for (const key of premiumSaladSelectionLookupKeys(option)) {
    if (!lookup.has(key)) lookup.set(key, option);
  }
}

function buildPremiumSaladSnapshotLookup(slot = {}) {
  const lookup = new Map();
  const confirmationSelections = slot.confirmationSnapshot
    && Array.isArray(slot.confirmationSnapshot.selectedOptions)
    ? slot.confirmationSnapshot.selectedOptions
    : [];
  const displaySelections = slot.displaySnapshot
    && Array.isArray(slot.displaySnapshot.groups)
    ? slot.displaySnapshot.groups
    : [];

  displaySelections.forEach((option) => addPremiumSaladLookupEntry(lookup, option));
  confirmationSelections.forEach((option) => addPremiumSaladLookupEntry(lookup, option));
  return lookup;
}

function buildPremiumSaladSourceLookup(sourceGroups = {}) {
  const lookup = new Map();
  for (const [rawKey, values] of Object.entries(sourceGroups)) {
    const groupKey = canonicalPremiumSaladGroupKey(rawKey);
    for (const value of Array.isArray(values) ? values : []) {
      const item = value && typeof value === "object" ? value : { id: value };
      addPremiumSaladLookupEntry(lookup, {
        ...item,
        groupKey,
        canonicalGroupKey: groupKey,
        optionId: item.optionId || item.id || item._id || item.ingredientId,
        optionKey: item.optionKey || item.key || item.ingredientKey,
      });
    }
  }
  return lookup;
}

function findPremiumSaladLookupEntry(lookup, option = {}) {
  for (const key of premiumSaladSelectionLookupKeys(option)) {
    if (lookup.has(key)) return lookup.get(key);
  }
  return null;
}

function selectedOptionToSaladItem(option = {}, snapshot = {}, sourceItem = {}) {
  return {
    id: asId(
      option.optionId || option.id || option._id || option.ingredientId
      || snapshot.optionId || snapshot.id || snapshot._id || snapshot.ingredientId
      || sourceItem.optionId || sourceItem.id || sourceItem._id || sourceItem.ingredientId
    ),
    key: option.optionKey || option.key || option.ingredientKey
      || snapshot.optionKey || snapshot.key || snapshot.ingredientKey
      || sourceItem.optionKey || sourceItem.key || sourceItem.ingredientKey
      || null,
    nameI18n: option.nameI18n || option.name || option.optionName || option.label
      || snapshot.optionName || snapshot.nameI18n || snapshot.name || snapshot.label
      || sourceItem.nameI18n || sourceItem.name || sourceItem.label
      || "",
    quantity: Math.max(1, Number(
      option.quantity || option.qty || snapshot.quantity || sourceItem.quantity || 1
    )),
  };
}

function buildPremiumSaladGroups(slot = {}) {
  const sourceGroups = slot.salad && slot.salad.groups && typeof slot.salad.groups === "object"
    ? slot.salad.groups
    : {};
  const selectedOptions = Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [];
  const confirmationSelections = slot.confirmationSnapshot
    && Array.isArray(slot.confirmationSnapshot.selectedOptions)
    ? slot.confirmationSnapshot.selectedOptions
    : [];
  const displaySelections = slot.displaySnapshot
    && Array.isArray(slot.displaySnapshot.groups)
    ? slot.displaySnapshot.groups
    : [];
  const authoritativeSelections = selectedOptions.length > 0
    ? selectedOptions
    : (displaySelections.length > 0 ? displaySelections : confirmationSelections);
  const groups = {};

  if (authoritativeSelections.length === 0) {
    for (const [rawKey, values] of Object.entries(sourceGroups)) {
      if (!Array.isArray(values)) continue;
      const key = canonicalPremiumSaladGroupKey(rawKey);
      if (!key) continue;
      groups[key] = mergeSaladGroupValues({
        existing: groups[key] || [],
        incoming: values,
      }, ["existing", "incoming"]);
    }
    return groups;
  }

  const snapshotLookup = buildPremiumSaladSnapshotLookup(slot);
  const sourceLookup = buildPremiumSaladSourceLookup(sourceGroups);

  for (const option of authoritativeSelections) {
    if (!option || typeof option !== "object") continue;
    const key = canonicalPremiumSaladGroupKey(option.canonicalGroupKey || option.groupKey);
    if (!key) continue;
    const snapshot = findPremiumSaladLookupEntry(snapshotLookup, option) || {};
    const sourceItem = findPremiumSaladLookupEntry(sourceLookup, option) || {};
    const item = selectedOptionToSaladItem(option, snapshot, sourceItem);
    if (!item.id && !item.key && !nameI18n(item.nameI18n).ar) continue;
    groups[key] = mergeSaladGroupValues({
      existing: groups[key] || [],
      incoming: [item],
    }, ["existing", "incoming"]);
  }

  // Legacy Flutter payloads can persist the selected protein in selectedOptions
  // while the remaining Premium salad selections live only in salad.groups.
  // Keep canonical selections authoritative inside any group they represent, but
  // recover groups that are entirely absent instead of dropping them from Kitchen.
  for (const [rawKey, values] of Object.entries(sourceGroups)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const key = canonicalPremiumSaladGroupKey(rawKey);
    if (!key || (Array.isArray(groups[key]) && groups[key].length > 0)) continue;
    groups[key] = mergeSaladGroupValues({ incoming: values }, ["incoming"]);
  }

  return groups;
}

function buildSaladSections(slot = {}) {
  const groups = buildPremiumSaladGroups(slot);
  const keys = SECTION_ORDER.concat(Object.keys(groups).filter((key) => (
    !SECTION_ORDER.includes(key) && !VEGETABLE_GROUP_ALIASES.has(key)
  )));
  const sections = [];

  for (const key of keys) {
    const values = key === "vegetables_legumes"
      ? mergeSaladGroupValues(groups, ["vegetables", "vegetables_legumes"])
      : groups[key];
    let items = saladSectionItems(values);
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

function resolvePremiumLargeSaladProduct(product = {}, protein = {}) {
  const sameAsProtein = Boolean(
    (product.id && protein.id && String(product.id) === String(protein.id))
      || (product.key && protein.key && String(product.key) === String(protein.key))
  );
  const hasCanonicalKey = product.key === PREMIUM_LARGE_SALAD_PRODUCT.key;
  if (hasCanonicalKey && !sameAsProtein) return product;

  return {
    id: null,
    key: PREMIUM_LARGE_SALAD_PRODUCT.key,
    name: PREMIUM_LARGE_SALAD_PRODUCT.nameI18n.ar,
    nameI18n: { ...PREMIUM_LARGE_SALAD_PRODUCT.nameI18n },
  };
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
  const rawProduct = component({
    id: slot.productId || slot.sandwichId,
    key: slot.productKey || slot.sandwichKey,
    nameI18n: slot.productNameI18n || slot.sandwichNameI18n || slot.productName || slot.sandwichName,
  });
  const product = type === "premium_large_salad"
    ? resolvePremiumLargeSaladProduct(rawProduct, protein)
    : rawProduct;
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
  if (type === "premium_large_salad" && (!product.key || !product.name)) warnings.push("UNRESOLVED_PREMIUM_SALAD_PRODUCT");

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
