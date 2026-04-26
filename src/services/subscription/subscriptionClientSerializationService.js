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
const { SYSTEM_CURRENCY } = require("../../utils/currency");

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
  const validPlanIds = (planIds || []).filter((id) => mongoose.isValidObjectId(id));
  const validAddonIds = (addonIds || []).filter((id) => mongoose.isValidObjectId(id));
  const validPremiumIds = (premiumIds || []).filter((id) => mongoose.isValidObjectId(id));

  const [planDocs, addonDocs, premiumDocs] = await Promise.all([
    validPlanIds.length ? Plan.find({ _id: { $in: validPlanIds } }).select("_id name").lean() : Promise.resolve([]),
    validAddonIds.length ? Addon.find({ _id: { $in: validAddonIds } }).select("_id name").lean() : Promise.resolve([]),
    validPremiumIds.length ? BuilderProtein.find({ _id: { $in: validPremiumIds } }).select("_id name").lean() : Promise.resolve([]),
  ]);

  return {
    lang,
    planNames: new Map(planDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    addonNames: new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    premiumNames: new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
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
    basePriceHalala:
      subscription && subscription.subtotalHalala !== undefined
        ? subscription.subtotalHalala
        : snapshotPricing.subtotalHalala,
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
        : snapshotPricing.totalHalala,
  });

  return buildMoneySummary({
    ...normalized,
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

  data.status = resolveEffectiveSubscriptionStatus(data, await getRestaurantBusinessDate()) || data.status;

  return localizeSubscriptionReadPayload({
    ...data,
    deliveryAddress: subscription.deliveryAddress || null,
    deliverySlot,
    pricingSummary: resolveSubscriptionPricingSummary(subscription),
    contract: contractReadView.contract,
  }, {
    lang,
    addonNames: catalog.addonNames,
    premiumNames: catalog.premiumNames,
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
