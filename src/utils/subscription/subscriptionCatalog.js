const { pickLang } = require("../i18n");
const { withDefaultMealNutrition } = require("../mealNutrition");

const SYSTEM_CURRENCY = "SAR";
const PREMIUM_PROTEIN_SELECTION_TYPE = "premium_protein";

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

function formatSignedCurrencyLabel(halala, currency = SYSTEM_CURRENCY) {
  const normalized = Number(halala);
  if (!Number.isFinite(normalized)) return `0 ${currency || SYSTEM_CURRENCY}`;
  const absoluteSar = Math.abs(normalized) / 100;
  const compact = formatCompactMoney(absoluteSar);
  const prefix = normalized < 0 ? "-" : "";
  return `${prefix}${compact} ${currency || SYSTEM_CURRENCY}`;
}

function normalizeAddonBillingModeValue(value) {
  const normalized = String(value || "").trim();
  return ["flat_once", "per_day", "per_meal"].includes(normalized) ? normalized : "";
}

function resolveLegacyAddonBillingMode(addon = {}) {
  return "per_day";
}

function resolveSubscriptionAddonBillingMode(addon = {}, options = {}) {
  const explicitMode = normalizeAddonBillingModeValue(addon && addon.billingMode);
  if (explicitMode) return explicitMode;

  const defaultMode = normalizeAddonBillingModeValue(options.defaultMode);
  if (defaultMode) return defaultMode;

  return resolveLegacyAddonBillingMode(addon);
}

function isRecurringSubscriptionAddon(addonOrType, options = {}) {
  if (!addonOrType) return true;

  const mode = typeof addonOrType === "string"
    ? addonOrType
    : resolveSubscriptionAddonBillingMode(addonOrType, options);

  return mode !== "flat_once";
}

function resolveAddonDurationDays(addonOrType, daysCount) {
  if (!isRecurringSubscriptionAddon(addonOrType)) return 1;

  const parsedDays = Number(daysCount);
  if (!Number.isFinite(parsedDays)) return 0;
  return Math.max(0, Math.round(parsedDays));
}

function resolveAddonChargeTotalHalala({ unitPriceHalala, qty, daysCount, mealsPerDay, addon = {} } = {}) {
  const unit = toMoneyParts(unitPriceHalala).halala;
  const parsedQty = Number(qty);
  const normalizedQty = Number.isFinite(parsedQty) ? Math.max(0, Math.round(parsedQty)) : 0;
  const mode = resolveSubscriptionAddonBillingMode(addon, { defaultMode: "per_day" });

  if (mode === "per_meal") {
    const totalMeals = Number(daysCount || 0) * Number(mealsPerDay || 0);
    return unit * normalizedQty * totalMeals;
  }

  const durationDays = resolveAddonDurationDays(mode, daysCount);
  return unit * normalizedQty * durationDays;
}

function formatAddonUnitLabel(halala, currency = SYSTEM_CURRENCY, addon = {}, lang = "ar") {
  const baseLabel = formatCurrencyLabel(halala, currency);
  const mode = resolveSubscriptionAddonBillingMode(addon, { defaultMode: "per_day" });

  if (mode === "per_day") return localizeText(lang, `${baseLabel} / يوم`, `${baseLabel} / day`);
  if (mode === "per_meal") return localizeText(lang, `${baseLabel} / وجبة`, `${baseLabel} / meal`);
  return baseLabel;
}

function formatAddonFormulaLabel({ unitPriceHalala, currency = SYSTEM_CURRENCY, qty, daysCount, mealsPerDay, addon = {}, lang = "ar" } = {}) {
  const unit = toMoneyParts(unitPriceHalala);
  const parsedQty = Number(qty);
  const normalizedQty = Number.isFinite(parsedQty) ? Math.max(0, Math.round(parsedQty)) : 0;
  if (normalizedQty <= 0) return "";

  const compactUnitLabel = formatCompactMoney(unit.sar);
  const mode = resolveSubscriptionAddonBillingMode(addon, { defaultMode: "per_day" });

  if (mode === "per_day") {
    const durationDays = resolveAddonDurationDays(mode, daysCount);
    const unitPerDayLabel = localizeText(
      lang,
      `${compactUnitLabel} ${currency}/يوم`,
      `${compactUnitLabel} ${currency}/day`
    );
    const daysLabel = localizeText(lang, `${durationDays} يوم`, `${durationDays} days`);
    return normalizedQty > 1
      ? `${unitPerDayLabel} × ${daysLabel} × ${normalizedQty}`
      : `${unitPerDayLabel} × ${daysLabel}`;
  }

  if (mode === "per_meal") {
    const durationDays = resolveAddonDurationDays(mode, daysCount);
    const totalMeals = durationDays * Number(mealsPerDay || 0);
    const unitPerMealLabel = localizeText(
      lang,
      `${compactUnitLabel} ${currency}/وجبة`,
      `${compactUnitLabel} ${currency}/meal`
    );
    const mealsLabel = localizeText(lang, `${totalMeals} وجبة`, `${totalMeals} meals`);
    return normalizedQty > 1
      ? `${unitPerMealLabel} × ${mealsLabel} × ${normalizedQty}`
      : `${unitPerMealLabel} × ${mealsLabel}`;
  }

  const baseLabel = formatCurrencyLabel(unit.halala, currency);
  return normalizedQty > 1 ? `${baseLabel} × ${normalizedQty}` : baseLabel;
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
  const skipPolicy = plan && plan.skipPolicy && typeof plan.skipPolicy === "object" ? plan.skipPolicy : {};

  return {
    id: String(plan._id),
    name: pickLang(plan.name, lang),
    daysCount: Number(plan.daysCount || 0),
    daysLabel: formatDaysLabel(plan.daysCount, lang),
    currency: plan.currency || SYSTEM_CURRENCY,
    isActive: Boolean(plan.isActive),
    skipPolicy: {
      enabled: skipPolicy.enabled === undefined ? true : Boolean(skipPolicy.enabled),
      maxDays: Number.isInteger(skipPolicy.maxDays) && skipPolicy.maxDays >= 0 ? skipPolicy.maxDays : 0,
    },
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
  const normalizedRow = withDefaultMealNutrition(row);
  const extraFee = toMoneyParts(normalizedRow && normalizedRow.extraFeeHalala);
  const premiumKey = normalizedRow.premiumKey || null;
  const isPremium = normalizedRow.isPremium === true;

  if (isPremium && !premiumKey) {
    const err = new Error(`Data Integrity Error: Premium record [${normalizedRow._id}] is missing canonical premiumKey`);
    err.code = "PREMIUM_INTEGRITY_VIOLATION";
    throw err;
  }

  const selectionType = premiumKey ? premiumKey : "premium_protein";
  const type = premiumKey ? premiumKey : "premium_protein";

  return {
    id: String(normalizedRow._id),
    premiumKey,
    selectionType,
    type,
    name: pickLang(normalizedRow.name, lang),
    description: pickLang(normalizedRow.description, lang),
    imageUrl: normalizedRow.imageUrl || "",
    currency: normalizedRow.currency || SYSTEM_CURRENCY,
    extraFeeHalala: extraFee.halala,
    extraFeeSar: extraFee.sar,
    priceHalala: extraFee.halala,
    priceSar: extraFee.sar,
    priceLabel: formatCurrencyLabel(extraFee.halala, normalizedRow.currency || SYSTEM_CURRENCY),
    proteinGrams: normalizedRow.proteinGrams,
    carbGrams: normalizedRow.carbGrams,
    fatGrams: normalizedRow.fatGrams,
    ui: {
      title: pickLang(normalizedRow.name, lang),
      subtitle: pickLang(normalizedRow.description, lang),
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
  const billingMode = resolveSubscriptionAddonBillingMode(row, { defaultMode: "per_day" });
  const type = billingMode === "flat_once" ? "one_time" : "subscription";

  const pricingModelMap = {
    flat_once: "one_time",
    per_day: "daily_recurring",
    per_meal: "meal_recurring",
  };

  const billingUnitMap = {
    flat_once: "item",
    per_day: "day",
    per_meal: "meal",
  };

  return {
    id: String(row._id),
    name: pickLang(row.name, lang),
    description: pickLang(row.description, lang),
    imageUrl: row.imageUrl || "",
    currency: row.currency || SYSTEM_CURRENCY,
    priceHalala: price.halala,
    priceSar: price.sar,
    priceLabel: formatAddonUnitLabel(price.halala, row.currency || SYSTEM_CURRENCY, row, lang),
    kind: row.kind || "item",
    category: row.category || "",
    type,
    billingMode,
    pricingModel: pricingModelMap[billingMode] || "one_time",
    billingUnit: billingUnitMap[billingMode] || "item",
    ui: {
      title: pickLang(row.name, lang),
      subtitle: pickLang(row.description, lang),
      ctaLabel: localizeText(lang, "أضف", "Add"),
      badge: billingMode === "flat_once"
        ? localizeText(lang, "إضافة مرة واحدة", "One-time add-on")
        : localizeText(lang, "إضافة مع الاشتراك", "Subscription add-on"),
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
      line1:
        pickLang(rawLocation.address.line1, lang)
        || pickLang(rawLocation.line1, lang)
        || pickLang({ ar: rawLocation.address.addressAr, en: rawLocation.address.addressEn }, lang)
        || pickLang({ ar: rawLocation.address.labelAr, en: rawLocation.address.labelEn }, lang)
        || plainName,
      line2:
        pickLang(rawLocation.address.line2, lang)
        || pickLang(rawLocation.line2, lang)
        || "",
      city: rawLocation.address.city || rawLocation.city || "",
      district:
        pickLang(rawLocation.address.district, lang)
        || pickLang(rawLocation.district, lang)
        || "",
      street:
        pickLang(rawLocation.address.street, lang)
        || pickLang(rawLocation.street, lang)
        || "",
      building: rawLocation.address.building || rawLocation.building || "",
      apartment: rawLocation.address.apartment || rawLocation.apartment || "",
      lat: rawLocation.address.lat !== undefined ? rawLocation.address.lat : rawLocation.lat,
      lng: rawLocation.address.lng !== undefined ? rawLocation.address.lng : rawLocation.lng,
      notes:
        pickLang(rawLocation.address.notes, lang)
        || pickLang(rawLocation.notes, lang)
        || "",
    }
    : {
      line1:
        pickLang(rawLocation.line1, lang)
        || pickLang({ ar: rawLocation.addressAr, en: rawLocation.addressEn }, lang)
        || plainName,
      line2: pickLang(rawLocation.line2, lang) || "",
      city: rawLocation.city || "",
      district: pickLang(rawLocation.district, lang) || "",
      street: pickLang(rawLocation.street, lang) || "",
      building: rawLocation.building || "",
      apartment: rawLocation.apartment || "",
      lat: rawLocation.lat,
      lng: rawLocation.lng,
      notes: pickLang(rawLocation.notes, lang) || "",
    };

  return {
    id: String(rawLocation.id || rawLocation.locationId || `pickup_location_${index + 1}`),
    name: plainName,
    label: plainName,
    address,
    slots: [],
  };
}

function resolveDeliveryAreaEntry(zone, lang) {
  if (!zone || !zone._id || !zone.name) return null;

  const fee = toMoneyParts(zone.deliveryFeeHalala);
  const isActive = zone.isActive !== false;

  return {
    id: String(zone._id),
    zoneId: String(zone._id),
    name: pickLang(zone.name, lang),
    label: pickLang(zone.name, lang),
    feeHalala: fee.halala,
    feeSar: fee.sar,
    feeLabel: formatCurrencyLabel(fee.halala),
    isActive,
    availability: isActive ? "available" : "unavailable",
    availabilityLabel: isActive
      ? localizeText(lang, "متاح", "Available")
      : localizeText(lang, "غير متاح", "Not available"),
  };
}

function resolveDeliveryCatalog({
  lang,
  windows,
  deliveryFeeHalala = 0,
  pickupLocations = [],
  zones = [],
}) {
  const deliverySlots = resolveDeliverySlots(windows, lang, "delivery");
  const deliveryFee = toMoneyParts(deliveryFeeHalala);
  const resolvedAreas = Array.isArray(zones)
    ? zones
      .map((zone) => resolveDeliveryAreaEntry(zone, lang))
      .filter(Boolean)
    : [];
  const hasAreaPricing = resolvedAreas.length > 0;
  const resolvedPickupLocations = Array.isArray(pickupLocations)
    ? pickupLocations
      .map((location, index) => resolvePickupLocationEntry(location, index, lang, []))
      .filter(Boolean)
    : [];

  return {
    methods: [
      {
        id: "delivery",
        type: "delivery",
        title: localizeText(lang, "توصيل للمنزل", "Home Delivery"),
        subtitle: localizeText(lang, "نوصل وجباتك إلى باب المنزل", "Get your meals delivered to your doorstep"),
        pricingMode: hasAreaPricing ? "zone_based" : "flat_fee",
        feeHalala: hasAreaPricing ? 0 : deliveryFee.halala,
        feeSar: hasAreaPricing ? 0 : deliveryFee.sar,
        feeLabel: hasAreaPricing
          ? localizeText(lang, "حسب المنطقة", "Depends on area")
          : deliveryFee.halala > 0
          ? formatCurrencyLabel(deliveryFee.halala)
          : localizeText(lang, "مجاني", "Free"),
        helperText: hasAreaPricing
          ? localizeText(lang, "رسوم التوصيل تعتمد على منطقتك", "Delivery fee depends on your area")
          : "",
        areaSelectionRequired: hasAreaPricing,
        requiresAddress: true,
        slots: deliverySlots,
      },
      {
        id: "pickup",
        type: "pickup",
        title: localizeText(lang, "استلام من الفرع", "Pickup"),
        subtitle: localizeText(
          lang,
          "يمكنك استلام وجباتك من الفرع في أي وقت خلال ساعات العمل",
          "Pick up your meals from the branch at any time during working hours"
        ),
        feeHalala: 0,
        feeSar: 0,
        feeLabel: localizeText(lang, "مجاني", "Free"),
        requiresAddress: false,
        helperText: localizeText(lang, "لا يلزم اختيار وقت للاستلام", "No pickup time selection is required"),
        slots: [],
      },
    ],
    areas: resolvedAreas,
    pickupLocations: resolvedPickupLocations,
    defaults: {
      type: "delivery",
      slotId: deliverySlots[0] ? deliverySlots[0].id : "",
      window: deliverySlots[0] ? deliverySlots[0].window : "",
      zoneId: "",
      areaId: "",
      pickupLocationId: resolvedPickupLocations[0] ? resolvedPickupLocations[0].id : "",
    },
  };
}

function resolvePickupLocationSelection(pickupLocations, locationId, lang, windows = []) {
  const normalizedId = String(locationId || "").trim();
  if (!normalizedId) return null;

  const resolvedLocations = Array.isArray(pickupLocations)
    ? pickupLocations
      .map((location, index) => resolvePickupLocationEntry(location, index, lang, []))
      .filter(Boolean)
    : [];

  return resolvedLocations.find((location) => location.id === normalizedId) || null;
}

function resolveCheckoutLineItem(kind, label, amountHalala) {
  const normalized = Number(amountHalala);
  const signedAmount = Number.isFinite(normalized) ? Math.round(normalized) : 0;
  return {
    kind,
    label,
    amountHalala: signedAmount,
    amountSar: signedAmount / 100,
    amountLabel: formatSignedCurrencyLabel(signedAmount),
  };
}

function resolveQuoteSummary(quote, lang) {
  const planEntry = resolvePlanCatalogEntry(quote.plan, lang);
  const selectedGrams = (planEntry.gramsOptions || []).find((item) => item.grams === quote.grams) || null;
  const selectedMeals = selectedGrams && Array.isArray(selectedGrams.mealsOptions)
    ? selectedGrams.mealsOptions.find((item) => item.mealsPerDay === quote.mealsPerDay) || null
    : null;
  const planDaysCount = Number(
    quote && quote.plan && quote.plan.daysCount !== undefined
      ? quote.plan.daysCount
      : planEntry.daysCount
  ) || 0;
  const deliveryType = quote.delivery && quote.delivery.type ? quote.delivery.type : "delivery";
  const deliveryLabel = deliveryType === "pickup"
    ? localizeText(lang, "استلام من الفرع", "Pickup")
    : localizeText(lang, "توصيل للمنزل", "Home Delivery");

  const premiumItems = (quote.premiumItems || []).map((item) => {
    const unit = toMoneyParts(item.unitExtraFeeHalala);
    const total = toMoneyParts(unit.halala * Number(item.qty || 0));
    return {
      id: String(item.protein && item.protein._id ? item.protein._id : ""),
      proteinId: String(item.protein && item.protein._id ? item.protein._id : ""),
      name: pickLang(item.protein && item.protein.name, lang),
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
    const addon = item.addon || {};
    const billingMode = resolveSubscriptionAddonBillingMode(addon, { defaultMode: "per_day" });
    const addonType = billingMode === "flat_once" ? "one_time" : "subscription";

    const total = toMoneyParts(resolveAddonChargeTotalHalala({
      unitPriceHalala: unit.halala,
      qty: item.qty,
      daysCount: planDaysCount,
      mealsPerDay: quote.mealsPerDay,
      addon,
    }));

    const pricingModelMap = {
      flat_once: "one_time",
      per_day: "daily_recurring",
      per_meal: "meal_recurring",
    };

    const billingUnitMap = {
      flat_once: "item",
      per_day: "day",
      per_meal: "meal",
    };

    return {
      id: String(addon._id || ""),
      name: pickLang(addon.name, lang),
      qty: Number(item.qty || 0),
      type: addonType,
      billingMode,
      pricingModel: pricingModelMap[billingMode] || "one_time",
      billingUnit: billingUnitMap[billingMode] || "item",
      durationDays: resolveAddonDurationDays(billingMode, planDaysCount),
      unitPriceHalala: unit.halala,
      unitPriceSar: unit.sar,
      unitPriceLabel: formatAddonUnitLabel(unit.halala, item.currency || SYSTEM_CURRENCY, addon, lang),
      formulaLabel: formatAddonFormulaLabel({
        unitPriceHalala: unit.halala,
        currency: item.currency || SYSTEM_CURRENCY,
        qty: item.qty,
        daysCount: planDaysCount,
        mealsPerDay: quote.mealsPerDay,
        addon,
        lang,
      }),
      totalHalala: total.halala,
      totalSar: total.sar,
      totalLabel: formatCurrencyLabel(total.halala),
    };
  });

  const promo = quote && quote.promoCode && typeof quote.promoCode === "object"
    ? quote.promoCode
    : null;
  const discountAmountHalala = promo
    ? -Math.abs(Number(promo.discountAmountHalala || 0))
    : 0;

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
      zoneId: quote.delivery ? quote.delivery.zoneId || null : null,
      zoneName: quote.delivery ? quote.delivery.zoneName || "" : "",
      feeHalala: quote.breakdown ? Number(quote.breakdown.deliveryFeeHalala || 0) : 0,
      feeSar: quote.breakdown ? Number(quote.breakdown.deliveryFeeHalala || 0) / 100 : 0,
      feeLabel: formatCurrencyLabel(quote.breakdown && quote.breakdown.deliveryFeeHalala),
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
      ...(discountAmountHalala !== 0
        ? [
          resolveCheckoutLineItem(
            "discount",
            promo && promo.title
              ? String(promo.title)
              : localizeText(lang, "خصم الكوبون", "Promo discount"),
            discountAmountHalala
          ),
        ]
        : []),
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
  formatSignedCurrencyLabel,
  formatDaysLabel,
  formatGramsLabel,
  formatMealsLabel,
  formatWindowLabel,
  resolvePlanCatalogEntry,
  resolvePremiumMealCatalogEntry,
  resolveAddonCatalogEntry,
  resolveSubscriptionAddonBillingMode,
  isRecurringSubscriptionAddon,
  resolveAddonDurationDays,
  resolveAddonChargeTotalHalala,
  formatAddonUnitLabel,
  formatAddonFormulaLabel,
  resolveDeliveryCatalog,
  resolvePickupLocationSelection,
  resolveQuoteSummary,
};
