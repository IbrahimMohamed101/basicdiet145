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

function getPremiumCanonicalKey(catalogItem) {
  if (!catalogItem || typeof catalogItem !== "object") return null;

  if (catalogItem.proteinFamilyKey) {
    return `family:${catalogItem.proteinFamilyKey}`;
  }
  if (catalogItem.displayCategoryKey) {
    return `category:${catalogItem.displayCategoryKey}`;
  }

  const nameAr = catalogItem.name?.ar || "";
  const nameEn = catalogItem.name?.en || "";
  if (nameAr) return `name:${normalizePremiumName(nameAr)}`;
  if (nameEn) return `name:${normalizePremiumName(nameEn)}`;

  return null;
}

async function loadPremiumCatalogForOverview(lang) {
  try {
    const premiumDocs = await BuilderProtein.find({ isActive: true, isPremium: true })
      .select("_id name proteinFamilyKey displayCategoryKey")
      .lean();

    const byId = new Map();
    const byCanonicalKey = new Map();

    for (const doc of premiumDocs) {
      const id = String(doc._id);
      const localizedName = pickLang(doc.name, lang) || "";
      const canonicalKey = getPremiumCanonicalKey(doc);

      byId.set(id, {
        id,
        name: localizedName,
        proteinFamilyKey: doc.proteinFamilyKey || null,
        displayCategoryKey: doc.displayCategoryKey || null,
        canonicalKey,
      });

      if (canonicalKey && !byCanonicalKey.has(canonicalKey)) {
        byCanonicalKey.set(canonicalKey, {
          id,
          name: localizedName,
          proteinFamilyKey: doc.proteinFamilyKey || null,
          displayCategoryKey: doc.displayCategoryKey || null,
          canonicalKey,
        });
      }
    }

    return { byId, byCanonicalKey, allItems: Array.from(byId.values()) };
  } catch (err) {
    logger.error("currentOverview: failed to load premium catalog", {
      error: err.message,
      stack: err.stack,
    });
    return { byId: new Map(), byCanonicalKey: new Map(), allItems: [] };
  }
}

function buildSubscriptionPremiumBalanceSummary(subscription, premiumCatalog, lang) {
  if (!premiumCatalog || !premiumCatalog.allItems) {
    return [];
  }

  const { byId, byCanonicalKey, allItems } = premiumCatalog;
  const premiumBalance = Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [];

  const canonicalToBalance = new Map();
  const balanceOnlyItems = [];

  for (const row of premiumBalance) {
    if (!row || !row.proteinId) continue;

    const balanceProteinId = String(row.proteinId);
    const purchasedQty = Number(row.purchasedQty || 0);
    const remainingQty = Number(row.remainingQty || 0);

    const catalogById = byId.get(balanceProteinId);
    if (catalogById && catalogById.canonicalKey) {
      const existing = canonicalToBalance.get(catalogById.canonicalKey) || {
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        premiumMealId: balanceProteinId,
        name: catalogById.name,
      };
      existing.purchasedQtyTotal += purchasedQty;
      existing.remainingQtyTotal += remainingQty;
      canonicalToBalance.set(catalogById.canonicalKey, existing);
    } else {
      balanceOnlyItems.push({
        premiumMealId: balanceProteinId,
        name: "",
        purchasedQtyTotal: purchasedQty,
        remainingQtyTotal: remainingQty,
        consumedQtyTotal: purchasedQty - remainingQty,
      });
    }
  }

  const result = [];
  const processedCanonicalKeys = new Set();

  for (const catalogItem of allItems) {
    const canonicalKey = catalogItem.canonicalKey;

    if (canonicalKey && canonicalToBalance.has(canonicalKey)) {
      const balanceData = canonicalToBalance.get(canonicalKey);
      processedCanonicalKeys.add(canonicalKey);
      result.push({
        premiumMealId: balanceData.premiumMealId,
        name: catalogItem.name,
        purchasedQtyTotal: balanceData.purchasedQtyTotal,
        remainingQtyTotal: balanceData.remainingQtyTotal,
        consumedQtyTotal: balanceData.purchasedQtyTotal - balanceData.remainingQtyTotal,
      });
    } else if (!canonicalKey && byId.has(catalogItem.id) && canonicalToBalance.has(catalogItem.id)) {
      const balanceData = canonicalToBalance.get(catalogItem.id);
      processedCanonicalKeys.add(catalogItem.id);
      result.push({
        premiumMealId: balanceData.premiumMealId,
        name: catalogItem.name,
        purchasedQtyTotal: balanceData.purchasedQtyTotal,
        remainingQtyTotal: balanceData.remainingQtyTotal,
        consumedQtyTotal: balanceData.purchasedQtyTotal - balanceData.remainingQtyTotal,
      });
    } else {
      result.push({
        premiumMealId: catalogItem.id,
        name: catalogItem.name,
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        consumedQtyTotal: 0,
      });
    }
  }

  for (const balanceOnly of balanceOnlyItems) {
    result.push(balanceOnly);
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
