const Addon = require("../../models/Addon");
const BuilderCarb = require("../../models/BuilderCarb");
const BuilderProtein = require("../../models/BuilderProtein");
const SaladIngredient = require("../../models/SaladIngredient");
const Sandwich = require("../../models/Sandwich");
const Setting = require("../../models/Setting");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
  SALAD_SELECTION_GROUPS,
  SYSTEM_CURRENCY,
} = require("../../config/mealPlannerContract");
const { pickLang } = require("../../utils/i18n");
const { getRestaurantHours } = require("../restaurantHoursService");
const {
  getPublishedMenu,
  hasPublishedMenuCatalog,
} = require("./menuCatalogService");
const CUSTOMER_VISIBLE_CARB_KEY_SET = new Set(CUSTOMER_VISIBLE_CARB_KEYS);

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

function publicMenuActionForProduct(product = {}) {
  const hasOptionGroups = Array.isArray(product.optionGroups) && product.optionGroups.length > 0;
  const requiresBuilder = product.requiresBuilder === true || hasOptionGroups || product.pricingModel === "per_100g";
  if (product.canAddDirectly === true && !requiresBuilder) {
    return {
      type: "direct_add",
      canAddDirectly: true,
      requiresBuilder: false,
      isCustomizable: false,
    };
  }
  return {
    type: "open_builder",
    canAddDirectly: product.canAddDirectly === true,
    requiresBuilder,
    isCustomizable: product.isCustomizable === true,
  };
}

function publicMenuPricingForProduct(product = {}) {
  return {
    model: product.pricingModel || "fixed",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
    baseUnitGrams: Number(product.baseUnitGrams || 0),
    defaultWeightGrams: Number(product.defaultWeightGrams || 0),
    minWeightGrams: Number(product.minWeightGrams || 0),
    maxWeightGrams: Number(product.maxWeightGrams || 0),
    weightStepGrams: Number(product.weightStepGrams || 0),
  };
}

function buildPublicMenuV2(menu = {}) {
  const sections = (menu.categories || []).map((category) => ({
    id: category.id,
    key: category.key,
    type: "product_collection",
    name: category.name,
    nameI18n: category.nameI18n,
    description: category.description,
    descriptionI18n: category.descriptionI18n,
    imageUrl: category.imageUrl || "",
    sortOrder: Number(category.sortOrder || 0),
    ui: category.ui || {},
    products: (category.products || []).map((product) => ({
      id: product.id,
      key: product.key,
      categoryId: product.categoryId || category.id,
      categoryKey: category.key,
      itemType: product.itemType,
      name: product.name,
      nameI18n: product.nameI18n,
      description: product.description,
      descriptionI18n: product.descriptionI18n,
      imageUrl: product.imageUrl || "",
      sortOrder: Number(product.sortOrder || 0),
      pricing: publicMenuPricingForProduct(product),
      action: publicMenuActionForProduct(product),
      isCustomizable: product.isCustomizable === true,
      ui: product.ui || {},
      optionGroups: product.optionGroups || [],
    })),
  }));

  const products = sections.flatMap((section) => section.products);

  return {
    contractVersion: "one_time_menu.v2",
    source: menu.source || "one_time_order",
    fulfillmentMethod: menu.fulfillmentMethod || "pickup",
    currency: menu.currency || SYSTEM_CURRENCY,
    vatIncluded: menu.vatIncluded !== false,
    vatPercentage: Number(menu.vatPercentage || 0),
    sections,
    productIndex: {
      byId: Object.fromEntries(products.map((product) => [product.id, {
        sectionKey: product.categoryKey,
        productKey: product.key,
      }])),
      byKey: Object.fromEntries(products.map((product) => [product.key, {
        sectionKey: product.categoryKey,
        productId: product.id,
      }])),
    },
    rules: {
      selectionLimitSemantics: "maxSelections_null_means_unlimited",
      pricingUnit: "halala",
      visibility: "published_active_visible_available_one_time_only",
      ordering: "section_sortOrder_then_product_sortOrder",
    },
  };
}

async function getOneTimeOrderMenu({ lang = "en", fulfillmentMethod, includePublicV2 = false } = {}) {
  if (await hasPublishedMenuCatalog()) {
    const [menu, restaurantHours] = await Promise.all([
      getPublishedMenu({ lang, branchId: "" }),
      getRestaurantHours().catch(() => ({})),
    ]);
    const payload = {
      ...menu,
      restaurantHours: {
        ...restaurantHours,
        fulfillmentMethod: "pickup",
      },
    };
    if (includePublicV2) {
      payload.publicMenuV2 = buildPublicMenuV2(payload);
    }
    return payload;
  }

  const [
    proteins,
    carbs,
    sandwiches,
    saladIngredients,
    addonItems,
    restaurantHours,
  ] = await Promise.all([
    BuilderProtein.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    BuilderCarb.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Sandwich.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    SaladIngredient.find({ isActive: true }).sort({ groupKey: 1, sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({ kind: "item", isActive: true }).sort({ category: 1, sortOrder: 1, createdAt: -1 }).lean(),
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

  const payload = {
    currency: SYSTEM_CURRENCY,
    source: "one_time_order",
    fulfillmentMethod: "pickup",
    vatIncluded: true,
    standardMeals: {
      proteins: proteins.map((protein) => toCatalogItem(protein, lang, {
        displayCategoryKey: protein.displayCategoryKey,
        proteinFamilyKey: protein.proteinFamilyKey,
        isPremium: Boolean(protein.isPremium),
        extraFeeHalala: Number(protein.extraFeeHalala || 0),
        currency: protein.currency || SYSTEM_CURRENCY,
        nutrition: protein.nutrition || {},
      })),
      carbs: carbs.filter((carb) => CUSTOMER_VISIBLE_CARB_KEY_SET.has(carb.key)).map((carb) => toCatalogItem(carb, lang, {
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
      groups: SALAD_SELECTION_GROUPS.filter((group) => group.source !== "option").map((group) => ({
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
    restaurantHours: {
      ...restaurantHours,
      fulfillmentMethod: "pickup",
    },
  };
  if (includePublicV2) {
    payload.publicMenuV2 = buildPublicMenuV2(payload);
  }
  return payload;
}

module.exports = {
  getOneTimeOrderMenu,
  buildPublicMenuV2,
  normalizeWindows,
};
