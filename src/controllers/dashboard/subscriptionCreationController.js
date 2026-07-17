"use strict";

const adminController = require("../adminController");

function normalizeHalala(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeCurrency(value) {
  return String(value || "SAR").trim().toUpperCase() || "SAR";
}

function formatAmountLabel(amountHalala, currency = "SAR") {
  const amountSar = normalizeHalala(amountHalala) / 100;
  const numeric = Number.isInteger(amountSar)
    ? String(amountSar)
    : amountSar.toFixed(2).replace(/\.?0+$/, "");
  return `${numeric} ${normalizeCurrency(currency)}`;
}

function moneyBlock(amountHalala, currency = "SAR") {
  const normalized = normalizeHalala(amountHalala);
  return {
    amountHalala: normalized,
    amountSar: normalized / 100,
    currency: normalizeCurrency(currency),
    label: formatAmountLabel(normalized, currency),
  };
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return 0;
}

function resolveQuoteBreakdown(data = {}) {
  const breakdown = data.breakdown && typeof data.breakdown === "object" ? data.breakdown : {};
  const pricingSummary = data.pricingSummary && typeof data.pricingSummary === "object" ? data.pricingSummary : {};
  const contractPricing = data.contract && data.contract.pricing && typeof data.contract.pricing === "object"
    ? data.contract.pricing
    : {};

  const currency = normalizeCurrency(
    breakdown.currency ||
    pricingSummary.currency ||
    data.checkoutCurrency ||
    contractPricing.currency ||
    data.currency ||
    "SAR"
  );

  const subscriptionPriceHalala = firstNumber(
    breakdown.basePlanPriceHalala,
    breakdown.basePlanGrossHalala,
    data.basePlanPriceHalala,
    data.basePlanGrossHalala,
    pricingSummary.basePlanPriceHalala,
    pricingSummary.basePlanGrossHalala,
    pricingSummary.basePriceHalala,
    contractPricing.basePlanPriceHalala,
    contractPricing.basePlanGrossHalala
  );

  const premiumTotalHalala = firstNumber(
    breakdown.premiumTotalHalala,
    contractPricing.premiumTotalHalala,
    Array.isArray(data.premiumItems)
      ? data.premiumItems.reduce((sum, item) => sum + Number(item && item.totalHalala || 0), 0)
      : undefined,
    Array.isArray(data.premiumBalance)
      ? data.premiumBalance.reduce((sum, item) => sum + Number(item && item.totalHalala || 0), 0)
      : undefined
  );

  const addonsTotalHalala = firstNumber(
    breakdown.addonsTotalHalala,
    contractPricing.addonsTotalHalala,
    Array.isArray(data.addonPlans)
      ? data.addonPlans.reduce((sum, item) => sum + Number(item && item.totalHalala || item && item.priceHalala || 0), 0)
      : undefined
  );

  const deliveryFeeHalala = firstNumber(
    breakdown.deliveryFeeHalala,
    data.deliveryFeeHalala,
    contractPricing.deliveryFeeHalala
  );

  const discountHalala = firstNumber(
    breakdown.discountHalala,
    data.discountHalala,
    contractPricing.discountHalala
  );

  const vatPercentage = Number.isFinite(Number(breakdown.vatPercentage))
    ? Number(breakdown.vatPercentage)
    : Number.isFinite(Number(data.vatPercentage))
      ? Number(data.vatPercentage)
      : Number.isFinite(Number(pricingSummary.vatPercentage))
        ? Number(pricingSummary.vatPercentage)
        : Number.isFinite(Number(contractPricing.vatPercentage))
          ? Number(contractPricing.vatPercentage)
          : 15;

  const vatHalala = firstNumber(
    breakdown.vatHalala,
    data.vatHalala,
    pricingSummary.vatHalala,
    contractPricing.vatHalala
  );

  const grossTotalHalala = firstNumber(
    breakdown.grossTotalHalala,
    subscriptionPriceHalala + premiumTotalHalala + addonsTotalHalala + deliveryFeeHalala
  );

  const totalHalala = firstNumber(
    breakdown.totalHalala,
    breakdown.totalPriceHalala,
    data.totalPriceHalala,
    pricingSummary.totalPriceHalala,
    pricingSummary.totalHalala,
    contractPricing.totalHalala,
    contractPricing.totalPriceHalala,
    Math.max(0, grossTotalHalala - discountHalala)
  );

  return {
    currency,
    subscriptionPriceHalala,
    basePlanPriceHalala: subscriptionPriceHalala,
    premiumTotalHalala,
    addonsTotalHalala,
    deliveryFeeHalala,
    discountHalala,
    grossTotalHalala,
    vatPercentage,
    vatHalala,
    totalHalala,
    totalPriceHalala: totalHalala,
  };
}

function buildLineItems(pricing, lang = "en") {
  const labels = lang === "ar"
    ? {
      plan: "الاشتراك الأساسي",
      premium: "الوجبات المميزة",
      addons: "اشتراكات الإضافات",
      delivery: "التوصيل",
      discount: "الخصم",
      vat: "الضريبة",
      total: "الإجمالي",
    }
    : {
      plan: "Base subscription",
      premium: "Premium meals",
      addons: "Add-on subscriptions",
      delivery: "Delivery",
      discount: "Discount",
      vat: "VAT",
      total: "Total",
    };

  const line = (kind, label, amountHalala) => ({
    kind,
    label,
    amountHalala: normalizeHalala(amountHalala),
    amountSar: normalizeHalala(amountHalala) / 100,
    amountLabel: formatAmountLabel(amountHalala, pricing.currency),
  });

  const items = [
    line("plan", labels.plan, pricing.subscriptionPriceHalala),
    line("premium", labels.premium, pricing.premiumTotalHalala),
    line("addons", labels.addons, pricing.addonsTotalHalala),
    line("delivery", labels.delivery, pricing.deliveryFeeHalala),
  ];

  if (pricing.discountHalala > 0) {
    items.push({
      kind: "discount",
      label: labels.discount,
      amountHalala: -pricing.discountHalala,
      amountSar: -pricing.discountHalala / 100,
      amountLabel: `-${formatAmountLabel(pricing.discountHalala, pricing.currency)}`,
    });
  }

  items.push(line("vat", labels.vat, pricing.vatHalala));
  items.push(line("total", labels.total, pricing.totalHalala));
  return items;
}

function sectionLabels(lang = "en") {
  return lang === "ar"
    ? {
      subscriptionMeals: "وجبات الاشتراك",
      premiumMeals: "الوجبات المميزة",
      addonSubscriptions: "اشتراكات الإضافات",
    }
    : {
      subscriptionMeals: "Subscription meals",
      premiumMeals: "Premium meals",
      addonSubscriptions: "Add-on subscriptions",
    };
}

function sectionMoney(amountHalala, currency) {
  const money = moneyBlock(amountHalala, currency);
  return {
    totalHalala: money.amountHalala,
    totalSar: money.amountSar,
    totalLabel: money.label,
    currency: money.currency,
  };
}

function sumItemQuantities(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const parsed = Number(
      item && item.qty !== undefined
        ? item.qty
        : item && item.quantity !== undefined
          ? item.quantity
          : item && item.quantityPerDay !== undefined
            ? item.quantityPerDay
            : 1
    );
    return sum + (Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0);
  }, 0);
}

function buildSubscriptionMealSection({ plan, data, pricing, subscriptionPrice, lang }) {
  const labels = sectionLabels(lang);
  const selectedOptions = data && data.selectedOptions && typeof data.selectedOptions === "object"
    ? data.selectedOptions
    : {};
  const items = plan
    ? [{
      ...plan,
      kind: "subscription_meals",
      type: "base_subscription",
      quantity: 1,
      qty: 1,
      selectedOptions: {
        grams: selectedOptions.grams || plan.grams || plan.selectedGrams || null,
        mealsPerDay: selectedOptions.mealsPerDay || plan.mealsPerDay || plan.selectedMealsPerDay || null,
        startDate: selectedOptions.startDate || plan.startDate || null,
        daysCount: plan.daysCount || selectedOptions.daysCount || null,
      },
      priceHalala: pricing.subscriptionPriceHalala,
      totalHalala: pricing.subscriptionPriceHalala,
      priceSar: pricing.subscriptionPriceHalala / 100,
      totalSar: pricing.subscriptionPriceHalala / 100,
      priceLabel: subscriptionPrice.label,
      totalLabel: subscriptionPrice.label,
    }]
    : [];
  return {
    key: "subscription_meals",
    id: "subscription_meals",
    kind: "plan",
    type: "subscription_meals",
    title: labels.subscriptionMeals,
    label: labels.subscriptionMeals,
    itemCount: items.length,
    totalQuantity: items.length,
    ...sectionMoney(pricing.subscriptionPriceHalala, pricing.currency),
    items,
  };
}

function buildPremiumMealsSection({ premiumItems, pricing, lang }) {
  const labels = sectionLabels(lang);
  return {
    key: "premium_meals",
    id: "premium_meals",
    kind: "premium",
    type: "premium_meals",
    title: labels.premiumMeals,
    label: labels.premiumMeals,
    itemCount: premiumItems.length,
    totalQuantity: sumItemQuantities(premiumItems),
    ...sectionMoney(pricing.premiumTotalHalala, pricing.currency),
    items: premiumItems,
  };
}

function buildAddonSubscriptionsSection({ addonPlans, pricing, lang }) {
  const labels = sectionLabels(lang);
  return {
    key: "addon_subscriptions",
    id: "addon_subscriptions",
    kind: "addons",
    type: "addon_subscriptions",
    title: labels.addonSubscriptions,
    label: labels.addonSubscriptions,
    itemCount: addonPlans.length,
    totalQuantity: sumItemQuantities(addonPlans),
    ...sectionMoney(pricing.addonsTotalHalala, pricing.currency),
    items: addonPlans,
  };
}

function buildDashboardSelectionSections({ plan, data, premiumItems, addonPlans, pricing, subscriptionPrice, lang }) {
  return [
    buildSubscriptionMealSection({ plan, data, pricing, subscriptionPrice, lang }),
    buildPremiumMealsSection({ premiumItems, pricing, lang }),
    buildAddonSubscriptionsSection({ addonPlans, pricing, lang }),
  ];
}

function enrichPremiumItem(item = {}) {
  const unitPriceHalala = firstNumber(item.unitPriceHalala, item.unitExtraFeeHalala, item.priceHalala);
  const qty = firstNumber(item.qty, item.quantity, 1);
  const totalHalala = firstNumber(item.totalHalala, unitPriceHalala * qty);
  const currency = normalizeCurrency(item.currency || "SAR");
  const premiumKey = item.premiumKey || item.selectionType || item.type || null;

  return {
    ...item,
    premiumKey,
    type: item.type || (premiumKey === "premium_large_salad" ? "premium_large_salad" : "premium_meal"),
    selectionType: item.selectionType || premiumKey || "premium_meal",
    qty,
    quantity: qty,
    unitExtraFeeHalala: unitPriceHalala,
    unitPriceHalala,
    unitPriceSar: unitPriceHalala / 100,
    priceHalala: unitPriceHalala,
    priceSar: unitPriceHalala / 100,
    totalHalala,
    totalSar: totalHalala / 100,
    priceLabel: formatAmountLabel(unitPriceHalala, currency),
    totalLabel: formatAmountLabel(totalHalala, currency),
    currency,
    ui: {
      ...(item.ui && typeof item.ui === "object" ? item.ui : {}),
      selectionStyle: (item.ui && item.ui.selectionStyle) || "stepper",
      ctaLabel: (item.ui && item.ui.ctaLabel) || "Add",
    },
  };
}

function enrichAddonPlan(item = {}) {
  const unitPriceHalala = firstNumber(item.unitPriceHalala, item.unitPlanPriceHalala, item.priceHalala);
  const totalHalala = firstNumber(item.totalHalala, item.priceHalala, unitPriceHalala);
  const qty = firstNumber(item.qty, item.quantity, item.quantityPerDay, 1);
  const currency = normalizeCurrency(item.currency || "SAR");
  const billingMode = item.billingMode || (item.type === "one_time" ? "flat_once" : "per_day");

  return {
    ...item,
    addonPlanId: item.addonPlanId || item.addonId || item.id || null,
    qty,
    quantity: qty,
    quantityPerDay: firstNumber(item.quantityPerDay, qty),
    billingMode,
    pricingModel: item.pricingModel || (billingMode === "per_meal" ? "meal_recurring" : billingMode === "flat_once" ? "one_time" : "daily_recurring"),
    billingUnit: item.billingUnit || (billingMode === "per_meal" ? "meal" : billingMode === "flat_once" ? "item" : "day"),
    unitPlanPriceHalala: firstNumber(item.unitPlanPriceHalala, unitPriceHalala),
    unitPriceHalala,
    unitPriceSar: unitPriceHalala / 100,
    priceHalala: totalHalala,
    totalHalala,
    totalSar: totalHalala / 100,
    unitPriceLabel: item.unitPriceLabel || formatAmountLabel(unitPriceHalala, currency),
    totalLabel: item.totalLabel || formatAmountLabel(totalHalala, currency),
    currency,
    ui: {
      ...(item.ui && typeof item.ui === "object" ? item.ui : {}),
      selectionStyle: (item.ui && item.ui.selectionStyle) || "stepper",
      ctaLabel: (item.ui && item.ui.ctaLabel) || "Add",
    },
  };
}

function enrichDashboardSubscriptionData(data = {}, options = {}) {
  if (!data || typeof data !== "object") return data;
  const lang = options.lang || "en";
  const pricing = resolveQuoteBreakdown(data);
  const subscriptionPrice = moneyBlock(pricing.subscriptionPriceHalala, pricing.currency);
  const lineItems = Array.isArray(data.lineItems) && data.lineItems.length
    ? data.lineItems
    : buildLineItems(pricing, lang);
  const premiumItems = Array.isArray(data.premiumItems)
    ? data.premiumItems.map(enrichPremiumItem)
    : [];
  const addonPlans = Array.isArray(data.addonPlans)
    ? data.addonPlans.map(enrichAddonPlan)
    : [];

  const plan = data.plan && typeof data.plan === "object"
    ? {
      ...data.plan,
      subscriptionPrice,
      subscriptionPriceHalala: pricing.subscriptionPriceHalala,
      subscriptionPriceSar: pricing.subscriptionPriceHalala / 100,
      priceHalala: pricing.subscriptionPriceHalala,
      priceSar: pricing.subscriptionPriceHalala / 100,
      priceLabel: subscriptionPrice.label,
    }
    : data.plan;

  const selectionSections = buildDashboardSelectionSections({
    plan,
    data,
    premiumItems,
    addonPlans,
    pricing,
    subscriptionPrice,
    lang,
  });
  const selectionGroups = {
    subscriptionMeals: selectionSections[0],
    premiumMeals: selectionSections[1],
    addonSubscriptions: selectionSections[2],
  };

  return {
    ...data,
    plan,
    premiumItems,
    addonPlans,
    addons: Array.isArray(data.addons) && data.addons.length ? data.addons : addonPlans,
    subscriptionPrice,
    subscriptionPriceHalala: pricing.subscriptionPriceHalala,
    subscriptionPriceSar: pricing.subscriptionPriceHalala / 100,
    pricing: {
      ...(data.pricing && typeof data.pricing === "object" ? data.pricing : {}),
      ...pricing,
      subscriptionPrice,
      lineItems,
    },
    selectionSections,
    dashboardSections: selectionSections,
    selectionGroups,
    checkoutSummary: {
      plan,
      subscriptionPrice,
      premiumItems,
      addonPlans,
      addons: addonPlans,
      selectionSections,
      selectionGroups,
      lineItems,
      pricing,
    },
    quoteSummary: data.quoteSummary || data.summary || {
      plan,
      premiumItems,
      addons: addonPlans,
      selectionSections,
      selectionGroups,
      lineItems,
    },
    lineItems,
  };
}

function enrichDashboardSubscriptionPayload(payload = {}, options = {}) {
  if (!payload || typeof payload !== "object" || payload.status !== true || !payload.data) {
    return payload;
  }

  return {
    ...payload,
    data: enrichDashboardSubscriptionData(payload.data, options),
  };
}

function wrapDashboardSubscriptionHandler(handler) {
  return async function dashboardSubscriptionHandler(req, res, next) {
    let statusCode = 200;
    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);

    res.status = (code) => {
      statusCode = code;
      return res;
    };

    res.json = (payload) => {
      const enriched = enrichDashboardSubscriptionPayload(payload, {
        lang: String(req.headers["accept-language"] || "en").toLowerCase().startsWith("ar") ? "ar" : "en",
      });
      res.status = originalStatus;
      res.json = originalJson;
      return originalStatus(statusCode).json(enriched);
    };

    try {
      return await handler(req, res, next);
    } catch (err) {
      res.status = originalStatus;
      res.json = originalJson;
      throw err;
    }
  };
}

module.exports = {
  quoteSubscriptionAdmin: wrapDashboardSubscriptionHandler(adminController.quoteSubscriptionAdmin),
  createSubscriptionAdmin: wrapDashboardSubscriptionHandler(adminController.createSubscriptionAdmin),
  enrichDashboardSubscriptionPayload,
  enrichDashboardSubscriptionData,
};
