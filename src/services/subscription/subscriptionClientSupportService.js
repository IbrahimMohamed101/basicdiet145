"use strict";

const {
  isPhase2CanonicalDayPlanningEnabled,
} = require("../../utils/featureFlags");
const {
  mapRawDayStatusToClientStatus,
  resolveReadLabel,
} = require("../../utils/subscription/subscriptionLocalizationCommon");
const {
  getMealPlannerRules,
} = require("./mealSlotPlannerService");
const {
  applyCommercialStateToDay,
} = require("./subscriptionDayCommercialStateService");
const {
  applySubscriptionDayFulfillmentState,
} = require("./subscriptionDayFulfillmentStateService");
const {
  buildFulfillmentReadFields,
} = require("./subscriptionFulfillmentSummaryService");
const {
  buildCanonicalPlanningView,
  isCanonicalDayPlanningEligible,
} = require("./subscriptionDayPlanningService");
const {
  buildAddonEntitlementsReadModel,
} = require("./subscriptionAddonEntitlementReadService");
const {
  buildClientAddonBalance,
} = require("./subscriptionAddonBalanceService");
const { toKSADateString } = require("../../utils/date");
const { logger } = require("../../utils/logger");

function buildSupportRuntime(runtimeOverrides = null) {
  const runtime = {
    isCanonicalDayPlanningEligible: (...args) => isCanonicalDayPlanningEligible(...args),
    buildCanonicalPlanningView: (...args) => buildCanonicalPlanningView(...args),
  };
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function serializeSubscriptionDayForClient(subscription, day, runtimeOverrides = null) {
  const runtime = buildSupportRuntime(runtimeOverrides);
  const serializedDay = { ...day, status: mapRawDayStatusToClientStatus(day.status) };
  delete serializedDay.baseAllocationKeys;
  delete serializedDay.entitlementTransitionState;
  delete serializedDay.premiumReservationMode;

  const actionType = day.canonicalDayActionType;
  if (actionType !== undefined && actionType !== null) {
    serializedDay.canonicalDayActionType = actionType;
  } else {
    delete serializedDay.canonicalDayActionType;
  }

  if (Array.isArray(day.addonSelections)) {
    serializedDay.addonSelections = day.addonSelections;
  }

  serializedDay.addonEntitlements = buildAddonEntitlementsReadModel(
    subscription && subscription.addonSubscriptions,
    serializedDay.addonSelections || []
  );

  if (runtime.isCanonicalDayPlanningEligible(subscription, {
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  })) {
    const planning = runtime.buildCanonicalPlanningView({ subscription, day });
    if (planning) {
      serializedDay.planning = planning;
    }
  }
  return serializedDay;
}

function buildLegacyPlanningMetaMirror(day = {}) {
  const existing = day && typeof day.planningMeta === "object" ? day.planningMeta : {};
  const plannerMeta = day && typeof day.plannerMeta === "object" ? day.plannerMeta : {};
  const completeSlotCount = Number(plannerMeta.completeSlotCount || 0);
  const premiumSlotCount = Number(plannerMeta.premiumSlotCount || 0);
  const requiredSlotCount = Number(plannerMeta.requiredSlotCount || 0);
  const hasCanonicalPlannerMeta = Object.keys(plannerMeta).length > 0;

  if (!hasCanonicalPlannerMeta) {
    return Object.keys(existing).length > 0 ? existing : undefined;
  }

  return {
    ...existing,
    requiredMealCount: requiredSlotCount,
    selectedBaseMealCount: Math.max(0, completeSlotCount - premiumSlotCount),
    selectedPremiumMealCount: premiumSlotCount,
    selectedTotalMealCount: completeSlotCount,
    isExactCountSatisfied: Boolean(plannerMeta.isDraftValid),
    lastEditedAt: existing.lastEditedAt || day.updatedAt || day.createdAt || null,
    confirmedAt: plannerMeta.confirmedAt || existing.confirmedAt || null,
    confirmedByRole: plannerMeta.confirmedByRole || existing.confirmedByRole || null,
  };
}

function applyLegacyMealPlannerResponseMirrors({ subscription = null, day, lang = "ar" }) {
  if (!day || typeof day !== "object") return day;

  const mirrored = { ...day };
  const mirroredPlanningMeta = buildLegacyPlanningMetaMirror(mirrored);
  const canonicalPlannerState = mirrored.plannerState || mirrored.planningState || null;
  const plannedViewSource = mirrored.planning && typeof mirrored.planning === "object"
    ? mirrored.planning
    : (subscription ? buildCanonicalPlanningView({ subscription, day: mirrored }) : null);

  if (canonicalPlannerState) {
    mirrored.planningState = canonicalPlannerState;
  }
  if (mirroredPlanningMeta) {
    mirrored.planningMeta = mirroredPlanningMeta;
  }
  if (plannedViewSource && typeof plannedViewSource === "object") {
    mirrored.planning = {
      ...plannedViewSource,
      state: canonicalPlannerState || plannedViewSource.state || "draft",
      confirmedAt:
        (mirrored.plannerMeta && mirrored.plannerMeta.confirmedAt)
        || plannedViewSource.confirmedAt
        || null,
      confirmedByRole:
        (mirrored.plannerMeta && mirrored.plannerMeta.confirmedByRole)
        || plannedViewSource.confirmedByRole
        || null,
      stateLabel: resolveReadLabel(
        "planningStates",
        canonicalPlannerState || plannedViewSource.state || "draft",
        "ar" === lang ? "ar" : "en"
      ),
      premiumOverageStatusLabel: resolveReadLabel(
        "paymentStatuses",
        plannedViewSource.premiumOverageStatus,
        "ar" === lang ? "ar" : "en"
      ),
    };
  }

  return mirrored;
}

function shapeMealPlannerReadFields({ subscription = null, day, lang = "ar", pickupLocations = [], businessDate = null }) {
  if (!day || typeof day !== "object") return day;

  const shaped = applySubscriptionDayFulfillmentState({
    subscription,
    day: applyLegacyMealPlannerResponseMirrors({
      subscription,
      day: applyCommercialStateToDay(day, { subscription }),
      lang,
    }),
    today: businessDate || undefined,
  });
  delete shaped.baseAllocationKeys;
  delete shaped.entitlementTransitionState;
  delete shaped.premiumReservationMode;
  const commercialStateLabel = resolveReadLabel("commercialStates", shaped.commercialState, lang);
  const premiumExtraPaymentStatus = (shaped.premiumExtraPayment && shaped.premiumExtraPayment.status) || "none";
  const premiumExtraPaymentStatusLabel = resolveReadLabel("premiumExtraPaymentStatuses", premiumExtraPaymentStatus, lang);
  const pricingStatus = (shaped.paymentRequirement && shaped.paymentRequirement.pricingStatus) || "none";
  const pricingStatusLabel = resolveReadLabel("pricingStatuses", pricingStatus, lang);
  const blockingReasonLabel = shaped.paymentRequirement && shaped.paymentRequirement.blockingReason
    ? resolveReadLabel("paymentBlockingReasons", shaped.paymentRequirement.blockingReason, lang)
    : null;

  const fulfillmentReadFields = subscription
    ? buildFulfillmentReadFields({
      subscription,
      day: shaped,
      pickupLocations,
      lang,
      fulfillmentState: shaped,
      statusLabel: resolveReadLabel("dayStatuses", shaped.status, lang),
    })
    : {};

  const effectiveBusinessDate = businessDate || shaped.today || toKSADateString(new Date());

  const mealBalance = (subscription && effectiveBusinessDate)
    ? buildMealBalance(subscription, effectiveBusinessDate)
    : undefined;

  const addonBalance = (subscription && effectiveBusinessDate)
    ? buildClientAddonBalance(subscription, effectiveBusinessDate)
    : undefined;

  // Explicitly surface the review flag if it exists, so the client app or backend knows it's blocked
  let addonBalanceNeedsReview = false;
  if (addonBalance && addonBalance.addonBalanceNeedsReview) {
    addonBalanceNeedsReview = true;
  }

  return {
    ...shaped,
    ...fulfillmentReadFields,
    mealBalance,
    addonBalance,
    addonBalanceNeedsReview,
    rules: getMealPlannerRules(),
    commercialStateLabel,
    premiumExtraPayment: {
      ...shaped.premiumExtraPayment,
      statusLabel: premiumExtraPaymentStatusLabel,
    },
    paymentRequirement: {
      ...shaped.paymentRequirement,
      pricingStatusLabel,
      blockingReasonLabel,
    },
  };
}

function buildPaymentRequirementReadFields(paymentRequirement, lang = "ar") {
  if (!paymentRequirement || typeof paymentRequirement !== "object") return paymentRequirement;
  return {
    ...paymentRequirement,
    pricingStatusLabel: resolveReadLabel("pricingStatuses", paymentRequirement.pricingStatus, lang),
    blockingReasonLabel: paymentRequirement.blockingReason
      ? resolveReadLabel("paymentBlockingReasons", paymentRequirement.blockingReason, lang)
      : null,
  };
}

function buildControllerErrorDetails(err, lang = "ar") {
  const details = err && err.details && typeof err.details === "object" ? { ...err.details } : undefined;
  if (err && err.paymentRequirement && typeof err.paymentRequirement === "object") {
    return {
      ...(details || {}),
      paymentRequirement: buildPaymentRequirementReadFields(err.paymentRequirement, lang),
    };
  }
  if (err && err.slotErrors) {
    return {
      ...(details || {}),
      slotErrors: err.slotErrors,
      ...(err.debug && { debug: err.debug }),
    };
  }
  return details;
}

function resolveRequestedDate(req) {
  const bodyDate = req && req.body && typeof req.body.date === "string"
    ? req.body.date.trim()
    : "";
  if (bodyDate) {
    return bodyDate;
  }
  return req && req.params && typeof req.params.date === "string"
    ? req.params.date.trim()
    : "";
}

function resolveBulkDaySelectionRequests(req) {
  const body = req && req.body && typeof req.body === "object" ? req.body : {};
  const bodyDays = Array.isArray(body.days) ? body.days : null;

  if (bodyDays && bodyDays.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))) {
    return bodyDays.map((entry) => ({
      date: typeof entry.date === "string" ? entry.date.trim() : "",
      mealSlots: Array.isArray(entry.mealSlots) ? entry.mealSlots : undefined,
      requestedOneTimeAddonIds:
        entry.addonsOneTime !== undefined
          ? entry.addonsOneTime
          : entry.oneTimeAddonSelections,
    }));
  }

  const bodyDates = Array.isArray(body.dates)
    ? body.dates
    : (Array.isArray(body.days) ? body.days : []);
  const mealSlots = Array.isArray(body.mealSlots) ? body.mealSlots : undefined;
  const requestedOneTimeAddonIds = body.addonsOneTime || body.oneTimeAddonSelections;

  return bodyDates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .map((date) => ({
      date,
      mealSlots,
      requestedOneTimeAddonIds,
    }));
}

function buildProjectedOpenDayForClient(subscription, date, runtimeOverrides = null) {
  return serializeSubscriptionDayForClient(
    subscription,
    { subscriptionId: subscription._id, date, status: "open", addonSelections: [] },
    runtimeOverrides
  );
}

function buildSingleSkipMessage({ appliedDays, dueToLimit = false, alreadySkipped = false } = {}) {
  if (alreadySkipped) {
    return "Day was already skipped";
  }
  if (dueToLimit) {
    return appliedDays > 0
      ? `Only ${appliedDays} day${appliedDays === 1 ? "" : "s"} applied due to plan limit`
      : "No days applied due to plan limit";
  }
  return appliedDays > 0
    ? `${appliedDays} day${appliedDays === 1 ? "" : "s"} applied`
    : "No days applied";
}

function logWalletIntegrityError(context, meta = {}) {
  logger.error(`WALLET_INTEGRITY_ERROR: ${context}`, meta);
}

function buildMealBalance(subscription, businessDate) {
  const remainingMeals = Number(subscription.remainingMeals || 0);
  const totalMeals = Number(subscription.totalMeals || 0);
  const hasEntitlementLedger = Number(subscription.entitlementVersion || 0) >= 2;
  const consumedMeals = hasEntitlementLedger
    ? Math.max(0, Number(subscription.consumedMeals || 0) + Number(subscription.forfeitedMeals || 0))
    : Math.max(0, totalMeals - remainingMeals);
  const isSubscriptionActive = subscription.status === "active";

  const validityEndDateStr = subscription.validityEndDate
    ? toKSADateString(subscription.validityEndDate)
    : (subscription.endDate ? toKSADateString(subscription.endDate) : null);

  const isInsideValidity = !validityEndDateStr || businessDate <= validityEndDateStr;

  // canConsumeNow is true only if active, in validity, AND has remaining meals
  const canConsumeNow = isSubscriptionActive && isInsideValidity && remainingMeals > 0;

  // maxConsumableMealsNow is remainingMeals if active and in validity, else 0
  const maxConsumableMealsNow = (isSubscriptionActive && isInsideValidity) ? remainingMeals : 0;

  return {
    totalMeals,
    remainingMeals,
    consumedMeals,
    canConsumeNow,
    maxConsumableMealsNow,
    mealBalancePolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
    dailyMealLimitEnforced: false,
    dailyMealsDefault: Number(subscription.selectedMealsPerDay || subscription.mealsPerDay || 0),
  };
}

module.exports = {
  buildControllerErrorDetails,
  buildProjectedOpenDayForClient,
  buildSingleSkipMessage,
  logWalletIntegrityError,
  resolveBulkDaySelectionRequests,
  resolveRequestedDate,
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
  buildMealBalance,
};
