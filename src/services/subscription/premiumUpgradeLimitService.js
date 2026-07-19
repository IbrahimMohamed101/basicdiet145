const SubscriptionDay = require("../../models/SubscriptionDay");

const PREMIUM_UPGRADE_LIMIT_EXCEEDED = "PREMIUM_UPGRADE_LIMIT_EXCEEDED";
const PREMIUM_SELECTION_TYPES = new Set(["premium_meal", "premium_large_salad"]);

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function buildPremiumUpgradeLimit({ totalSubscriptionMeals, selectedPremiumUpgrades }) {
  const maxPremiumUpgrades = toNonNegativeInteger(totalSubscriptionMeals);
  const selected = toNonNegativeInteger(selectedPremiumUpgrades);
  return {
    maxPremiumUpgrades,
    selectedPremiumUpgrades: selected,
    remainingPremiumUpgrades: Math.max(0, maxPremiumUpgrades - selected),
  };
}

function buildPremiumUpgradeLimitError({ premiumUpgradeCount, totalSubscriptionMeals }) {
  const maxPremiumUpgrades = toNonNegativeInteger(totalSubscriptionMeals);
  const selected = toNonNegativeInteger(premiumUpgradeCount);
  const err = new Error("Premium meal upgrades cannot exceed total subscription meals.");
  err.status = 422;
  err.code = PREMIUM_UPGRADE_LIMIT_EXCEEDED;
  err.details = {
    premiumUpgradeCount: selected,
    totalSubscriptionMeals: maxPremiumUpgrades,
    maxPremiumUpgrades,
  };
  return err;
}

function assertPremiumUpgradeLimit({ premiumUpgradeCount, totalSubscriptionMeals }) {
  const selected = toNonNegativeInteger(premiumUpgradeCount);
  const max = toNonNegativeInteger(totalSubscriptionMeals);
  if (selected > max) {
    throw buildPremiumUpgradeLimitError({
      premiumUpgradeCount: selected,
      totalSubscriptionMeals: max,
    });
  }
  return buildPremiumUpgradeLimit({
    totalSubscriptionMeals: max,
    selectedPremiumUpgrades: selected,
  });
}

function resolveTotalSubscriptionMealsFromQuote(quote) {
  const plan = quote && quote.plan && typeof quote.plan === "object" ? quote.plan : {};
  const daysCount = toNonNegativeInteger(plan.daysCount);
  const mealsPerDay = toNonNegativeInteger(quote && quote.mealsPerDay);
  return daysCount * mealsPerDay;
}

function resolveTotalSubscriptionMealsFromSubscription(subscription) {
  if (!subscription || typeof subscription !== "object") return 0;
  const storedTotal = toNonNegativeInteger(subscription.totalMeals);
  if (storedTotal > 0) return storedTotal;

  const snapshotPlan = subscription.contractSnapshot
    && subscription.contractSnapshot.plan
    && typeof subscription.contractSnapshot.plan === "object"
    ? subscription.contractSnapshot.plan
    : null;
  if (snapshotPlan) {
    const snapshotTotal = toNonNegativeInteger(snapshotPlan.totalMeals);
    if (snapshotTotal > 0) return snapshotTotal;
    const snapshotDays = toNonNegativeInteger(snapshotPlan.daysCount);
    const snapshotMeals = toNonNegativeInteger(snapshotPlan.mealsPerDay);
    if (snapshotDays > 0 && snapshotMeals > 0) return snapshotDays * snapshotMeals;
  }

  const plan = subscription.planId && typeof subscription.planId === "object" ? subscription.planId : {};
  const daysCount = toNonNegativeInteger(plan.daysCount || subscription.daysCount);
  const mealsPerDay = toNonNegativeInteger(subscription.selectedMealsPerDay || subscription.mealsPerDay);
  return daysCount * mealsPerDay;
}

function countPremiumItemsQty(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + toNonNegativeInteger(item && item.qty),
    0
  );
}

function isPremiumUpgradeSelection(selection) {
  if (!selection || typeof selection !== "object") return false;
  if (PREMIUM_SELECTION_TYPES.has(String(selection.selectionType || ""))) return true;
  if (selection.isPremium === true) return true;
  if (selection.premiumKey) return true;
  return Boolean(selection.premiumSource && String(selection.premiumSource) !== "none");
}

function countPremiumUpgradeSelections(selections) {
  return (Array.isArray(selections) ? selections : []).filter(isPremiumUpgradeSelection).length;
}

function countPremiumUpgradesFromDay(day) {
  if (!day || typeof day !== "object") return 0;
  if (Array.isArray(day.premiumUpgradeSelections) && day.premiumUpgradeSelections.length > 0) {
    return countPremiumUpgradeSelections(day.premiumUpgradeSelections);
  }
  if (Array.isArray(day.mealSlots) && day.mealSlots.length > 0) {
    return countPremiumUpgradeSelections(day.mealSlots);
  }
  const plannerMetaCount = toNonNegativeInteger(day.plannerMeta && day.plannerMeta.premiumSlotCount);
  if (plannerMetaCount > 0) return plannerMetaCount;
  return toNonNegativeInteger(day.planningMeta && day.planningMeta.selectedPremiumMealCount);
}

async function countPersistedPremiumUpgradesForSubscription({ subscriptionId, excludeDate = null, session = null }) {
  if (!subscriptionId) return 0;
  const filter = {
    subscriptionId,
    status: { $nin: ["canceled", "cancelled", "delivery_canceled", "skipped", "frozen", "fulfilled", "no_show"] },
  };
  if (excludeDate) filter.date = { $ne: excludeDate };
  let query = SubscriptionDay.find(filter).select("status plannerState planningState premiumExtraPayment premiumUpgradeSelections mealSlots plannerMeta planningMeta");
  if (session) query = query.session(session);
  const days = await query.lean();
  return (Array.isArray(days) ? days : []).reduce(
    (sum, day) => {
      const paymentStatus = String(day?.premiumExtraPayment?.status || "").toLowerCase();
      if (["failed", "expired", "superseded", "revision_mismatch", "canceled", "cancelled"].includes(paymentStatus)) {
        return sum;
      }
      const plannerState = String(day?.plannerState || day?.planningState || "").toLowerCase();
      const hasActiveFunding = (Array.isArray(day?.premiumUpgradeSelections) ? day.premiumUpgradeSelections : [])
        .some((selection) => ["balance", "paid", "paid_extra"].includes(String(selection?.premiumSource || "").toLowerCase()));
      if (plannerState !== "confirmed" && !hasActiveFunding) return sum;
      return sum + countPremiumUpgradesFromDay(day);
    },
    0
  );
}

module.exports = {
  PREMIUM_UPGRADE_LIMIT_EXCEEDED,
  assertPremiumUpgradeLimit,
  buildPremiumUpgradeLimit,
  buildPremiumUpgradeLimitError,
  countPersistedPremiumUpgradesForSubscription,
  countPremiumItemsQty,
  countPremiumUpgradeSelections,
  countPremiumUpgradesFromDay,
  resolveTotalSubscriptionMealsFromQuote,
  resolveTotalSubscriptionMealsFromSubscription,
};
