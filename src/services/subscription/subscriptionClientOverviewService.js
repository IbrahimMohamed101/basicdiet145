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
const {
  buildFulfillmentReadFields,
  getPickupLocationsSetting,
} = require("./subscriptionFulfillmentSummaryService");
const { 
  getPremiumDisplayName, 
  resolvePremiumKeyFromName,
  CANONICAL_PREMIUM_KEYS 
} = require("../../utils/subscription/premiumIdentity");

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

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";

function buildCustomPremiumSaladItem(lang) {
  const name = getPremiumDisplayName({ premiumKey: CUSTOM_PREMIUM_SALAD_KEY, lang });
  return {
    premiumMealId: CUSTOM_PREMIUM_SALAD_KEY,
    premiumKey: CUSTOM_PREMIUM_SALAD_KEY,
    name,
    type: CUSTOM_PREMIUM_SALAD_KEY,
    extraFeeHalala: 3000,
    purchasedQtyTotal: 0,
    remainingQtyTotal: 0,
    consumedQtyTotal: 0,
  };
}

const PREMIUM_CATALOG_CACHE_TTL = 300000; // 5 minutes
let premiumCatalogCache = { data: null, lastFetch: 0 };

async function loadPremiumCatalogForOverview(lang) {
  const now = Date.now();
  if (premiumCatalogCache.data && (now - premiumCatalogCache.lastFetch) < PREMIUM_CATALOG_CACHE_TTL) {
    return premiumCatalogCache.data;
  }

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

    const result = { byId, byPremiumKey, allItems: Array.from(byId.values()) };
    premiumCatalogCache = { data: result, lastFetch: now };
    return result;
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

  if (balanceRow.premiumKey && CANONICAL_PREMIUM_KEYS.includes(balanceRow.premiumKey)) {
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

function resolvePremiumKeyFromRow(balanceRow, premiumCatalog) {
  if (balanceRow.premiumKey && CANONICAL_PREMIUM_KEYS.includes(balanceRow.premiumKey)) {
    return balanceRow.premiumKey;
  }

  const matchResult = findMatchingCatalogItem(balanceRow, premiumCatalog);
  if (matchResult.match && matchResult.match.premiumKey) {
    return matchResult.match.premiumKey;
  }

  const name = balanceRow.name || balanceRow.name_ar || "";
  if (name) {
    const resolved = resolvePremiumKeyFromName(name);
    if (resolved && CANONICAL_PREMIUM_KEYS.includes(resolved)) {
      return resolved;
    }
  }

  return null;
}

function buildSubscriptionPremiumBalanceSummary(subscription, premiumCatalog, lang) {
  if (!premiumCatalog || !premiumCatalog.allItems) {
    return [];
  }

  const { byPremiumKey, allItems } = premiumCatalog;
  const premiumBalance = Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [];

  const summaryMap = new Map();

  for (const row of premiumBalance) {
    if (!row) continue;

    const purchasedQty = Number(row.purchasedQty || 0);
    const remainingQty = Number(row.remainingQty || 0);

    if (purchasedQty === 0 && remainingQty === 0) {
      continue;
    }

    const key = resolvePremiumKeyFromRow(row, premiumCatalog);

    if (!key || !CANONICAL_PREMIUM_KEYS.includes(key)) {
      continue;
    }

    const existing = summaryMap.get(key) || {
      premiumKey: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
    };

    existing.purchasedQtyTotal += purchasedQty;
    existing.remainingQtyTotal += remainingQty;

    summaryMap.set(key, existing);
  }

  const result = [];
  const existingKeys = new Set();

  for (const catalogItem of allItems) {
    const catalogKey = catalogItem.premiumKey;

    if (!catalogKey || !CANONICAL_PREMIUM_KEYS.includes(catalogKey)) {
      continue;
    }

    const summary = summaryMap.get(catalogKey);
    const purchasedQtyTotal = summary ? summary.purchasedQtyTotal : 0;
    const remainingQtyTotal = summary ? summary.remainingQtyTotal : 0;

    if (purchasedQtyTotal > 0 || remainingQtyTotal > 0) {
      result.push({
        premiumMealId: catalogItem.id,
        premiumKey: catalogKey,
        name: catalogItem.name,
        purchasedQtyTotal,
        remainingQtyTotal,
        consumedQtyTotal: purchasedQtyTotal - remainingQtyTotal,
      });
    }

    existingKeys.add(catalogKey);
  }

  for (const [key, summary] of summaryMap) {
    if (existingKeys.has(key)) {
      continue;
    }
    if (!CANONICAL_PREMIUM_KEYS.includes(key)) {
      continue;
    }

    const catalogItem = byPremiumKey.get(key);
    if (catalogItem) {
      continue;
    }

    if (summary.purchasedQtyTotal > 0 || summary.remainingQtyTotal > 0) {
      result.push({
        premiumMealId: key,
        premiumKey: key,
        name: getPremiumDisplayName({ premiumKey: key, lang }),
        purchasedQtyTotal: summary.purchasedQtyTotal,
        remainingQtyTotal: summary.remainingQtyTotal,
        consumedQtyTotal: summary.purchasedQtyTotal - summary.remainingQtyTotal,
      });
    }

    existingKeys.add(key);
  }

  const customSaladItem = buildCustomPremiumSaladItem(lang);
  if (!existingKeys.has(CUSTOM_PREMIUM_SALAD_KEY)) {
    // Only add if it has non-zero quantities (handled by the balance processing above)
    // Actually, for custom_premium_salad, if it's not in existingKeys, it means 0 balance.
    // The user wants to EXCLUDE items with zero quantities.
    // So we don't automatically push it anymore.
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
    getPickupLocationsSetting,
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
      status: true,
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
  const pickupLocations = await runtime.getPickupLocationsSetting();
  await validateAndNormalizePremiumBalance(serializedSubscription, sub, premiumCatalog);

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
    status: true,
    data: {
      ...serializedSubscription,
      ...buildFulfillmentReadFields({
        subscription: sub,
        day: null,
        pickupLocations,
        lang,
        fulfillmentState: pickupPreparation || {},
        statusLabel: serializedSubscription.statusLabel,
      }),
      ...skipUsage,
      businessDate: restaurantHours.businessDate,
      pickupPreparation,
      premiumSummary,
    },
  };
}

async function validateAndNormalizePremiumBalance(serializedSubscription, sub, premiumCatalog) {
  if (!serializedSubscription || !Array.isArray(serializedSubscription.premiumBalance)) {
    return;
  }

  for (const row of serializedSubscription.premiumBalance) {
    if (!row.premiumKey) {
      const resolvedKey = resolvePremiumKeyFromRow(row, premiumCatalog);
      if (resolvedKey) {
        row.premiumKey = resolvedKey;
      } else {
        logger.error("[PREMIUM_BALANCE_CONSISTENCY] CRITICAL: Unresolved premiumKey in overview - failing gracefully", {
          subscriptionId: String(sub._id),
          proteinId: row.proteinId,
          name: row.name
        });
        row.validationError = true;
        row.premiumKey = `legacy_${row.proteinId}`;
      }
    }
  }
}

module.exports = {
  buildCurrentSubscriptionOverview,
  buildSubscriptionPremiumBalanceSummary,
  loadPremiumCatalogForOverview,
};
