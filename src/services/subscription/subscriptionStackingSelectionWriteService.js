"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  getMealPlannerRules,
  buildMealSlotDraft,
} = require("./mealSlotPlannerService");
const {
  isCanonicalPlannerRequest,
  validateCanonicalMealSlots,
} = require("./canonicalMealSlotPlannerService");
const {
  assertSubscriptionDayModifiable,
} = require("./subscriptionDayModificationPolicyService");
const {
  applyCanonicalDraftPlanningToDay,
} = require("./subscriptionDayPlanningService");
const {
  buildDayCommercialState,
} = require("./subscriptionDayCommercialStateService");
const {
  resolveStackingPlanningContext,
} = require("./subscriptionStackingPlanningContextService");
const {
  applyBlueprintProteinGramsToMealSlots,
} = require("./subscriptionStackingKitchenGramsService");
const {
  reserveBlueprintAllocationsTransactional,
} = require("./subscriptionEntitlementLedgerService");
const {
  reconcileSubscriptionStackingLifecycleTransactional,
} = require("./subscriptionStackingLifecycleService");

function selectionError(code, message, status = 422, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return JSON.parse(JSON.stringify(value));
}

function normalizeDate(value) {
  const normalized = String(value || "").trim();
  if (!dateUtils.isValidKSADateString(normalized)) {
    throw selectionError(
      "INVALID_DATE",
      "date must use YYYY-MM-DD",
      400,
      { date: value }
    );
  }
  return normalized;
}

function assertContainerOwnedAndActive(subscription, userId, date) {
  if (!subscription) {
    throw selectionError("NOT_FOUND", "Subscription not found", 404);
  }
  if (String(subscription.userId || "") !== String(userId || "")) {
    throw selectionError("FORBIDDEN", "Forbidden", 403);
  }
  if (String(subscription.status || "") !== "active") {
    throw selectionError("SUB_INACTIVE", "Subscription not active", 422);
  }

  const targetDate = normalizeDate(date);
  const startDate = subscription.startDate
    ? dateUtils.toKSADateString(subscription.startDate)
    : "";
  const endDate = subscription.validityEndDate || subscription.endDate;
  const endDateString = endDate ? dateUtils.toKSADateString(endDate) : "";
  if (startDate && targetDate < startDate) {
    throw selectionError("SUB_NOT_STARTED", "Date is before subscription start", 422);
  }
  if (endDateString && targetDate > endDateString) {
    throw selectionError("SUB_EXPIRED", "Subscription expired for this date", 422);
  }
}

function assertBaseMealsOnly({
  mealSlots = [],
  draft = null,
  requestedOneTimeAddonIds,
  existingDay = null,
} = {}) {
  const requestedAddons = Array.isArray(requestedOneTimeAddonIds)
    ? requestedOneTimeAddonIds
    : [];
  const existingAddons = existingDay && Array.isArray(existingDay.addonSelections)
    ? existingDay.addonSelections
    : [];
  const existingPremium = existingDay && Array.isArray(existingDay.premiumUpgradeSelections)
    ? existingDay.premiumUpgradeSelections
    : [];
  const draftPremium = draft && Array.isArray(draft.premiumUpgradeSelections)
    ? draft.premiumUpgradeSelections
    : [];
  const premiumSlot = (Array.isArray(mealSlots) ? mealSlots : []).find((slot) => Boolean(
    slot
      && (
        slot.isPremium === true
        || (slot.premiumKey && String(slot.premiumKey).trim())
        || ["balance", "pending_payment", "paid", "paid_extra"]
          .includes(String(slot.premiumSource || ""))
      )
  ));

  if (requestedAddons.length > 0 || existingAddons.length > 0) {
    throw selectionError(
      "STACKING_ADDON_SELECTION_NOT_READY",
      "Add-on selection is not enabled for stacked subscriptions yet",
      503
    );
  }
  if (existingPremium.length > 0 || draftPremium.length > 0 || premiumSlot) {
    throw selectionError(
      "STACKING_PREMIUM_SELECTION_NOT_READY",
      "Premium selection is not enabled for stacked subscriptions yet",
      503
    );
  }
}

async function validateDraftAgainstContext({
  context,
  mealSlots,
  contractVersion,
  session = null,
} = {}) {
  const requiredSlotCount = Number(context && context.blueprint && context.blueprint.requiredSlotCount || 0);
  if (requiredSlotCount < 1) {
    throw selectionError(
      "STACKING_NO_ENTITLEMENT_FOR_DATE",
      "No reservable meal credit is available for this date",
      422,
      { date: context && context.date }
    );
  }

  const sourceSlots = Array.isArray(mealSlots) ? mealSlots : [];
  const useCanonicalPlanner = isCanonicalPlannerRequest({
    contractVersion,
    mealSlots: sourceSlots,
  });
  const draft = useCanonicalPlanner
    ? await validateCanonicalMealSlots({
      mealSlots: sourceSlots,
      mealsPerDayLimit: requiredSlotCount,
      maxSlotCount: requiredSlotCount,
      subscription: context.subscriptionView,
      ...(session ? { session } : {}),
    })
    : await buildMealSlotDraft({
      mealSlots: sourceSlots,
      mealsPerDayLimit: requiredSlotCount,
      maxSlotCount: requiredSlotCount,
      subscription: context.subscriptionView,
      ...(session ? { session } : {}),
    });

  if (!draft || draft.valid !== true) {
    throw selectionError(
      draft && draft.errorCode || "INVALID_MEAL_PLAN",
      draft && draft.errorMessage || "Meal planner validation failed",
      422,
      {
        valid: false,
        slotErrors: draft && draft.slotErrors || [],
        debug: draft && draft.debug,
        rules: getMealPlannerRules(),
      }
    );
  }

  draft.processedSlots = applyBlueprintProteinGramsToMealSlots({
    mealSlots: draft.processedSlots,
    blueprint: context.blueprint,
    fallbackGrams: context.subscriptionView.selectedGrams,
  });
  return draft;
}

function buildDraftCommercialState({ day, draft, subscriptionView }) {
  const shapedInput = {
    ...(day ? clonePlain(day) : {}),
    status: day && day.status ? day.status : "open",
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections: [],
    premiumExtraPayment: null,
  };
  return buildDayCommercialState(shapedInput, {
    subscription: subscriptionView,
  });
}

function buildSelectionUpdate({ draft, commercialState }) {
  return {
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    plannerVersion: "v1",
    plannerState: "draft",
    planningState: "draft",
    plannerRevisionHash: commercialState.plannerRevisionHash,
    premiumExtraPayment: commercialState.premiumExtraPayment,
    materializedMeals: draft.materializedMeals,
    selections: draft.selections,
    premiumUpgradeSelections: [],
    premiumReservationMode: "deferred",
    baseMealSlots: draft.baseMealSlots,
    addonSelections: [],
  };
}

async function loadInitialContext({
  userId,
  subscriptionId,
  date,
  mealSlots,
  requestedOneTimeAddonIds,
  getBusinessDate,
} = {}) {
  const targetDate = normalizeDate(date);
  const subscription = await Subscription.findById(subscriptionId).lean();
  assertContainerOwnedAndActive(subscription, userId, targetDate);
  const businessDate = await getBusinessDate();
  if (!businessDate) {
    throw selectionError(
      "STACKING_BUSINESS_DATE_UNAVAILABLE",
      "Restaurant business date is unavailable",
      503
    );
  }
  const existingDay = await SubscriptionDay.findOne({
    subscriptionId,
    date: targetDate,
  }).lean();
  await assertSubscriptionDayModifiable({
    subscription,
    day: existingDay,
    date: targetDate,
    getBusinessDateFn: async () => businessDate,
  });
  if (existingDay && String(existingDay.status || "open") !== "open") {
    throw selectionError("LOCKED", "Day is locked", 409);
  }
  if (existingDay && String(existingDay.plannerState || "") === "confirmed") {
    throw selectionError("LOCKED", "Planner is already confirmed for this day", 409);
  }
  assertBaseMealsOnly({
    mealSlots,
    requestedOneTimeAddonIds,
    existingDay,
  });
  const context = await resolveStackingPlanningContext({
    userId,
    subscription,
    date: targetDate,
    businessDate,
    existingMealSlots: existingDay && existingDay.mealSlots || [],
    incomingMealSlots: mealSlots,
    materialize: false,
  });
  return {
    targetDate,
    businessDate,
    subscription,
    existingDay,
    context,
  };
}

async function performStackingDaySelectionValidation({
  userId,
  subscriptionId,
  date,
  mealSlots = [],
  contractVersion,
  requestedOneTimeAddonIds,
  getBusinessDate = getRestaurantBusinessDate,
} = {}) {
  const loaded = await loadInitialContext({
    userId,
    subscriptionId,
    date,
    mealSlots,
    requestedOneTimeAddonIds,
    getBusinessDate,
  });
  const draft = await validateDraftAgainstContext({
    context: loaded.context,
    mealSlots,
    contractVersion,
  });
  assertBaseMealsOnly({
    mealSlots: draft.processedSlots,
    draft,
    requestedOneTimeAddonIds,
    existingDay: loaded.existingDay,
  });
  const commercialState = buildDraftCommercialState({
    day: loaded.existingDay,
    draft,
    subscriptionView: loaded.context.subscriptionView,
  });

  return {
    valid: true,
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections: [],
    plannerRevisionHash: commercialState.plannerRevisionHash,
    premiumSummary: commercialState.premiumSummary,
    addonSummary: commercialState.addonSummary,
    addonCategoryAllowances: commercialState.addonCategoryAllowances,
    addonSubscriptionAllowances: commercialState.addonSubscriptionAllowances,
    premiumExtraPayment: commercialState.premiumExtraPayment,
    paymentRequirement: commercialState.paymentRequirement,
    commercialState: commercialState.commercialState,
    isFulfillable: commercialState.isFulfillable,
    canBePrepared: commercialState.canBePrepared,
    rules: getMealPlannerRules(),
  };
}

async function performStackingDaySelectionUpdate({
  userId,
  subscriptionId,
  date,
  mealSlots = [],
  contractVersion,
  requestedOneTimeAddonIds,
  getBusinessDate = getRestaurantBusinessDate,
} = {}) {
  const loaded = await loadInitialContext({
    userId,
    subscriptionId,
    date,
    mealSlots,
    requestedOneTimeAddonIds,
    getBusinessDate,
  });
  const previewDraft = await validateDraftAgainstContext({
    context: loaded.context,
    mealSlots,
    contractVersion,
  });
  assertBaseMealsOnly({
    mealSlots: previewDraft.processedSlots,
    draft: previewDraft,
    requestedOneTimeAddonIds,
    existingDay: loaded.existingDay,
  });

  const session = await startSafeSession();
  session.startTransaction();
  try {
    const subscription = await Subscription.findById(subscriptionId).session(session);
    assertContainerOwnedAndActive(subscription, userId, loaded.targetDate);
    const existingDay = await SubscriptionDay.findOne({
      subscriptionId,
      date: loaded.targetDate,
    }).session(session);
    await assertSubscriptionDayModifiable({
      subscription,
      day: existingDay,
      date: loaded.targetDate,
      getBusinessDateFn: async () => loaded.businessDate,
    });
    if (existingDay && String(existingDay.status || "open") !== "open") {
      throw selectionError("LOCKED", "Day is locked", 409);
    }
    if (existingDay && String(existingDay.plannerState || "") === "confirmed") {
      throw selectionError("LOCKED", "Planner is already confirmed for this day", 409);
    }
    assertBaseMealsOnly({
      mealSlots,
      requestedOneTimeAddonIds,
      existingDay,
    });

    const context = await resolveStackingPlanningContext({
      userId,
      subscription,
      date: loaded.targetDate,
      businessDate: loaded.businessDate,
      existingMealSlots: existingDay && existingDay.mealSlots || [],
      incomingMealSlots: mealSlots,
      materialize: true,
      session,
    });
    const draft = await validateDraftAgainstContext({
      context,
      mealSlots,
      contractVersion,
      session,
    });
    assertBaseMealsOnly({
      mealSlots: draft.processedSlots,
      draft,
      requestedOneTimeAddonIds,
      existingDay,
    });
    const commercialState = buildDraftCommercialState({
      day: existingDay,
      draft,
      subscriptionView: context.subscriptionView,
    });

    if (
      existingDay
      && String(existingDay.plannerRevisionHash || "") === String(commercialState.plannerRevisionHash || "")
      && Array.isArray(existingDay.mealSlots)
      && existingDay.mealSlots.every((slot) => Boolean(
        slot
          && slot.entitlementSnapshot
          && Number(slot.entitlementSnapshot.proteinGrams || 0) > 0
      ))
    ) {
      await session.abortTransaction();
      await session.endSession();
      return {
        subscription,
        day: existingDay,
        idempotent: true,
      };
    }

    const update = buildSelectionUpdate({ draft, commercialState });
    const day = await SubscriptionDay.findOneAndUpdate(
      {
        subscriptionId,
        date: loaded.targetDate,
        ...(existingDay
          ? { _id: existingDay._id, plannerState: { $ne: "confirmed" } }
          : {}),
      },
      { $set: update },
      { upsert: !existingDay, new: true, session }
    );
    if (!day) {
      throw selectionError(
        "STACKING_DAY_SELECTION_CONFLICT",
        "Meal plan changed concurrently",
        409
      );
    }

    applyCanonicalDraftPlanningToDay({
      subscription: context.subscriptionView,
      day,
      selections: draft.selections,
      premiumSelections: [],
      now: new Date(),
    });
    day.mealSlots = draft.processedSlots;
    day.plannerMeta = draft.plannerMeta;
    day.plannerRevisionHash = commercialState.plannerRevisionHash;
    day.premiumExtraPayment = commercialState.premiumExtraPayment;
    await day.save({ session });

    await session.commitTransaction();
    await session.endSession();
    return {
      subscription,
      day,
      idempotent: false,
      plannerRevisionHash: day.plannerRevisionHash,
      premiumSummary: commercialState.premiumSummary,
      addonSummary: commercialState.addonSummary,
      addonCategoryAllowances: commercialState.addonCategoryAllowances,
      addonSubscriptionAllowances: commercialState.addonSubscriptionAllowances,
      premiumExtraPayment: commercialState.premiumExtraPayment,
      paymentRequirement: commercialState.paymentRequirement,
      commercialState: commercialState.commercialState,
    };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
    throw err;
  }
}

async function performStackingDayPlanningConfirmation({
  userId,
  subscriptionId,
  date,
  getBusinessDate = getRestaurantBusinessDate,
} = {}) {
  const targetDate = normalizeDate(date);
  const businessDate = await getBusinessDate();
  if (!businessDate) {
    throw selectionError(
      "STACKING_BUSINESS_DATE_UNAVAILABLE",
      "Restaurant business date is unavailable",
      503
    );
  }

  const session = await startSafeSession();
  session.startTransaction();
  try {
    let subscription = await Subscription.findById(subscriptionId).session(session);
    assertContainerOwnedAndActive(subscription, userId, targetDate);
    const day = await SubscriptionDay.findOne({
      subscriptionId,
      date: targetDate,
    }).session(session);
    if (!day) throw selectionError("NOT_FOUND", "Day not found", 404);
    await assertSubscriptionDayModifiable({
      subscription,
      day,
      date: targetDate,
      getBusinessDateFn: async () => businessDate,
    });
    if (String(day.status || "open") !== "open") {
      throw selectionError("LOCKED", "Day is locked", 409);
    }
    if (
      String(day.plannerState || "") === "confirmed"
      || String(day.planningState || "") === "confirmed"
    ) {
      await session.abortTransaction();
      await session.endSession();
      return { subscription, day, idempotent: true };
    }
    assertBaseMealsOnly({
      mealSlots: day.mealSlots,
      existingDay: day,
    });

    const context = await resolveStackingPlanningContext({
      userId,
      subscription,
      date: targetDate,
      businessDate,
      existingMealSlots: day.mealSlots || [],
      incomingMealSlots: day.mealSlots || [],
      materialize: true,
      session,
    });
    const contractVersion = Array.isArray(day.mealSlots)
      && day.mealSlots.some((slot) => slot && slot.contractVersion)
      ? "v3"
      : null;
    const draft = await validateDraftAgainstContext({
      context,
      mealSlots: day.mealSlots || [],
      contractVersion,
      session,
    });
    assertBaseMealsOnly({
      mealSlots: draft.processedSlots,
      draft,
      existingDay: day,
    });

    const requiredSlotCount = Number(context.blueprint.requiredSlotCount || 0);
    const plannerMeta = draft.plannerMeta || {};
    if (
      Number(plannerMeta.partialSlotCount || 0) > 0
      || Number(plannerMeta.completeSlotCount || 0) !== requiredSlotCount
      || Number(plannerMeta.requiredSlotCount || 0) !== requiredSlotCount
    ) {
      throw selectionError(
        "PLANNING_INCOMPLETE",
        "Planner must have all required slots complete",
        422,
        {
          requiredSlotCount,
          completeSlotCount: Number(plannerMeta.completeSlotCount || 0),
          partialSlotCount: Number(plannerMeta.partialSlotCount || 0),
        }
      );
    }

    const commercialState = buildDayCommercialState({
      ...clonePlain(day),
      status: day.status,
      plannerState: "draft",
      mealSlots: draft.processedSlots,
      plannerMeta,
      addonSelections: [],
      premiumExtraPayment: null,
    }, { subscription: context.subscriptionView });
    if (commercialState.paymentRequirement.requiresPayment) {
      throw selectionError(
        "PAYMENT_REQUIRED",
        "Pending payment must be settled before confirmation",
        422
      );
    }
    if (commercialState.commercialState !== "ready_to_confirm") {
      throw selectionError(
        "PLANNING_INCOMPLETE",
        "Day is not ready for confirmation",
        422
      );
    }

    const plannerRevisionHash = commercialState.plannerRevisionHash;
    const reservation = await reserveBlueprintAllocationsTransactional({
      userId,
      containerSubscriptionId: subscriptionId,
      blueprint: context.blueprint,
      subscriptionDayId: day._id,
      plannerRevisionHash,
      operationIdempotencyKeyPrefix: `planner-confirm:${day._id}:${plannerRevisionHash}`,
      session,
    });
    if (Number(reservation.allocationCount || 0) !== requiredSlotCount) {
      throw selectionError(
        "STACKING_RESERVATION_COUNT_MISMATCH",
        "Reserved meal count does not match the day blueprint",
        409,
        {
          requiredSlotCount,
          allocationCount: Number(reservation.allocationCount || 0),
        }
      );
    }

    const confirmedAt = new Date();
    const confirmedPlannerMeta = {
      ...plannerMeta,
      isDraftValid: true,
      isConfirmable: true,
      confirmedAt,
      confirmedByRole: "client",
    };
    const confirmedDay = await SubscriptionDay.findOneAndUpdate(
      {
        _id: day._id,
        subscriptionId,
        plannerState: { $ne: "confirmed" },
        plannerRevisionHash: String(day.plannerRevisionHash || ""),
      },
      {
        $set: {
          mealSlots: draft.processedSlots,
          materializedMeals: draft.materializedMeals,
          selections: draft.selections,
          premiumUpgradeSelections: [],
          baseMealSlots: draft.baseMealSlots,
          plannerMeta: confirmedPlannerMeta,
          plannerState: "confirmed",
          planningState: "confirmed",
          plannerRevisionHash,
          planningMeta: {
            requiredMealCount: requiredSlotCount,
            selectedBaseMealCount: requiredSlotCount,
            selectedPremiumMealCount: 0,
            isExactCountSatisfied: true,
            confirmedAt,
          },
          premiumExtraPayment: commercialState.premiumExtraPayment,
        },
      },
      { new: true, session }
    );
    if (!confirmedDay) {
      throw selectionError(
        "PLANNER_REVISION_CONFLICT",
        "Planner changed while meal credits were being reserved",
        409
      );
    }

    const lifecycle = await reconcileSubscriptionStackingLifecycleTransactional({
      containerSubscriptionId: subscriptionId,
      businessDate,
      session,
    });
    subscription = lifecycle.container || subscription;

    await session.commitTransaction();
    await session.endSession();
    return {
      subscription,
      day: confirmedDay,
      idempotent: false,
      stackingReservation: {
        allocationCount: reservation.allocationCount,
        newlyReservedCount: reservation.newlyReservedCount,
      },
    };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    await session.endSession();
    throw err;
  }
}

module.exports = {
  assertBaseMealsOnly,
  performStackingDayPlanningConfirmation,
  performStackingDaySelectionUpdate,
  performStackingDaySelectionValidation,
  validateDraftAgainstContext,
};
