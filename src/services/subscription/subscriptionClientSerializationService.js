const mongoose = require("mongoose");

const Plan = require("../../models/Plan");
const Addon = require("../../models/Addon");
const BuilderProtein = require("../../models/BuilderProtein");
const { logger } = require("../../utils/logger");
const { pickLang } = require("../../utils/i18n");
const {
  localizeSubscriptionReadPayload,
} = require("../../utils/subscription/subscriptionReadLocalization");
const {
  normalizeStoredVatBreakdown,
  buildMoneySummary,
} = require("../../utils/pricing");
const {
  getSubscriptionContractReadView,
} = require("./subscriptionContractReadService");
const {
  resolveEffectiveSubscriptionStatus,
} = require("./subscriptionOperationsReadService");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const dateUtils = require("../../utils/date");
const { SYSTEM_CURRENCY } = require("../../utils/currency");

const CATALOG_CACHE_TTL = 300000; // 5 minutes
const catalogCache = {
  plans: { data: new Map(), lastFetch: 0 },
  addons: { data: new Map(), lastFetch: 0 },
  proteins: { data: new Map(), lastFetch: 0 },
};

function collectWalletCatalogIds({ subscription, days } = {}) {
  const planIds = new Set();
  const addonIds = new Set();
  const premiumIds = new Set();

  const sub = subscription && typeof subscription === "object" ? subscription : null;
  if (sub && sub.planId) planIds.add(String(sub.planId));

  const addonBalance = Array.isArray(sub && sub.addonBalance) ? sub.addonBalance : [];
  const addonSelections = Array.isArray(sub && sub.addonSelections) ? sub.addonSelections : [];
  for (const row of addonBalance) {
    if (row && row.addonId) addonIds.add(String(row.addonId));
  }
  for (const row of addonSelections) {
    if (row && row.addonId) addonIds.add(String(row.addonId));
  }

  const premiumSelections = Array.isArray(sub && sub.premiumSelections) ? sub.premiumSelections : [];
  const premiumBalance = Array.isArray(sub && sub.premiumBalance) ? sub.premiumBalance : [];
  for (const row of premiumSelections) {
    if (row && row.proteinId) premiumIds.add(String(row.proteinId));
  }
  for (const row of premiumBalance) {
    if (row && row.proteinId) premiumIds.add(String(row.proteinId));
  }

  const normalizedDays = Array.isArray(days) ? days : [];
  for (const day of normalizedDays) {
    if (!day || typeof day !== "object") continue;
    const dayAddons = Array.isArray(day.addons) ? day.addons : [];
    for (const row of dayAddons) {
      if (row && row.addonId) addonIds.add(String(row.addonId));
    }
    const mealSlots = Array.isArray(day.mealSlots) ? day.mealSlots : [];
    for (const slot of mealSlots) {
      if (slot && slot.proteinId) premiumIds.add(String(slot.proteinId));
    }
  }

  return {
    planIds: Array.from(planIds),
    addonIds: Array.from(addonIds),
    premiumIds: Array.from(premiumIds),
  };
}

async function loadWalletCatalogMaps({ subscription = null, days = [], lang = "ar" } = {}) {
  const { planIds, addonIds, premiumIds } = collectWalletCatalogIds({ subscription, days });
  const now = Date.now();

  const getCachedOrFetch = async (ids, cacheKey, Model, select) => {
    const validIds = (ids || []).filter((id) => mongoose.isValidObjectId(id));
    const result = new Map();
    const missingIds = [];

    for (const id of validIds) {
      if (catalogCache[cacheKey].data.has(id) && (now - catalogCache[cacheKey].lastFetch) < CATALOG_CACHE_TTL) {
        result.set(id, catalogCache[cacheKey].data.get(id));
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const docs = await Model.find({ _id: { $in: missingIds } }).select(select).lean();
      for (const doc of docs) {
        const docId = String(doc._id);
        catalogCache[cacheKey].data.set(docId, doc);
        result.set(docId, doc);
      }
      catalogCache[cacheKey].lastFetch = now;
    }

    return result;
  };

  const [planDocsMap, addonDocsMap, premiumDocsMap] = await Promise.all([
    getCachedOrFetch(planIds, "plans", Plan, "_id name"),
    getCachedOrFetch(addonIds, "addons", Addon, "_id name"),
    getCachedOrFetch(premiumIds, "proteins", BuilderProtein, "_id name premiumKey"),
  ]);

  const planDocs = Array.from(planDocsMap.values());
  const addonDocs = Array.from(addonDocsMap.values());
  const premiumDocs = Array.from(premiumDocsMap.values());

  return {
    lang,
    planNames: new Map(planDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    addonNames: new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    premiumNames: new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    premiumKeys: new Map(premiumDocs.map((doc) => [String(doc._id), doc.premiumKey || null])),
  };
}

async function loadWalletCatalogMapsSafely({ subscription = null, days = [], lang = "ar", context = "wallet_catalog" } = {}) {
  try {
    return await loadWalletCatalogMaps({ subscription, days, lang });
  } catch (err) {
    logger.error("loadWalletCatalogMapsSafely failed", {
      context,
      error: err.message,
      stack: err.stack,
      subscriptionId: subscription && subscription._id ? String(subscription._id) : null,
      planId: subscription && subscription.planId ? String(subscription.planId) : null,
    });
    return {
      lang,
      planNames: new Map(),
      addonNames: new Map(),
      premiumNames: new Map(),
    };
  }
}

function resolveSubscriptionPricingSummary(subscription) {
  const snapshotPricing = subscription
    && subscription.contractSnapshot
    && subscription.contractSnapshot.pricing
    && typeof subscription.contractSnapshot.pricing === "object"
    ? subscription.contractSnapshot.pricing
    : {};
  const normalized = normalizeStoredVatBreakdown({
    basePlanGrossHalala:
      subscription && subscription.basePlanGrossHalala !== undefined
        ? subscription.basePlanGrossHalala
        : snapshotPricing.basePlanGrossHalala,
    basePlanNetHalala:
      subscription && subscription.basePlanNetHalala !== undefined
        ? subscription.basePlanNetHalala
        : snapshotPricing.basePlanNetHalala,
    basePlanPriceHalala:
      subscription && subscription.basePlanPriceHalala !== undefined
        ? subscription.basePlanPriceHalala
        : snapshotPricing.basePlanPriceHalala,
    basePriceHalala:
      subscription && subscription.basePlanPriceHalala !== undefined
        ? subscription.basePlanPriceHalala
        : snapshotPricing.basePlanPriceHalala,
    subtotalHalala:
      subscription && subscription.subtotalHalala !== undefined
        ? subscription.subtotalHalala
        : snapshotPricing.subtotalHalala,
    subtotalBeforeVatHalala:
      subscription && (subscription.subtotalBeforeVatHalala !== undefined || subscription.subtotalHalala !== undefined)
        ? (subscription.subtotalBeforeVatHalala || subscription.subtotalHalala)
        : (snapshotPricing.subtotalBeforeVatHalala || snapshotPricing.subtotalHalala),
    vatPercentage:
      subscription && subscription.vatPercentage !== undefined
        ? subscription.vatPercentage
        : snapshotPricing.vatPercentage,
    vatHalala:
      subscription && subscription.vatHalala !== undefined
        ? subscription.vatHalala
        : snapshotPricing.vatHalala,
    totalPriceHalala:
      subscription && subscription.totalPriceHalala !== undefined
        ? subscription.totalPriceHalala
        : (snapshotPricing.totalPriceHalala || snapshotPricing.totalHalala),
    vatPercentage:
      subscription && subscription.vatPercentage !== undefined
        ? subscription.vatPercentage
        : snapshotPricing.vatPercentage,
    vatHalala:
      subscription && subscription.vatHalala !== undefined
        ? subscription.vatHalala
        : snapshotPricing.vatHalala,
  });

  return buildMoneySummary({
    basePlanPriceHalala: normalized.basePlanPriceHalala,
    basePlanGrossHalala: normalized.basePlanGrossHalala,
    basePlanNetHalala: normalized.basePlanNetHalala,
    subtotalBeforeVatHalala: normalized.subtotalBeforeVatHalala,
    subtotalHalala: normalized.subtotalHalala,
    vatPercentage: normalized.vatPercentage,
    vatHalala: normalized.vatHalala,
    totalPriceHalala: normalized.totalPriceHalala,
    currency: subscription && subscription.checkoutCurrency ? subscription.checkoutCurrency : SYSTEM_CURRENCY,
  });
}

async function serializeSubscriptionForClient(subscription, lang) {
  const catalog = await loadWalletCatalogMaps({ subscription, lang });
  const contractReadView = getSubscriptionContractReadView(subscription, {
    audience: "client",
    lang,
    context: "client_subscription_read",
  });
  const deliverySlot = subscription.deliverySlot && typeof subscription.deliverySlot === "object"
    ? subscription.deliverySlot
    : {
      type: subscription.deliveryMode,
      window: subscription.deliveryWindow || "",
      slotId: "",
    };
  const data = { ...subscription };
  delete data.__v;

  const businessDate = await getRestaurantBusinessDate();
  data.status = resolveEffectiveSubscriptionStatus(data, businessDate) || data.status;

  // ── Additive meal balance fields (new policy) ──────────────────────────────
  const remainingMeals = Number(data.remainingMeals || 0);
  const totalMeals = Number(data.totalMeals || 0);
  const consumedMeals = Math.max(0, totalMeals - remainingMeals);
  const isSubscriptionActive = data.status === "active";
  const validityEndDateStr = data.validityEndDate ? dateUtils.toKSADateString(data.validityEndDate) : (data.endDate ? dateUtils.toKSADateString(data.endDate) : null);
  const canConsumeNow = isSubscriptionActive && (!validityEndDateStr || businessDate <= validityEndDateStr);
  const maxConsumableMealsNow = canConsumeNow ? remainingMeals : 0;
  
  const mealBalance = {
    totalMeals,
    remainingMeals,
    consumedMeals,
    canConsumeNow,
    maxConsumableMealsNow,
    mealBalancePolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
    dailyMealLimitEnforced: false,
    dailyMealsDefault: Number(data.selectedMealsPerDay || data.mealsPerDay || 0),
  };
  // ────────────────────────────────────────────────────────────────────────────

  return localizeSubscriptionReadPayload({
    ...data,
    mealBalance,
    deliveryAddress: subscription.deliveryAddress || null,
    deliverySlot,
    pricingSummary: resolveSubscriptionPricingSummary(subscription),
    contract: contractReadView.contract,
  }, {
    lang,
    addonNames: catalog.addonNames,
    premiumNames: catalog.premiumNames,
    premiumKeys: catalog.premiumKeys,
    planName: contractReadView.planName || "",
  });
}

async function serializeSubscriptionForClientWithGuard(subscription, lang) {
  const subscriptionId = String(subscription && subscription._id ? subscription._id : "");
  const planId = subscription && subscription.planId ? String(subscription.planId) : null;

  try {
    return await serializeSubscriptionForClient(subscription, lang);
  } catch (err) {
    logger.error("currentOverview: serializeSubscriptionForClient failed", {
      subscriptionId,
      planId,
      lang,
      error: err.message,
      stack: err.stack,
      rootCause: err.code === "CAST_ERROR" || err.name === "CastError" ? "Mongoose CastError (Likely Legacy ID)" : "Unknown",
    });

    return {
      _id: subscriptionId,
      userId: subscription && subscription.userId ? String(subscription.userId) : null,
      status: subscription && subscription.status ? subscription.status : "unknown",
      planId,
      remainingMeals: Number(subscription && subscription.remainingMeals || 0),
      isDegraded: true,
      errorContext: process.env.NODE_ENV === "development" ? err.message : undefined,
    };
  }
}

module.exports = {
  loadWalletCatalogMaps,
  loadWalletCatalogMapsSafely,
  serializeSubscriptionForClient,
  serializeSubscriptionForClientWithGuard,
};
