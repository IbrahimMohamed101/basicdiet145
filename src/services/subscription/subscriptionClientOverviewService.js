const Plan = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const BuilderProtein = require("../../models/BuilderProtein");
const { logger } = require("../../utils/logger");
const { resolveSubscriptionSkipPolicy } = require("./subscriptionContractReadService");
const { resolveSkipRemainingDays } = require("./subscriptionSkipService");
const { resolvePickupPreparationState } = require("./subscriptionPickupPreparationService");
const { mapSubscriptionPickupRequestStatus } = require("./subscriptionPickupRequestClientService");
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
  normalizePremiumItemKey,
  PREMIUM_LARGE_SALAD_KEY,
} = require("../../utils/subscription/premiumIdentity");
const {
  findCurrentActiveSubscriptionForUser,
} = require("./subscriptionCurrentResolverService");
const {
  buildClientAddonBalance,
  buildAddonCategoryAllowances,
  buildAddonSubscriptionAllowances,
} = require("./subscriptionAddonBalanceService");
const { buildSubscriptionAddonCoverageSummary } = require("./subscriptionAddonPricingService");

const ACTIVE_PICKUP_REQUEST_STATUSES = ["locked", "in_preparation", "ready_for_pickup"];

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

const CUSTOM_PREMIUM_SALAD_KEY = PREMIUM_LARGE_SALAD_KEY;

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
      const premiumKey = normalizePremiumItemKey(doc.premiumKey) || null;

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

  const normalizedBalanceKey = normalizePremiumItemKey(balanceRow.premiumKey);
  if (normalizedBalanceKey) {
    const keyMatch = byPremiumKey.get(normalizedBalanceKey);
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
  const normalizedBalanceKey = normalizePremiumItemKey(balanceRow.premiumKey);
  if (normalizedBalanceKey) {
    return normalizedBalanceKey;
  }

  const matchResult = findMatchingCatalogItem(balanceRow, premiumCatalog);
  if (matchResult.match && matchResult.match.premiumKey) {
    return matchResult.match.premiumKey;
  }

  const name = balanceRow.name || balanceRow.name_ar || "";
  if (name) {
    const resolved = resolvePremiumKeyFromName(name);
    if (resolved) {
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

    if (!key) {
      continue;
    }

    const existing = summaryMap.get(key) || {
      premiumKey: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      name: "",
      nameI18n: null,
      imageUrl: "",
      unitExtraFeeHalala: null,
      currency: "",
    };

    existing.purchasedQtyTotal += purchasedQty;
    existing.remainingQtyTotal += remainingQty;
    if (!existing.name && row.name) {
      existing.name = typeof row.name === "object"
        ? (row.name[lang] || row.name.en || row.name.ar || "")
        : String(row.name || "");
    }
    if (!existing.nameI18n && row.nameI18n && typeof row.nameI18n === "object") {
      existing.nameI18n = {
        ar: String(row.nameI18n.ar || ""),
        en: String(row.nameI18n.en || ""),
      };
    }
    if (!existing.imageUrl && row.imageUrl) existing.imageUrl = String(row.imageUrl || "");
    if (existing.unitExtraFeeHalala === null && row.unitExtraFeeHalala !== undefined) {
      existing.unitExtraFeeHalala = Number(row.unitExtraFeeHalala || 0);
    }
    if (!existing.currency && row.currency) existing.currency = String(row.currency || "");

    summaryMap.set(key, existing);
  }

  const result = [];
  const existingKeys = new Set();

  for (const catalogItem of allItems) {
    const catalogKey = catalogItem.premiumKey;

    if (!catalogKey) {
      continue;
    }

    const summary = summaryMap.get(catalogKey);
    const purchasedQtyTotal = summary ? summary.purchasedQtyTotal : 0;
    const remainingQtyTotal = summary ? summary.remainingQtyTotal : 0;

    if (purchasedQtyTotal > 0 || remainingQtyTotal > 0) {
      result.push({
        premiumMealId: catalogItem.id,
        premiumKey: catalogKey,
        name: summary && summary.name ? summary.name : catalogItem.name,
        nameI18n: summary && summary.nameI18n ? summary.nameI18n : undefined,
        imageUrl: summary && summary.imageUrl ? summary.imageUrl : undefined,
        unitExtraFeeHalala: summary && summary.unitExtraFeeHalala !== null ? summary.unitExtraFeeHalala : undefined,
        currency: summary && summary.currency ? summary.currency : undefined,
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
    const catalogItem = byPremiumKey.get(key);
    if (catalogItem) {
      continue;
    }

    if (summary.purchasedQtyTotal > 0 || summary.remainingQtyTotal > 0) {
      result.push({
        premiumMealId: key,
        premiumKey: key,
        name: summary.name || getPremiumDisplayName({ premiumKey: key, lang }),
        nameI18n: summary.nameI18n || undefined,
        imageUrl: summary.imageUrl || undefined,
        unitExtraFeeHalala: summary.unitExtraFeeHalala !== null ? summary.unitExtraFeeHalala : undefined,
        currency: summary.currency || undefined,
        purchasedQtyTotal: summary.purchasedQtyTotal,
        remainingQtyTotal: summary.remainingQtyTotal,
        consumedQtyTotal: summary.purchasedQtyTotal - summary.remainingQtyTotal,
      });
    }

    existingKeys.add(key);
  }

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
      return findCurrentActiveSubscriptionForUser(userId, {
        SubscriptionModel: Subscription,
        context: "current_subscription_overview",
        includeUpcoming: true,
      });
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
    async findPickupRequestOverview(subscriptionId, date) {
      const [activePickupRequestCount, latestPickupRequest] = await Promise.all([
        SubscriptionPickupRequest.countDocuments({
          subscriptionId,
          date,
          status: { $in: ACTIVE_PICKUP_REQUEST_STATUSES },
        }),
        SubscriptionPickupRequest.findOne({ subscriptionId, date })
          .sort({ createdAt: -1 })
          .lean(),
      ]);
      return {
        activePickupRequestCount,
        latestPickupRequest: latestPickupRequest
          ? mapSubscriptionPickupRequestStatus(latestPickupRequest, { includeNextAction: false })
          : null,
      };
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
    const pickupRequestOverview = sub.deliveryMode === "pickup" && runtime.findPickupRequestOverview
      ? await runtime.findPickupRequestOverview(sub._id, todayKSA)
      : { activePickupRequestCount: 0, latestPickupRequest: null };

    pickupPreparation = runtime.resolvePickupPreparationState(sub, todayDay, {
      lang,
      getTodayKSADate: () => todayKSA,
      activePickupRequestCount: pickupRequestOverview.activePickupRequestCount,
      latestPickupRequest: pickupRequestOverview.latestPickupRequest,
      restaurantHours,
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
      // Stable client identity. Never require callers to infer the subscription
      // from `_id`, `id`, a plan id, or the literal `current` route segment.
      subscriptionId,
      businessDate: restaurantHours.businessDate,
      addonBalanceSummary: buildClientAddonBalance(sub, restaurantHours.businessDate),
      addonCategoryAllowances: buildAddonCategoryAllowances(sub),
      addonSubscriptionAllowances: buildAddonSubscriptionAllowances(sub),
      addonCoverage: buildSubscriptionAddonCoverageSummary(sub),
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
