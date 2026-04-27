const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const BuilderProtein = require("../../models/BuilderProtein");
const { logger } = require("../../utils/logger");
const { resolveSubscriptionSkipPolicy } = require("./subscriptionContractReadService");
const { resolveSkipRemainingDays } = require("./subscriptionSkipService");
const { resolvePickupPreparationState } = require("./subscriptionPickupPreparationService");
const { serializeSubscriptionForClientWithGuard } = require("./subscriptionClientSerializationService");
const { getRestaurantHours } = require("../restaurantHoursService");
const { pickLang } = require("../../utils/i18n");

function isPopulatedPlanDocument(plan) {
  return Boolean(
    plan
    && typeof plan === "object"
    && !Array.isArray(plan)
    && (
      Object.prototype.hasOwnProperty.call(plan, "skipPolicy")
      || Object.prototype.hasOwnProperty.call(plan, "freezePolicy")
      || Object.prototype.hasOwnProperty.call(plan, "name")
    )
  );
}

async function buildSubscriptionOverviewSkipUsageSafe(subscription, runtime) {
  if (!subscription) {
    return {
      skipDaysUsed: 0,
      skipDaysLimit: 0,
      remainingSkipDays: 0,
    };
  }

  let livePlan = null;
  const subscriptionId = String(subscription._id || "");
  const planId = subscription.planId ? String(subscription.planId) : null;

  try {
    if (subscription.planId) {
      if (isPopulatedPlanDocument(subscription.planId)) {
        livePlan = subscription.planId;
      } else {
        livePlan = await runtime.findPlanById(subscription.planId);
        if (!livePlan) {
          logger.warn("currentOverview: plan not found for skipUsage", {
            subscriptionId,
            planId,
          });
        }
      }
    }
  } catch (err) {
    logger.error("currentOverview: error loading plan for skipUsage", {
      subscriptionId,
      planId,
      error: err.message,
      stack: err.stack,
    });
    livePlan = null;
  }

  let skipPolicy = null;
  try {
    skipPolicy = resolveSubscriptionSkipPolicy(subscription, livePlan, {
      context: "current_subscription_overview",
    });
  } catch (err) {
    logger.error("currentOverview: resolveSubscriptionSkipPolicy failed", {
      subscriptionId,
      planId,
      error: err.message,
      stack: err.stack,
    });
    skipPolicy = { enabled: false, maxDays: 0 };
  }

  return {
    skipDaysUsed: Number(subscription && subscription.skipDaysUsed ? subscription.skipDaysUsed : 0),
    skipDaysLimit: Number(skipPolicy && skipPolicy.maxDays ? skipPolicy.maxDays : 0),
    remainingSkipDays: resolveSkipRemainingDays(skipPolicy, subscription),
  };
}

function normalizePremiumName(value) {
  if (!value || typeof value !== "string") return "";
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";

const CANONICAL_PREMIUM_KEYS = ["shrimp", "beef_steak", "salmon", "custom_premium_salad"];

const CUSTOM_PREMIUM_SALAD_NAMES = {
  ar: "سلطة مميزة",
  en: "Custom Premium Salad",
};

function buildCustomPremiumSaladItem(lang) {
  const name = lang === "en" ? CUSTOM_PREMIUM_SALAD_NAMES.en : CUSTOM_PREMIUM_SALAD_NAMES.ar;
  return {
    premiumMealId: CUSTOM_PREMIUM_SALAD_KEY,
    premiumKey: CUSTOM_PREMIUM_SALAD_KEY,
    name,
    type: "custom_premium_salad",
    extraFeeHalala: 3000,
    purchasedQtyTotal: 0,
    remainingQtyTotal: 0,
    consumedQtyTotal: 0,
  };
}

async function loadPremiumCatalogForOverview(lang) {
  try {
    const premiumDocs = await BuilderProtein.find({
      isActive: true,
      isPremium: true,
      availableForSubscription: { $ne: false },
      premiumKey: { $exists: true, $ne: null, $ne: "" },
    })
      .select("_id name premiumKey")
      .lean();

    const byId = new Map();
    const byPremiumKey = new Map();

    for (const doc of premiumDocs) {
      const id = String(doc._id);
      const localizedName = pickLang(doc.name, lang) || "";
      const premiumKey = doc.premiumKey || null;

      const catalogItem = {
        id,
        name: localizedName,
        premiumKey,
      };

      byId.set(id, catalogItem);

      if (premiumKey && !byPremiumKey.has(premiumKey)) {
        byPremiumKey.set(premiumKey, catalogItem);
      }
    }

    return { byId, byPremiumKey, allItems: Array.from(byId.values()) };
  } catch (err) {
    logger.error("currentOverview: failed to load premium catalog", {
      error: err.message,
      stack: err.stack,
    });
    return { byId: new Map(), byPremiumKey: new Map(), allItems: [] };
  }
}

function findMatchingCatalogItem(balanceRow, premiumCatalog) {
  const { byId, byPremiumKey } = premiumCatalog;
  const balanceProteinId = String(balanceRow.proteinId);

  if (balanceRow.premiumKey) {
    const keyMatch = byPremiumKey.get(balanceRow.premiumKey);
    if (keyMatch) {
      return { match: keyMatch, matchType: "premiumKey" };
    }
  }

  const exactIdMatch = byId.get(balanceProteinId);
  if (exactIdMatch) {
    return { match: exactIdMatch, matchType: "id" };
  }

  return { match: null, matchType: null };
}

function buildSubscriptionPremiumBalanceSummary(subscription, premiumCatalog, lang) {
  if (!premiumCatalog || !premiumCatalog.allItems) {
    return [];
  }

  const { byId, allItems } = premiumCatalog;
  const premiumBalance = Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [];

  const mergedByCatalogId = new Map();
  const balanceOnlyItems = [];

  for (const row of premiumBalance) {
    if (!row || !row.proteinId) continue;

    const balanceProteinId = String(row.proteinId);
    const purchasedQty = Number(row.purchasedQty || 0);
    const remainingQty = Number(row.remainingQty || 0);

    const matchResult = findMatchingCatalogItem(row, premiumCatalog);

    if (matchResult.match) {
      const matchedCatalogId = matchResult.match.id;
      const existing = mergedByCatalogId.get(matchedCatalogId) || {
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        premiumMealId: matchedCatalogId,
        name: matchResult.match.name,
      };
      existing.purchasedQtyTotal += purchasedQty;
      existing.remainingQtyTotal += remainingQty;
      mergedByCatalogId.set(matchedCatalogId, existing);
    } else if (row.premiumKey && CANONICAL_PREMIUM_KEYS.includes(row.premiumKey)) {
      balanceOnlyItems.push({
        premiumMealId: row.premiumKey,
        premiumKey: row.premiumKey,
        name: row.name || row.premiumKey,
        purchasedQtyTotal: purchasedQty,
        remainingQtyTotal: remainingQty,
        consumedQtyTotal: purchasedQty - remainingQty,
      });
    }
  }

  const result = [];
  const existingPremiumKeys = new Set();
  const existingPremiumMealIds = new Set();
  const existingNormalizedNames = new Set();

  for (const catalogItem of allItems) {
    const catalogId = catalogItem.id;

    if (mergedByCatalogId.has(catalogId)) {
      const mergedData = mergedByCatalogId.get(catalogId);
      result.push({
        premiumMealId: mergedData.premiumMealId,
        premiumKey: catalogItem.premiumKey || null,
        name: catalogItem.name,
        purchasedQtyTotal: mergedData.purchasedQtyTotal,
        remainingQtyTotal: mergedData.remainingQtyTotal,
        consumedQtyTotal: mergedData.purchasedQtyTotal - mergedData.remainingQtyTotal,
      });
      existingPremiumMealIds.add(mergedData.premiumMealId);
      if (catalogItem.premiumKey) {
        existingPremiumKeys.add(catalogItem.premiumKey);
      }
      const normalizedName = normalizePremiumName(catalogItem.name);
      if (normalizedName) {
        existingNormalizedNames.add(normalizedName);
      }
    } else {
      result.push({
        premiumMealId: catalogId,
        premiumKey: catalogItem.premiumKey || null,
        name: catalogItem.name,
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        consumedQtyTotal: 0,
      });
      existingPremiumMealIds.add(catalogId);
      if (catalogItem.premiumKey) {
        existingPremiumKeys.add(catalogItem.premiumKey);
      }
      const normalizedName = normalizePremiumName(catalogItem.name);
      if (normalizedName) {
        existingNormalizedNames.add(normalizedName);
      }
    }
  }

  for (const balanceOnly of balanceOnlyItems) {
    if (!balanceOnly.premiumKey) {
      continue;
    }
    if (!CANONICAL_PREMIUM_KEYS.includes(balanceOnly.premiumKey)) {
      continue;
    }
    if (balanceOnly.premiumKey && existingPremiumKeys.has(balanceOnly.premiumKey)) {
      continue;
    }
    if (existingPremiumMealIds.has(balanceOnly.premiumMealId)) {
      continue;
    }
    const balanceNormalizedName = normalizePremiumName(balanceOnly.name);
    if (balanceNormalizedName && existingNormalizedNames.has(balanceNormalizedName)) {
      continue;
    }

    result.push({
      premiumMealId: balanceOnly.premiumMealId,
      premiumKey: balanceOnly.premiumKey,
      name: balanceOnly.name,
      purchasedQtyTotal: balanceOnly.purchasedQtyTotal,
      remainingQtyTotal: balanceOnly.remainingQtyTotal,
      consumedQtyTotal: balanceOnly.consumedQtyTotal,
    });

    if (balanceOnly.premiumKey) {
      existingPremiumKeys.add(balanceOnly.premiumKey);
    }
    existingPremiumMealIds.add(balanceOnly.premiumMealId);
    if (balanceNormalizedName) {
      existingNormalizedNames.add(balanceNormalizedName);
    }
  }

  const customSaladItem = buildCustomPremiumSaladItem(lang);
  const customSaladNormalizedName = normalizePremiumName(customSaladItem.name);
  if (!existingPremiumKeys.has(CUSTOM_PREMIUM_SALAD_KEY) &&
      !existingPremiumMealIds.has(customSaladItem.premiumMealId) &&
      (!customSaladNormalizedName || !existingNormalizedNames.has(customSaladNormalizedName))) {
    result.push(customSaladItem);
  }

  return result;
}

function defaultRuntime() {
  return {
    findCurrentSubscription(userId) {
      return Subscription.findOne(
        {
          userId,
          status: { $in: ["active", "pending_payment"] },
        },
        null,
        { sort: { createdAt: -1 } }
      ).lean();
    },
    findPlanById(planId) {
      return Plan.findById(planId).lean();
    },
    serializeSubscriptionForClientWithGuard,
    getRestaurantHoursSettings() {
      return getRestaurantHours();
    },
    findSubscriptionDay(subscriptionId, date) {
      return SubscriptionDay.findOne({
        subscriptionId,
        date,
      }).lean();
    },
    resolvePickupPreparationState,
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

async function buildCurrentSubscriptionOverview({ userId, lang, runtime: runtimeOverrides = null }) {
  const runtime = resolveRuntime(runtimeOverrides);
  const sub = await runtime.findCurrentSubscription(userId);

  if (!sub) {
    return {
      ok: true,
      data: null,
    };
  }

  const subscriptionId = String(sub._id || "");
  const planId = sub.planId ? String(sub.planId) : null;

  logger.info("currentOverview: subscription loaded", {
    userId: String(userId),
    subscriptionId,
    planId,
    status: sub.status,
  });

  const serializedSubscription = await runtime.serializeSubscriptionForClientWithGuard(sub, lang);
  const skipUsage = await buildSubscriptionOverviewSkipUsageSafe(sub, runtime);
  const restaurantHours = await runtime.getRestaurantHoursSettings();
  const premiumCatalog = await loadPremiumCatalogForOverview(lang);
  const premiumSummary = buildSubscriptionPremiumBalanceSummary(sub, premiumCatalog, lang);

  let pickupPreparation = null;
  try {
    const todayKSA = restaurantHours.businessDate;
    const todayDay = await runtime.findSubscriptionDay(sub._id, todayKSA);

    pickupPreparation = runtime.resolvePickupPreparationState(sub, todayDay, {
      lang,
      getTodayKSADate: () => todayKSA,
    });

    logger.info("currentOverview: pickupPreparation resolved", {
      subscriptionId,
      todayDate: todayKSA,
      hasTodayDay: Boolean(todayDay),
      flowStatus: pickupPreparation && pickupPreparation.flowStatus,
    });
  } catch (err) {
    logger.error("currentOverview: pickupPreparation failed", {
      subscriptionId,
      planId,
      userId: String(userId),
      error: err.message,
      stack: err.stack,
    });
    pickupPreparation = null;
  }

  return {
    ok: true,
    data: {
      ...serializedSubscription,
      ...skipUsage,
      businessDate: restaurantHours.businessDate,
      pickupPreparation,
      premiumSummary,
    },
  };
}

module.exports = {
  buildCurrentSubscriptionOverview,
  buildSubscriptionPremiumBalanceSummary,
  loadPremiumCatalogForOverview,
};
