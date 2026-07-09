const mongoose = require("mongoose");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const dateUtils = require("../../utils/date");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../../utils/subscription/subscriptionDaySelectionSync");
const {
  getMealPlannerRules,
  buildMealSlotDraft,
  recomputePlannerMetaFromSlots,
  projectMaterializedAndLegacyFromSlots,
} = require("./mealSlotPlannerService");
const { applyCanonicalDraftPlanningToDay } = require("./subscriptionDayPlanningService");
const {
  isCanonicalPlannerRequest,
  validateCanonicalMealSlots,
} = require("./canonicalMealSlotPlannerService");
const { assertSubscriptionDayModifiable } = require("./subscriptionDayModificationPolicyService");
const {
  resolveAddonChoiceProductById,
} = require("./subscriptionAddonChoicesService");
const {
  buildDayCommercialState,
  finalizeDayCommercialStateForPersistence,
} = require("./subscriptionDayCommercialStateService");
const { buildMealBalance } = require("./subscriptionClientSupportService");
const {
  assertPremiumUpgradeLimit,
  countPersistedPremiumUpgradesForSubscription,
  countPremiumUpgradeSelections,
  resolveTotalSubscriptionMealsFromSubscription,
} = require("./premiumUpgradeLimitService");
const {
  assertPlanningBalanceAfterSave,
} = require("./subscriptionPlanningBalanceService");
const { resolvePremiumUpgrade, resolveSubscriptionPremiumUpgradePricing } = require("./premiumUpgradeConfigService");
const {
  supersedeInitiatedDayPlanningPaymentsForRevisionChange,
} = require("./subscriptionDayPaymentLifecycleService");
const {
  assertSubscriptionActiveAndOwned,
  assertSubscriptionDateRange,
} = require("./subscriptionDateRangeHelperService");
const {
  assertDayModifiableByClient,
  hasPendingOrUnpaidPayment,
  hasSupersededPayment,
} = require("./subscriptionDayLockService");
const { resolveSubscriptionAddonBalanceWithAudit, buildClientAddonBalance } = require("./subscriptionAddonBalanceService");

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

async function reconcileAddonInclusions(
  subscription,
  day,
  requestedAddonIds = [],
  { resolveChoiceProductById = resolveAddonChoiceProductById } = {}
) {
  if (!Array.isArray(requestedAddonIds) || requestedAddonIds.length === 0) {
    day.addonSelections = [];
    return;
  }

  const choiceMap = new Map();
  for (const addonId of requestedAddonIds) {
    if (choiceMap.has(String(addonId))) continue;
    const choice = await resolveChoiceProductById(addonId);
    if (choice) choiceMap.set(String(addonId), choice);
  }

  // Build simulation map for remaining quantities
  const simulatedRemaining = new Map();
  const hasAddonBalance = Array.isArray(subscription && subscription.addonBalance) && subscription.addonBalance.length > 0;

  // 1. Fetch unified category balances (this safely combines explicit buckets and audit fallback per category)
  const computedBalances = buildClientAddonBalance(subscription, null);

  if (computedBalances && computedBalances.addonBalanceNeedsReview) {
    throw { 
      status: 409, 
      code: "ADDON_BALANCE_MISSING_REVIEW_REQUIRED", 
      message: "Subscription is missing addon balance tracking and requires administrative review to proceed." 
    };
  }

  // 2. Prepare the simulated remaining map per category/bucket
  if (hasAddonBalance) {
    for (const bucket of subscription.addonBalance) {
      if (!bucket || !bucket._id) continue;
      let qty = Number(bucket.remainingQty || 0);

      // Add back existing day selections that were already deducted
      if (day && Array.isArray(day.addonSelections)) {
        for (const sel of day.addonSelections) {
          if (sel.source === "subscription") {
            const match = findAddonBalanceBucket(subscription, {
              addonId: sel.addonId,
              addonPlanId: sel.addonPlanId,
              category: sel.category,
              unitPriceHalala: sel.unitPriceHalala
            });
            if (match && String(match._id) === String(bucket._id)) {
              qty += 1;
            }
          }
        }
      }
      simulatedRemaining.set(String(bucket._id), qty);
    }
  }

  const newSelections = [];

  for (const addonId of requestedAddonIds) {
    const choice = choiceMap.get(String(addonId));
    if (!choice) {
      throw {
        status: 400,
        code: "INVALID_ONE_TIME_ADDON_SELECTION",
        message: `Add-on choice ${String(addonId)} is not an active one-time MenuProduct in an allowed subscription add-on category`,
      };
    }

    const doc = choice.product;
    const category = choice.addonCategory;
    const entitlement = findAddonEntitlementForChoice(subscription, category, addonId);

    let source = "pending_payment";
    const unitPriceHalala = doc.priceHalala || Math.round((doc.price || 0) * 100);
    let priceHalala = unitPriceHalala;

    // Preserve existing 'paid' selections if they match (to avoid re-charging)
    const existingPaid = (day.addonSelections || []).find(
      (s) => String(s.addonId) === String(addonId) && s.source === "paid"
    );

    if (existingPaid) {
      newSelections.push(existingPaid);
      continue;
    }

    // Determine whether this item is covered by the entitlement's explicit allowlist.
    // menuProductIds acts as a coverage-eligibility gate, NOT a rejection gate:
    //   - item IN menuProductIds   → eligible for subscription balance coverage
    //   - item NOT IN menuProductIds → falls through to pending_payment (no balance consumed)
    //   - menuProductIds empty/absent → all items of matching category are balance-eligible
    let isRestrictedByPlan = false;
    if (entitlement && Array.isArray(entitlement.menuProductIds) && entitlement.menuProductIds.length > 0) {
      const allowedIds = entitlement.menuProductIds.map((id) => String(id));
      if (!allowedIds.includes(String(doc._id))) {
        isRestrictedByPlan = true;
      }
    }

    if (entitlement && !isRestrictedByPlan) {
      let canCover = false;
      const bucket = findAddonBalanceBucket(subscription, {
        addonId: doc._id,
        addonPlanId: entitlement ? (entitlement.addonPlanId || entitlement.addonId) : null,
        category,
        unitPriceHalala
      });
      if (bucket && bucket._id) {
        const rem = simulatedRemaining.get(String(bucket._id)) || 0;
        if (rem > 0) {
          canCover = true;
          simulatedRemaining.set(String(bucket._id), rem - 1);
        }
      }

      if (canCover) {
        source = "subscription";
        priceHalala = 0;
      }
    }

    newSelections.push({
      addonId: doc._id,
      addonPlanId: entitlement ? (entitlement.addonPlanId || entitlement.addonId) : null,
      name: resolveAddonSelectionName(doc),
      category,
      source,
      priceHalala,
      unitPriceHalala,
      currency: doc.currency || "SAR",
      consumedAt: new Date(),
    });
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

function findAddonEntitlementForChoice(subscription, category, addonId = null) {
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  return entitlements.find((entry) => {
    if (!entry) return false;
    if (category && entry.category === category) return true;
    if (addonId && String(entry.addonId || entry.addonPlanId || "") === String(addonId)) return true;
    return false;
  }) || null;
}

function findAddonBalanceBucket(subscription, { addonId = null, addonPlanId = null, category = null, unitPriceHalala = null } = {}) {
  const balances = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
  const entitlements = Array.isArray(subscription && subscription.addonSubscriptions) ? subscription.addonSubscriptions : [];
  return balances.find((bucket) => {
    if (!bucket) return false;
    if (addonPlanId && String(bucket.addonPlanId || bucket.addonId || "") === String(addonPlanId)) return true;
    if (addonId && String(bucket.addonId || "") === String(addonId)) return true;
    if (category && bucket.category === category) return true;
    if (category) {
      return entitlements.some((entry) => {
        const entryPlanId = String(entry.addonPlanId || entry.addonId || "");
        const bucketPlanId = String(bucket.addonPlanId || bucket.addonId || "");
        return entry.category === category && entryPlanId && entryPlanId === bucketPlanId;
      });
    }
    if (unitPriceHalala !== null && Number(bucket.unitPriceHalala || 0) === Number(unitPriceHalala || 0)) return true;
    return false;
  }) || null;
}

async function consumePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, session }) {
  if (!session) {
    throw new Error("consumePremiumBalanceAtomically requires a session");
  }

  if (!premiumKey) {
    return { consumed: false, reason: "no_premium_key", premiumSource: "pending_payment", premiumExtraFeeHalala: 0 };
  }
  const canonicalUpgrade = await resolveSubscriptionPremiumUpgradePricing(premiumKey, { session });
  const unitExtraFeeHalala = canonicalUpgrade.priceHalala;

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { consumed: false, reason: "no_balance_array", premiumSource: "pending_payment", premiumExtraFeeHalala: unitExtraFeeHalala };
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

async function consumeAddonBalanceAtomically({ subscription, dayId, date, addonId, addonPlanId = null, category = null, session }) {
  if (!session) throw new Error("consumeAddonBalanceAtomically requires a session");
  if (!subscription || !Array.isArray(subscription.addonBalance)) return { consumed: false };

  const bucket = findAddonBalanceBucket(subscription, { addonId, addonPlanId, category });
  const bucketIndex = bucket
    ? subscription.addonBalance.findIndex((b) => b._id && bucket._id && String(b._id) === String(bucket._id))
    : -1;

  if (bucketIndex < 0 || Number(bucket.remainingQty || 0) <= 0) return { consumed: false };

  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      "addonBalance._id": bucket._id,
      "addonBalance.remainingQty": { $gt: 0 },
    },
    {
      $inc: { "addonBalance.$.remainingQty": -1, "addonBalance.$.consumedQty": 1 },
    },
    { session, new: true }
  );

  if (!atomicResult) return { consumed: false };

  return {
    consumed: true,
    addonPlanId: bucket.addonPlanId || bucket.addonId,
    unitPriceHalala: bucket.unitPriceHalala,
    currency: bucket.currency,
  };
}

async function releaseAddonBalanceAtomically({ subscription, addonId, addonPlanId = null, category = null, unitPriceHalala, session }) {
  if (!session) throw new Error("releaseAddonBalanceAtomically requires a session");
  if (!subscription || !Array.isArray(subscription.addonBalance)) return { released: false };

  const bucket = findAddonBalanceBucket(subscription, { addonId, addonPlanId, category, unitPriceHalala });
  const bucketIndex = bucket
    ? subscription.addonBalance.findIndex((b) => b._id && bucket._id && String(b._id) === String(bucket._id))
    : -1;

  if (bucketIndex < 0) return { released: false };

  let atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      "addonBalance._id": bucket._id,
      "addonBalance.consumedQty": { $gt: 0 },
    },
    {
      $inc: { "addonBalance.$.remainingQty": 1, "addonBalance.$.consumedQty": -1 },
    },
    { session, new: true }
  );

  if (!atomicResult) {
    atomicResult = await Subscription.findOneAndUpdate(
      {
        _id: subscription._id,
        "addonBalance._id": bucket._id,
      },
      {
        $inc: { "addonBalance.$.remainingQty": 1 },
      },
      { session, new: true }
    );
  }

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

async function resolveMealSlotPlanningLimits(subscription) {
  const requiredSlotCount = resolveMealsPerDay(subscription);
  let mealBalance = subscription && subscription.mealBalance && typeof subscription.mealBalance === "object"
    ? subscription.mealBalance
    : null;

  if (!mealBalance && subscription && subscription.contractMode === "canonical") {
    const businessDate = await getRestaurantBusinessDate();
    mealBalance = buildMealBalance(subscription, businessDate);
  }

  const maxConsumableMealsNow = Number(mealBalance && mealBalance.maxConsumableMealsNow);
  const maxSlotCount = mealBalance
    && mealBalance.dailyMealLimitEnforced === false
    && Number.isFinite(maxConsumableMealsNow)
      ? Math.max(0, maxConsumableMealsNow)
      : requiredSlotCount;

  return {
    requiredSlotCount,
    maxSlotCount,
    mealBalance,
  };
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

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function isPickupAppendAllowedForExistingDay(subscription, day) {
  if (!subscription || subscription.deliveryMode !== "pickup" || !day) return false;
  if (["skipped", "frozen"].includes(String(day.status || "open"))) return false;
  return true;
}

function buildAppendMealSlots(existingDay, appendMealSlots = []) {
  const existingSlots = Array.isArray(existingDay && existingDay.mealSlots)
    ? clonePlain(existingDay.mealSlots)
    : [];
  const maxSlotIndex = existingSlots.reduce((max, slot) => Math.max(max, Number(slot && slot.slotIndex || 0)), 0);
  const appendedSlots = appendMealSlots.map((slot, index) => {
    const slotIndex = maxSlotIndex + index + 1;
    return {
      ...clonePlain(slot),
      slotIndex,
      slotKey: `slot_${slotIndex}`,
    };
  });
  return existingSlots.concat(appendedSlots);
}

async function evaluateDaySelectionPricingState({
  subscription,
  subscriptionId,
  date,
  existingDay,
  draft,
  requestedOneTimeAddonIds,
}) {
  const totalSubscriptionMeals = resolveTotalSubscriptionMealsFromSubscription(subscription);
  const existingPremiumUpgradeCount = await countPersistedPremiumUpgradesForSubscription({
    subscriptionId,
    excludeDate: date,
  });
  const incomingPremiumUpgradeCount = countPremiumUpgradeSelections(draft.premiumUpgradeSelections);
  assertPremiumUpgradeLimit({
    premiumUpgradeCount: existingPremiumUpgradeCount + incomingPremiumUpgradeCount,
    totalSubscriptionMeals,
  });

  await assertPlanningBalanceAfterSave({
    subscription,
    affectedDates: [date],
    incomingDaySelections: [{ date, mealSlots: draft.processedSlots }],
  });

  const addonContainer = {
    addonSelections: existingDay ? JSON.parse(JSON.stringify(existingDay.addonSelections || [])) : [],
  };
  if (requestedOneTimeAddonIds !== undefined) {
    await reconcileAddonInclusions(subscription, addonContainer, requestedOneTimeAddonIds);
  }

  const commercialState = buildDayCommercialState({
    status: existingDay && existingDay.status ? existingDay.status : "open",
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections: addonContainer.addonSelections,
    premiumExtraPayment: existingDay && existingDay.premiumExtraPayment ? existingDay.premiumExtraPayment : null,
  }, { subscription });

  return {
    addonSelections: addonContainer.addonSelections,
    commercialState,
  };
}

async function performDaySelectionUpdate({ userId, subscriptionId, date, selections = [], premiumSelections = [], mealSlots, contractVersion, requestedOneTimeAddonIds, runtime, appendOnly = false }) {
  const totalSelected = (selections || []).length + (premiumSelections || []).length;

  // 1. Fetch context (Lean)
  const requestedSub = await Subscription.findById(subscriptionId).lean();
  if (!requestedSub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };

  // Centralized ownership and status check (preserves existing behavior)
  assertSubscriptionActiveAndOwned({ subscription: requestedSub, userId, date });

  const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(requestedSub);
  const subForDraft = resolvedPlanningSubscription.subscription;
  const canonicalSubscriptionId = resolvedPlanningSubscription.subscriptionId;

  await resolveSubscriptionAddonBalanceWithAudit(subForDraft);

  const planningLimits = await resolveMealSlotPlanningLimits(subForDraft);
  const mealsPerDayLimit = planningLimits.requiredSlotCount;
  if (totalSelected > mealsPerDayLimit) throw { status: 400, code: "DAILY_CAP", message: "Selections exceed meals per day" };

  const existingDay = await SubscriptionDay.findOne({ subscriptionId: canonicalSubscriptionId, date }).lean();
  const allowAppendToConfirmedPickup = appendOnly && isPickupAppendAllowedForExistingDay(subForDraft, existingDay);
  if (!allowAppendToConfirmedPickup) {
    await assertSubscriptionDayModifiable({
      subscription: subForDraft,
      day: existingDay,
      date,
      getBusinessDateFn: getRestaurantBusinessDate,
    });
  }
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
  // Phase 5: Explicit check for day status - pending/unpaid or superseded payments do NOT lock planner edits
  if (existingDay) {
    const hasPendingPayment = hasPendingOrUnpaidPayment(existingDay);
    const hasSuperseded = hasSupersededPayment(existingDay);
    
    // Only lock if not pending/unpaid and not superseded
    if (!hasPendingPayment && !hasSuperseded && !allowAppendToConfirmedPickup) {
      if (existingDay.status !== "open") throw { status: 409, code: "LOCKED", message: "Day is locked" };
      if (existingDay.plannerState === "confirmed") throw { status: 409, code: "LOCKED", message: "Planner is already confirmed for this day" };
    }
  }
  if (appendOnly) {
    if (!existingDay) throw { status: 404, code: "DAY_NOT_FOUND", message: "Day not found" };
    if (!allowAppendToConfirmedPickup && existingDay.plannerState === "confirmed") {
      throw { status: 409, code: "LOCKED", message: "Planner is already confirmed for this day" };
    }
    mealSlots = buildAppendMealSlots(existingDay, mealSlots);
  }

  // 2. Build Draft & Reconcile Addons (In-Memory)
  const planningDraftSubscription = buildPlanningDraftSubscriptionView(subForDraft, existingDay);
  const useCanonicalPlanner = isCanonicalPlannerRequest({ contractVersion, mealSlots });
  const draft = useCanonicalPlanner
    ? await validateCanonicalMealSlots({
      mealSlots,
      mealsPerDayLimit,
      maxSlotCount: planningLimits.maxSlotCount,
      subscription: planningDraftSubscription,
    })
    : await buildMealSlotDraft({
      mealSlots,
      mealsPerDayLimit,
      maxSlotCount: planningLimits.maxSlotCount,
      subscription: planningDraftSubscription,
    });
  
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

  if (appendOnly) {
    const preservedExistingSlots = Array.isArray(existingDay && existingDay.mealSlots)
      ? clonePlain(existingDay.mealSlots)
      : [];
    const appendedProcessedSlots = draft.processedSlots.slice(preservedExistingSlots.length);
    draft.processedSlots = preservedExistingSlots.concat(appendedProcessedSlots);
    const recomputed = recomputePlannerMetaFromSlots({
      mealSlots: draft.processedSlots,
      requiredSlotCount: mealsPerDayLimit,
      maxSlotCount: planningLimits.maxSlotCount,
    });
    if (Array.isArray(recomputed.slotErrors) && recomputed.slotErrors.length > 0) {
      throw {
        status: 422,
        code: "INVALID_MEAL_PLAN",
        message: "Meal planner validation failed",
        valid: false,
        slotErrors: recomputed.slotErrors,
        rules: getMealPlannerRules(),
      };
    }
    draft.plannerMeta = recomputed.plannerMeta;
    const projection = projectMaterializedAndLegacyFromSlots({
      processedSlots: draft.processedSlots,
      now: new Date(),
    });
    draft.materializedMeals = projection.materializedMeals;
    draft.selections = projection.selections;
    draft.premiumUpgradeSelections = projection.premiumSelections;
    draft.baseMealSlots = projection.baseMealSlots;
  }

  const pricingState = await evaluateDaySelectionPricingState({
    subscription: subForDraft,
    subscriptionId: canonicalSubscriptionId,
    date,
    existingDay,
    draft,
    requestedOneTimeAddonIds,
  });
  const addonContainer = { addonSelections: pricingState.addonSelections };
  const derivedDraftState = pricingState.commercialState;

  // Security/Quota Check: Strict rejection for PUT /selection if payment is required
  // Now handled by returning 402 gracefully after saving the draft in subscriptionPlanningClientService.js

  // 4. Idempotency Short-circuit
  if (existingDay && existingDay.plannerRevisionHash === derivedDraftState.plannerRevisionHash) {
    await finalizeDayCommercialStateForPersistence(existingDay);
    return { subscription: subForDraft, day: existingDay, idempotent: true };
  }

  // 5. Atomic Update Execution
  const session = await startSafeSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(canonicalSubscriptionId).session(session);
    if (!subInSession) throw { status: 404, code: "NOT_FOUND", message: "Subscription for session lost" };

    await assertPlanningBalanceAfterSave({
      subscription: subInSession,
      affectedDates: [date],
      incomingDaySelections: [{ date, mealSlots: draft.processedSlots }],
      session,
    });

    const update = {
      mealSlots: draft.processedSlots,
      plannerMeta: draft.plannerMeta,
      plannerVersion: "v1",
      plannerState: appendOnly && existingDay && existingDay.plannerState === "confirmed" && !derivedDraftState.paymentRequirement.requiresPayment
        ? "confirmed"
        : "draft",
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

          const upgrade = await resolveSubscriptionPremiumUpgradePricing(sel.premiumKey, { session, fallbackPriceHalala: sel.unitExtraFeeHalala });
          if (existingClaim) {
             processedPremiumSelections.push({ ...sel, premiumSource: "balance", unitExtraFeeHalala: upgrade.priceHalala });
             existingBalanceMap.delete(mapKey);
             continue;
          }

          const balanceResult = await consumePremiumBalanceAtomically({
            subscription: subInSession,
            dayId: day._id,
            date,
            premiumKey: sel.premiumKey || null,
            proteinId: sel.proteinId,
            unitExtraFeeHalala: upgrade.priceHalala,
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
            unitExtraFeeHalala: balanceResult.consumed ? 0 : upgrade.priceHalala
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
    const hasAddonBalance = Array.isArray(subInSession.addonBalance) && subInSession.addonBalance.length > 0;
    if (hasAddonBalance) {
      const existingAddonWalletMap = new Map();
      if (existingDay && Array.isArray(existingDay.addonSelections)) {
         for (const sel of existingDay.addonSelections) {
           if (sel.source === "subscription") {
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
            if (sel.source === "subscription") {
               const key = String(sel.addonId);
               const existingList = existingAddonWalletMap.get(key);
               if (existingList && existingList.length > 0) {
                  existingList.shift();
                  processedAddonSelections.push(sel);
               } else {
                  const walletResult = await consumeAddonBalanceAtomically({
                     subscription: subInSession,
                     addonId: sel.addonId,
                     addonPlanId: sel.addonPlanId || null,
                     category: sel.category || null,
                     session
                  });
                  if (walletResult.consumed) {
                     processedAddonSelections.push({ ...sel, addonPlanId: sel.addonPlanId || walletResult.addonPlanId || null, source: "subscription", priceHalala: 0 });
                  } else {
                     processedAddonSelections.push({
                       ...sel,
                       source: "pending_payment",
                       priceHalala: Number(sel.unitPriceHalala || sel.priceHalala || 0),
                     });
                  }
               }
            } else {
               processedAddonSelections.push(sel);
            }
         }
         day.addonSelections = processedAddonSelections;
      }

      // Release survivors (addons that were using subscription balance but are now removed)
      for (const list of existingAddonWalletMap.values()) {
         for (const sel of list) {
            await releaseAddonBalanceAtomically({
               subscription: subInSession,
               addonId: sel.addonId,
               addonPlanId: sel.addonPlanId || null,
               category: sel.category || null,
               unitPriceHalala: sel.unitPriceHalala || 0,
               session
            });
         }
      }
    }

    await subInSession.save({ session });
    await finalizeDayCommercialStateForPersistence(day, { session });

    await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
      subscriptionId: canonicalSubscriptionId,
      dayId: day._id,
      date,
      nextRevisionHash: day.plannerRevisionHash,
      reason: "planner_selection_changed",
      session,
    });

    // Ensure Global Sync (redundant but for compatibility)
    if (Array.isArray(subInSession.addonSelections)) {
       subInSession.addonSelections = subInSession.addonSelections.filter(s => s.date !== date);
       for (const sel of day.addonSelections) {
         if (sel.source === "subscription" || sel.source === "pending_payment" || sel.source === "paid") {
           subInSession.addonSelections.push({ dayId: day._id, date: day.date, addonId: sel.addonId, addonPlanId: sel.addonPlanId || null, qty: 1, unitPriceHalala: sel.priceHalala, currency: sel.currency });
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

    const finalCommercialState = buildDayCommercialState(day.toObject ? day.toObject() : day, { subscription: subInSession });

    await session.commitTransaction();
    session.endSession();
    return {
      subscription: subInSession,
      day,
      idempotent: false,
      plannerRevisionHash: day.plannerRevisionHash,
      premiumSummary: finalCommercialState.premiumSummary,
      addonSummary: finalCommercialState.addonSummary,
      addonCategoryAllowances: finalCommercialState.addonCategoryAllowances,
      premiumExtraPayment: day.premiumExtraPayment,
      paymentRequirement: finalCommercialState.paymentRequirement,
      commercialState: finalCommercialState.commercialState,
    };
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
  contractVersion,
  requestedOneTimeAddonIds,
}) {
  const requestedSub = await Subscription.findById(subscriptionId);
  if (!requestedSub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  if (String(requestedSub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

  const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(requestedSub);
  const sub = resolvedPlanningSubscription.subscription;
  const resolvedSubscriptionId = resolvedPlanningSubscription.subscriptionId;
  if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };

  await resolveSubscriptionAddonBalanceWithAudit(sub);

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

  const planningLimits = await resolveMealSlotPlanningLimits(sub);
  const mealsPerDayLimit = planningLimits.requiredSlotCount;
  const planningDraftSubscription = buildPlanningDraftSubscriptionView(sub, day);
  const useCanonicalPlanner = isCanonicalPlannerRequest({ contractVersion, mealSlots });
  const draft = useCanonicalPlanner
    ? await validateCanonicalMealSlots({
      mealSlots,
      mealsPerDayLimit,
      maxSlotCount: planningLimits.maxSlotCount,
      subscription: planningDraftSubscription,
    })
    : await buildMealSlotDraft({
      mealSlots,
      mealsPerDayLimit,
      maxSlotCount: planningLimits.maxSlotCount,
      subscription: planningDraftSubscription,
    });
  if (!draft.valid) {
    throw { status: 422, code: draft.errorCode || "INVALID_MEAL_PLAN", message: draft.errorMessage || "Meal planner validation failed", slotErrors: draft.slotErrors, rules: getMealPlannerRules(), valid: false };
  }

  const pricingState = await evaluateDaySelectionPricingState({
    subscription: sub,
    subscriptionId: resolvedSubscriptionId,
    date,
    existingDay: day,
    draft,
    requestedOneTimeAddonIds,
  });
  const addonSelections = pricingState.addonSelections;
  const derivedDraftState = pricingState.commercialState;

  return {
    valid: true,
    plannerState: "draft",
    mealSlots: draft.processedSlots,
    plannerMeta: draft.plannerMeta,
    addonSelections,
    plannerRevisionHash: derivedDraftState.plannerRevisionHash,
    premiumSummary: derivedDraftState.premiumSummary,
    addonSummary: derivedDraftState.addonSummary,
    addonCategoryAllowances: derivedDraftState.addonCategoryAllowances,
    premiumExtraPayment: derivedDraftState.premiumExtraPayment,
    paymentRequirement: derivedDraftState.paymentRequirement,
    commercialState: derivedDraftState.commercialState,
    isFulfillable: derivedDraftState.isFulfillable,
    canBePrepared: derivedDraftState.canBePrepared,
    rules: getMealPlannerRules(),
  };
}

async function performBulkDaySelectionPlanningBalanceValidation({
  userId,
  subscriptionId,
  requests = [],
}) {
  const requestedSub = await Subscription.findById(subscriptionId).lean();
  if (!requestedSub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };
  if (String(requestedSub.userId) !== String(userId)) throw { status: 403, code: "FORBIDDEN", message: "Forbidden" };

  const resolvedPlanningSubscription = await resolvePlanningSubscriptionForOperation(requestedSub);
  const sub = resolvedPlanningSubscription.subscription;
  const resolvedSubscriptionId = resolvedPlanningSubscription.subscriptionId;
  if (!sub) throw { status: 404, code: "NOT_FOUND", message: "Subscription not found" };

  const normalizedRequests = (Array.isArray(requests) ? requests : []).map((entry) => ({
    date: entry && typeof entry.date === "string" ? entry.date.trim() : "",
    mealSlots: Array.isArray(entry && entry.mealSlots) ? entry.mealSlots : undefined,
    contractVersion: entry && (entry.contractVersion || entry.plannerContractVersion || entry.version),
  }));
  const dates = normalizedRequests.map((entry) => entry.date).filter(Boolean);
  const existingDays = await SubscriptionDay.find({
    subscriptionId: resolvedSubscriptionId,
    date: { $in: dates },
  }).lean();
  const existingDayByDate = new Map(existingDays.map((day) => [String(day.date), day]));
  const planningLimits = await resolveMealSlotPlanningLimits(sub);
  const incomingDaySelections = [];

  for (const requestEntry of normalizedRequests) {
    const { date, mealSlots, contractVersion } = requestEntry;
    if (!date) {
      throw { status: 400, code: "INVALID", message: "Each day entry must include date" };
    }
    if (!Array.isArray(mealSlots)) {
      continue;
    }

    ensureActive(sub, date);
    await validateSelectionDateRangeOrThrow(date, sub);

    const existingDay = existingDayByDate.get(date) || null;
    await assertSubscriptionDayModifiable({
      subscription: sub,
      day: existingDay,
      date,
      getBusinessDateFn: getRestaurantBusinessDate,
    });
    if (existingDay && existingDay.status !== "open") {
      throw { status: 409, code: "LOCKED", message: "Day is locked", details: { date } };
    }
    if (existingDay && existingDay.plannerState === "confirmed") {
      throw { status: 409, code: "LOCKED", message: "Planner is already confirmed for this day", details: { date } };
    }

    const planningDraftSubscription = buildPlanningDraftSubscriptionView(sub, existingDay);
    const useCanonicalPlanner = isCanonicalPlannerRequest({ contractVersion, mealSlots });
    const draft = useCanonicalPlanner
      ? await validateCanonicalMealSlots({
        mealSlots,
        mealsPerDayLimit: planningLimits.requiredSlotCount,
        maxSlotCount: planningLimits.maxSlotCount,
        subscription: planningDraftSubscription,
      })
      : await buildMealSlotDraft({
        mealSlots,
        mealsPerDayLimit: planningLimits.requiredSlotCount,
        maxSlotCount: planningLimits.maxSlotCount,
        subscription: planningDraftSubscription,
      });

    if (!draft.valid) {
      throw {
        status: 422,
        code: draft.errorCode || "INVALID_MEAL_PLAN",
        message: draft.errorMessage || "Meal planner validation failed",
        valid: false,
        slotErrors: draft.slotErrors,
        rules: getMealPlannerRules(),
        details: { date },
      };
    }

    incomingDaySelections.push({ date, mealSlots: draft.processedSlots });
  }

  return assertPlanningBalanceAfterSave({
    subscription: sub,
    affectedDates: dates,
    incomingDaySelections,
  });
}

async function performDayPlanningConfirmation({ userId, subscriptionId, date, runtime }) {
  const session = await startSafeSession();
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
      await session.abortTransaction();
      session.endSession();
      return { subscription: subInSession, day, idempotent: true };
    }

    const planningLimits = await resolveMealSlotPlanningLimits(subInSession);
    const requiredSlotCount = planningLimits.requiredSlotCount;
    const planningDraftSubscription = buildPlanningDraftSubscriptionView(subInSession, day);
    const useCanonicalPlanner = isCanonicalPlannerRequest({
      contractVersion: day.mealSlots && day.mealSlots.some((slot) => slot && slot.contractVersion) ? "v3" : null,
      mealSlots: day.mealSlots,
    });
    const validatedDraft = useCanonicalPlanner
      ? await validateCanonicalMealSlots({
        mealSlots: day.mealSlots,
        mealsPerDayLimit: requiredSlotCount,
        maxSlotCount: planningLimits.maxSlotCount,
        subscription: planningDraftSubscription,
        session,
        forConfirmation: true,
      })
      : await buildMealSlotDraft({
        mealSlots: day.mealSlots,
        mealsPerDayLimit: requiredSlotCount,
        maxSlotCount: planningLimits.maxSlotCount,
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

    {
      const totalSubscriptionMeals = resolveTotalSubscriptionMealsFromSubscription(subInSession);
      const existingPremiumUpgradeCount = await countPersistedPremiumUpgradesForSubscription({
        subscriptionId,
        excludeDate: date,
        session,
      });
      const incomingPremiumUpgradeCount = countPremiumUpgradeSelections(validatedDraft.premiumUpgradeSelections);
      assertPremiumUpgradeLimit({
        premiumUpgradeCount: existingPremiumUpgradeCount + incomingPremiumUpgradeCount,
        totalSubscriptionMeals,
      });
    }

    const plannerMeta = validatedDraft.plannerMeta;
    if (plannerMeta.partialSlotCount > 0) throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Planner has partial slots" };
    if (plannerMeta.completeSlotCount < plannerMeta.requiredSlotCount) throw { status: 422, code: "PLANNING_INCOMPLETE", message: "Planner must have all required slots complete" };

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
          mealSlots: day.mealSlots,
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
      const alreadyConfirmedDay = await SubscriptionDay.findById(day._id).session(session);
      await session.abortTransaction();
      session.endSession();
      return { subscription: subInSession, day: alreadyConfirmedDay || day, idempotent: true };
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
  reconcileAddonInclusions,
  performDaySelectionUpdate,
  performDaySelectionValidation,
  performBulkDaySelectionPlanningBalanceValidation,
  performDayPlanningConfirmation,
  consumeAddonBalanceAtomically,
  releaseAddonBalanceAtomically,
};
