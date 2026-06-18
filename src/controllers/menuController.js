const Meal = require("../models/Meal");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const MealCategory = require("../models/MealCategory");
const Setting = require("../models/Setting");
const Zone = require("../models/Zone");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { withDefaultMealNutrition } = require("../utils/mealNutrition");
const {
  buildMealSections,
  buildMealCategoryMap,
  resolveMealCategoryForKey,
} = require("../utils/mealCategoryCatalog");
const {
  resolvePlanCatalogEntry,
  resolvePremiumMealCatalogEntry,
  resolveAddonCatalogEntry,
  resolveDeliveryCatalog,
} = require("../utils/subscription/subscriptionCatalog");
const { getMealPlannerCatalog } = require("../services/subscription/mealPlannerCatalogService");

const SYSTEM_CURRENCY = "SAR";

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function resolveMealCard(doc, lang, category = null) {
  const normalizedDoc = withDefaultMealNutrition(doc);
  const resolvedCategoryKey = category && category.key
    ? category.key
    : normalizedDoc.categoryId
      ? String(normalizedDoc.categoryId)
      : normalizedDoc.category
        ? String(normalizedDoc.category)
        : null;
  return {
    id: String(normalizedDoc._id),
    name: pickLang(normalizedDoc.name, lang),
    description: pickLang(normalizedDoc.description, lang),
    imageUrl: normalizedDoc.imageUrl || "",
    categoryId: normalizedDoc.categoryId ? String(normalizedDoc.categoryId) : null,
    categoryKey: resolvedCategoryKey,
    category: category || null,
    proteinGrams: normalizedDoc.proteinGrams,
    carbGrams: normalizedDoc.carbGrams,
    fatGrams: normalizedDoc.fatGrams,
  };
}

function resolveCustomSaladSupport(basePriceSar) {
  const normalizedBasePriceSar = Number.isFinite(Number(basePriceSar)) ? Number(basePriceSar) : 0;
  const basePriceHalala = Math.max(0, Math.round(normalizedBasePriceSar * 100));

  return {
    enabled: true,
    basePriceHalala,
    basePriceSar: basePriceHalala / 100,
    currency: SYSTEM_CURRENCY,
  };
}

function resolveCustomMealSupport(basePriceSar) {
  const normalizedBasePriceSar = Number.isFinite(Number(basePriceSar)) ? Number(basePriceSar) : 0;
  const basePriceHalala = Math.max(0, Math.round(normalizedBasePriceSar * 100));

  return {
    enabled: true,
    basePriceHalala,
    basePriceSar: basePriceHalala / 100,
    currency: SYSTEM_CURRENCY,
  };
}

function buildAddonCatalog(addonItems = []) {
  const items = Array.isArray(addonItems) ? addonItems : [];
  const byCategory = items.reduce((accumulator, item) => {
    const categoryKey = String(item && item.category ? item.category : "other").trim() || "other";
    if (!accumulator[categoryKey]) {
      accumulator[categoryKey] = [];
    }
    accumulator[categoryKey].push(item);
    return accumulator;
  }, {});

  return {
    items,
    byCategory,
    totalCount: items.length,
  };
}

function buildAddonCatalogFromLegacyPlannerAddons(legacyPlannerAddons = {}) {
  const items = Array.isArray(legacyPlannerAddons?.items) ? legacyPlannerAddons.items : [];
  const grouped = buildAddonCatalog(items);

  return {
    items,
    byCategory: grouped.byCategory,
    totalCount: Number(legacyPlannerAddons?.totalCount ?? items.length),
  };
}

function mapBuilderPremiumProteinsToLegacyRows(builderCatalog = {}) {
  return (builderCatalog.premiumProteins || []).map((protein) => ({
    _id: protein.id,
    name: { ar: protein.name || "", en: protein.name || "" },
    description: { ar: protein.description || "", en: protein.description || "" },
    imageUrl: "",
    currency: protein.currency || SYSTEM_CURRENCY,
    extraFeeHalala: Number(protein.extraFeeHalala || 0),
    proteinGrams: 0,
    carbGrams: 0,
    fatGrams: 0,
    isPremium: true,
    premiumKey: protein.premiumKey,
    isActive: true,
    sortOrder: protein.sortOrder || 0,
  }));
}

function buildSubscriptionMealCatalog({
  lang,
  regularMeals,
  mealCategories,
  premiumMeals,
  addons,
  mealPlannerAddons,
  customSaladBasePrice,
  customMealBasePrice,
} = {}) {
  const mappedPremiumMeals = premiumMeals.map((meal) => resolvePremiumMealCatalogEntry(meal, lang));
  const mappedAddons = addons.map((addon) => {
    const entry = resolveAddonCatalogEntry(addon, lang);
    if (addon.isAvailable === false) {
      entry.isAvailable = false;
    }
    return entry;
  });
  const mappedMealPlannerAddons = (Array.isArray(mealPlannerAddons) ? mealPlannerAddons : addons)
    .map((addon) => {
      const entry = resolveAddonCatalogEntry(addon, lang);
      if (addon.isAvailable === false) {
        entry.isAvailable = false;
      }
      return entry;
    });
  const mealCategoryMap = buildMealCategoryMap(mealCategories, lang);
  const resolvedRegularMeals = regularMeals.map((meal) => {
    const category = resolveMealCategoryForKey(
      meal.categoryId !== undefined && meal.categoryId !== null ? meal.categoryId : meal.category,
      mealCategoryMap,
      lang
    );
    return {
      ...resolveMealCard(meal, lang, category),
      type: "regular",
      pricingModel: "included",
      priceHalala: 0,
      priceSar: 0,
      currency: SYSTEM_CURRENCY,
      ui: {
        title: pickLang(meal.name, lang),
        subtitle: pickLang(meal.description, lang),
      },
    };
  });
  const resolvedRegularMealsById = new Map(resolvedRegularMeals.map((meal) => [meal.id, meal]));
  const mealSections = buildMealSections({
    meals: regularMeals,
    categoryDocs: mealCategories,
    lang,
    itemResolver: (meal, category) => resolvedRegularMealsById.get(String(meal._id)) || {
      ...resolveMealCard(meal, lang, category),
      type: "regular",
    },
  });
  const mealCategoriesPayload = mealSections.map((section) => ({
    ...section.category,
    categoryId: section.category.id,
  }));
  const premiumMealsPayload = mappedPremiumMeals.map((meal) => ({
    ...meal,
    type: "premium",
    pricingModel: "extra_fee",
  }));
  const subscriptionAddons = mappedAddons.filter((addon) => addon.type === "subscription");
  const oneTimeAddons = mappedAddons.filter((addon) => addon.type === "one_time");
  const mealPlannerSubscriptionAddons = mappedMealPlannerAddons.filter((addon) => addon.type === "subscription");
  const mealPlannerOneTimeAddons = mappedMealPlannerAddons.filter((addon) => addon.type === "one_time");

  return {
    currency: SYSTEM_CURRENCY,
    customSalad: resolveCustomSaladSupport(customSaladBasePrice),
    customMeal: resolveCustomMealSupport(customMealBasePrice),
    regularMeals: resolvedRegularMeals,
    mealCategories: mealCategoriesPayload,
    mealSections,
    premiumMeals: premiumMealsPayload,
    addons: mappedAddons,
    addonsByType: {
      subscription: subscriptionAddons,
      oneTime: oneTimeAddons,
    },
    mealPlanner: {
      regularMeals: {
        items: resolvedRegularMeals,
        categories: mealCategoriesPayload,
        sections: mealSections,
        totalCount: resolvedRegularMeals.length,
      },
      premiumMeals: {
        items: premiumMealsPayload,
        totalCount: premiumMealsPayload.length,
      },
      addons: {
        items: mappedMealPlannerAddons,
        byType: {
          subscription: mealPlannerSubscriptionAddons,
          oneTime: mealPlannerOneTimeAddons,
        },
        totalCount: mappedMealPlannerAddons.length,
      },
    },
  };
}

async function getOrderMenu(req, res) {
  const lang = getRequestLang(req);
  const [meals, categories, regularPriceSar, premiumPriceSar, customSaladBasePrice, customMealBasePrice] = await Promise.all([
    Meal.find({ isActive: true, availableForOrder: { $ne: false }, categoryId: { $ne: null } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    MealCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("one_time_meal_price", 25),
    getSettingValue("one_time_premium_price", 25),
    getSettingValue("custom_salad_base_price", 0),
    getSettingValue("custom_meal_base_price", 0),
  ]);

  const normalizedRegularPriceSar = Number.isFinite(Number(regularPriceSar)) ? Number(regularPriceSar) : 25;
  const normalizedPremiumPriceSar = Number.isFinite(Number(premiumPriceSar))
    ? Number(premiumPriceSar)
    : normalizedRegularPriceSar;
  const categoryMap = buildMealCategoryMap(categories, lang);

  const resolvedMeals = meals.map((meal) => {
    const priceSar = meal.type === "premium" ? normalizedPremiumPriceSar : normalizedRegularPriceSar;
    const priceHalala = Math.max(0, Math.round(priceSar * 100));
    const category = resolveMealCategoryForKey(meal.categoryId, categoryMap, lang);

    return {
      ...resolveMealCard(meal, lang, category),
      type: meal.type || "regular",
      priceHalala,
      priceSar: priceHalala / 100,
      currency: SYSTEM_CURRENCY,
    };
  });
  const resolvedMealsById = new Map(resolvedMeals.map((meal) => [meal.id, meal]));

  const mealSections = buildMealSections({
    meals,
    categoryDocs: categories,
    lang,
    itemResolver: (meal, category) => resolvedMealsById.get(String(meal._id)) || {
      ...resolveMealCard(meal, lang, category),
      type: meal.type || "regular",
    },
  });

  return res.status(200).json({
    status: true,
    data: {
      currency: SYSTEM_CURRENCY,
      customSalad: resolveCustomSaladSupport(customSaladBasePrice),
      customMeal: resolveCustomMealSupport(customMealBasePrice),
      meals: resolvedMeals,
      mealCategories: mealSections.map((section) => section.category),
      mealSections,
    },
  });
}

async function getSubscriptionMenu(req, res) {
  const lang = getRequestLang(req);
  const [
    plans,
    regularMeals,
    mealCategories,
    mealPlannerCatalog,
    addons,
    mealPlannerAddons,
    deliveryWindows,
    subscriptionDeliveryFeeHalala,
    zones,
    pickupLocations,
    customSaladBasePrice,
    customMealBasePrice,
  ] = await Promise.all([
    Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Meal.find({ type: "regular", isActive: true, availableForSubscription: { $ne: false }, categoryId: { $ne: null } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    MealCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getMealPlannerCatalog({ lang }),
    Addon.find({ isActive: true, kind: "plan", billingMode: "per_day" }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({ isActive: true, kind: "item", billingMode: "flat_once" }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("delivery_windows", []),
    getSettingValue("subscription_delivery_fee_halala", 0),
    Zone.find({}).sort({ isActive: -1, sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("pickup_locations", []),
    getSettingValue("custom_salad_base_price", 0),
    getSettingValue("custom_meal_base_price", 0),
  ]);

  const basePlanId = req.query?.basePlanId || req.query?.planId;
  let priceMap = new Map();
  if (basePlanId) {
    try {
      const AddonPlanPrice = require("../models/AddonPlanPrice");
      const validateObjectId = require("../utils/validateObjectId");
      validateObjectId(basePlanId, "basePlanId");
      const prices = await AddonPlanPrice.find({ basePlanId, isActive: true }).lean();
      for (const p of prices) {
        priceMap.set(String(p.addonPlanId), p.priceHalala);
      }
    } catch (err) {
      // ignore
    }
  }

  const enrichedAddons = addons.map((addon) => {
    const data = { ...addon };
    if (basePlanId) {
      const matrixPrice = priceMap.get(String(addon._id));
      if (matrixPrice !== undefined) {
        data.priceHalala = matrixPrice;
        data.price = matrixPrice / 100;
        data.priceSar = matrixPrice / 100;
        data.priceLabel = `${matrixPrice / 100} SAR`;
      } else {
        data.isAvailable = false;
      }
    }
    return data;
  });

  const enrichedMealPlannerAddons = mealPlannerAddons.map((addon) => {
    const data = { ...addon };
    if (basePlanId) {
      const matrixPrice = priceMap.get(String(addon._id));
      if (matrixPrice !== undefined) {
        data.priceHalala = matrixPrice;
        data.price = matrixPrice / 100;
        data.priceSar = matrixPrice / 100;
        data.priceLabel = `${matrixPrice / 100} SAR`;
      } else {
        data.isAvailable = false;
      }
    }
    return data;
  });

  const builderCatalog = mealPlannerCatalog?.builderCatalog || mealPlannerCatalog || {};
  const mappedPlans = plans.map((plan) => resolvePlanCatalogEntry(plan, lang));
  const premiumMeals = mapBuilderPremiumProteinsToLegacyRows(builderCatalog);
  const deliveryCatalog = resolveDeliveryCatalog({
    lang,
    windows: deliveryWindows,
    deliveryFeeHalala: subscriptionDeliveryFeeHalala,
    zones,
    pickupLocations,
  });
  const mealCatalog = buildSubscriptionMealCatalog({
    lang,
    regularMeals,
    mealCategories,
    premiumMeals,
    addons: enrichedAddons,
    mealPlannerAddons: enrichedMealPlannerAddons,
    customSaladBasePrice,
    customMealBasePrice,
  });

  return res.status(200).json({
    status: true,
    data: {
      ...mealCatalog,
      plans: mappedPlans,
      delivery: deliveryCatalog,
      flow: {
        steps: [
          { id: "packages", title: lang === "en" ? "Subscription Packages" : "باقات الاشتراك" },
          { id: "premiumMeals", title: lang === "en" ? "Premium Meals" : "الوجبات المميزة" },
          { id: "addons", title: lang === "en" ? "Add-Ons" : "الإضافات" },
          { id: "delivery", title: lang === "en" ? "Delivery Method" : "طريقة الاستلام" },
          { id: "mealSelection", title: lang === "en" ? "Meal Selection" : "اختيار الوجبات" },
        ],
      },
    },
  });
}

async function getSubscriptionMealPlannerMenu(req, res) {
  const lang = getRequestLang(req);
  const includeLegacy = String(req.query?.includeLegacy || "").toLowerCase() === "true";
  const requestedContractVersion = String(req.query?.contractVersion || req.query?.version || "").trim().toLowerCase();
  const includeV3 = !requestedContractVersion
    || requestedContractVersion === "v3"
    || requestedContractVersion === "meal_planner_menu.v3";
  const [regularMeals, mealCategories, addons, mealPlannerCatalog] = await Promise.all([
    Meal.find({ type: "regular", isActive: true, availableForSubscription: { $ne: false }, categoryId: { $ne: null } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    MealCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({ isActive: true, kind: "item", billingMode: "flat_once" }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getMealPlannerCatalog({ lang, includeV3 }),
  ]);
  const legacyBuilderCatalog = mealPlannerCatalog?.builderCatalog || mealPlannerCatalog || {};
  const builderCatalogV2 = mealPlannerCatalog?.builderCatalogV2 || null;
  const plannerCatalog = mealPlannerCatalog?.plannerCatalog || null;
  const appBuilderCatalog = plannerCatalog || {};
  const premiumMeals = mapBuilderPremiumProteinsToLegacyRows(legacyBuilderCatalog);
  const mealCatalog = buildSubscriptionMealCatalog({
    lang,
    regularMeals,
    mealCategories,
    premiumMeals,
    addons,
  });
  const legacyPlannerAddons = mealCatalog?.mealPlanner?.addons || { items: [], totalCount: 0 };

  const data = {
    builderCatalog: appBuilderCatalog,
    addonCatalog: buildAddonCatalogFromLegacyPlannerAddons(legacyPlannerAddons),
    plannerCatalog: plannerCatalog || { sections: [] },
  };
  if (includeLegacy && builderCatalogV2) {
    data.builderCatalogV2 = builderCatalogV2;
  }

  if (includeLegacy) {
    data.legacyBuilderCatalog = legacyBuilderCatalog;
    data.currency = mealCatalog.currency;
    data.regularMeals = mealCatalog.mealPlanner.regularMeals;
    data.premiumMeals = mealCatalog.mealPlanner.premiumMeals;
    data.addons = legacyPlannerAddons;
  }

  return res.status(200).json({
    status: true,
    data,
  });
}

async function getDeliveryOptions(req, res) {
  const lang = getRequestLang(req);
  const [
    deliveryWindows,
    subscriptionDeliveryFeeHalala,
    zones,
    pickupLocations,
  ] = await Promise.all([
    getSettingValue("delivery_windows", []),
    getSettingValue("subscription_delivery_fee_halala", 0),
    Zone.find({}).sort({ isActive: -1, sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("pickup_locations", []),
  ]);

  const deliveryCatalog = resolveDeliveryCatalog({
    lang,
    windows: deliveryWindows,
    deliveryFeeHalala: subscriptionDeliveryFeeHalala,
    zones,
    pickupLocations,
  });

  return res.status(200).json({
    status: true,
    data: deliveryCatalog,
  });
}

module.exports = {
  getOrderMenu,
  getSubscriptionMenu,
  getSubscriptionMealPlannerMenu,
  getDeliveryOptions,
};
