const { pickLang } = require("./i18n");

const SYSTEM_CURRENCY = "SAR";

function resolveSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoneyParts(halala) {
  const normalized = Number(halala);
  const amountHalala = Number.isFinite(normalized) ? Math.max(0, Math.round(normalized)) : 0;
  return {
    halala: amountHalala,
    sar: amountHalala / 100,
  };
}

function localizeText(lang, ar, en) {
  return lang === "en" ? en : ar;
}

function formatCompactMoney(sarAmount) {
  if (!Number.isFinite(Number(sarAmount))) return "0";
  const normalized = Number(sarAmount);
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(2).replace(/\.?0+$/, "");
}

function formatCurrencyLabel(halala, currency = SYSTEM_CURRENCY) {
  const money = toMoneyParts(halala);
  return `${formatCompactMoney(money.sar)} ${currency || SYSTEM_CURRENCY}`;
}

function formatMealsLabel(mealsPerDay, lang, withPerDay = false) {
  const count = Number(mealsPerDay) || 0;
  if (lang === "en") {
    return withPerDay ? `${count} meals/day` : `${count} meals`;
  }
  return withPerDay ? `${count} وجبات يوميا` : `${count} وجبات`;
}

function formatDaysLabel(daysCount, lang) {
  const count = Number(daysCount) || 0;
  return lang === "en" ? `${count} Days` : `${count} يوم`;
}

function formatGramsLabel(grams, lang) {
  const count = Number(grams) || 0;
  return lang === "en" ? `${count}g` : `${count} جرام`;
}

function formatTimeLabel(timeValue, lang) {
  const raw = String(timeValue || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;

  const hours24 = Number(match[1]);
  const minutes = match[2];
  if (!Number.isFinite(hours24)) return raw;

  const period = hours24 >= 12 ? (lang === "en" ? "PM" : "م") : (lang === "en" ? "AM" : "ص");
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes === "00" ? `${hours12} ${period}` : `${hours12}:${minutes} ${period}`;
}

function formatWindowLabel(windowValue, lang) {
  const raw = String(windowValue || "").trim();
  const [from, to] = raw.split("-").map((part) => String(part || "").trim());
  if (!from || !to) return raw;
  return `${formatTimeLabel(from, lang)} - ${formatTimeLabel(to, lang)}`;
}

function resolveSavings(compareAtHalala, priceHalala) {
  const compareAt = Number(compareAtHalala) || 0;
  const price = Number(priceHalala) || 0;
  return Math.max(0, compareAt - price);
}

function resolvePlanMealOption(mealOption, lang, isDefault = false) {
  const price = toMoneyParts(mealOption && mealOption.priceHalala);
  const compareAt = toMoneyParts(mealOption && mealOption.compareAtHalala);
  const savingsHalala = resolveSavings(compareAt.halala, price.halala);
  const savings = toMoneyParts(savingsHalala);
  const mealsPerDay = Number(mealOption && mealOption.mealsPerDay) || 0;

  return {
    mealsPerDay,
    label: formatMealsLabel(mealsPerDay, lang),
    shortLabel: formatMealsLabel(mealsPerDay, lang, true),
    priceHalala: price.halala,
    priceSar: price.sar,
    compareAtHalala: compareAt.halala,
    compareAtSar: compareAt.sar,
    savingsHalala,
    savingsSar: savings.sar,
    priceLabel: formatCurrencyLabel(price.halala),
    compareAtLabel: compareAt.halala > 0 ? formatCurrencyLabel(compareAt.halala) : "",
    savingsLabel: savingsHalala > 0
      ? localizeText(lang, `وفر ${formatCompactMoney(savings.sar)} ${SYSTEM_CURRENCY}`, `Save ${formatCompactMoney(savings.sar)} ${SYSTEM_CURRENCY}`)
      : "",
    isDefault,
  };
}

function resolvePlanGramsOption(gramsOption, lang, isDefault = false) {
  const mealsOptions = Array.isArray(gramsOption && gramsOption.mealsOptions)
    ? gramsOption.mealsOptions
      .filter((mealOption) => mealOption && mealOption.isActive !== false)
      .sort((a, b) => {
        const orderDiff = resolveSortValue(a.sortOrder) - resolveSortValue(b.sortOrder);
        if (orderDiff !== 0) return orderDiff;
        return Number(a.mealsPerDay) - Number(b.mealsPerDay);
      })
      .map((mealOption, index) => resolvePlanMealOption(mealOption, lang, index === 0))
    : [];

  const grams = Number(gramsOption && gramsOption.grams) || 0;

  return {
    grams,
    label: formatGramsLabel(grams, lang),
    subtitle: localizeText(lang, "حجم الحصة", "Portion size"),
    isDefault,
    mealsOptions,
  };
}

function resolvePlanCatalogEntry(plan, lang) {
  const gramsOptions = Array.isArray(plan && plan.gramsOptions)
    ? plan.gramsOptions
      .filter((gramsOption) => gramsOption && gramsOption.isActive !== false)
      .sort((a, b) => {
        const orderDiff = resolveSortValue(a.sortOrder) - resolveSortValue(b.sortOrder);
        if (orderDiff !== 0) return orderDiff;
        return Number(a.grams) - Number(b.grams);
      })
      .map((gramsOption, index) => resolvePlanGramsOption(gramsOption, lang, index === 0))
    : [];

  const defaultGramsOption = gramsOptions[0] || null;
  const defaultMealsOption = defaultGramsOption && Array.isArray(defaultGramsOption.mealsOptions)
    ? defaultGramsOption.mealsOptions[0] || null
    : null;
  const startsFromHalala = defaultMealsOption ? defaultMealsOption.priceHalala : 0;
  const compareAtStartsFromHalala = defaultMealsOption ? defaultMealsOption.compareAtHalala : 0;
  const savingsStartsFromHalala = resolveSavings(compareAtStartsFromHalala, startsFromHalala);

  return {
    id: String(plan._id),
    name: pickLang(plan.name, lang),
    daysCount: Number(plan.daysCount || 0),
    daysLabel: formatDaysLabel(plan.daysCount, lang),
    currency: plan.currency || SYSTEM_CURRENCY,
    isActive: Boolean(plan.isActive),
    skipAllowanceCompensatedDays:
      Number.isInteger(plan.skipAllowanceCompensatedDays) && plan.skipAllowanceCompensatedDays >= 0
        ? plan.skipAllowanceCompensatedDays
        : 0,
    freezePolicy: {
      enabled: plan && plan.freezePolicy && plan.freezePolicy.enabled !== undefined
        ? Boolean(plan.freezePolicy.enabled)
        : true,
      maxDays:
        plan && plan.freezePolicy && Number.isInteger(plan.freezePolicy.maxDays) && plan.freezePolicy.maxDays >= 1
          ? plan.freezePolicy.maxDays
          : 31,
      maxTimes:
        plan && plan.freezePolicy && Number.isInteger(plan.freezePolicy.maxTimes) && plan.freezePolicy.maxTimes >= 0
          ? plan.freezePolicy.maxTimes
          : 1,
    },
    gramsOptions,
    defaultSelection: {
      grams: defaultGramsOption ? defaultGramsOption.grams : null,
      mealsPerDay: defaultMealsOption ? defaultMealsOption.mealsPerDay : null,
    },
    pricing: {
      startsFromHalala,
      startsFromSar: startsFromHalala / 100,
      compareAtStartsFromHalala,
      compareAtStartsFromSar: compareAtStartsFromHalala / 100,
      savingsStartsFromHalala,
      savingsStartsFromSar: savingsStartsFromHalala / 100,
      startsFromLabel: formatCurrencyLabel(startsFromHalala),
    },
    ui: {
      title: pickLang(plan.name, lang),
      subtitle: localizeText(
        lang,
        `اختر عدد الوجبات والحجم المناسب لمدة ${Number(plan.daysCount || 0)} يوم`,
        `Choose meals and portion size for ${Number(plan.daysCount || 0)} days`
      ),
      badges: [
        formatDaysLabel(plan.daysCount, lang),
        defaultGramsOption ? defaultGramsOption.label : "",
        defaultMealsOption ? defaultMealsOption.shortLabel : "",
      ].filter(Boolean),
      ctaLabel: localizeText(lang, "اختر الباقة", "Choose package"),
    },
  };
}

function resolvePremiumMealCatalogEntry(row, lang) {
  const extraFee = toMoneyParts(row && row.extraFeeHalala);

  return {
    id: String(row._id),
    name: pickLang(row.name, lang),
    description: pickLang(row.description, lang),
    imageUrl: row.imageUrl || "",
    currency: row.currency || SYSTEM_CURRENCY,
    extraFeeHalala: extraFee.halala,
    extraFeeSar: extraFee.sar,
    priceHalala: extraFee.halala,
    priceSar: extraFee.sar,
    priceLabel: formatCurrencyLabel(extraFee.halala, row.currency || SYSTEM_CURRENCY),
    ui: {
      title: pickLang(row.name, lang),
      subtitle: pickLang(row.description, lang),
      ctaLabel: localizeText(lang, "أضف", "Add"),
      selectionStyle: "stepper",
    },
  };
}

function resolveAddonCatalogEntry(row, lang) {
  const price = toMoneyParts(
    Number.isInteger(row && row.priceHalala)
      ? row.priceHalala
      : Math.max(0, Math.round(Number((row && row.price) || 0) * 100))
  );
  const type = row && row.type === "one_time" ? "one_time" : "subscription";

  return {
    id: String(row._id),
    name: pickLang(row.name, lang),
    description: pickLang(row.description, lang),
    imageUrl: row.imageUrl || "",
    currency: row.currency || SYSTEM_CURRENCY,
    priceHalala: price.halala,
    priceSar: price.sar,
    priceLabel: formatCurrencyLabel(price.halala, row.currency || SYSTEM_CURRENCY),
    type,
    ui: {
      title: pickLang(row.name, lang),
      subtitle: pickLang(row.description, lang),
      ctaLabel: localizeText(lang, "أضف", "Add"),
      badge: type === "subscription"
        ? localizeText(lang, "إضافة مع الاشتراك", "Subscription add-on")
        : localizeText(lang, "إضافة مرة واحدة", "One-time add-on"),
    },
  };
}

function resolveDeliverySlots(windows, lang, type = "delivery") {
  return Array.isArray(windows)
    ? windows
      .map((windowValue, index) => {
        const normalizedWindow = String(windowValue || "").trim();
        if (!normalizedWindow) return null;
        return {
          id: `${type}_slot_${index + 1}`,
          type,
          window: normalizedWindow,
          label: formatWindowLabel(normalizedWindow, lang),
        };
      })
      .filter(Boolean)
    : [];
}

function resolvePickupLocationEntry(rawLocation, index, lang, fallbackSlots) {
  if (!rawLocation) return null;

  if (typeof rawLocation === "string") {
    const value = rawLocation.trim();
    if (!value) return null;

    return {
      id: `pickup_location_${index + 1}`,
      name: value,
      label: value,
      address: {
        line1: value,
      },
      slots: fallbackSlots,
    };
  }

  if (typeof rawLocation !== "object" || Array.isArray(rawLocation)) {
    return null;
  }

  const localizedName = pickLang(rawLocation.name, lang);
  const plainName = String(
    rawLocation.label
    || rawLocation.title
    || localizedName
    || rawLocation.line1
    || (rawLocation.address && rawLocation.address.line1)
    || ""
  ).trim();
  if (!plainName) return null;

  const address = rawLocation.address && typeof rawLocation.address === "object" && !Array.isArray(rawLocation.address)
    ? {
      line1: rawLocation.address.line1 || rawLocation.line1 || plainName,
      line2: rawLocation.address.line2 || rawLocation.line2 || "",
      city: rawLocation.address.city || rawLocation.city || "",
      district: rawLocation.address.district || rawLocation.district || "",
      street: rawLocation.address.street || rawLocation.street || "",
      building: rawLocation.address.building || rawLocation.building || "",
      apartment: rawLocation.address.apartment || rawLocation.apartment || "",
      lat: rawLocation.address.lat !== undefined ? rawLocation.address.lat : rawLocation.lat,
      lng: rawLocation.address.lng !== undefined ? rawLocation.address.lng : rawLocation.lng,
      notes: rawLocation.address.notes || rawLocation.notes || "",
    }
    : {
      line1: rawLocation.line1 || plainName,
      line2: rawLocation.line2 || "",
      city: rawLocation.city || "",
      district: rawLocation.district || "",
      street: rawLocation.street || "",
      building: rawLocation.building || "",
      apartment: rawLocation.apartment || "",
      lat: rawLocation.lat,
      lng: rawLocation.lng,
      notes: rawLocation.notes || "",
    };

  const slots = resolveDeliverySlots(rawLocation.windows || rawLocation.slots || [], lang, "pickup");

  return {
    id: String(rawLocation.id || rawLocation.locationId || `pickup_location_${index + 1}`),
    name: plainName,
    label: plainName,
    address,
    slots: slots.length ? slots : fallbackSlots,
  };
}

function resolveDeliveryCatalog({
  lang,
  windows,
  deliveryFeeHalala = 0,
  pickupLocations = [],
}) {
  const deliverySlots = resolveDeliverySlots(windows, lang, "delivery");
  const pickupSlots = resolveDeliverySlots(windows, lang, "pickup");
  const deliveryFee = toMoneyParts(deliveryFeeHalala);
  const resolvedPickupLocations = Array.isArray(pickupLocations)
    ? pickupLocations
      .map((location, index) => resolvePickupLocationEntry(location, index, lang, pickupSlots))
      .filter(Boolean)
    : [];

  return {
    methods: [
      {
        id: "delivery",
        type: "delivery",
        title: localizeText(lang, "توصيل للمنزل", "Home Delivery"),
        subtitle: localizeText(lang, "نوصل وجباتك إلى باب المنزل", "Get your meals delivered to your doorstep"),
        feeHalala: deliveryFee.halala,
        feeSar: deliveryFee.sar,
        feeLabel: deliveryFee.halala > 0
          ? formatCurrencyLabel(deliveryFee.halala)
          : localizeText(lang, "مجاني", "Free"),
        requiresAddress: true,
        slots: deliverySlots,
      },
      {
        id: "pickup",
        type: "pickup",
        title: localizeText(lang, "استلام من الفرع", "Pickup"),
        subtitle: localizeText(lang, "استلم طلبك من أقرب موقع متاح", "Pick up your order from an available location"),
        feeHalala: 0,
        feeSar: 0,
        feeLabel: localizeText(lang, "مجاني", "Free"),
        requiresAddress: false,
        slots: pickupSlots,
      },
    ],
    pickupLocations: resolvedPickupLocations,
    defaults: {
      type: "delivery",
      slotId: deliverySlots[0] ? deliverySlots[0].id : "",
      window: deliverySlots[0] ? deliverySlots[0].window : "",
      pickupLocationId: resolvedPickupLocations[0] ? resolvedPickupLocations[0].id : "",
    },
  };
}

function resolvePickupLocationSelection(pickupLocations, locationId, lang, windows = []) {
  const normalizedId = String(locationId || "").trim();
  if (!normalizedId) return null;

  const fallbackSlots = resolveDeliverySlots(windows, lang, "pickup");
  const resolvedLocations = Array.isArray(pickupLocations)
    ? pickupLocations
      .map((location, index) => resolvePickupLocationEntry(location, index, lang, fallbackSlots))
      .filter(Boolean)
    : [];

  return resolvedLocations.find((location) => location.id === normalizedId) || null;
}

function resolveCheckoutLineItem(kind, label, amountHalala) {
  const money = toMoneyParts(amountHalala);
  return {
    kind,
    label,
    amountHalala: money.halala,
    amountSar: money.sar,
    amountLabel: formatCurrencyLabel(money.halala),
  };
}

function resolveQuoteSummary(quote, lang) {
  const planEntry = resolvePlanCatalogEntry(quote.plan, lang);
  const selectedGrams = (planEntry.gramsOptions || []).find((item) => item.grams === quote.grams) || null;
  const selectedMeals = selectedGrams && Array.isArray(selectedGrams.mealsOptions)
    ? selectedGrams.mealsOptions.find((item) => item.mealsPerDay === quote.mealsPerDay) || null
    : null;
  const deliveryType = quote.delivery && quote.delivery.type ? quote.delivery.type : "delivery";
  const deliveryLabel = deliveryType === "pickup"
    ? localizeText(lang, "استلام من الفرع", "Pickup")
    : localizeText(lang, "توصيل للمنزل", "Home Delivery");

  const premiumItems = quote.premiumWalletMode === "generic_v1"
    ? (() => {
      const qty = Number(quote.premiumCount || 0);
      const unit = toMoneyParts(quote.premiumUnitPriceHalala || 0);
      const total = toMoneyParts(unit.halala * qty);
      if (qty <= 0) return [];
      return [{
        id: "",
        name: localizeText(lang, "رصيد بريميوم", "Premium credits"),
        qty,
        unitPriceHalala: unit.halala,
        unitPriceSar: unit.sar,
        totalHalala: total.halala,
        totalSar: total.sar,
        totalLabel: formatCurrencyLabel(total.halala),
      }];
    })()
    : (quote.premiumItems || []).map((item) => {
      const unit = toMoneyParts(item.unitExtraFeeHalala);
      const total = toMoneyParts(unit.halala * Number(item.qty || 0));
      return {
        id: String(item.premiumMeal && item.premiumMeal._id ? item.premiumMeal._id : ""),
        name: pickLang(item.premiumMeal && item.premiumMeal.name, lang),
        qty: Number(item.qty || 0),
        unitPriceHalala: unit.halala,
        unitPriceSar: unit.sar,
        totalHalala: total.halala,
        totalSar: total.sar,
        totalLabel: formatCurrencyLabel(total.halala),
      };
    });

  const addonItems = (quote.addonItems || []).map((item) => {
    const unit = toMoneyParts(item.unitPriceHalala);
    const total = toMoneyParts(unit.halala * Number(item.qty || 0));
    return {
      id: String(item.addon && item.addon._id ? item.addon._id : ""),
      name: pickLang(item.addon && item.addon.name, lang),
      qty: Number(item.qty || 0),
      type: item.addon && item.addon.type ? item.addon.type : "subscription",
      unitPriceHalala: unit.halala,
      unitPriceSar: unit.sar,
      totalHalala: total.halala,
      totalSar: total.sar,
      totalLabel: formatCurrencyLabel(total.halala),
    };
  });

  return {
    plan: {
      id: planEntry.id,
      name: planEntry.name,
      daysCount: planEntry.daysCount,
      daysLabel: planEntry.daysLabel,
      grams: quote.grams,
      gramsLabel: selectedGrams ? selectedGrams.label : formatGramsLabel(quote.grams, lang),
      mealsPerDay: quote.mealsPerDay,
      mealsLabel: selectedMeals ? selectedMeals.shortLabel : formatMealsLabel(quote.mealsPerDay, lang, true),
      startDate: quote.startDate || null,
    },
    delivery: {
      type: deliveryType,
      label: deliveryLabel,
      address: quote.delivery ? quote.delivery.address || null : null,
      slot: quote.delivery && quote.delivery.slot
        ? {
          type: quote.delivery.slot.type || deliveryType,
          slotId: quote.delivery.slot.slotId || "",
          window: quote.delivery.slot.window || "",
          label: formatWindowLabel(quote.delivery.slot.window || "", lang),
        }
        : null,
    },
    premiumItems,
    addons: addonItems,
    lineItems: [
      resolveCheckoutLineItem(
        "plan",
        localizeText(lang, "الباقة", "Plan"),
        quote.breakdown && quote.breakdown.basePlanPriceHalala
      ),
      resolveCheckoutLineItem(
        "premium",
        localizeText(lang, "الوجبات المميزة", "Premium meals"),
        quote.breakdown && quote.breakdown.premiumTotalHalala
      ),
      resolveCheckoutLineItem(
        "addons",
        localizeText(lang, "الإضافات", "Add-ons"),
        quote.breakdown && quote.breakdown.addonsTotalHalala
      ),
      resolveCheckoutLineItem(
        "delivery",
        localizeText(lang, "التوصيل", "Delivery"),
        quote.breakdown && quote.breakdown.deliveryFeeHalala
      ),
      resolveCheckoutLineItem(
        "vat",
        localizeText(lang, "الضريبة", "VAT"),
        quote.breakdown && quote.breakdown.vatHalala
      ),
      resolveCheckoutLineItem(
        "total",
        localizeText(lang, "الإجمالي", "Total"),
        quote.breakdown && quote.breakdown.totalHalala
      ),
    ],
  };
}

module.exports = {
  resolveSortValue,
  toMoneyParts,
  formatCurrencyLabel,
  formatDaysLabel,
  formatGramsLabel,
  formatMealsLabel,
  formatWindowLabel,
  resolvePlanCatalogEntry,
  resolvePremiumMealCatalogEntry,
  resolveAddonCatalogEntry,
  resolveDeliveryCatalog,
  resolvePickupLocationSelection,
  resolveQuoteSummary,
};
