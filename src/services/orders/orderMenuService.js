const Addon = require("../../models/Addon");
const BuilderCarb = require("../../models/BuilderCarb");
const BuilderProtein = require("../../models/BuilderProtein");
const SaladIngredient = require("../../models/SaladIngredient");
const Sandwich = require("../../models/Sandwich");
const Setting = require("../../models/Setting");
const Zone = require("../../models/Zone");
const { SALAD_SELECTION_GROUPS, SYSTEM_CURRENCY } = require("../../config/mealPlannerContract");
const { pickLang } = require("../../utils/i18n");
const { getRestaurantHours } = require("../restaurantHoursService");

function localizeName(value, lang) {
  return pickLang(value, lang) || "";
}

function toCatalogItem(doc, lang, extra = {}) {
  return {
    id: String(doc._id),
    name: localizeName(doc.name, lang),
    description: localizeName(doc.description, lang),
    sortOrder: Number(doc.sortOrder || 0),
    isActive: doc.isActive !== false,
    ...extra,
  };
}

function normalizeWindows(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") {
        const window = item.trim();
        return window ? { value: window, label: window } : null;
      }
      if (item && typeof item === "object") {
        const window = String(item.value || item.key || item.window || item.label || "").trim();
        if (!window) return null;
        return {
          value: window,
          label: String(item.label || window),
          ...(item.from ? { from: item.from } : {}),
          ...(item.to ? { to: item.to } : {}),
        };
      }
      return null;
    })
    .filter(Boolean);
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function getOneTimeOrderMenu({ lang = "en", fulfillmentMethod } = {}) {
  const [
    proteins,
    carbs,
    sandwiches,
    saladIngredients,
    addonItems,
    zones,
    deliveryWindows,
    restaurantHours,
  ] = await Promise.all([
    BuilderProtein.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Sandwich.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    SaladIngredient.find({ isActive: true }).sort({ groupKey: 1, sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({ kind: "item", isActive: true }).sort({ category: 1, sortOrder: 1, createdAt: -1 }).lean(),
    Zone.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("delivery_windows", []),
    getRestaurantHours().catch(() => ({})),
  ]);

  const addonsByCategory = {};
  const serializedAddons = addonItems.map((addon) => {
    const item = toCatalogItem(addon, lang, {
      category: addon.category,
      kind: addon.kind,
      priceHalala: Number(addon.priceHalala || 0),
      currency: addon.currency || SYSTEM_CURRENCY,
    });
    if (!addonsByCategory[item.category]) addonsByCategory[item.category] = [];
    addonsByCategory[item.category].push(item);
    return item;
  });

  return {
    currency: SYSTEM_CURRENCY,
    itemTypes: ["standard_meal", "sandwich", "salad", "addon_item"],
    standardMeals: {
      proteins: proteins.map((protein) => toCatalogItem(protein, lang, {
        displayCategoryKey: protein.displayCategoryKey,
        proteinFamilyKey: protein.proteinFamilyKey,
        isPremium: Boolean(protein.isPremium),
        extraFeeHalala: Number(protein.extraFeeHalala || 0),
        currency: protein.currency || SYSTEM_CURRENCY,
        nutrition: protein.nutrition || {},
      })),
      carbs: carbs.map((carb) => toCatalogItem(carb, lang, {
        displayCategoryKey: carb.displayCategoryKey,
        nutrition: carb.nutrition || {},
      })),
    },
    sandwiches: sandwiches.map((sandwich) => toCatalogItem(sandwich, lang, {
      imageUrl: sandwich.imageUrl || "",
      calories: Number(sandwich.calories || 0),
      priceHalala: Number(sandwich.priceHalala || 0),
      currency: SYSTEM_CURRENCY,
      proteinFamilyKey: sandwich.proteinFamilyKey,
    })),
    salad: {
      ingredients: saladIngredients.map((ingredient) => toCatalogItem(ingredient, lang, {
        groupKey: ingredient.groupKey,
        priceHalala: Math.round(Number(ingredient.price || 0) * 100),
        priceSar: Number(ingredient.price || 0),
        calories: Number(ingredient.calories || 0),
        maxQuantity: ingredient.maxQuantity || null,
      })),
      groups: SALAD_SELECTION_GROUPS.map((group) => ({
        key: group.key,
        name: localizeName(group.name, lang),
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: Number(group.sortOrder || 0),
      })),
    },
    addons: {
      items: serializedAddons,
      byCategory: addonsByCategory,
    },
    delivery: {
      windows: normalizeWindows(deliveryWindows),
      zones: zones.map((zone) => ({
        id: String(zone._id),
        name: localizeName(zone.name, lang),
        deliveryFeeHalala: Number(zone.deliveryFeeHalala || 0),
        sortOrder: Number(zone.sortOrder || 0),
        isActive: zone.isActive !== false,
      })),
    },
    restaurantHours: {
      ...restaurantHours,
      fulfillmentMethod: fulfillmentMethod || undefined,
    },
  };
}

module.exports = {
  getOneTimeOrderMenu,
  normalizeWindows,
};
