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
  buildCanonicalPlanningView,
  isCanonicalDayPlanningEligible,
} = require("./subscriptionDayPlanningService");
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

  const actionType = day.canonicalDayActionType;
  if (actionType !== undefined && actionType !== null) {
    serializedDay.canonicalDayActionType = actionType;
  } else {
    delete serializedDay.canonicalDayActionType;
  }

  if (Array.isArray(day.addonSelections)) {
    serializedDay.addonSelections = day.addonSelections;
  }

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

function shapeMealPlannerReadFields({ subscription = null, day, lang = "ar" }) {
  if (!day || typeof day !== "object") return day;

  const shaped = applySubscriptionDayFulfillmentState({
    subscription,
    day: applyLegacyMealPlannerResponseMirrors({
      subscription,
      day: applyCommercialStateToDay(day),
      lang,
    }),
  });
  const commercialStateLabel = resolveReadLabel("commercialStates", shaped.commercialState, lang);
  const premiumExtraPaymentStatus = (shaped.premiumExtraPayment && shaped.premiumExtraPayment.status) || "none";
  const premiumExtraPaymentStatusLabel = resolveReadLabel("premiumExtraPaymentStatuses", premiumExtraPaymentStatus, lang);
  const pricingStatus = (shaped.paymentRequirement && shaped.paymentRequirement.pricingStatus) || "none";
  const pricingStatusLabel = resolveReadLabel("pricingStatuses", pricingStatus, lang);
  const blockingReasonLabel = shaped.paymentRequirement && shaped.paymentRequirement.blockingReason
    ? resolveReadLabel("paymentBlockingReasons", shaped.paymentRequirement.blockingReason, lang)
    : null;

  return {
    ...shaped,
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

function buildControllerErrorDetails(err) {
  const details = err && err.details && typeof err.details === "object" ? { ...err.details } : undefined;
  if (err && err.slotErrors) {
    return {
      ...(details || {}),
      slotErrors: err.slotErrors,
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

module.exports = {
  buildControllerErrorDetails,
  buildProjectedOpenDayForClient,
  buildSingleSkipMessage,
  logWalletIntegrityError,
  resolveBulkDaySelectionRequests,
  resolveRequestedDate,
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
};
