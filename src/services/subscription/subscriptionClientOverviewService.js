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

async function loadPremiumCatalogForOverview(lang) {
  try {
    const premiumDocs = await BuilderProtein.find({ isActive: true, isPremium: true })
      .select("_id name")
      .lean();
    return new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""]));
  } catch (err) {
    logger.error("currentOverview: failed to load premium catalog", {
      error: err.message,
      stack: err.stack,
    });
    return new Map();
  }
}

function buildSubscriptionPremiumBalanceSummary(subscription, premiumCatalog, lang) {
  const premiumBalance = Array.isArray(subscription && subscription.premiumBalance)
    ? subscription.premiumBalance
    : [];

  const aggregatedByProteinId = new Map();
  for (const row of premiumBalance) {
    if (!row || !row.proteinId) continue;
    const proteinId = String(row.proteinId);
    const existing = aggregatedByProteinId.get(proteinId) || { purchasedQtyTotal: 0, remainingQtyTotal: 0 };
    existing.purchasedQtyTotal += Number(row.purchasedQty || 0);
    existing.remainingQtyTotal += Number(row.remainingQty || 0);
    aggregatedByProteinId.set(proteinId, existing);
  }

  const summaryFromBalance = [];
  for (const [proteinId, totals] of aggregatedByProteinId) {
    const name = premiumCatalog.get(proteinId) || "";
    summaryFromBalance.push({
      premiumMealId: proteinId,
      name,
      purchasedQtyTotal: totals.purchasedQtyTotal,
      remainingQtyTotal: totals.remainingQtyTotal,
      consumedQtyTotal: totals.purchasedQtyTotal - totals.remainingQtyTotal,
    });
  }

  const allPremiumItems = [];
  const addedProteinIds = new Set();

  for (const [proteinId, name] of premiumCatalog) {
    addedProteinIds.add(proteinId);
    const fromBalance = summaryFromBalance.find((item) => item.premiumMealId === proteinId);
    if (fromBalance) {
      allPremiumItems.push(fromBalance);
    } else {
      allPremiumItems.push({
        premiumMealId: proteinId,
        name,
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        consumedQtyTotal: 0,
      });
    }
  }

  return allPremiumItems;
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
