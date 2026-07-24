"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenArabicCatalogAuthority.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenArabicCatalogAuthority.wrapped");

const ARABIC_KEY_FALLBACKS = Object.freeze({
  chicken: "دجاج",
  grilled_chicken: "دجاج مشوي",
  beef: "لحم بقري",
  steak: "ستيك لحم",
  shrimp: "روبيان",
  salmon: "سلمون",
  fish: "سمك",
  white_rice: "أرز أبيض",
  rice_white: "أرز أبيض",
  rice: "أرز",
  red_sauce_pasta: "مكرونة بالصلصة الحمراء",
  red_pasta: "مكرونة حمراء",
  pasta: "مكرونة",
  roasted_potato: "بطاطس مشوية",
  potato: "بطاطس",
});

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function scalarText(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return "";
  const text = String(value).replace(/\[object Object\]/gi, "").trim();
  return text;
}

function idText(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value && typeof value.toHexString === "function") {
    try {
      return scalarText(value.toHexString()) || null;
    } catch (_) {
      return null;
    }
  }
  if (value && typeof value === "object" && value._id !== value) {
    return idText(value._id || value.id);
  }
  return scalarText(value) || null;
}

function keyText(value) {
  return scalarText(value).toLowerCase() || null;
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(scalarText(value));
}

function localizedPair(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) return { ar: "", en: "" };

  const scalar = scalarText(value);
  if (scalar) {
    return containsArabic(scalar)
      ? { ar: scalar, en: "" }
      : { ar: "", en: scalar };
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const pair = localizedPair(entry, depth + 1);
      if (pair.ar || pair.en) return pair;
    }
    return { ar: "", en: "" };
  }

  if (!value || typeof value !== "object") return { ar: "", en: "" };

  const directAr = scalarText(value.ar);
  const directEn = scalarText(value.en);
  if (directAr || directEn) {
    return {
      ar: directAr && containsArabic(directAr) ? directAr : "",
      en: directEn || (!containsArabic(directAr) ? directAr : ""),
    };
  }

  for (const key of [
    "nameI18n",
    "name",
    "optionNameI18n",
    "optionName",
    "labelI18n",
    "label",
    "titleI18n",
    "title",
  ]) {
    if (!value[key] || value[key] === value) continue;
    const pair = localizedPair(value[key], depth + 1);
    if (pair.ar || pair.en) return pair;
  }

  return { ar: "", en: "" };
}

function fallbackArabicForKey(key) {
  const normalized = keyText(key);
  if (!normalized) return "";
  if (ARABIC_KEY_FALLBACKS[normalized]) return ARABIC_KEY_FALLBACKS[normalized];
  for (const [candidate, label] of Object.entries(ARABIC_KEY_FALLBACKS)) {
    if (normalized.includes(candidate)) return label;
  }
  return "";
}

function mergeLocalizedPair(authoritative, stored, key) {
  const live = localizedPair(authoritative);
  const snapshot = localizedPair(stored);
  const ar = live.ar || snapshot.ar || fallbackArabicForKey(key);
  const en = live.en || snapshot.en || scalarText(key);
  return {
    ar,
    en: en || ar,
  };
}

function mapLookup(map, value) {
  const key = idText(value) || keyText(value);
  if (!(map instanceof Map) || !key) return null;
  return map.get(String(key)) || null;
}

function lookupCatalog(catalogMaps = {}, kinds = [], id, key) {
  for (const kind of kinds) {
    const byId = mapLookup(catalogMaps[`${kind}ById`], id);
    if (byId) return byId;
    const byKey = mapLookup(catalogMaps[`${kind}ByKey`], key);
    if (byKey) return byKey;
  }
  return null;
}

function catalogName(document) {
  return document && (document.nameI18n || document.name || document.labelI18n || document.label);
}

function assignLocalizedFields(target, pair, { nameField = "name", i18nField = "nameI18n" } = {}) {
  if (!target || typeof target !== "object") return target;
  const next = { ...target };
  next[nameField] = pair.ar || pair.en || "";
  next[i18nField] = { ar: pair.ar || pair.en || "", en: pair.en || pair.ar || "" };
  return next;
}

function repairSelectedOption(option = {}, catalogMaps = {}) {
  const id = idText(option.optionId || option.id || option._id);
  const key = keyText(option.optionKey || option.key);
  const document = lookupCatalog(catalogMaps, ["option", "protein", "carb", "saladItem"], id, key);
  const pair = mergeLocalizedPair(
    catalogName(document),
    option.nameI18n || option.name || option.optionNameI18n || option.optionName || option.label,
    key || (document && document.key)
  );
  return {
    ...option,
    optionId: id,
    optionKey: key || keyText(document && document.key),
    name: pair.ar || pair.en,
    optionName: pair.ar || pair.en,
    nameI18n: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
    optionNameI18n: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
  };
}

function repairSalad(salad, catalogMaps = {}) {
  if (!salad || typeof salad !== "object" || Array.isArray(salad)) return salad || null;
  const groups = salad.groups && typeof salad.groups === "object" ? salad.groups : {};
  const repairedGroups = {};
  for (const [groupKey, values] of Object.entries(groups)) {
    repairedGroups[groupKey] = (Array.isArray(values) ? values : []).map((entry) => {
      const item = entry && typeof entry === "object" ? entry : { id: entry };
      const id = idText(item.id || item._id || item.optionId || item.ingredientId);
      const key = keyText(item.key || item.optionKey || item.ingredientKey);
      const kinds = String(groupKey) === "protein"
        ? ["protein", "option", "saladItem"]
        : ["saladItem", "option", "protein"];
      const document = lookupCatalog(catalogMaps, kinds, id, key);
      const pair = mergeLocalizedPair(catalogName(document), item.nameI18n || item.name || item.label, key || (document && document.key));
      return {
        ...item,
        id,
        key: key || keyText(document && document.key),
        name: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
        nameI18n: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
      };
    });
  }
  return { ...salad, groups: repairedGroups };
}

function repairMealSlot(slot = {}, catalogMaps = {}) {
  if (!slot || typeof slot !== "object") return slot;
  const next = { ...slot };

  const productId = idText(slot.productId || slot.sandwichId);
  const productKey = keyText(slot.productKey || slot.sandwichKey);
  const productDoc = lookupCatalog(catalogMaps, ["product", "sandwich"], productId, productKey);
  if (productDoc || slot.productNameI18n || slot.productName || slot.sandwichNameI18n || slot.sandwichName) {
    const pair = mergeLocalizedPair(
      catalogName(productDoc),
      slot.productNameI18n || slot.productName || slot.sandwichNameI18n || slot.sandwichName,
      productKey || (productDoc && productDoc.key)
    );
    next.productId = productId || idText(productDoc && productDoc._id);
    next.productKey = productKey || keyText(productDoc && productDoc.key);
    next.productName = pair.ar || pair.en;
    next.productNameI18n = { ar: pair.ar || pair.en, en: pair.en || pair.ar };
    if (slot.sandwichId || String(slot.selectionType || "") === "sandwich") {
      next.sandwichId = idText(slot.sandwichId || next.productId);
      next.sandwichKey = keyText(slot.sandwichKey || next.productKey);
      next.sandwichName = pair.ar || pair.en;
      next.sandwichNameI18n = { ar: pair.ar || pair.en, en: pair.en || pair.ar };
    }
  }

  const proteinId = idText(slot.proteinId);
  const proteinKey = keyText(slot.proteinKey || slot.proteinFamilyKey);
  const proteinDoc = lookupCatalog(catalogMaps, ["protein", "option", "saladItem"], proteinId, proteinKey);
  if (proteinId || proteinKey || proteinDoc || slot.proteinName || slot.proteinNameI18n) {
    const pair = mergeLocalizedPair(
      catalogName(proteinDoc),
      slot.proteinNameI18n || slot.proteinName,
      proteinKey || (proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey))
    );
    next.proteinId = proteinId || idText(proteinDoc && proteinDoc._id);
    next.proteinKey = proteinKey || keyText(proteinDoc && (proteinDoc.key || proteinDoc.proteinFamilyKey));
    next.proteinFamilyKey = next.proteinKey || keyText(slot.proteinFamilyKey);
    next.proteinName = pair.ar || pair.en;
    next.proteinNameI18n = { ar: pair.ar || pair.en, en: pair.en || pair.ar };
  }

  next.carbSelections = (Array.isArray(slot.carbSelections) ? slot.carbSelections : []).map((carb) => {
    const id = idText(carb && (carb.carbId || carb.id || carb.optionId || carb._id));
    const key = keyText(carb && (carb.key || carb.carbKey || carb.optionKey));
    const document = lookupCatalog(catalogMaps, ["carb", "option"], id, key);
    const pair = mergeLocalizedPair(
      catalogName(document),
      carb && (carb.nameI18n || carb.name || carb.carbName || carb.optionName),
      key || (document && document.key)
    );
    return {
      ...carb,
      carbId: id || idText(document && document._id),
      key: key || keyText(document && document.key),
      name: pair.ar || pair.en,
      nameI18n: { ar: pair.ar || pair.en, en: pair.en || pair.ar },
      grams: carb && carb.grams !== undefined && carb.grams !== null ? Number(carb.grams || 0) : null,
    };
  });

  next.selectedOptions = (Array.isArray(slot.selectedOptions) ? slot.selectedOptions : [])
    .map((option) => repairSelectedOption(option, catalogMaps));
  next.salad = repairSalad(slot.salad, catalogMaps);
  return next;
}

function repairAddon(addon = {}, catalogMaps = {}) {
  if (!addon || typeof addon !== "object") return addon;
  const addonPlanId = idText(addon.addonPlanId);
  const productId = idText(addon.productId || addon.id);
  const key = keyText(addon.key || addon.productKey);
  const document = lookupCatalog(catalogMaps, ["product", "addon"], productId, key);
  const planOnly = Boolean(addonPlanId && productId && addonPlanId === productId && !key && !document);

  if (planOnly) {
    return {
      ...addon,
      id: null,
      productId: null,
      key: null,
      name: "لم يتم تحديد منتج الإضافة",
      nameI18n: { ar: "لم يتم تحديد منتج الإضافة", en: "Addon product not selected" },
    };
  }

  const pair = mergeLocalizedPair(catalogName(document), addon.nameI18n || addon.name, key || (document && document.key));
  return {
    ...addon,
    id: productId || idText(document && document._id),
    productId: productId || idText(document && document._id),
    key: key || keyText(document && document.key),
    name: pair.ar || pair.en || "إضافة",
    nameI18n: { ar: pair.ar || pair.en || "إضافة", en: pair.en || pair.ar || "Addon" },
  };
}

function repairKitchenDetails(details = {}, catalogMaps = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return details;
  return {
    ...details,
    mealSlots: (Array.isArray(details.mealSlots) ? details.mealSlots : []).map((slot) => repairMealSlot(slot, catalogMaps)),
    addons: (Array.isArray(details.addons) ? details.addons : []).map((addon) => repairAddon(addon, catalogMaps)),
  };
}

function wrapBuilder(service, method, mapsIndex) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = function buildArabicCatalogAuthoritativeKitchenDetails(...args) {
    const details = original.apply(this, args);
    return repairKitchenDetails(details, args[mapsIndex] || {});
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function installKitchenArabicCatalogAuthority() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./opsPayloadService");
  wrapBuilder(service, "buildKitchenDetailsPayload", 3);
  wrapBuilder(service, "buildOrderKitchenDetailsPayload", 2);

  const verification = Object.freeze({
    installed: true,
    catalogNamesAuthoritative: true,
    arabicScalarMirroringDisabled: true,
    gramsPreserved: true,
    planOnlyAddonItemsExplicit: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenArabicCatalogAuthority();

module.exports = {
  installKitchenArabicCatalogAuthority,
  localizedPair,
  mergeLocalizedPair,
  repairKitchenDetails,
  repairMealSlot,
};
