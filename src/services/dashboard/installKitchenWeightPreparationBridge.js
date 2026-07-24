"use strict";

const {
  extractDeclaredWeightGrams,
  positiveInteger,
} = require("../orders/preparationWeightService");

const INSTALL_MARK = Symbol.for("basicdiet.dashboardKitchenWeightPreparationBridge.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.dashboardKitchenWeightPreparationBridge.wrapped");
const ADDON_CATEGORY_LABELS = Object.freeze({
  desserts: { ar: "حلويات", en: "Desserts" },
  ice_cream: { ar: "آيس كريم", en: "Ice Cream" },
  drinks: { ar: "مشروبات", en: "Drinks" },
  juices: { ar: "عصائر", en: "Juices" },
  snacks: { ar: "سناك", en: "Snacks" },
  addons: { ar: "إضافات", en: "Add-ons" },
});

function text(value) {
  if (value === undefined || value === null) return "";
  if (["string", "number"].includes(typeof value)) return String(value).trim();
  if (typeof value !== "object" || Array.isArray(value)) return "";
  return text(value.ar || value.en || value.nameI18n || value.name || value.labelI18n || value.label || "");
}

function pair(value) {
  if (!value) return { ar: "", en: "" };
  if (typeof value === "object" && !Array.isArray(value)) {
    const nested = value.nameI18n || value.name || value.labelI18n || value.label;
    if (nested && nested !== value) return pair(nested);
    const ar = text(value.ar);
    const en = text(value.en);
    return { ar: ar || en, en: en || ar };
  }
  const scalar = text(value);
  return { ar: scalar, en: scalar };
}

function key(value) {
  return text(value).toLowerCase();
}

function isProteinOption(option = {}) {
  const groupKey = key(option.canonicalGroupKey || option.groupKey);
  const groupName = pair(option.groupNameI18n || option.groupName);
  return ["protein", "proteins"].includes(groupKey)
    || /بروتين/u.test(groupName.ar)
    || /protein/i.test(groupName.en);
}

function enrichBasicSaladSlot(slot = {}, card = {}) {
  const type = String(card.type || slot.selectionType || "");
  if (type !== "basic_salad" && slot.productKey !== "basic_salad") return slot;

  const options = Array.isArray(slot.selectedOptions) ? slot.selectedOptions.map((option) => ({ ...option })) : [];
  const optionIndex = options.findIndex(isProteinOption);
  if (optionIndex < 0) return slot;

  const option = options[optionIndex];
  const declared = extractDeclaredWeightGrams(
    slot.productNameI18n,
    slot.productName,
    card.titleI18n,
    card.title
  );
  const grams = positiveInteger(option.grams || option.extraWeightGrams || slot.proteinGrams || declared);
  const name = pair(option.nameI18n || option.name || option.optionNameI18n || option.optionName);
  options[optionIndex] = { ...option, ...(grams ? { grams } : {}) };

  return {
    ...slot,
    proteinId: option.optionId || option.id || slot.proteinId || null,
    proteinKey: option.optionKey || option.key || slot.proteinKey || null,
    proteinName: name.ar || name.en || slot.proteinName || "",
    proteinNameI18n: { ar: name.ar || name.en, en: name.en || name.ar },
    proteinGrams: grams || slot.proteinGrams || null,
    selectedOptions: options,
  };
}

function addonCategory(addon = {}) {
  const value = key(addon.key || addon.productKey);
  if (value.startsWith("desserts_")) return "desserts";
  if (value.startsWith("ice_cream_")) return "ice_cream";
  if (value.startsWith("drinks_")) return "drinks";
  if (value.startsWith("juices_")) return "juices";
  if (value.startsWith("snacks_")) return "snacks";
  return "addons";
}

function enrichUnplannedAddon(addon = {}) {
  if (addon.addonPlanId) return addon;
  const label = ADDON_CATEGORY_LABELS[addonCategory(addon)] || ADDON_CATEGORY_LABELS.addons;
  return {
    ...addon,
    addonPlanNameI18n: label,
  };
}

function repairDto(dto = {}) {
  if (!dto || typeof dto !== "object") return dto;
  const details = dto.kitchenDetails && typeof dto.kitchenDetails === "object" ? dto.kitchenDetails : null;
  if (!details) return dto;
  const cards = Array.isArray(dto.kitchenCards) ? dto.kitchenCards : [];
  const slots = (Array.isArray(details.mealSlots) ? details.mealSlots : []).map((slot, index) => (
    enrichBasicSaladSlot(slot, cards[index] || {})
  ));
  dto.kitchenDetails = {
    ...details,
    mealSlots: slots,
    addons: (Array.isArray(details.addons) ? details.addons : []).map(enrichUnplannedAddon),
  };
  return dto;
}

function wrap(service, method) {
  const original = service[method];
  if (typeof original !== "function" || original[WRAPPED_MARK]) return;
  const wrapped = function mapKitchenWeightBridge(...args) {
    return repairDto(original.apply(this, args));
  };
  wrapped[WRAPPED_MARK] = true;
  service[method] = wrapped;
}

function installKitchenWeightPreparationBridge() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];
  const service = require("./dashboardDtoService");
  wrap(service, "mapSubscriptionDayToDTO");
  wrap(service, "mapOrderToDTO");
  wrap(service, "mapSubscriptionPickupRequestToDTO");
  const verification = Object.freeze({
    installed: true,
    basicSaladProteinProjected: true,
    unplannedAddonLabelsLocalized: true,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installKitchenWeightPreparationBridge();

module.exports = {
  enrichBasicSaladSlot,
  enrichUnplannedAddon,
  installKitchenWeightPreparationBridge,
  repairDto,
};
