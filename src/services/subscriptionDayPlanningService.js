const { logger } = require("../utils/logger");
const { createLocalizedError } = require("../utils/errorLocalization");
const { resolveMealsPerDay } = require("../utils/subscriptionDaySelectionSync");
const {
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../utils/featureFlags");
const { isGenericPremiumWalletMode } = require("./genericPremiumWalletService");

const DAY_PLANNING_VERSION = "subscription_day_planning.v1";
const BASE_MEAL_SLOT_PREFIX = "base_slot_";

function hasCanonicalContract(subscription) {
  return Boolean(
    subscription
      && subscription.contractVersion === "subscription_contract.v1"
      && subscription.contractMode === "canonical"
      && subscription.contractSnapshot
  );
}

function isCanonicalDayPlanningEligible(subscription, { flagEnabled = isPhase2CanonicalDayPlanningEnabled() } = {}) {
  return Boolean(flagEnabled && hasCanonicalContract(subscription));
}

function buildBaseMealSlotKey(index) {
  return `${BASE_MEAL_SLOT_PREFIX}${index + 1}`;
}

function normalizeMealIds(values) {
  if (!Array.isArray(values)) return [];
  return values.filter(Boolean);
}

function normalizeNonNegativeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function buildBaseMealSlots({ selections = [], existingBaseMealSlots = [], assignmentSource = "client", now = new Date() } = {}) {
  const normalizedSelections = normalizeMealIds(selections);
  const existingByKey = new Map(
    (Array.isArray(existingBaseMealSlots) ? existingBaseMealSlots : []).map((slot) => [String(slot.slotKey || ""), slot])
  );

  return normalizedSelections.map((mealId, index) => {
    const slotKey = buildBaseMealSlotKey(index);
    const existing = existingByKey.get(slotKey);
    const sameMeal = existing && existing.mealId && String(existing.mealId) === String(mealId);

    return {
      slotKey,
      mealId,
      assignmentSource: sameMeal && existing.assignmentSource ? existing.assignmentSource : assignmentSource,
      assignedAt: sameMeal && existing.assignedAt ? existing.assignedAt : now,
    };
  });
}

function buildPlanningMeta({
  subscription,
  selections = [],
  premiumSelections = [],
  now = new Date(),
  confirmed = false,
  confirmedByRole = null,
} = {}) {
  const requiredMealCount = resolveMealsPerDay(subscription);
  const selectedBaseMealCount = normalizeMealIds(selections).length;
  const selectedPremiumMealCount = normalizeMealIds(premiumSelections).length;
  const selectedTotalMealCount = selectedBaseMealCount + selectedPremiumMealCount;
  const isExactCountSatisfied = selectedTotalMealCount === requiredMealCount;

  return {
    requiredMealCount,
    selectedBaseMealCount,
    selectedPremiumMealCount,
    selectedTotalMealCount,
    isExactCountSatisfied,
    lastEditedAt: now,
    confirmedAt: confirmed ? now : null,
    confirmedByRole: confirmed ? confirmedByRole : null,
  };
}

function applyCanonicalDraftPlanningToDay({
  subscription,
  day,
  selections = [],
  premiumSelections = [],
  assignmentSource = "client",
  now = new Date(),
} = {}) {
  day.planningVersion = DAY_PLANNING_VERSION;
  day.baseMealSlots = buildBaseMealSlots({
    selections,
    existingBaseMealSlots: day.baseMealSlots || [],
    assignmentSource,
    now,
  });
  day.planningState = "draft";
  day.planningMeta = buildPlanningMeta({
    subscription,
    selections,
    premiumSelections,
    now,
    confirmed: false,
  });
  day.selections = normalizeMealIds(selections);
  return day;
}

function buildCanonicalPlanningView({ subscription, day } = {}) {
  if (!day) return null;

  // READ-PATH ALIGNMENT: Prioritize locked snapshot for historical stability
  if (day.lockedSnapshot && day.lockedSnapshot.planning) {
    const snap = day.lockedSnapshot.planning;
    const meta = snap.meta || {};
    return {
      version: snap.version || DAY_PLANNING_VERSION,
      state: snap.state || "confirmed",
      requiredMealCount: meta.requiredMealCount,
      selectedBaseMealCount: meta.selectedBaseMealCount,
      selectedPremiumMealCount: meta.selectedPremiumMealCount,
      selectedTotalMealCount: meta.selectedTotalMealCount,
      isExactCountSatisfied: meta.isExactCountSatisfied,
      confirmedAt: meta.confirmedAt || null,
      confirmedByRole: meta.confirmedByRole || null,
      baseMealSlots: snap.baseMealSlots || [],
      premiumOverageCount: meta.premiumOverageCount || 0,
      premiumOverageStatus: meta.premiumOverageStatus || null,
    };
  }

  const resolvedSelections = normalizeMealIds(day.selections);
  const resolvedPremiumSelections = normalizeMealIds(day.premiumSelections);
  const baseMealSlots = Array.isArray(day.baseMealSlots) && day.baseMealSlots.length > 0
    ? day.baseMealSlots
    : buildBaseMealSlots({
      selections: resolvedSelections,
      existingBaseMealSlots: [],
      assignmentSource: "legacy_compat",
      now: day.updatedAt || day.createdAt || new Date(),
    });
  const planningMeta = day.planningMeta || buildPlanningMeta({
    subscription,
    selections: resolvedSelections,
    premiumSelections: resolvedPremiumSelections,
    now: day.updatedAt || day.createdAt || new Date(),
    confirmed: day.planningState === "confirmed",
    confirmedByRole: day.planningMeta && day.planningMeta.confirmedByRole ? day.planningMeta.confirmedByRole : null,
  });

  return {
    version: day.planningVersion || DAY_PLANNING_VERSION,
    state: day.planningState || "draft",
    requiredMealCount: planningMeta.requiredMealCount,
    selectedBaseMealCount: planningMeta.selectedBaseMealCount,
    selectedPremiumMealCount: planningMeta.selectedPremiumMealCount,
    selectedTotalMealCount: planningMeta.selectedTotalMealCount,
    isExactCountSatisfied: planningMeta.isExactCountSatisfied,
    confirmedAt: planningMeta.confirmedAt || null,
    confirmedByRole: planningMeta.confirmedByRole || null,
    baseMealSlots,
    premiumOverageCount: day.premiumOverageCount || 0,
    premiumOverageStatus: day.premiumOverageStatus || null,
  };
}

function isCanonicalPremiumOverageEligible(
  subscription,
  {
    dayPlanningFlagEnabled = isPhase2CanonicalDayPlanningEnabled(),
    genericPremiumWalletFlagEnabled = isPhase2GenericPremiumWalletEnabled(),
  } = {}
) {
  return Boolean(
    genericPremiumWalletFlagEnabled
      && isGenericPremiumWalletMode(subscription)
      && isCanonicalDayPlanningEligible(subscription, { flagEnabled: dayPlanningFlagEnabled })
  );
}

function applyPremiumOverageState({
  day,
  requestedPremiumSelectionCount = 0,
  walletBackedConsumedCount = 0,
} = {}) {
  if (!day) {
    return { premiumOverageCount: 0, premiumOverageStatus: null };
  }

  const overageCount = Math.max(
    0,
    normalizeNonNegativeCount(requestedPremiumSelectionCount) - normalizeNonNegativeCount(walletBackedConsumedCount)
  );

  day.premiumOverageCount = overageCount;
  day.premiumOverageStatus = overageCount > 0 ? "pending" : undefined;

  return {
    premiumOverageCount: overageCount,
    premiumOverageStatus: overageCount > 0 ? "pending" : null,
  };
}

function assertCanonicalPlanningExactCount({ subscription, day } = {}) {
  const planningView = buildCanonicalPlanningView({ subscription, day });
  if (!planningView || !planningView.isExactCountSatisfied) {
    logger.warn("assertCanonicalPlanningExactCount failed: exact count not satisfied", {
      subscriptionId: subscription ? String(subscription._id) : null,
      dayId: day ? String(day._id) : null,
      date: day ? day.date : null,
    });
    throw createLocalizedError({
      code: "PLANNING_INCOMPLETE",
      key: "errors.planning.incomplete",
      fallbackMessage: "Day must contain exactly mealsPerDay total meal selections before confirmation",
    });
  }
  return planningView;
}

function assertNoPendingPremiumOverage({
  subscription,
  day,
  overageEligible = isCanonicalPremiumOverageEligible(subscription),
} = {}) {
  if (!overageEligible || !day) return day;

  const overageCount = normalizeNonNegativeCount(day.premiumOverageCount);
  if (overageCount > 0 && day.premiumOverageStatus !== "paid") {
    logger.warn("assertNoPendingPremiumOverage failed: unpaid premium overage", {
      subscriptionId: subscription ? String(subscription._id) : null,
      dayId: day ? String(day._id) : null,
      date: day ? day.date : null,
    });
    throw createLocalizedError({
      code: "PREMIUM_OVERAGE_PAYMENT_REQUIRED",
      key: "errors.planning.premiumOverageRequired",
      fallbackMessage: "Premium overage payment is required before confirmation",
    });
  }

  return day;
}

function confirmCanonicalDayPlanning({
  subscription,
  day,
  actorRole = "client",
  now = new Date(),
} = {}) {
  const planningView = assertCanonicalPlanningExactCount({ subscription, day });
  day.planningVersion = day.planningVersion || DAY_PLANNING_VERSION;
  day.planningState = "confirmed";
  day.planningMeta = buildPlanningMeta({
    subscription,
    selections: day.selections || [],
    premiumSelections: day.premiumSelections || [],
    now,
    confirmed: true,
    confirmedByRole: actorRole,
  });
  if (!Array.isArray(day.baseMealSlots) || day.baseMealSlots.length === 0) {
    day.baseMealSlots = planningView.baseMealSlots;
  }
  return day;
}

function buildCanonicalPlanningSnapshot({ subscription, day } = {}) {
  if (!day) return null;
  const view = buildCanonicalPlanningView({ subscription, day });
  return {
    version: view.version,
    state: view.state,
    baseMealSlots: view.baseMealSlots,
    meta: {
      requiredMealCount: view.requiredMealCount,
      selectedBaseMealCount: view.selectedBaseMealCount,
      selectedPremiumMealCount: view.selectedPremiumMealCount,
      selectedTotalMealCount: view.selectedTotalMealCount,
      isExactCountSatisfied: view.isExactCountSatisfied,
      confirmedAt: view.confirmedAt,
      confirmedByRole: view.confirmedByRole,
      premiumOverageCount: day.premiumOverageCount || 0,
      premiumOverageStatus: day.premiumOverageStatus || null,
    },
  };
}

function buildScopedCanonicalPlanningSnapshot({
  subscription,
  day,
  flagEnabled = isPhase2CanonicalDayPlanningEnabled(),
} = {}) {
  if (!isCanonicalDayPlanningEligible(subscription, { flagEnabled })) {
    return null;
  }
  return buildCanonicalPlanningSnapshot({ subscription, day });
}

module.exports = {
  DAY_PLANNING_VERSION,
  buildBaseMealSlots,
  buildCanonicalPlanningView,
  buildCanonicalPlanningSnapshot,
  buildScopedCanonicalPlanningSnapshot,
  applyCanonicalDraftPlanningToDay,
  applyPremiumOverageState,
  confirmCanonicalDayPlanning,
  assertCanonicalPlanningExactCount,
  assertNoPendingPremiumOverage,
  hasCanonicalContract,
  isCanonicalDayPlanningEligible,
  isCanonicalPremiumOverageEligible,
};
