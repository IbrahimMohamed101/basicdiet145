const Meal = require("../models/Meal");
const PremiumMeal = require("../models/PremiumMeal");
const Setting = require("../models/Setting");
const { getRequestLang, pickLang } = require("../utils/i18n");

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

async function getOrderMenu(req, res) {
  const lang = getRequestLang(req);
  const [meals, regularPriceSar, premiumPriceSar, customSaladBasePrice] = await Promise.all([
    Meal.find({ isActive: true, availableForOrder: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    getSettingValue("one_time_meal_price", 25),
    getSettingValue("one_time_premium_price", 25),
    getSettingValue("custom_salad_base_price", 0),
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
  const [regularMeals, premiumMeals, customSaladBasePrice] = await Promise.all([
    Meal.find({ type: "regular", isActive: true, availableForSubscription: { $ne: false } })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean(),
    PremiumMeal.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    getSettingValue("custom_salad_base_price", 0),
  ]);

  return res.status(200).json({
    ok: true,
    data: {
      currency: SYSTEM_CURRENCY,
      customSalad: resolveCustomSaladSupport(customSaladBasePrice),
      regularMeals: regularMeals.map((meal) => ({
        ...resolveMealCard(meal, lang),
        type: "regular",
        pricingModel: "included",
        priceHalala: 0,
        priceSar: 0,
        currency: SYSTEM_CURRENCY,
      })),
      premiumMeals: premiumMeals.map((meal) => ({
        id: String(meal._id),
        name: pickLang(meal.name, lang),
        description: pickLang(meal.description, lang),
        imageUrl: meal.imageUrl || "",
        type: "premium",
        pricingModel: "extra_fee",
        priceHalala: Number(meal.extraFeeHalala || 0),
        priceSar: Number(meal.extraFeeHalala || 0) / 100,
        currency: meal.currency || SYSTEM_CURRENCY,
      })),
    },
  });
}

module.exports = {
  getOrderMenu,
  getSubscriptionMenu,
};
