"use strict";

const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Meal = require("../../models/Meal");
const MenuProduct = require("../../models/MenuProduct");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const Addon = require("../../models/Addon");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");

const CONSUMED_DAY_STATUSES = new Set([
  "fulfilled",
  "delivered",
  "consumed_without_preparation",
]);

const STATUS_LABELS_AR = Object.freeze({
  open: "متاح للاختيار",
  planned: "تم اختيار الوجبات",
  locked: "مقفل",
  in_preparation: "قيد التحضير",
  preparing: "قيد التحضير",
  ready_for_delivery: "جاهز للتوصيل",
  ready_for_pickup: "جاهز للاستلام",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم الاستلام",
  fulfilled: "تم الاستلام",
  consumed_without_preparation: "محسوم بدون تحضير",
  delivery_canceled: "أُلغي التوصيل",
  canceled_at_branch: "أُلغي في الفرع",
  no_show: "لم يحضر",
  frozen: "مجمّد",
  skipped: "تم التخطي",
  extension: "يوم إضافي",
});

const SOURCE_LABELS_AR = Object.freeze({
  base: "أيام الباقة",
  timeline_extra: "أيام مرونة الباقة",
  freeze_compensation: "تعويض تجميد",
  skip_compensation: "تعويض تخطي",
});

const MEAL_TYPE_LABELS_AR = Object.freeze({
  standard_meal: "وجبة عادية",
  premium_meal: "وجبة مميزة",
  premium_large_salad: "سلطة مميزة كبيرة",
  sandwich: "ساندويتش",
  empty: "وجبة غير محددة",
});

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(asNumber(value, 0)));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pickLocalized(value, lang = "ar") {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asObject(value);
  if (!record) return "";
  const preferred = lang === "en" ? record.en : record.ar;
  const fallback = lang === "en" ? record.ar : record.en;
  for (const candidate of [
    preferred,
    fallback,
    record.displayName,
    record.label,
    record.title,
    asObject(record.name)?.[lang],
    asObject(record.name)?.ar,
    asObject(record.name)?.en,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function objectIdString(value) {
  if (!value) return null;
  const candidate = value && typeof value === "object" && value._id ? value._id : value;
  const text = String(candidate || "").trim();
  return mongoose.isValidObjectId(text) ? text : null;
}

function uniqueObjectIds(values) {
  return [...new Set((values || []).map(objectIdString).filter(Boolean))];
}

function isConsumedDayStatus(status) {
  return CONSUMED_DAY_STATUSES.has(String(status || "").trim().toLowerCase());
}

function buildAllocationCounts(subscription = {}) {
  const byDate = new Map();
  const allocations = Array.isArray(subscription.baseMealAllocations)
    ? subscription.baseMealAllocations
    : [];

  for (const allocation of allocations) {
    const date = String(allocation && allocation.date || "").trim();
    if (!date) continue;
    const current = byDate.get(date) || {
      consumed: 0,
      reserved: 0,
      released: 0,
      forfeited: 0,
      total: 0,
      hasLedger: true,
    };
    const state = String(allocation && allocation.state || "").trim();
    const quantity = Math.max(1, nonNegativeInteger(allocation && allocation.quantity));
    current.total += quantity;
    if (Object.prototype.hasOwnProperty.call(current, state)) {
      current[state] += quantity;
    }
    byDate.set(date, current);
  }

  return byDate;
}

function buildCatalogIdSets(days = []) {
  const mealIds = [];
  const menuProductIds = [];
  const proteinIds = [];
  const carbIds = [];
  const addonIds = [];

  for (const day of days) {
    for (const value of Array.isArray(day.selections) ? day.selections : []) {
      mealIds.push(value);
    }
    for (const slot of Array.isArray(day.baseMealSlots) ? day.baseMealSlots : []) {
      mealIds.push(slot && slot.mealId);
    }
    for (const slot of Array.isArray(day.mealSlots) ? day.mealSlots : []) {
      mealIds.push(slot && slot.sandwichId);
      menuProductIds.push(slot && slot.productId);
      proteinIds.push(slot && slot.proteinId);
      carbIds.push(slot && slot.carbId);
      for (const carb of Array.isArray(slot && slot.carbs) ? slot.carbs : []) {
        carbIds.push(carb && carb.carbId);
      }
      for (const carb of Array.isArray(slot && slot.carbSelections) ? slot.carbSelections : []) {
        carbIds.push(carb && carb.carbId);
      }
    }
    for (const premium of Array.isArray(day.premiumUpgradeSelections) ? day.premiumUpgradeSelections : []) {
      proteinIds.push(premium && premium.proteinId);
    }
    for (const addon of Array.isArray(day.addonSelections) ? day.addonSelections : []) {
      addonIds.push(addon && (addon.addonId || addon.addonPlanId));
      menuProductIds.push(addon && (addon.menuProductId || addon.productId));
    }
  }

  return {
    mealIds: uniqueObjectIds(mealIds),
    menuProductIds: uniqueObjectIds(menuProductIds),
    proteinIds: uniqueObjectIds(proteinIds),
    carbIds: uniqueObjectIds(carbIds),
    addonIds: uniqueObjectIds(addonIds),
  };
}

async function loadCatalogMaps(days) {
  const ids = buildCatalogIdSets(days);
  const [meals, products, proteins, carbs, addons] = await Promise.all([
    ids.mealIds.length
      ? Meal.find({ _id: { $in: ids.mealIds } }).select("_id name type premiumKey").lean()
      : [],
    ids.menuProductIds.length
      ? MenuProduct.find({ _id: { $in: ids.menuProductIds } }).select("_id key name itemType").lean()
      : [],
    ids.proteinIds.length
      ? BuilderProtein.find({ _id: { $in: ids.proteinIds } }).select("_id key name isPremium premiumKey").lean()
      : [],
    ids.carbIds.length
      ? BuilderCarb.find({ _id: { $in: ids.carbIds } }).select("_id key name").lean()
      : [],
    ids.addonIds.length
      ? Addon.find({ _id: { $in: ids.addonIds } }).select("_id name category kind").lean()
      : [],
  ]);

  const toMap = (rows) => new Map(rows.map((row) => [String(row._id), row]));
  return {
    meals: toMap(meals),
    products: toMap(products),
    proteins: toMap(proteins),
    carbs: toMap(carbs),
    addons: toMap(addons),
  };
}

function snapshotName(slot, lang) {
  const snapshots = [
    slot && slot.displaySnapshot,
    slot && slot.confirmationSnapshot,
    slot && slot.fulfillmentSnapshot,
    slot && slot.pricingSnapshot,
  ];
  for (const snapshot of snapshots) {
    const record = asObject(snapshot);
    if (!record) continue;
    const name = pickLocalized(
      record.name || record.nameI18n || record.title || record.label || record.productName,
      lang
    );
    if (name) return name;
  }
  return "";
}

function getCarbRows(slot) {
  if (Array.isArray(slot && slot.carbs) && slot.carbs.length) return slot.carbs;
  if (Array.isArray(slot && slot.carbSelections) && slot.carbSelections.length) {
    return slot.carbSelections;
  }
  return slot && slot.carbId ? [{ carbId: slot.carbId, grams: null }] : [];
}

function buildSlotMealItem(slot, index, catalog, lang) {
  const product = catalog.products.get(objectIdString(slot && slot.productId));
  const sandwich = catalog.meals.get(objectIdString(slot && slot.sandwichId));
  const protein = catalog.proteins.get(objectIdString(slot && slot.proteinId));
  const selectionType = String(slot && slot.selectionType || "standard_meal");
  const carbRows = getCarbRows(slot);
  const carbs = carbRows.map((row) => {
    const carb = catalog.carbs.get(objectIdString(row && row.carbId));
    return {
      id: objectIdString(row && row.carbId),
      name: pickLocalized(carb && carb.name, lang) || "نشويات",
      grams: row && row.grams !== undefined && row.grams !== null
        ? nonNegativeInteger(row.grams)
        : null,
    };
  });
  const proteinName = pickLocalized(protein && protein.name, lang);
  const name = snapshotName(slot, lang)
    || pickLocalized(product && product.name, lang)
    || pickLocalized(sandwich && sandwich.name, lang)
    || proteinName
    || MEAL_TYPE_LABELS_AR[selectionType]
    || "وجبة";

  return {
    id: String(slot && (slot.slotKey || slot.slotIndex) || `slot-${index + 1}`),
    slotIndex: nonNegativeInteger(slot && slot.slotIndex) || index + 1,
    slotKey: String(slot && slot.slotKey || `slot_${index + 1}`),
    name,
    type: selectionType,
    typeLabel: MEAL_TYPE_LABELS_AR[selectionType] || "وجبة",
    quantity: 1,
    isPremium: Boolean(slot && slot.isPremium) || Boolean(protein && protein.isPremium),
    premiumKey: slot && slot.premiumKey || (protein && protein.premiumKey) || null,
    protein: proteinName
      ? { id: objectIdString(slot && slot.proteinId), name: proteinName }
      : null,
    carbs,
  };
}

function buildLegacyMealItems(day, catalog, lang) {
  const ids = [];
  for (const slot of Array.isArray(day.baseMealSlots) ? day.baseMealSlots : []) {
    ids.push(slot && slot.mealId);
  }
  for (const value of Array.isArray(day.selections) ? day.selections : []) {
    ids.push(value);
  }

  return uniqueObjectIds(ids).map((id, index) => {
    const meal = catalog.meals.get(id);
    return {
      id,
      slotIndex: index + 1,
      slotKey: `legacy_${index + 1}`,
      name: pickLocalized(meal && meal.name, lang) || "وجبة",
      type: meal && meal.type === "premium" ? "premium_meal" : "standard_meal",
      typeLabel: meal && meal.type === "premium" ? "وجبة مميزة" : "وجبة عادية",
      quantity: 1,
      isPremium: Boolean(meal && meal.type === "premium"),
      premiumKey: meal && meal.premiumKey || null,
      protein: null,
      carbs: [],
    };
  });
}

function buildDayMealItems(day, catalog, lang) {
  const completeSlots = (Array.isArray(day && day.mealSlots) ? day.mealSlots : [])
    .filter((slot) => slot && slot.status === "complete");
  if (completeSlots.length) {
    return completeSlots.map((slot, index) => buildSlotMealItem(slot, index, catalog, lang));
  }
  return buildLegacyMealItems(day || {}, catalog, lang);
}

function buildDayAddonItems(day, catalog, lang) {
  return (Array.isArray(day && day.addonSelections) ? day.addonSelections : []).map((row, index) => {
    const addon = catalog.addons.get(objectIdString(row && (row.addonId || row.addonPlanId)));
    const product = catalog.products.get(objectIdString(row && (row.menuProductId || row.productId)));
    const name = pickLocalized(
      row && (row.nameI18n || row.name),
      lang
    ) || pickLocalized(product && product.name, lang)
      || pickLocalized(addon && addon.name, lang)
      || "إضافة";
    return {
      id: objectIdString(row && (row.menuProductId || row.productId || row.addonId)) || `addon-${index + 1}`,
      name,
      quantity: Math.max(1, nonNegativeInteger(row && (row.quantity || row.qty || row.requestedQty))),
      category: String(row && (row.entitlementCategory || row.category) || addon && addon.category || ""),
    };
  });
}

function resolveStatusLabel(day, lang) {
  const candidates = [day && day.statusLabel, day && day.commercialStateLabel];
  for (const candidate of candidates) {
    const label = pickLocalized(candidate, lang);
    if (label) return label;
  }
  const status = String(day && (day.dayStatus || day.status) || "open");
  return STATUS_LABELS_AR[status] || status;
}

function resolveDayReceivedMeals({ timelineDay, rawDay, allocation }) {
  if (allocation && allocation.hasLedger) return nonNegativeInteger(allocation.consumed);
  const status = String(
    rawDay && rawDay.status
      || timelineDay && timelineDay.dayStatus
      || timelineDay && timelineDay.status
      || ""
  );
  if (!isConsumedDayStatus(status)) return 0;
  const selected = nonNegativeInteger(timelineDay && timelineDay.meals && timelineDay.meals.selected);
  const required = nonNegativeInteger(timelineDay && timelineDay.meals && timelineDay.meals.required);
  return selected || required;
}

function buildTrackingSummary({ subscription, timeline, dayRows }) {
  const mealBalance = asObject(timeline && timeline.mealBalance) || {};
  const totalMeals = nonNegativeInteger(mealBalance.totalMeals ?? subscription.totalMeals);
  const remainingMeals = nonNegativeInteger(mealBalance.remainingMeals ?? subscription.remainingMeals);
  const reservedMeals = nonNegativeInteger(mealBalance.reservedMeals ?? subscription.reservedMeals);
  const consumedMeals = nonNegativeInteger(
    mealBalance.consumedMeals
      ?? subscription.consumedMeals
      ?? Math.max(0, totalMeals - remainingMeals)
  );
  const forfeitedMeals = nonNegativeInteger(subscription.forfeitedMeals);
  const timelineReceivedMeals = dayRows.reduce(
    (sum, day) => sum + nonNegativeInteger(day.receivedMeals),
    0
  );
  const unattributedConsumedMeals = Math.max(0, consumedMeals - timelineReceivedMeals);
  const deliveredDays = dayRows.filter((day) => day.receivedMeals > 0).length;
  const plannedMeals = dayRows.reduce(
    (sum, day) => sum + nonNegativeInteger(day.selectedMeals),
    0
  );

  return {
    totalMeals,
    consumedMeals,
    receivedMeals: consumedMeals,
    remainingMeals,
    availableMeals: nonNegativeInteger(mealBalance.availableMeals ?? remainingMeals),
    reservedMeals,
    forfeitedMeals,
    unconsumedMeals: Math.max(0, totalMeals - consumedMeals),
    progressPercent: totalMeals > 0
      ? Math.min(100, Math.round((consumedMeals / totalMeals) * 100))
      : 0,
    timelineDays: dayRows.length,
    deliveredDays,
    plannedMeals,
    timelineReceivedMeals,
    unattributedConsumedMeals,
    reconciliation: {
      status: timelineReceivedMeals === consumedMeals ? "balanced" : "difference",
      authoritativeSource: Number(subscription.entitlementVersion || 0) >= 2
        ? "base_meal_allocation_ledger"
        : "subscription_balance_legacy",
      consumedMeals,
      attributedToTimeline: timelineReceivedMeals,
      difference: consumedMeals - timelineReceivedMeals,
    },
  };
}

async function buildSubscriptionDashboardTracking({
  subscription,
  timeline,
  lang = "ar",
  businessDate: requestedBusinessDate = null,
}) {
  if (!subscription || !subscription._id) {
    const err = new Error("Subscription is required");
    err.code = "INVALID_SUBSCRIPTION";
    throw err;
  }

  const rawDays = await SubscriptionDay.find({ subscriptionId: subscription._id })
    .sort({ date: 1 })
    .lean();
  const rawDayMap = new Map(rawDays.map((day) => [String(day.date), day]));
  const allocationMap = buildAllocationCounts(subscription);
  const catalog = await loadCatalogMaps(rawDays);
  const businessDate = requestedBusinessDate || await getRestaurantBusinessDate();

  const dayRows = (Array.isArray(timeline && timeline.days) ? timeline.days : []).map((timelineDay) => {
    const date = String(timelineDay && timelineDay.date || "");
    const rawDay = rawDayMap.get(date) || null;
    const allocation = allocationMap.get(date) || null;
    const mealItems = buildDayMealItems(rawDay, catalog, lang);
    const addonItems = buildDayAddonItems(rawDay, catalog, lang);
    const selectedMeals = nonNegativeInteger(
      timelineDay && timelineDay.meals && timelineDay.meals.selected
    );
    const requiredMeals = nonNegativeInteger(
      timelineDay && timelineDay.meals && timelineDay.meals.required
    );
    const receivedMeals = resolveDayReceivedMeals({ timelineDay, rawDay, allocation });

    return {
      date,
      isToday: date === businessDate,
      isPast: Boolean(timelineDay && timelineDay.isPast),
      status: String(timelineDay && timelineDay.status || "open"),
      dayStatus: String(timelineDay && timelineDay.dayStatus || rawDay && rawDay.status || "open"),
      statusLabel: resolveStatusLabel(timelineDay, lang),
      source: String(timelineDay && timelineDay.source || "base"),
      sourceLabel: SOURCE_LABELS_AR[String(timelineDay && timelineDay.source || "base")]
        || "أيام الاشتراك",
      calendar: timelineDay && timelineDay.calendar || null,
      fulfillmentMode: String(
        timelineDay && (timelineDay.effectiveFulfillmentMode || timelineDay.fulfillmentMode)
          || subscription.deliveryMode
          || ""
      ),
      selectedMeals,
      requiredMeals,
      receivedMeals,
      reservedMeals: allocation ? nonNegativeInteger(allocation.reserved) : 0,
      forfeitedMeals: allocation ? nonNegativeInteger(allocation.forfeited) : 0,
      releasedMeals: allocation ? nonNegativeInteger(allocation.released) : 0,
      balanceSource: allocation && allocation.hasLedger
        ? "base_meal_allocation_ledger"
        : "legacy_day_status",
      mealItems,
      addonItems,
      notes: rawDay && (rawDay.cancellationNote || rawDay.dayEndConsumptionReason || rawDay.settlementReason) || null,
      timestamps: {
        createdAt: rawDay && rawDay.createdAt || null,
        updatedAt: rawDay && rawDay.updatedAt || null,
        fulfilledAt: rawDay && rawDay.fulfilledAt || null,
        canceledAt: rawDay && rawDay.canceledAt || null,
        settledAt: rawDay && rawDay.settledAt || null,
      },
    };
  });

  return {
    contractVersion: "dashboard_subscription_tracking.v1",
    readOnly: true,
    businessDate,
    generatedAt: new Date().toISOString(),
    summary: buildTrackingSummary({ subscription, timeline, dayRows }),
    validity: timeline && timeline.validity || null,
    months: timeline && timeline.months || [],
    days: dayRows,
  };
}

module.exports = {
  buildAllocationCounts,
  buildSubscriptionDashboardTracking,
  buildTrackingSummary,
  isConsumedDayStatus,
  resolveDayReceivedMeals,
};
