const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Addon = require("../../models/Addon");
const dateUtils = require("../../utils/date");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { getMealPlannerRules, mapPaymentRequirement, buildMealSlotDraft } = require("./mealSlotPlannerService");
const { applyCanonicalDraftPlanningToDay } = require("./subscriptionDayPlanningService");
const { assertSubscriptionDayModifiable } = require("./subscriptionDayModificationPolicyService");
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
  const addonDocs = await Addon.find({
    _id: { $in: requestedAddonIds },
    isActive: true,
    kind: "item",
    billingMode: "flat_once",
  }).lean();
  const addonMap = new Map(addonDocs.map((d) => [String(d._id), d]));

  // 2. Track category usage for subscription entitlements
  const entitlements = Array.isArray(subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  const entitlementUsage = new Map(); // category -> count

  const newSelections = [];

  for (const addonId of requestedAddonIds) {
    const doc = addonMap.get(String(addonId));
    if (!doc) {
      throw {
        status: 400,
        code: "INVALID_ONE_TIME_ADDON_SELECTION",
        message: `Addon ${String(addonId)} is not an active meal-planner add-on item`,
      };
    }

    const category = doc.category;
    const entitlement = entitlements.find((e) => e.category === category);
    
    let source = "pending_payment";
    let priceHalala = doc.priceHalala || Math.round((doc.price || 0) * 100);

    // Check if inclusive
    const used = entitlementUsage.get(category) || 0;
    if (entitlement && used < (entitlement.maxPerDay || 1)) {
      source = "subscription";
      priceHalala = 0;
      entitlementUsage.set(category, used + 1);
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
        name: resolveAddonSelectionName(doc),
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

function resolveAddonSelectionName(addonDoc) {
  if (!addonDoc || addonDoc.name == null) return "";
  if (typeof addonDoc.name === "string") return addonDoc.name;
  if (typeof addonDoc.name === "object") {
    return String(addonDoc.name.en || addonDoc.name.ar || "").trim();
  }
  return String(addonDoc.name || "").trim();
}

async function consumePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, unitExtraFeeHalala = 3000, session }) {
  if (!session) {
    throw new Error("consumePremiumBalanceAtomically requires a session");
  }

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { consumed: false, reason: "no_balance_array", premiumSource: "pending_payment", premiumExtraFeeHalala: unitExtraFeeHalala };
  }

  if (!premiumKey) {
    return { consumed: false, reason: "no_premium_key", premiumSource: "pending_payment", premiumExtraFeeHalala: unitExtraFeeHalala };
  }

  const bucketIndex = subscription.premiumBalance.findIndex(
    (b) => b.premiumKey === premiumKey && Number(b.remainingQty || 0) > 0
  );

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

async function releasePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, session }) {
  if (!session) {
    throw new Error("releasePremiumBalanceAtomically requires a session");
  }

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { released: false, reason: "no_balance_array" };
  }

  if (!premiumKey) {
    return { released: false, reason: "no_premium_key" };
  }

  const bucketIndex = subscription.premiumBalance.findIndex((b) => b.premiumKey === premiumKey);

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

async function consumeAddonBalanceAtomically({ subscription, dayId, date, addonId, session }) {
  if (!session) throw new Error("consumeAddonBalanceAtomically requires a session");
  if (!subscription || !Array.isArray(subscription.addonBalance)) return { consumed: false };

  const bucketIndex = subscription.addonBalance.findIndex(
    (b) => String(b.addonId) === String(addonId) && Number(b.remainingQty || 0) > 0
  );

  if (bucketIndex < 0) return { consumed: false };

  const bucket = subscription.addonBalance[bucketIndex];
  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      "addonBalance._id": bucket._id,
      "addonBalance.remainingQty": { $gt: 0 },
    },
    {
      $inc: { "addonBalance.$.remainingQty": -1 },
    },
    { session, new: true }
  );

  if (!atomicResult) return { consumed: false };

  return {
    consumed: true,
    unitPriceHalala: bucket.unitPriceHalala,
    currency: bucket.currency,
  };
}

async function releaseAddonBalanceAtomically({ subscription, addonId, unitPriceHalala, session }) {
  if (!session) throw new Error("releaseAddonBalanceAtomically requires a session");
  if (!subscription || !Array.isArray(subscription.addonBalance)) return { released: false };

  const bucketIndex = subscription.addonBalance.findIndex(
    (b) => String(b.addonId) === String(addonId) && Number(b.unitPriceHalala || 0) === Number(unitPriceHalala || 0)
  );

  if (bucketIndex < 0) return { released: false };

  const bucket = subscription.addonBalance[bucketIndex];
  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      "addonBalance._id": bucket._id,
    },
    {
      $inc: { "addonBalance.$.remainingQty": 1 },
    },
    { session, new: true }
  );

  return { released: !!atomicResult };
}

function reconcilePremiumBalanceForDay(subscription, existingDay, newPremiumUpgradeSelections, { dayId, date } = {}) {
  if (!subscription || !Array.isArray(subscription.premiumBalance)) return;

  const toRefund = [];
  if (existingDay && Array.isArray(existingDay.premiumUpgradeSelections)) {
    for (const sel of existingDay.premiumUpgradeSelections) {
      if (sel.premiumSource === "balance") toRefund.push(sel);
    }
  }

  // Find matches in premiumBalance and refund by premiumKey
  for (const sel of toRefund) {
    const bucket = subscription.premiumBalance.find((b) => b.premiumKey === sel.premiumKey);
    if (bucket) {
      bucket.remainingQty += 1;
    }
    // Also remove from subscription.premiumSelections if tracked there
    if (Array.isArray(subscription.premiumSelections)) {
       const keyDate = date || (existingDay && existingDay.date) || sel.date;
       const idx = subscription.premiumSelections.findIndex((ps) => ps.premiumKey === sel.premiumKey && ps.baseSlotKey === sel.baseSlotKey && ps.date === keyDate);
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
              const bucket = subscription.premiumBalance.find((b) => b.premiumKey === sel.premiumKey && b.remainingQty > 0);
              if (bucket) {
                  bucket.remainingQty -= 1;
                  subscription.premiumSelections.push({
                      dayId: dayId || (existingDay ? existingDay._id : null),
                      date: date || (existingDay ? existingDay.date : null) || sel.date,
                      baseSlotKey: sel.baseSlotKey,
                      premiumKey: sel.premiumKey,
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
      const bucket = premiumBalance.find((row) => row.premiumKey === selection.premiumKey);
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
    const startDate = subscription.startDate;
    const startDateStr = startDate instanceof Date || typeof startDate === "number" ? dateUtils.toKSADateString(startDate) : startDate;
    if (startDateStr && dateUtils.isBeforeKSADate(dateStr, startDateStr)) {
      const err = new Error("Date is before subscription start");
      err.code = "SUB_NOT_STARTED";
      err.status = 422;
      throw err;
    }

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

async function validateSelectionDateRangeOrThrow(date, sub, endDateOverride) {
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
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
  const totalSelected = (selections || []).length + (premiumSelections || []).length;

  // 1. Fetch context (Lean)
  const requestedSub = await Subscription.findById(subscriptionId).lean();
  if (!requestedSub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  if (String(requestedSub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

  const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(requestedSub);
  const subForDraft = resolvedPlanningSubscription.subscription;
  const canonicalSubscriptionId = resolvedPlanningSubscription.subscriptionId;

  const mealsPerDayLimit = resolveMealsPerDay(subForDraft);
  if (totalSelected > mealsPerDayLimit) throw { status: 400, code: "DAILY_CAP", message: "Selections exceed meals per day" };
  ensureActive(subForDraft, date);
  await validateSelectionDateRangeOrThrow(date, subForDraft);

    const existingDay = await SubscriptionDay.findOne({ subscriptionId: canonicalSubscriptionId, date }).lean();
    await assertSubscriptionDayModifiable({
      subscription: subForDraft,
      day: existingDay,
      date,
      getBusinessDateFn: getRestaurantBusinessDate,
    });
    if (!Array.isArray(mealSlots)) {
      throw {
        status: 422,
        code: "LEGACY_DAY_SELECTION_UNSUPPORTED",
        message: "Legacy day selection payload is no longer supported. Submit mealSlots with canonical planner fields.",
        details: {
          expectedPayload: {
            mealSlots: [
              {
                slotIndex: 1,
                selectionType: "standard_meal",
                proteinId: "protein_id",
                carbs: [{ carbId: "carb_id", grams: 150 }],
              },
            ],
          },
        },
      };
    }
    if (existingDay && existingDay.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };
    if (existingDay && existingDay.plannerState === "confirmed") throw { status: 409, code: "LOCKED", message: "Planner is already confirmed for this day" };

    // 2. Build Draft & Reconcile Addons (In-Memory)
    const planningDraftSubscription = buildPlanningDraftSubscriptionView(subForDraft, existingDay);
    const draft = await buildMealSlotDraft({ mealSlots, mealsPerDayLimit, subscription: planningDraftSubscription });
    
    if (!draft.valid) {
      throw {
        status: 422,
        code: draft.errorCode || "INVALID_MEAL_PLAN",
        message: draft.errorMessage || "Meal planner validation failed",
        valid: false,
        slotErrors: draft.slotErrors,
        rules: getMealPlannerRules()
      };
    }

  const addonContainer = {
    addonSelections: existingDay ? JSON.parse(JSON.stringify(existingDay.addonSelections || [])) : [],
  };
  if (requestedOneTimeAddonIds !== undefined) {
    await reconcileAddonInclusions(subForDraft, addonContainer, requestedOneTimeAddonIds);
  }

  // 3. Calculate Commercial State & Revision Hash
  const derivedDraftState = buildDayCommercialState({
    status: existingDay && existingDay.status ? existingDay.status : "open",
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections: addonContainer.addonSelections,
    premiumExtraPayment: existingDay && existingDay.premiumExtraPayment ? existingDay.premiumExtraPayment : null,
  });

  // 4. Idempotency Short-circuit
  if (existingDay && existingDay.plannerRevisionHash === derivedDraftState.plannerRevisionHash) {
    return { subscription: subForDraft, day: existingDay, idempotent: true };
  }

  // 5. Atomic Update Execution
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(canonicalSubscriptionId).session(session);
    if (!subInSession) throw { status: 404, code: "NOT_FOUND", message: "Subscription for session lost" };

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
      addonSelections: addonContainer.addonSelections,
    };

    const day = await SubscriptionDay.findOneAndUpdate(
      { subscriptionId: canonicalSubscriptionId, date },
      { $set: update },
      { upsert: true, new: true, session }
    );

    // SYNC: Ensure planning projection is consistent
    applyCanonicalDraftPlanningToDay({
      subscription: subInSession,
      day,
      selections: draft.selections,
      premiumSelections: draft.premiumUpgradeSelections,
      now: new Date(),
    });

    // ATOMIC: Premium balance sync
    const existingBalanceMap = new Map();
    if (existingDay && Array.isArray(existingDay.premiumUpgradeSelections)) {
       for (const sel of existingDay.premiumUpgradeSelections) {
         if (sel.premiumSource === "balance") {
           existingBalanceMap.set(`${sel.baseSlotKey}_${sel.premiumKey}`, sel);
         }
       }
    }

    const processedPremiumSelections = [];
    if (Array.isArray(draft.premiumUpgradeSelections)) {
      for (const sel of draft.premiumUpgradeSelections) {
        if (sel.isPremium === true || (sel.premiumSource && sel.premiumSource !== "none")) {
          const mapKey = `${sel.baseSlotKey}_${sel.premiumKey}`;
          const existingClaim = existingBalanceMap.get(mapKey);

          if (existingClaim) {
             processedPremiumSelections.push({ ...sel, premiumSource: "balance", unitExtraFeeHalala: existingClaim.unitExtraFeeHalala || 3000 });
             existingBalanceMap.delete(mapKey);
             continue;
          }

          const balanceResult = await consumePremiumBalanceAtomically({
            subscription: subInSession,
            dayId: day._id,
            date,
            premiumKey: sel.premiumKey || null,
            proteinId: sel.proteinId,
            unitExtraFeeHalala: sel.unitExtraFeeHalala || 3000,
            session,
          });
          if (balanceResult.consumed && Array.isArray(subInSession.premiumBalance)) {
            const balanceRow = subInSession.premiumBalance.find((row) => row.premiumKey === (sel.premiumKey || null));
            if (balanceRow && Number(balanceRow.remainingQty || 0) > 0) {
              balanceRow.remainingQty -= 1;
            }
            subInSession.markModified("premiumBalance");
          }

          processedPremiumSelections.push({
            ...sel,
            premiumSource: balanceResult.consumed ? "balance" : "pending_payment",
            unitExtraFeeHalala: balanceResult.consumed ? 0 : (balanceResult.premiumExtraFeeHalala || 3000)
          });
        } else {
          processedPremiumSelections.push(sel);
        }
      }
      day.premiumUpgradeSelections = processedPremiumSelections;
    }

    for (const sel of existingBalanceMap.values()) {
      await releasePremiumBalanceAtomically({ subscription: subInSession, premiumKey: sel.premiumKey, session });
      if (Array.isArray(subInSession.premiumBalance)) {
        const balanceRow = subInSession.premiumBalance.find((row) => row.premiumKey === sel.premiumKey);
        if (balanceRow) {
          balanceRow.remainingQty = Number(balanceRow.remainingQty || 0) + 1;
        }
        subInSession.markModified("premiumBalance");
      }
    }

    // ATOMIC: Addon balance sync
    const existingAddonWalletMap = new Map();
    if (existingDay && Array.isArray(existingDay.addonSelections)) {
       for (const sel of existingDay.addonSelections) {
         if (sel.source === "wallet") {
           const key = String(sel.addonId);
           const list = existingAddonWalletMap.get(key) || [];
           list.push(sel);
           existingAddonWalletMap.set(key, list);
         }
       }
    }

    const processedAddonSelections = [];
    if (Array.isArray(day.addonSelections)) {
       for (const sel of day.addonSelections) {
          if (sel.source === "subscription" || sel.source === "paid") {
             processedAddonSelections.push(sel);
          } else {
             // It's pending_payment or newly requested. Try wallet claim if possible.
             const key = String(sel.addonId);
             const existingList = existingAddonWalletMap.get(key);
             if (existingList && existingList.length > 0) {
                const claim = existingList.shift();
                processedAddonSelections.push({ ...sel, source: "wallet", priceHalala: 0 });
             } else {
                const walletResult = await consumeAddonBalanceAtomically({
                   subscription: subInSession,
                   addonId: sel.addonId,
                   session
                });
                if (walletResult.consumed) {
                   processedAddonSelections.push({ ...sel, source: "wallet", priceHalala: 0 });
                } else {
                   processedAddonSelections.push(sel); // keep as pending_payment
                }
             }
          }
       }
       day.addonSelections = processedAddonSelections;
    }

    // Release survivors (addons that were using wallet but are now removed)
    for (const list of existingAddonWalletMap.values()) {
       for (const sel of list) {
          await releaseAddonBalanceAtomically({
             subscription: subInSession,
             addonId: sel.addonId,
             unitPriceHalala: sel.unitPriceHalala || 0,
             session
          });
       }
    }

    await subInSession.save({ session });
    await day.save({ session });

    // Ensure Global Sync (redundant but for compatibility)
    if (Array.isArray(subInSession.addonSelections)) {
       subInSession.addonSelections = subInSession.addonSelections.filter(s => s.date !== date);
       for (const sel of day.addonSelections) {
         if (sel.source === "wallet" || sel.source === "pending_payment" || sel.source === "paid") {
           subInSession.addonSelections.push({ dayId: day._id, date: day.date, addonId: sel.addonId, qty: 1, unitPriceHalala: sel.priceHalala, currency: sel.currency });
         }
       }
       subInSession.markModified("addonSelections");
    }
    if (Array.isArray(subInSession.premiumSelections)) {
       subInSession.premiumSelections = subInSession.premiumSelections.filter(s => s.date !== date);
       for (const sel of day.premiumUpgradeSelections) {
         if (sel.premiumSource === "balance" || sel.premiumSource === "pending_payment" || sel.premiumSource === "paid") {
           subInSession.premiumSelections.push({ dayId: day._id, date: day.date, baseSlotKey: sel.baseSlotKey, premiumKey: sel.premiumKey, proteinId: sel.proteinId, unitExtraFeeHalala: sel.unitExtraFeeHalala, currency: sel.currency });
         }
       }
       subInSession.markModified("premiumSelections");
    }
    await subInSession.save({ session });

    await session.commitTransaction();
    session.endSession();
    return { subscription: subInSession, day, idempotent: false };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

async function performDaySelectionValidation({
  userId,
  subscriptionId,
  date,
  mealSlots = [],
  requestedOneTimeAddonIds,
}) {
  const requestedSub = await Subscription.findById(subscriptionId);
  if (!requestedSub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  if (String(requestedSub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

  const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(requestedSub);
  const sub = resolvedPlanningSubscription.subscription;
  const resolvedSubscriptionId = resolvedPlanningSubscription.subscriptionId;
  if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  ensureActive(sub, date);
  await validateSelectionDateRangeOrThrow(date, sub);

  const day = await SubscriptionDay.findOne({ subscriptionId: resolvedSubscriptionId, date });
  await assertSubscriptionDayModifiable({
    subscription: sub,
    day,
    date,
    getBusinessDateFn: getRestaurantBusinessDate,
  });
  if (day && day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

  const mealsPerDayLimit = resolveMealsPerDay(sub);
  const planningDraftSubscription = buildPlanningDraftSubscriptionView(sub, day);
  const draft = await buildMealSlotDraft({ mealSlots, mealsPerDayLimit, subscription: planningDraftSubscription });
  if (!draft.valid) {
    throw { status: 422, code: draft.errorCode || "INVALID_MEAL_PLAN", message: draft.errorMessage || "Meal planner validation failed", slotErrors: draft.slotErrors, rules: getMealPlannerRules(), valid: false };
  }

  let addonSelections = Array.isArray(day && day.addonSelections)
    ? JSON.parse(JSON.stringify(day.addonSelections))
    : [];

  if (requestedOneTimeAddonIds !== undefined) {
    const addonContainer = { addonSelections };
    await reconcileAddonInclusions(sub, addonContainer, requestedOneTimeAddonIds);
    addonSelections = addonContainer.addonSelections;
  }

  const derivedDraftState = buildDayCommercialState({
    plannerState: "draft",
    status: day && day.status ? day.status : "open",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections,
    premiumExtraPayment: day && day.premiumExtraPayment ? day.premiumExtraPayment : null,
  });

  return {
    valid: true,
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections,
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
    let subInSession = await Subscription.findById(subscriptionId).session(session);
    if (!subInSession) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };

    const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(subInSession, session);
    subInSession = resolvedPlanningSubscription.subscription;
    subscriptionId = resolvedPlanningSubscription.subscriptionId;

    if (String(subInSession.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };
    ensureActive(subInSession, date);
    await validateSelectionDateRangeOrThrow(date, subInSession);

    const day = await SubscriptionDay.findOne({ subscriptionId, date }).session(session);
    if (!day) throw { status: 404, code: "NOT_FOUND", message: "Day not found" };
    await assertSubscriptionDayModifiable({
      subscription: subInSession,
      day,
      date,
      getBusinessDateFn: getRestaurantBusinessDate,
    });
    if (day.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };

    if (day.plannerState === "confirmed" || day.planningState === "confirmed") {
      throw { status: 409, code: "DAY_ALREADY_CONFIRMED", message: "Day is already confirmed" };
    }

    const requiredSlotCount = resolveMealsPerDay(subInSession);
    const planningDraftSubscription = buildPlanningDraftSubscriptionView(subInSession, day);
    const validatedDraft = await buildMealSlotDraft({
      mealSlots: day.mealSlots,
      mealsPerDayLimit: requiredSlotCount,
      subscription: planningDraftSubscription,
      session,
    });
    if (!validatedDraft.valid) {
      throw {
        status: 422,
        code: validatedDraft.errorCode || "INVALID_MEAL_PLAN",
        message: validatedDraft.errorMessage || "Meal planner validation failed",
        valid: false,
        slotErrors: validatedDraft.slotErrors,
      };
    }

    const plannerMeta = validatedDraft.plannerMeta;
    if (plannerMeta.partialSlotCount > 0) throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Planner has partial slots" };
    if (plannerMeta.completeSlotCount !== plannerMeta.requiredSlotCount) throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Planner must have all required slots complete" };

    day.mealSlots = validatedDraft.processedSlots;
    day.materializedMeals = validatedDraft.materializedMeals;
    day.selections = validatedDraft.selections;
    day.premiumUpgradeSelections = validatedDraft.premiumUpgradeSelections;
    day.baseMealSlots = validatedDraft.baseMealSlots;
    const preConfirmState = buildDayCommercialState({
      ...(typeof day.toObject === "function" ? day.toObject() : day),
      plannerState: day.plannerState || "draft",
      plannerMeta,
      mealSlots: day.mealSlots,
      status: day.status,
      premiumExtraPayment: day.premiumExtraPayment || null,
    });
    if (preConfirmState.paymentRequirement.requiresPayment) {
      if (Number(preConfirmState.paymentRequirement.premiumPendingPaymentCount || 0) > 0) {
        throw { status: 422, code: "PREMIUM_PAYMENT_REQUIRED", message: "Premium payment is required before confirmation" };
      }
      if (Number(preConfirmState.paymentRequirement.addonPendingPaymentCount || 0) > 0) {
        throw { status: 422, code: "ADDON_PAYMENT_REQUIRED", message: "Add-on payment is required before confirmation" };
      }
      throw { status: 422, code: "PAYMENT_REQUIRED", message: "Pending payment must be settled before confirmation" };
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


module.exports = {
  consumePremiumBalanceAtomically,
  releasePremiumBalanceAtomically,
  performDaySelectionUpdate,
  performDaySelectionValidation,
  performDayPlanningConfirmation,
};
