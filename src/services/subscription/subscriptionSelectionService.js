const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Addon = require("../../models/Addon");
const dateUtils = require("../../utils/date");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { getMealPlannerRules, mapPaymentRequirement, buildMealSlotDraft, recomputePlannerMetaFromSlots, projectMaterializedAndLegacyForExistingSlots } = require("./mealSlotPlannerService");
const { applyCanonicalDraftPlanningToDay } = require("./subscriptionDayPlanningService");
const {
  buildDayCommercialState,
} = require("./subscriptionDayCommercialStateService");

async function resolvePlanningSubscriptionForOperation(subscription, session = null) {
  let resolvedSubscription = subscription;
  let resolvedSubscriptionId = subscription && subscription._id ? subscription._id : null;

  if (
    resolvedSubscription
    && resolvedSubscription.contractMode !== "canonical"
    && resolvedSubscription.userId
  ) {
    let query = Subscription.findOne({
      userId: resolvedSubscription.userId,
      contractMode: "canonical",
      status: "active",
    }).sort({ createdAt: -1 });

    if (session) {
      query = query.session(session);
    }

    const canonical = await query;
    if (canonical) {
      resolvedSubscription = canonical;
      resolvedSubscriptionId = canonical._id;
    }
  }

  return {
    subscription: resolvedSubscription,
    subscriptionId: resolvedSubscriptionId,
  };
}

async function reconcileAddonInclusions(subscription, day, requestedAddonIds = []) {
  if (!Array.isArray(requestedAddonIds) || requestedAddonIds.length === 0) {
    day.addonSelections = [];
    return;
  }

  // 1. Fetch requested addon items
  const addonDocs = await Addon.find({ _id: { $in: requestedAddonIds }, kind: "item" }).lean();
  const addonMap = new Map(addonDocs.map((d) => [String(d._id), d]));

  // 2. Track category usage for subscription entitlements
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const entitlementUsage = new Map(); // category -> count

  const newSelections = [];

  for (const addonId of requestedAddonIds) {
    const doc = addonMap.get(String(addonId));
    if (!doc) continue;

    const category = doc.category;
    const entitlement = entitlements.find((e) => e.category === category);
    
    let source = "pending_payment";
    let priceHalala = doc.priceHalala || Math.round((doc.price || 0) * 100);

    // Check if inclusive
    if (entitlement) {
      const used = entitlementUsage.get(category) || 0;
      if (used < (entitlement.maxPerDay || 1)) {
        source = "subscription";
        priceHalala = 0;
        entitlementUsage.set(category, used + 1);
      }
    }

    // Preserve existing 'paid' selections if they match (to avoid re-charging)
    const existingPaid = (day.addonSelections || []).find(
      (s) => String(s.addonId) === String(addonId) && s.source === "paid"
    );

    if (existingPaid) {
      newSelections.push(existingPaid);
    } else {
      newSelections.push({
        addonId: doc._id,
        name: doc.name,
        category: doc.category,
        source,
        priceHalala,
        currency: doc.currency || "SAR",
        consumedAt: new Date(),
      });
    }
  }

  day.addonSelections = newSelections;
}

async function consumePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, proteinId, unitExtraFeeHalala = 3000, session }) {
  if (!session) {
    throw new Error("consumePremiumBalanceAtomically requires a session");
  }

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { consumed: false, reason: "no_balance_array", premiumSource: "pending_payment", premiumExtraFeeHalala: unitExtraFeeHalala };
  }

  const matchKey = premiumKey || null;
  const matchId = proteinId ? String(proteinId) : null;

  let bucketIndex = -1;
  if (matchKey) {
    bucketIndex = subscription.premiumBalance.findIndex(
      (b) => b.premiumKey === matchKey && Number(b.remainingQty || 0) > 0
    );
  }

  if (bucketIndex < 0 && matchId) {
    bucketIndex = subscription.premiumBalance.findIndex(
      (b) => String(b.proteinId) === matchId && Number(b.remainingQty || 0) > 0
    );
  }

  if (bucketIndex < 0) {
    return { consumed: false, reason: "no_remaining_balance", premiumSource: "pending_payment", premiumExtraFeeHalala: unitExtraFeeHalala };
  }

  const bucket = subscription.premiumBalance[bucketIndex];
  const bucketId = subscription._id;

  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: bucketId,
      "premiumBalance._id": bucket._id,
      "premiumBalance.remainingQty": { $gt: 0 },
    },
    {
      $inc: { "premiumBalance.$.remainingQty": -1 },
    },
    { session, new: true }
  );

  if (!atomicResult) {
    return { consumed: false, reason: "atomic_failed", premiumSource: "pending_payment", premiumExtraFeeHalala: unitExtraFeeHalala };
  }

  return {
    consumed: true,
    remainingQty: atomicResult.premiumBalance[bucketIndex]?.remainingQty || 0,
    premiumSource: "balance",
    premiumKey: bucket.premiumKey,
    proteinId: bucket.proteinId,
  };
}

async function releasePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, proteinId, session }) {
  if (!session) {
    throw new Error("releasePremiumBalanceAtomically requires a session");
  }

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { released: false, reason: "no_balance_array" };
  }

  const matchKey = premiumKey || null;
  const matchId = proteinId ? String(proteinId) : null;

  let bucketIndex = -1;
  if (matchKey) {
    bucketIndex = subscription.premiumBalance.findIndex((b) => b.premiumKey === matchKey);
  }

  if (bucketIndex < 0 && matchId) {
    bucketIndex = subscription.premiumBalance.findIndex((b) => String(b.proteinId) === matchId);
  }

  if (bucketIndex < 0) {
    return { released: false, reason: "bucket_not_found" };
  }

  const bucket = subscription.premiumBalance[bucketIndex];
  const bucketId = subscription._id;

  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: bucketId,
      "premiumBalance._id": bucket._id,
    },
    {
      $inc: { "premiumBalance.$.remainingQty": 1 },
    },
    { session, new: true }
  );

  if (!atomicResult) {
    return { released: false, reason: "atomic_failed" };
  }

  return { released: true, remainingQty: atomicResult.premiumBalance[bucketIndex]?.remainingQty || 0 };
}

function reconcilePremiumBalanceForDay(subscription, existingDay, newPremiumUpgradeSelections, { dayId, date } = {}) {
  if (!subscription || !Array.isArray(subscription.premiumBalance)) return;

  const toRefund = [];
  if (existingDay && Array.isArray(existingDay.premiumUpgradeSelections)) {
    for (const sel of existingDay.premiumUpgradeSelections) {
      if (sel.premiumSource === "balance") toRefund.push(sel);
    }
  }

  // Find matches in premiumBalance and refund
  for (const sel of toRefund) {
    const bucket = subscription.premiumBalance.find((b) => String(b.proteinId) === String(sel.proteinId));
    if (bucket) {
      bucket.remainingQty += 1;
    }
    // Also remove from subscription.premiumSelections if tracked there
    if (Array.isArray(subscription.premiumSelections)) {
       const keyDate = date || (existingDay && existingDay.date) || sel.date;
       const idx = subscription.premiumSelections.findIndex((ps) => String(ps.proteinId) === String(sel.proteinId) && ps.baseSlotKey === sel.baseSlotKey && ps.date === keyDate);
       if (idx >= 0) {
          subscription.premiumSelections.splice(idx, 1);
       }
    }
  }

  // Deduct new
  if (Array.isArray(newPremiumUpgradeSelections)) {
      subscription.premiumSelections = subscription.premiumSelections || [];
      for (const sel of newPremiumUpgradeSelections) {
          if (sel.premiumSource === "balance") {
              const bucket = subscription.premiumBalance.find((b) => String(b.proteinId) === String(sel.proteinId) && b.remainingQty > 0);
              if (bucket) {
                  bucket.remainingQty -= 1;
                  subscription.premiumSelections.push({
                      dayId: dayId || (existingDay ? existingDay._id : null),
                      date: date || (existingDay ? existingDay.date : null) || sel.date,
                      baseSlotKey: sel.baseSlotKey,
                      proteinId: sel.proteinId,
                      unitExtraFeeHalala: sel.unitExtraFeeHalala,
                      currency: sel.currency,
                  });
              } else {
                  // Fallback safety: If some race condition happened, flip it to paid
                  sel.premiumSource = "paid";
              }
          }
      }
  }

  // CRITICAL: Mongoose doesn't always track nested object updates in an array
  if (subscription.markModified) {
    subscription.markModified("premiumBalance");
  }
}

function buildPlanningDraftSubscriptionView(subscription, existingDay) {
  if (!subscription || typeof subscription !== "object") {
    return subscription;
  }

  const premiumBalance = Array.isArray(subscription.premiumBalance)
    ? subscription.premiumBalance.map((row) => ({
      ...(row && typeof row.toObject === "function" ? row.toObject() : row),
    }))
    : [];

  if (existingDay && Array.isArray(existingDay.premiumUpgradeSelections)) {
    for (const selection of existingDay.premiumUpgradeSelections) {
      if (!selection || selection.premiumSource !== "balance") continue;
      const bucket = premiumBalance.find((row) => String(row.proteinId) === String(selection.proteinId));
      if (bucket) {
        bucket.remainingQty = Number(bucket.remainingQty || 0) + 1;
      }
    }
  }

  return {
    ...subscription,
    premiumBalance,
  };
}

async function resolveSubscriptionDay({ subscriptionId, dayId, date, session }) {
  if (dayId) {
    const day = (await SubscriptionDay.findById(dayId).session(session))
      || (await SubscriptionDay.findOne({ subscriptionId, _id: dayId }).session(session));
    if (day) return day;
  }
  if (date) {
    const day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (day) return day;
  }
  return null;
}

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    err.status = 422;
    throw err;
  }
  if (dateStr) {
    const endDate = subscription.validityEndDate || subscription.endDate;
    const endDateStr = endDate instanceof Date || typeof endDate === "number" ? dateUtils.toKSADateString(endDate) : endDate;
    if (endDateStr && dateUtils.isAfterKSADate(dateStr, endDateStr)) {
      const err = new Error("Subscription expired for this date");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

async function validateFutureDateOrThrow(date, sub, endDateOverride) {
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
  const today = await getRestaurantBusinessDate();
  if (dateUtils.isBeforeKSADate(date, today)) {
    const err = new Error("Date cannot be in the past");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
  if (sub) {
    const startDateStr = sub.startDate ? dateUtils.toKSADateString(sub.startDate) : null;
    if (startDateStr && dateUtils.isBeforeKSADate(date, startDateStr)) {
      const err = new Error("Date is before subscription start date");
      err.code = "DAY_OUT_OF_SUBSCRIPTION_RANGE";
      err.status = 422;
      throw err;
    }
    const endDate = endDateOverride || sub.validityEndDate || sub.endDate;
    const endDateStr = endDate instanceof Date || typeof endDate === "number" ? dateUtils.toKSADateString(endDate) : endDate;
    if (endDateStr && dateUtils.isAfterKSADate(date, endDateStr)) {
      const err = new Error("Date is outside subscription validity");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

async function performDaySelectionUpdate({ userId, subscriptionId, date, selections = [], premiumSelections = [], mealSlots, requestedOneTimeAddonIds, runtime }) {
  await validateFutureDateOrThrow(date);
  const totalSelected = selections.length + premiumSelections.length;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let subInSession = await Subscription.findById(subscriptionId).session(session);
    if (!subInSession) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };

    const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(subInSession, session);
    subInSession = resolvedPlanningSubscription.subscription;
    subscriptionId = resolvedPlanningSubscription.subscriptionId;

    if (String(subInSession.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

    const mealsPerDayLimit = resolveMealsPerDay(subInSession);
    if (totalSelected > mealsPerDayLimit) throw { status: 400, code: "DAILY_CAP", message: "Selections exceed meals per day" };
    ensureActive(subInSession, date);
    await validateFutureDateOrThrow(date, subInSession);

    const existingDay = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (!Array.isArray(mealSlots)) {
      throw {
        status: 422,
        code: "LEGACY_DAY_SELECTION_UNSUPPORTED",
        message: "Legacy day selection payload is no longer supported. Submit mealSlots with proteinId/carbId only.",
        details: {
          expectedPayload: {
            mealSlots: [
              {
                slotIndex: 1,
                slotKey: "slot_1",
                proteinId: "protein_id",
                carbId: "carb_id",
              },
            ],
          },
        },
      };
    }
    if (existingDay && existingDay.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };
    if (existingDay && existingDay.plannerState === "confirmed") throw { status: 409, code: "LOCKED", message: "Planner is already confirmed for this day" };

    const planningDraftSubscription = buildPlanningDraftSubscriptionView(subInSession, existingDay);
    const draft = await buildMealSlotDraft({ mealSlots, mealsPerDayLimit, subscription: planningDraftSubscription, session });
    
    if (!draft.valid) {
      throw { 
        status: 422, 
        code: draft.errorCode || "INVALID_MEAL_PLAN", 
        message: draft.errorMessage || "Meal planner validation failed", 
        valid: false, 
        slotErrors: draft.slotErrors 
      };
    }

    const derivedDraftState = buildDayCommercialState({
      status: existingDay && existingDay.status ? existingDay.status : "open",
      plannerState: "draft",
      mealSlots: draft.processedSlots,
      plannerMeta: draft.plannerMeta,
      premiumExtraPayment: existingDay && existingDay.premiumExtraPayment ? existingDay.premiumExtraPayment : null,
    });

    const update = {
      mealSlots: draft.processedSlots,
      plannerMeta: draft.plannerMeta,
      plannerVersion: "v1",
      plannerState: "draft",
      plannerRevisionHash: derivedDraftState.plannerRevisionHash,
      premiumExtraPayment: derivedDraftState.premiumExtraPayment,
      materializedMeals: draft.materializedMeals,
      selections: draft.selections,
      premiumUpgradeSelections: draft.premiumUpgradeSelections,
      baseMealSlots: draft.baseMealSlots,
    };
    if (requestedOneTimeAddonIds !== undefined) {
      const addonContainer = {
        addonSelections: existingDay ? JSON.parse(JSON.stringify(existingDay.addonSelections || [])) : [],
      };
      await reconcileAddonInclusions(subInSession, addonContainer, requestedOneTimeAddonIds);
      update.addonSelections = addonContainer.addonSelections;
    }

    const day = await SubscriptionDay.findOneAndUpdate({ subscriptionId, date }, { $set: update }, { upsert: true, new: true, session });
    if (!day) {
        throw new Error("Critical: SubscriptionDay findOneAndUpdate returned null during valid update flow");
    }

    // SYNC: Ensure planning projection is consistent with the new slots
    applyCanonicalDraftPlanningToDay({
      subscription: subInSession,
      day,
      selections: draft.selections,
      premiumSelections: draft.premiumUpgradeSelections,
      now: new Date(),
    });

    // ATOMIC premium balance consumption - replaces reconcilePremiumBalanceForDay
    const processedPremiumSelections = [];
    if (Array.isArray(draft.premiumUpgradeSelections)) {
      for (const sel of draft.premiumUpgradeSelections) {
        if (sel.isPremium === true || (sel.premiumSource && sel.premiumSource !== "none")) {
          const balanceResult = await consumePremiumBalanceAtomically({
            subscription: subInSession,
            dayId: day._id,
            date,
            premiumKey: sel.premiumKey || null,
            proteinId: sel.proteinId,
            unitExtraFeeHalala: sel.unitExtraFeeHalala || 3000,
            session,
          });

          if (balanceResult.consumed) {
            processedPremiumSelections.push({
              baseSlotKey: sel.baseSlotKey,
              proteinId: sel.proteinId,
              premiumSource: "balance",
              unitExtraFeeHalala: sel.unitExtraFeeHalala || 3000,
              date,
              dayId: day._id,
            });
          } else {
            processedPremiumSelections.push({
              baseSlotKey: sel.baseSlotKey,
              proteinId: sel.proteinId,
              premiumSource: "pending_payment",
              unitExtraFeeHalala: balanceResult.premiumExtraFeeHalala || 3000,
              currency: "SAR",
              date,
              dayId: day._id,
            });
          }
        } else {
          processedPremiumSelections.push(sel);
        }
      }

      // Update day.premiumUpgradeSelections with processed selections
      day.premiumUpgradeSelections = processedPremiumSelections;
      update.premiumUpgradeSelections = processedPremiumSelections;
    }

    // Also process any changes - restore balance for slots that were using balance but no longer are
    if (existingDay && Array.isArray(existingDay.premiumUpgradeSelections)) {
      const existingBalanceSelections = existingDay.premiumUpgradeSelections.filter(
        (s) => s.premiumSource === "balance"
      );
      const newBaseSlotKeys = new Set(processedPremiumSelections.map((s) => s.baseSlotKey));

      for (const sel of existingBalanceSelections) {
        if (!newBaseSlotKeys.has(sel.baseSlotKey)) {
          await releasePremiumBalanceAtomically({
            subscription: subInSession,
            dayId: day._id,
            date,
            premiumKey: sel.premiumKey || null,
            proteinId: sel.proteinId,
            session,
          });
        }
      }
    }

    await subInSession.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
    return { subscription: subInSession, day, idempotent: false };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    throw err;
  }
}

async function performDaySelectionValidation({ userId, subscriptionId, date, mealSlots = [] }) {
  await validateFutureDateOrThrow(date);

  const requestedSub = await Subscription.findById(subscriptionId);
  if (!requestedSub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  if (String(requestedSub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

  const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(requestedSub);
  const sub = resolvedPlanningSubscription.subscription;
  const resolvedSubscriptionId = resolvedPlanningSubscription.subscriptionId;
  if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  ensureActive(sub, date);
  await validateFutureDateOrThrow(date, sub);

  const day = await SubscriptionDay.findOne({ subscriptionId: resolvedSubscriptionId, date });
  if (day && day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

  const mealsPerDayLimit = resolveMealsPerDay(sub);
  const planningDraftSubscription = buildPlanningDraftSubscriptionView(sub, day);
  const draft = await buildMealSlotDraft({ mealSlots, mealsPerDayLimit, subscription: planningDraftSubscription });
  if (!draft.valid) {
    return { valid: false, code: draft.errorCode || "INVALID_MEAL_PLAN", message: draft.errorMessage || "Meal planner validation failed", slotErrors: draft.slotErrors, rules: getMealPlannerRules() };
  }

  const derivedDraftState = buildDayCommercialState({
    plannerState: "draft",
    status: day && day.status ? day.status : "open",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    premiumExtraPayment: day && day.premiumExtraPayment ? day.premiumExtraPayment : null,
  });

  return {
    valid: true,
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    plannerRevisionHash: derivedDraftState.plannerRevisionHash,
    premiumSummary: derivedDraftState.premiumSummary,
    premiumExtraPayment: derivedDraftState.premiumExtraPayment,
    paymentRequirement: mapPaymentRequirement({
      plannerMeta: draft.plannerMeta,
      plannerState: "draft",
      status: day && day.status ? day.status : "open",
      premiumExtraPayment: derivedDraftState.premiumExtraPayment,
    }),
    commercialState: derivedDraftState.commercialState,
    isFulfillable: derivedDraftState.isFulfillable,
    canBePrepared: derivedDraftState.canBePrepared,
    rules: getMealPlannerRules(),
  };
}

async function performDayPlanningConfirmation({ userId, subscriptionId, date, runtime }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(subscriptionId).session(session);
    if (!subInSession) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    if (String(subInSession.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    ensureActive(subInSession, date);
    await validateFutureDateOrThrow(date, subInSession);

    const day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (!day) throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    if (day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

    if (day.plannerState === "confirmed" || day.planningState === "confirmed") {
      throw { status: 409, code: "DAY_ALREADY_CONFIRMED", message: "Day is already confirmed" };
    }

    const requiredSlotCount = resolveMealsPerDay(subInSession);
    const { plannerMeta, slotErrors } = recomputePlannerMetaFromSlots({ mealSlots: day.mealSlots, requiredSlotCount });
    if (slotErrors.length > 0) {
      const firstError = slotErrors[0] || {};
      throw { status: 422, code: firstError.code || "INVALID_MEAL_PLAN", message: firstError.message || "Meal planner validation failed", valid: false, slotErrors };
    }
    if (plannerMeta.partialSlotCount > 0) throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Planner has partial slots" };
    if (plannerMeta.completeSlotCount !== plannerMeta.requiredSlotCount) throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Planner must have all required slots complete" };

    const projection = await projectMaterializedAndLegacyForExistingSlots({ mealSlots: day.mealSlots, session });
    day.materializedMeals = projection.materializedMeals;
    day.selections = projection.selections;
    day.premiumUpgradeSelections = projection.premiumSelections;
    day.baseMealSlots = projection.baseMealSlots;
    const preConfirmState = buildDayCommercialState({
      ...(typeof day.toObject === "function" ? day.toObject() : day),
      plannerState: day.plannerState || "draft",
      plannerMeta,
      mealSlots: day.mealSlots,
      status: day.status,
      premiumExtraPayment: day.premiumExtraPayment || null,
    });
    if (preConfirmState.paymentRequirement.requiresPayment) {
      throw { status: 422, code: "PREMIUM_PAYMENT_REQUIRED", message: "Premium payment is required before confirmation" };
    }
    if (preConfirmState.commercialState !== "ready_to_confirm") {
      throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Day is not ready for confirmation" };
    }

    day.plannerMeta = { ...plannerMeta, isDraftValid: true, isConfirmable: true, confirmedAt: new Date(), confirmedByRole: "client" };
    day.plannerState = "confirmed";
    day.planningState = "confirmed";
    day.planningMeta = {
      ...(day.planningMeta && typeof day.planningMeta === "object" ? day.planningMeta : {}),
      requiredMealCount: Number(day.plannerMeta.requiredSlotCount || 0),
      selectedBaseMealCount: Math.max(
        0,
        Number(day.plannerMeta.completeSlotCount || 0) - Number(day.plannerMeta.premiumSlotCount || 0)
      ),
      selectedPremiumMealCount: Number(day.plannerMeta.premiumSlotCount || 0),
      selectedTotalMealCount: Number(day.plannerMeta.completeSlotCount || 0),
      isExactSatisfied: Boolean(day.plannerMeta.isDraftValid),
      lastEditedAt:
        (day.planningMeta && day.planningMeta.lastEditedAt)
        || (day.planningMeta && day.planningMeta.confirmedAt)
        || new Date(),
      confirmedAt: day.plannerMeta.confirmedAt || null,
      confirmedByRole: day.plannerMeta.confirmedByRole || null,
    };

    const derivedState = buildDayCommercialState({
      ...(typeof day.toObject === "function" ? day.toObject() : day),
      plannerState: "confirmed",
      plannerMeta: day.plannerMeta,
      mealSlots: day.mealSlots,
      status: day.status,
      premiumExtraPayment: day.premiumExtraPayment || null,
    });
    day.plannerRevisionHash = derivedState.plannerRevisionHash;
    day.premiumExtraPayment = derivedState.premiumExtraPayment;

    if (runtime && runtime.assertNoPendingOneTimeAddonPayment) {
      runtime.assertNoPendingOneTimeAddonPayment({ day });
    }

    const confirmUpdateResult = await SubscriptionDay.findOneAndUpdate(
      {
        _id: day._id,
        status: "open",
        $or: [
          { plannerState: { $ne: "confirmed" } },
          { plannerState: { $exists: false } },
        ],
      },
      {
        $set: {
          plannerState: "confirmed",
          planningState: "confirmed",
          plannerMeta: day.plannerMeta,
          planningMeta: day.planningMeta,
          materializedMeals: day.materializedMeals,
          selections: day.selections,
          premiumUpgradeSelections: day.premiumUpgradeSelections,
          baseMealSlots: day.baseMealSlots,
          plannerRevisionHash: day.plannerRevisionHash,
          premiumExtraPayment: day.premiumExtraPayment,
        },
      },
      { session, new: true }
    );

    if (!confirmUpdateResult) {
      throw { status: 409, code: "DAY_ALREADY_CONFIRMED", message: "Day was already confirmed by another request" };
    }

    await session.commitTransaction();
    session.endSession();
    return { subscription: subInSession, day: confirmUpdateResult };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function performConsumePremiumSelection({ userId, subscriptionId, dayId, date, baseSlotKey, proteinId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    if (String(sub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    ensureActive(sub, day.date);
    if (day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

    const normalizedBaseSlotKey = String(baseSlotKey || "").trim();
    const matchingSlot = Array.isArray(day.mealSlots)
      ? day.mealSlots.find((slot) => (
        slot
        && String(slot.slotKey || "") === normalizedBaseSlotKey
        && String(slot.proteinId || "") === String(proteinId)
      ))
      : null;
    if (!matchingSlot) {
      throw { status: 404, code: "NOT_FOUND", message: "Premium selection not found" };
    }

    const targetDayId = String(day._id);
    const targetDate = day.date;
    const existingSelection = (sub.premiumSelections || []).find((row) => (
      String(row.baseSlotKey || "") === normalizedBaseSlotKey
      && String(row.proteinId || "") === String(proteinId)
      && (((row.dayId && String(row.dayId) === targetDayId) || row.date === targetDate))
    ));
    if (existingSelection) {
      const remainingQtyTotal = (sub.premiumBalance || [])
        .filter((row) => String(row.proteinId) === String(proteinId))
        .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
      await session.commitTransaction();
      session.endSession();
      return { ok: true, subscriptionId: sub.id, proteinId: String(proteinId), remainingQtyTotal };
    }

    const balances = (sub.premiumBalance || [])
      .filter((row) => String(row.proteinId) === String(proteinId) && Number(row.remainingQty) > 0)
      .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
    if (!balances.length) {
      throw { status: 400, code: "INSUFFICIENT_PREMIUM", message: "Not enough premium credits" };
    }

    const bucket = balances[0];
    bucket.remainingQty = Math.max(0, Number(bucket.remainingQty || 0) - 1);
    sub.premiumSelections = sub.premiumSelections || [];
    sub.premiumSelections.push({
      dayId: day._id,
      date: day.date,
      baseSlotKey: normalizedBaseSlotKey,
      proteinId,
      unitExtraFeeHalala: Number(bucket.unitExtraFeeHalala || 0),
      currency: bucket.currency || "SAR",
      premiumWalletRowId: bucket._id || null,
    });

    if (Array.isArray(day.premiumUpgradeSelections)) {
      day.premiumUpgradeSelections = day.premiumUpgradeSelections.map((selection) => {
        if (
          selection
          && String(selection.baseSlotKey || "") === normalizedBaseSlotKey
          && String(selection.proteinId || "") === String(proteinId)
        ) {
          return {
            ...(selection.toObject ? selection.toObject() : selection),
            premiumSource: "balance",
            unitExtraFeeHalala: Number(bucket.unitExtraFeeHalala || selection.unitExtraFeeHalala || 0),
            currency: bucket.currency || selection.currency || "SAR",
          };
        }
        return selection;
      });
    }

    if (Array.isArray(day.mealSlots)) {
      day.mealSlots = day.mealSlots.map((slot) => {
        if (
          slot
          && String(slot.slotKey || "") === normalizedBaseSlotKey
          && String(slot.proteinId || "") === String(proteinId)
        ) {
          return {
            ...(slot.toObject ? slot.toObject() : slot),
            premiumSource: "balance",
          };
        }
        return slot;
      });
    }

    if (sub.markModified) {
      sub.markModified("premiumBalance");
      sub.markModified("premiumSelections");
    }
    day.markModified("premiumUpgradeSelections");
    day.markModified("mealSlots");
    applyDayWalletSelections({ day });
    await sub.save({ session });
    await day.save({ session });
    await session.commitTransaction();
    session.endSession();
    const remainingQtyTotal = (sub.premiumBalance || [])
      .filter((row) => String(row.proteinId) === String(proteinId))
      .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    return { ok: true, subscriptionId: sub.id, proteinId: String(proteinId), remainingQtyTotal };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function performRemovePremiumSelection({ userId, subscriptionId, dayId, date, baseSlotKey }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    if (String(sub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    ensureActive(sub, day.date);
    if (day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

    const normalizedBaseSlotKey = String(baseSlotKey || "").trim();
    const targetDayId = String(day._id);
    const targetDate = day.date;
    const selection = (sub.premiumSelections || []).find((row) => (
      String(row.baseSlotKey || "") === normalizedBaseSlotKey
      && (((row.dayId && String(row.dayId) === targetDayId) || row.date === targetDate))
    ));
    if (!selection) {
      throw { status: 404, code: "NOT_FOUND", message: "Premium selection not found" };
    }

    sub.premiumSelections = (sub.premiumSelections || []).filter((row) => !(
      String(row.baseSlotKey || "") === normalizedBaseSlotKey
      && (((row.dayId && String(row.dayId) === targetDayId) || row.date === targetDate))
    ));

    const match = (sub.premiumBalance || []).find((row) => (
      (selection.premiumWalletRowId && row._id && String(row._id) === String(selection.premiumWalletRowId))
      || (
        !selection.premiumWalletRowId
        && String(row.proteinId) === String(selection.proteinId)
        && Number(row.unitExtraFeeHalala || 0) === Number(selection.unitExtraFeeHalala || 0)
      )
    ));
    if (!match) {
      throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot refund premium credits because the original wallet bucket was not found" };
    }

    const nextRemainingQty = Number(match.remainingQty || 0) + 1;
    const purchasedQty = Number(match.purchasedQty || 0);
    if (nextRemainingQty > purchasedQty) {
      throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot refund premium credits because refund exceeds purchased quantity" };
    }
    match.remainingQty = nextRemainingQty;

    if (Array.isArray(day.premiumUpgradeSelections)) {
      day.premiumUpgradeSelections = day.premiumUpgradeSelections.map((premiumSelection) => {
        if (
          premiumSelection
          && String(premiumSelection.baseSlotKey || "") === normalizedBaseSlotKey
          && String(premiumSelection.proteinId || "") === String(selection.proteinId)
        ) {
          return {
            ...(premiumSelection.toObject ? premiumSelection.toObject() : premiumSelection),
            premiumSource: Number(premiumSelection.unitExtraFeeHalala || 0) > 0 ? "pending_payment" : "paid",
          };
        }
        return premiumSelection;
      });
    }

    if (Array.isArray(day.mealSlots)) {
      day.mealSlots = day.mealSlots.map((slot) => {
        if (
          slot
          && String(slot.slotKey || "") === normalizedBaseSlotKey
          && String(slot.proteinId || "") === String(selection.proteinId)
        ) {
          return {
            ...(slot.toObject ? slot.toObject() : slot),
            premiumSource: Number(slot.premiumExtraFeeHalala || 0) > 0 ? "pending_payment" : "paid",
          };
        }
        return slot;
      });
    }

    if (sub.markModified) {
      sub.markModified("premiumBalance");
      sub.markModified("premiumSelections");
    }
    day.markModified("premiumUpgradeSelections");
    day.markModified("mealSlots");
    applyDayWalletSelections({ day });
    await sub.save({ session });
    await day.save({ session });
    await session.commitTransaction();
    session.endSession();
    return { ok: true, subscriptionId: sub.id };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function performConsumeAddonSelection({ userId, subscriptionId, dayId, date, addonId, qty }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    if (String(sub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    ensureActive(sub, date);

    const day = dayId ? await SubscriptionDay.findById(dayId).session(session) : await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);
    if (!day) throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    if (day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

    const balances = (sub.addonBalance || []).filter((row) => String(row.addonId) === String(addonId) && Number(row.remainingQty) > 0).sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
    const totalAvailable = balances.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    if (totalAvailable < qty) throw { status: 400, code: "INSUFFICIENT_ADDON", message: "Not enough addon credits" };

    let remaining = qty;
    sub.addonSelections = sub.addonSelections || [];
    for (const row of balances) {
      if (remaining <= 0) break;
      const available = Number(row.remainingQty || 0);
      const deduct = Math.min(available, remaining);
      if (!deduct) continue;
      row.remainingQty = available - deduct;
      sub.addonSelections.push({ dayId: day._id, date: day.date, addonId, qty: deduct, unitPriceHalala: Number(row.unitPriceHalala || 0), currency: row.currency || "SAR" });
      remaining -= deduct;
    }

    applyDayWalletSelections({ day });
    await sub.save({ session });
    await day.save({ session });
    await session.commitTransaction();
    session.endSession();
    const remainingQtyTotal = (sub.addonBalance || []).filter((row) => String(row.addonId) === String(addonId)).reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    return { ok: true, subscriptionId: sub.id, addonId: String(addonId), remainingQtyTotal };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function performRemoveAddonSelection({ userId, subscriptionId, dayId, date, addonId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(subscriptionId).session(session);
    if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
    if (String(sub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

    const targetDay = dayId ? await SubscriptionDay.findById(dayId).session(session) : await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);
    if (!targetDay) throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    ensureActive(sub, targetDay.date);
    if (targetDay.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;
    const toRefund = (sub.addonSelections || []).filter((row) => String(row.addonId) === String(addonId) && ((row.dayId && String(row.dayId) === targetDayId) || row.date === targetDate));
    if (!toRefund.length) throw { status: 404, code: "NOT_FOUND", message: "Addon selection not found" };

    sub.addonSelections = (sub.addonSelections || []).filter((row) => !(String(row.addonId) === String(addonId) && (((row.dayId && String(row.dayId) === targetDayId) || row.date === targetDate))));
    for (const row of toRefund) {
      const match = (sub.addonBalance || []).find((balance) => String(balance.addonId) === String(addonId) && Number(balance.unitPriceHalala || 0) === Number(row.unitPriceHalala || 0));
      if (!match) throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot refund addon credits because the original wallet bucket was not found" };
      const nextRemainingQty = Number(match.remainingQty || 0) + Number(row.qty || 0);
      const purchasedQty = Number(match.purchasedQty || 0);
      if (nextRemainingQty > purchasedQty) throw { status: 409, code: "DATA_INTEGRITY_ERROR", message: "Cannot refund addon credits because refund exceeds purchased quantity" };
      match.remainingQty = nextRemainingQty;
    }

    applyDayWalletSelections({ day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });
    await session.commitTransaction();
    session.endSession();
    return { ok: true, subscriptionId: sub.id };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

module.exports = {
  consumePremiumBalanceAtomically,
  releasePremiumBalanceAtomically,
  performConsumePremiumSelection,
  performRemovePremiumSelection,
  performDaySelectionUpdate,
  performDaySelectionValidation,
  performDayPlanningConfirmation,
};
