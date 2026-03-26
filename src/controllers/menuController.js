const Meal = require("../models/Meal");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const PremiumMeal = require("../models/PremiumMeal");
const Setting = require("../models/Setting");
const Zone = require("../models/Zone");
const { getRequestLang, pickLang } = require("../utils/i18n");
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

function resolveMealCard(doc, lang) {
  return {
    id: String(doc._id),
    name: pickLang(doc.name, lang),
    description: pickLang(doc.description, lang),
    imageUrl: doc.imageUrl || "",
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

async function getOrderMenu(req, res) {
  const lang = getRequestLang(req);
  const [meals, regularPriceSar, premiumPriceSar, customSaladBasePrice, customMealBasePrice] = await Promise.all([
    Meal.find({ isActive: true, availableForOrder: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    getSettingValue("one_time_meal_price", 25),
    getSettingValue("one_time_premium_price", 25),
    getSettingValue("custom_salad_base_price", 0),
    getSettingValue("custom_meal_base_price", 0),
  ]);

  const normalizedRegularPriceSar = Number.isFinite(Number(regularPriceSar)) ? Number(regularPriceSar) : 25;
  const normalizedPremiumPriceSar = Number.isFinite(Number(premiumPriceSar))
    ? Number(premiumPriceSar)
    : normalizedRegularPriceSar;

  return res.status(200).json({
    ok: true,
    data: {
      currency: SYSTEM_CURRENCY,
      customSalad: resolveCustomSaladSupport(customSaladBasePrice),
      customMeal: resolveCustomMealSupport(customMealBasePrice),
      meals: meals.map((meal) => {
        const priceSar = meal.type === "premium" ? normalizedPremiumPriceSar : normalizedRegularPriceSar;
        const priceHalala = Math.max(0, Math.round(priceSar * 100));

        return {
          ...resolveMealCard(meal, lang),
          type: meal.type || "regular",
          priceHalala,
          priceSar: priceHalala / 100,
          currency: SYSTEM_CURRENCY,
        };
      }),
    },
  });
}

async function getSubscriptionMenu(req, res) {
  const lang = getRequestLang(req);
  const [
    plans,
    regularMeals,
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
  const mappedPremiumMeals = premiumMeals.map((meal) => resolvePremiumMealCatalogEntry(meal, lang));
  const mappedAddons = addons.map((addon) => resolveAddonCatalogEntry(addon, lang));
  const deliveryCatalog = resolveDeliveryCatalog({
    lang,
    windows: deliveryWindows,
    deliveryFeeHalala: subscriptionDeliveryFeeHalala,
    zones,
    pickupLocations,
  });

  return res.status(200).json({
    ok: true,
    data: {
      currency: SYSTEM_CURRENCY,
      customSalad: resolveCustomSaladSupport(customSaladBasePrice),
      customMeal: resolveCustomMealSupport(customMealBasePrice),
      plans: mappedPlans,
      regularMeals: regularMeals.map((meal) => ({
        ...resolveMealCard(meal, lang),
        type: "regular",
        pricingModel: "included",
        priceHalala: 0,
        priceSar: 0,
        currency: SYSTEM_CURRENCY,
        ui: {
          title: pickLang(meal.name, lang),
          subtitle: pickLang(meal.description, lang),
        },
      })),
      premiumMeals: mappedPremiumMeals.map((meal) => ({
        ...meal,
        type: "premium",
        pricingModel: "extra_fee",
      })),
      addons: mappedAddons,
      addonsByType: {
        subscription: mappedAddons.filter((addon) => addon.type === "subscription"),
        oneTime: mappedAddons.filter((addon) => addon.type === "one_time"),
      },
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
  getDeliveryOptions,
};
