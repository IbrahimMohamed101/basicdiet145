const Meal = require("../models/Meal");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const PremiumMeal = require("../models/PremiumMeal");
const MealCategory = require("../models/MealCategory");
const Setting = require("../models/Setting");
const Zone = require("../models/Zone");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { withDefaultMealNutrition } = require("../utils/mealNutrition");
const {
  buildMealSections,
  buildMealCategoryMap,
  resolveMealCategoryForKey,
  normalizeCategoryKey,
} = require("../utils/mealCategoryCatalog");
const {
  resolvePlanCatalogEntry,
  resolvePremiumMealCatalogEntry,
  resolveAddonCatalogEntry,
  resolveDeliveryCatalog,
} = require("../utils/subscriptionCatalog");

const SYSTEM_CURRENCY = "SAR";

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function resolveMealCard(doc, lang, category = null) {
  const normalizedDoc = withDefaultMealNutrition(doc);
  const categoryKey = normalizeCategoryKey(normalizedDoc.category);
  return {
    id: String(normalizedDoc._id),
    name: pickLang(normalizedDoc.name, lang),
    description: pickLang(normalizedDoc.description, lang),
    imageUrl: normalizedDoc.imageUrl || "",
    category: category || null,
    categoryKey,
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

function buildSubscriptionMealCatalog({
  lang,
  regularMeals,
  mealCategories,
  premiumMeals,
  addons,
  customSaladBasePrice,
  customMealBasePrice,
} = {}) {
  const mappedPremiumMeals = premiumMeals.map((meal) => resolvePremiumMealCatalogEntry(meal, lang));
  const mappedAddons = addons.map((addon) => resolveAddonCatalogEntry(addon, lang));
  const mealCategoryMap = buildMealCategoryMap(mealCategories, lang);
  const resolvedRegularMeals = regularMeals.map((meal) => {
    const category = resolveMealCategoryForKey(meal.category, mealCategoryMap, lang);
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
  const mealCategoriesPayload = mealSections.map((section) => section.category);
  const premiumMealsPayload = mappedPremiumMeals.map((meal) => ({
    ...meal,
    type: "premium",
    pricingModel: "extra_fee",
  }));
  const subscriptionAddons = mappedAddons.filter((addon) => addon.type === "subscription");
  const oneTimeAddons = mappedAddons.filter((addon) => addon.type === "one_time");

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
        items: mappedAddons,
        byType: {
          subscription: subscriptionAddons,
          oneTime: oneTimeAddons,
        },
        totalCount: mappedAddons.length,
      },
    },
  };
}

async function getOrderMenu(req, res) {
  const lang = getRequestLang(req);
  const [meals, categories, regularPriceSar, premiumPriceSar, customSaladBasePrice, customMealBasePrice] = await Promise.all([
    Meal.find({ isActive: true, availableForOrder: { $ne: false } })
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
    const category = resolveMealCategoryForKey(meal.category, categoryMap, lang);

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
    ok: true,
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
    premiumMeals,
    addons,
    deliveryWindows,
    subscriptionDeliveryFeeHalala,
    zones,
    pickupLocations,
    customSaladBasePrice,
    customMealBasePrice,
  ] = await Promise.all([
    Plan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Meal.find({ type: "regular", isActive: true, availableForSubscription: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    MealCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    PremiumMeal.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("delivery_windows", []),
    getSettingValue("subscription_delivery_fee_halala", 0),
    Zone.find({}).sort({ isActive: -1, sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("pickup_locations", []),
    getSettingValue("custom_salad_base_price", 0),
    getSettingValue("custom_meal_base_price", 0),
  ]);

  const mappedPlans = plans.map((plan) => resolvePlanCatalogEntry(plan, lang));
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
    addons,
    customSaladBasePrice,
    customMealBasePrice,
  });

  return res.status(200).json({
    ok: true,
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
  const [regularMeals, mealCategories, premiumMeals, addons] = await Promise.all([
    Meal.find({ type: "regular", isActive: true, availableForSubscription: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    MealCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    PremiumMeal.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);
  const mealCatalog = buildSubscriptionMealCatalog({
    lang,
    regularMeals,
    mealCategories,
    premiumMeals,
    addons,
  });

  return res.status(200).json({
    ok: true,
    data: {
      currency: mealCatalog.currency,
      regularMeals: mealCatalog.mealPlanner.regularMeals,
      premiumMeals: mealCatalog.mealPlanner.premiumMeals,
      addons: mealCatalog.mealPlanner.addons,
    },
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
    ok: true,
    data: deliveryCatalog,
  });
}

module.exports = {
  getOrderMenu,
  getSubscriptionMenu,
  getSubscriptionMealPlannerMenu,
  getDeliveryOptions,
};
