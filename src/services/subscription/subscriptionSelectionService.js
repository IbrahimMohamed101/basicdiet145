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
const { reconcileAddonInclusions } = require("./subscriptionAddonAllocationService");
const {
  findAddonBalanceBucket,
  isRecoverableUninitializedAddonBalanceBucket,
  resolveAddonBalanceCapacity,
  resolveAddonBalanceRemainingQty,
} = require("./subscriptionAddonPolicyService");
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

function normalizePremiumKey(value) {
  return String(value || "").trim().toLowerCase();
}

function objectIdString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function findExactPremiumBalanceBucket(subscription, { balanceBucketId = null, configId = null, revision = null, premiumKey = null } = {}) {
  const rows = Array.isArray(subscription && subscription.premiumBalance) ? subscription.premiumBalance : [];
  if (!rows.length) return { bucket: null, bucketIndex: -1, reason: "no_balance_array" };
  if (balanceBucketId) {
    const bucketIndex = rows.findIndex((row) => objectIdString(row._id) === objectIdString(balanceBucketId));
    return bucketIndex >= 0 ? { bucket: rows[bucketIndex], bucketIndex } : { bucket: null, bucketIndex: -1, reason: "bucket_not_found" };
  }
  if (configId && revision !== undefined && revision !== null && revision !== "") {
    const normalizedRevision = Number(revision);
    const matches = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => objectIdString(row.configId) === objectIdString(configId) && Number(row.revision || 0) === normalizedRevision);
    if (matches.length === 1) return { bucket: matches[0].row, bucketIndex: matches[0].index };
    if (matches.length > 1) return { bucket: null, bucketIndex: -1, reason: "ambiguous_balance_bucket" };
  }
  const key = normalizePremiumKey(premiumKey);
  if (key) {
    const matches = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => normalizePremiumKey(row.premiumKey) === key);
    if (matches.length === 1) return { bucket: matches[0].row, bucketIndex: matches[0].index };
    return { bucket: null, bucketIndex: -1, reason: matches.length ? "ambiguous_balance_bucket" : "bucket_not_found" };
  }
  return { bucket: null, bucketIndex: -1, reason: "no_premium_key" };
}

function premiumSelectionSourceFromPremiumSource(premiumSource) {
  if (premiumSource === "balance") return "subscription";
  if (premiumSource === "paid" || premiumSource === "paid_extra") return "paid";
  if (premiumSource === "pending_payment") return "pending_payment";
  return "";
}

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

async function consumePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, session, unitExtraFeeHalala, balanceBucketId = null, configId = null, revision = null }) {
  if (!session) {
    throw new Error("consumePremiumBalanceAtomically requires a session");
  }

  if (!premiumKey) {
    return { consumed: false, reason: "no_premium_key", premiumSource: "pending_payment", premiumExtraFeeHalala: 0 };
  }
  const canonicalUpgrade = await resolveSubscriptionPremiumUpgradePricing(premiumKey, { session, fallbackPriceHalala: unitExtraFeeHalala });
  const resolvedUnitExtraFeeHalala = canonicalUpgrade.priceHalala;

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { consumed: false, reason: "no_balance_array", premiumSource: "pending_payment", premiumExtraFeeHalala: resolvedUnitExtraFeeHalala };
  }

  const { bucket, bucketIndex, reason } = findExactPremiumBalanceBucket(subscription, {
    balanceBucketId,
    configId,
    revision,
    premiumKey,
  });

  if (bucketIndex < 0 || !bucket) {
    return { consumed: false, reason: reason || "bucket_not_found", premiumSource: "pending_payment", premiumExtraFeeHalala: resolvedUnitExtraFeeHalala };
  }

  if (Number(bucket.remainingQty || 0) <= 0) {
    return { consumed: false, reason: "no_remaining_balance", premiumSource: "pending_payment", premiumExtraFeeHalala: resolvedUnitExtraFeeHalala };
  }
  const bucketId = subscription._id;

  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: bucketId,
      premiumBalance: {
        $elemMatch: {
          _id: bucket._id,
          remainingQty: { $gt: 0 },
        },
      },
    },
    {
      $inc: { "premiumBalance.$.remainingQty": -1, "premiumBalance.$.consumedQty": 1 },
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
    balanceBucketId: bucket._id,
    configId: bucket.configId || null,
    revision: bucket.revision || 0,
    bucket,
  };
}

async function releasePremiumBalanceAtomically({ subscription, dayId, date, premiumKey, session, balanceBucketId = null, configId = null, revision = null }) {
  if (!session) {
    throw new Error("releasePremiumBalanceAtomically requires a session");
  }

  if (!subscription || !Array.isArray(subscription.premiumBalance)) {
    return { released: false, reason: "no_balance_array" };
  }

  if (!premiumKey && !balanceBucketId && !configId) {
    return { released: false, reason: "no_premium_key" };
  }

  const { bucket, bucketIndex, reason } = findExactPremiumBalanceBucket(subscription, {
    balanceBucketId,
    configId,
    revision,
    premiumKey,
  });
  if (bucketIndex < 0 || !bucket) {
    return { released: false, reason: reason || "bucket_not_found" };
  }

  const bucketId = subscription._id;
  const hasTrackedConsumedQty = Number(bucket.consumedQty || 0) > 0;
  const releaseInc = hasTrackedConsumedQty
    ? { "premiumBalance.$.remainingQty": 1, "premiumBalance.$.consumedQty": -1 }
    : { "premiumBalance.$.remainingQty": 1 };

  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: bucketId,
      premiumBalance: {
        $elemMatch: {
          _id: bucket._id,
          $or: [
            { consumedQty: { $gt: 0 } },
            { remainingQty: { $lt: Number(bucket.purchasedQty || 0) } },
          ],
        },
      },
    },
    {
      $inc: releaseInc,
    },
    { session, new: true }
  );

  if (!atomicResult) {
    return { released: false, reason: "atomic_failed" };
  }

  return { released: true, remainingQty: atomicResult.premiumBalance[bucketIndex]?.remainingQty || 0, balanceBucketId: bucket._id };
}

async function consumeAddonBalanceAtomically({ subscription, dayId, date, addonId, addonPlanId = null, category = null, balanceBucketId = null, entitlement = null, session }) {
  if (!session) throw new Error("consumeAddonBalanceAtomically requires a session");
  if (!subscription || !Array.isArray(subscription.addonBalance)) return { consumed: false, reason: "bucket_not_found" };

  let bucket = null;
  if (balanceBucketId) {
    bucket = subscription.addonBalance.find((b) => String(b._id) === String(balanceBucketId));
    if (!bucket) return { consumed: false, reason: "bucket_not_found" };
  }
  if (!bucket) {
    bucket = findAddonBalanceBucket(subscription, { addonId, addonPlanId, category, requirePositiveRemaining: true });
  }

  const bucketIndex = bucket
    ? subscription.addonBalance.findIndex((b) => b._id && bucket._id && String(b._id) === String(bucket._id))
    : -1;

  if (bucketIndex < 0) return { consumed: false, reason: "bucket_not_found" };
  if (!suppliedAddonReleaseIdentityMatchesBucket(bucket, { addonId, addonPlanId, category })) {
    return { consumed: false, reason: "bucket_identity_mismatch" };
  }
  if (resolveAddonBalanceRemainingQty(bucket, { entitlement }) <= 0) {
    return { consumed: false, reason: "no_remaining_balance" };
  }

  let atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      addonBalance: {
        $elemMatch: {
          ...buildAddonBalanceAtomicIdentity(bucket),
          remainingQty: { $gt: 0 },
        },
      },
    },
    {
      $inc: { "addonBalance.$.remainingQty": -1, "addonBalance.$.consumedQty": 1 },
    },
    { session, new: true }
  );

  // Production subscriptions exist where the entitlement total and exact
  // product snapshot are valid but the corresponding balance bucket was saved
  // with zero/missing counters. Recover that bucket only under a guarded
  // zero-consumption predicate, then consume the first unit in the same atomic
  // write. A genuinely exhausted bucket (consumedQty > 0) cannot match.
  if (!atomicResult && isRecoverableUninitializedAddonBalanceBucket(bucket, { entitlement })) {
    const capacity = resolveAddonBalanceCapacity(bucket, entitlement);
    const includedTotalQty = Math.max(
      Number(bucket.includedTotalQty || 0),
      Number(entitlement && entitlement.includedTotalQty || 0)
    );
    atomicResult = await Subscription.findOneAndUpdate(
      {
        _id: subscription._id,
        addonBalance: {
          $elemMatch: {
            ...buildAddonBalanceAtomicIdentity(bucket),
            $and: [
              { $or: [{ remainingQty: { $lte: 0 } }, { remainingQty: { $exists: false } }] },
              { $or: [{ consumedQty: { $lte: 0 } }, { consumedQty: { $exists: false } }] },
              { $or: [{ reservedQty: { $lte: 0 } }, { reservedQty: { $exists: false } }] },
              { $or: [{ overageConsumedQty: { $lte: 0 } }, { overageConsumedQty: { $exists: false } }] },
            ],
          },
        },
      },
      {
        $set: {
          "addonBalance.$.includedTotalQty": includedTotalQty,
          "addonBalance.$.purchasedQty": capacity,
          "addonBalance.$.remainingQty": Math.max(0, capacity - 1),
          "addonBalance.$.consumedQty": 1,
        },
      },
      { session, new: true }
    );
  }

  if (!atomicResult) return { consumed: false, reason: "atomic_consume_failed" };

  // Keep the in-memory Mongoose document synchronized with the atomic
  // addon balance updates performed via findOneAndUpdate(). Without this,
  // the subsequent subscription.save({ session }) could overwrite the
  // atomically updated addonBalance with stale in-memory values.
  const inMemoryBucket = subscription.addonBalance[bucketIndex];
  const updatedBucketIndex = findAddonBalanceBucketIndex(atomicResult.addonBalance, bucket._id);
  const updatedBucket = updatedBucketIndex >= 0 ? atomicResult.addonBalance[updatedBucketIndex] : null;
  if (inMemoryBucket) {
    inMemoryBucket.includedTotalQty = Number(updatedBucket && updatedBucket.includedTotalQty || inMemoryBucket.includedTotalQty || 0);
    inMemoryBucket.purchasedQty = Number(updatedBucket && updatedBucket.purchasedQty || inMemoryBucket.purchasedQty || 0);
    inMemoryBucket.remainingQty = Number(updatedBucket && updatedBucket.remainingQty || 0);
    inMemoryBucket.consumedQty = Number(updatedBucket && updatedBucket.consumedQty || 0);
    if (typeof subscription.markModified === "function") {
      subscription.markModified("addonBalance");
    }
  }

  return {
    consumed: true,
    addonPlanId: bucket.addonPlanId || bucket.addonId,
    balanceBucketId: bucket._id,
    unitPriceHalala: Number(bucket.unitPriceHalala || 0),
    currency: bucket.currency || "SAR",
    category: bucket.category || category,
    remainingQty: Number(updatedBucket && updatedBucket.remainingQty || 0),
  };
}

function findAddonBalanceBucketIndex(addonBalance, bucketId) {
  return Array.isArray(addonBalance)
    ? addonBalance.findIndex((b) => b && b._id && bucketId && String(b._id) === String(bucketId))
    : -1;
}

function normalizeAddonReleaseCurrency(currency) {
  return String(currency || "").trim().toUpperCase();
}

function hasOwnValue(source, key) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function addonSelectionIdentityKey(selection = {}) {
  return [
    selection.addonId || selection.productId || selection.menuProductId || "",
    selection.addonPlanId || "",
    selection.balanceBucketId || "",
    selection.category || "",
  ].map((part) => String(part || "")).join(":");
}

function normalizeOptionalAddonUnitPrice(value) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : NaN;
}

function buildAddonBalanceAtomicIdentity(bucket) {
  const identity = {
    _id: bucket._id,
    addonId: bucket.addonId,
    addonPlanId: bucket.addonPlanId || null,
    category: bucket.category || "",
    currency: bucket.currency || "SAR",
  };

  if (hasOwnValue(bucket, "unitPriceHalala")) {
    identity.unitPriceHalala = Number(bucket.unitPriceHalala || 0);
  }

  return identity;
}

function buildAddonBalanceReleaseIdentity(bucket, quantity = 1) {
  const identity = {
    ...buildAddonBalanceAtomicIdentity(bucket),
    consumedQty: { $gte: quantity },
  };

  return identity;
}

function bucketIdentityMatches(expectedBucket, actualBucket) {
  if (!expectedBucket || !actualBucket) return false;
  const expectedPlanId = String(expectedBucket.addonPlanId || expectedBucket.addonId || "");
  const actualPlanId = String(actualBucket.addonPlanId || actualBucket.addonId || "");
  return String(actualBucket._id || "") === String(expectedBucket._id || "")
    && String(actualBucket.addonId || "") === String(expectedBucket.addonId || "")
    && actualPlanId === expectedPlanId
    && String(actualBucket.category || "") === String(expectedBucket.category || "")
    && Number(actualBucket.unitPriceHalala || 0) === Number(expectedBucket.unitPriceHalala || 0)
    && normalizeAddonReleaseCurrency(actualBucket.currency || "SAR") === normalizeAddonReleaseCurrency(expectedBucket.currency || "SAR");
}

function suppliedAddonReleaseIdentityMatchesBucket(bucket, {
  addonId = null,
  addonPlanId = null,
  category = null,
  unitPriceHalala = null,
  currency = null,
} = {}) {
  if (!bucket) return false;
  const normalizedPlanId = String(addonPlanId || "");
  const normalizedAddonId = String(addonId || "");
  const bucketPlanId = String(bucket.addonPlanId || bucket.addonId || "");
  const bucketAddonId = String(bucket.addonId || "");

  if (normalizedPlanId && bucketPlanId !== normalizedPlanId) return false;
  if (!normalizedPlanId && normalizedAddonId && bucketAddonId !== normalizedAddonId && bucketPlanId !== normalizedAddonId) return false;
  if (category !== null && category !== undefined && String(bucket.category || "") !== String(category || "")) return false;

  const normalizedUnitPriceHalala = normalizeOptionalAddonUnitPrice(unitPriceHalala);
  if (Number.isNaN(normalizedUnitPriceHalala)) return false;
  if (normalizedUnitPriceHalala !== null && Number(bucket.unitPriceHalala || 0) !== normalizedUnitPriceHalala) return false;

  const suppliedCurrency = normalizeAddonReleaseCurrency(currency);
  if (suppliedCurrency && normalizeAddonReleaseCurrency(bucket.currency || "SAR") !== suppliedCurrency) return false;

  return true;
}

async function diagnoseAddonReleaseFailure({ subscriptionId, bucket, quantity, session }) {
  const latest = await Subscription.findOne(
    {
      _id: subscriptionId,
      "addonBalance._id": bucket && bucket._id,
    },
    { "addonBalance.$": 1 }
  ).session(session);
  const latestBucket = latest && Array.isArray(latest.addonBalance) ? latest.addonBalance[0] : null;

  if (!latestBucket) return "bucket_not_found";
  if (!bucketIdentityMatches(bucket, latestBucket)) return "bucket_identity_mismatch";
  if (Number(latestBucket.consumedQty || 0) < quantity) return "no_consumed_balance";
  return "atomic_release_failed";
}

function isAddonReleaseIdempotentResult(result) {
  return Boolean(result && (result.released === true || result.reason === "no_consumed_balance"));
}

function assertAddonBalanceReleaseSucceeded(result, context = {}) {
  if (isAddonReleaseIdempotentResult(result)) return;
  const reason = String(result && result.reason || "atomic_release_failed");
  const err = new Error(`Add-on balance release failed: ${reason}`);
  err.code = "ADDON_BALANCE_RELEASE_FAILED";
  err.status = 409;
  err.reason = reason;
  err.details = {
    addonId: context.addonId ? String(context.addonId) : null,
    addonPlanId: context.addonPlanId ? String(context.addonPlanId) : null,
    category: context.category || null,
  };
  throw err;
}

async function releaseAddonBalanceAtomically({ subscription, addonId, addonPlanId = null, category = null, unitPriceHalala, currency = null, balanceBucketId = null, session }) {
  if (!session) throw new Error("releaseAddonBalanceAtomically requires a session");
  if (!subscription || !Array.isArray(subscription.addonBalance)) return { released: false };

  const hasStrongIdentifier = Boolean(addonPlanId || addonId || balanceBucketId);
  if (!hasStrongIdentifier) return { released: false, reason: "bucket_not_found" };

  // The current persisted selection model records one row per covered add-on
  // credit. Keep release as a single-credit operation unless consume is changed
  // to reserve multiple credits per selection.
  const releaseQuantity = 1;
  let bucket = null;
  if (balanceBucketId) {
    bucket = subscription.addonBalance.find((b) => String(b._id) === String(balanceBucketId));
    if (!bucket) return { released: false, reason: "bucket_not_found" };
  }
  if (!bucket) {
    bucket = findAddonBalanceBucket(subscription, { addonId, addonPlanId, category });
  }
  const bucketIndex = bucket ? findAddonBalanceBucketIndex(subscription.addonBalance, bucket._id) : -1;

  if (bucketIndex < 0) return { released: false, reason: "bucket_not_found" };
  if (!suppliedAddonReleaseIdentityMatchesBucket(bucket, { addonId, addonPlanId, category, unitPriceHalala, currency })) {
    return { released: false, reason: "bucket_identity_mismatch" };
  }

  const atomicResult = await Subscription.findOneAndUpdate(
    {
      _id: subscription._id,
      addonBalance: {
        $elemMatch: buildAddonBalanceReleaseIdentity(bucket, releaseQuantity),
      },
    },
    {
      $inc: {
        "addonBalance.$.remainingQty": releaseQuantity,
        "addonBalance.$.consumedQty": -releaseQuantity,
      },
    },
    { session, new: true }
  );

  if (!atomicResult) {
    const reason = await diagnoseAddonReleaseFailure({
      subscriptionId: subscription._id,
      bucket,
      quantity: releaseQuantity,
      session,
    });
    return { released: false, reason };
  }

  // Keep the in-memory Mongoose document synchronized with the atomic
  // addon balance updates performed via findOneAndUpdate(). Without this,
  // the subsequent subscription.save({ session }) could overwrite the
  // atomically updated addonBalance with stale in-memory values.
  const inMemoryBucket = subscription.addonBalance[bucketIndex];
  const updatedBucketIndex = findAddonBalanceBucketIndex(atomicResult.addonBalance, bucket._id);
  const updatedBucket = updatedBucketIndex >= 0 ? atomicResult.addonBalance[updatedBucketIndex] : null;
  if (inMemoryBucket) {
    inMemoryBucket.remainingQty = Number(updatedBucket && updatedBucket.remainingQty || 0);
    inMemoryBucket.consumedQty = Number(updatedBucket && updatedBucket.consumedQty || 0);
    if (typeof subscription.markModified === "function") {
      subscription.markModified("addonBalance");
    }
  }

  return {
    released: true,
    remainingQty: Number(updatedBucket && updatedBucket.remainingQty || 0),
    consumedQty: Number(updatedBucket && updatedBucket.consumedQty || 0),
  };
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

function preservePersistedValidationTimestamps(draft, existingDay) {
  const existingSlots = Array.isArray(existingDay && existingDay.mealSlots)
    ? existingDay.mealSlots
    : [];
  const existingBySlotKey = new Map();
  const existingBySlotIndex = new Map();

  for (const slot of existingSlots) {
    if (!slot) continue;
    if (slot.slotKey) existingBySlotKey.set(String(slot.slotKey), slot);
    if (slot.slotIndex !== undefined && slot.slotIndex !== null) {
      existingBySlotIndex.set(Number(slot.slotIndex), slot);
    }
  }

  for (const slot of Array.isArray(draft && draft.processedSlots) ? draft.processedSlots : []) {
    const persistedSlot = (slot.slotKey && existingBySlotKey.get(String(slot.slotKey)))
      || existingBySlotIndex.get(Number(slot.slotIndex));
    // Validation is read-only: this field describes the persisted slot's last
    // modification, not the time at which a hypothetical response was built.
    slot.updatedAt = persistedSlot && persistedSlot.updatedAt
      ? persistedSlot.updatedAt
      : null;
  }

  if (draft && draft.plannerMeta) {
    const persistedLastEditedAt = existingDay
      && existingDay.plannerMeta
      && existingDay.plannerMeta.lastEditedAt;
    draft.plannerMeta.lastEditedAt = persistedLastEditedAt || null;
  }

  return draft;
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
      debug: draft.debug,
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
             processedPremiumSelections.push({
               ...sel,
               configId: sel.configId || existingClaim.configId || null,
               revision: Number(sel.revision || existingClaim.revision || 0),
               balanceBucketId: sel.balanceBucketId || existingClaim.balanceBucketId || existingClaim.premiumWalletRowId || null,
               premiumWalletRowId: sel.premiumWalletRowId || existingClaim.premiumWalletRowId || existingClaim.balanceBucketId || null,
               premiumSource: "balance",
               source: "subscription",
               quantity: Number(sel.quantity || 1),
               coveredQty: Number(sel.coveredQty || 1),
               paidQty: 0,
               unitExtraFeeHalala: upgrade.priceHalala,
               payableTotalHalala: 0,
             });
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
            balanceBucketId: sel.balanceBucketId || sel.premiumWalletRowId || null,
            configId: sel.configId || upgrade.configId || null,
            revision: sel.revision != null ? sel.revision : upgrade.revision,
            session,
          });

          const covered = balanceResult.consumed ? 1 : 0;
          const paid = balanceResult.consumed ? 0 : 1;
          processedPremiumSelections.push({
            ...sel,
            configId: sel.configId || balanceResult.configId || upgrade.configId || null,
            revision: Number(sel.revision || balanceResult.revision || upgrade.revision || 0),
            balanceBucketId: balanceResult.balanceBucketId || sel.balanceBucketId || null,
            premiumWalletRowId: balanceResult.balanceBucketId || sel.premiumWalletRowId || null,
            premiumSource: balanceResult.consumed ? "balance" : "pending_payment",
            source: balanceResult.consumed ? "subscription" : "pending_payment",
            quantity: Number(sel.quantity || 1),
            coveredQty: covered,
            paidQty: paid,
            unitExtraFeeHalala: upgrade.priceHalala,
            payableTotalHalala: paid * upgrade.priceHalala,
          });
        } else {
          processedPremiumSelections.push(sel);
        }
      }
      day.premiumUpgradeSelections = processedPremiumSelections;
    }

    for (const sel of existingBalanceMap.values()) {
      await releasePremiumBalanceAtomically({
        subscription: subInSession,
        premiumKey: sel.premiumKey,
        balanceBucketId: sel.balanceBucketId || sel.premiumWalletRowId || null,
        configId: sel.configId || null,
        revision: sel.revision || null,
        session,
      });
    }

    // ATOMIC: Addon balance sync
    const hasAddonBalance = Array.isArray(subInSession.addonBalance) && subInSession.addonBalance.length > 0;
    if (hasAddonBalance) {
      const existingAddonWalletMap = new Map();
      if (existingDay && Array.isArray(existingDay.addonSelections)) {
         for (const sel of existingDay.addonSelections) {
           if (sel.source === "subscription") {
             const key = addonSelectionIdentityKey(sel);
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
               const key = addonSelectionIdentityKey(sel);
               const existingList = existingAddonWalletMap.get(key);
               if (existingList && existingList.length > 0) {
                  existingList.shift();
                  processedAddonSelections.push(sel);
               } else {
                  let ownedResolution = null;
                  try {
                     const { resolveOwnedAddonEntitlementChoice } = require("./subscriptionOwnedAddonSnapshotService");
                     ownedResolution = await resolveOwnedAddonEntitlementChoice({
                       subscription: subInSession,
                       productId: sel.addonId,
                       addonPlanId: sel.addonPlanId || null,
                       category: sel.category || null,
                       balanceBucketId: sel.balanceBucketId || null,
                       entitlementKey: sel.entitlementKey || null,
                       userId: subInSession.userId,
                       session,
                     });
                  } catch (err) {
                     throw err;
                  }

                  const walletResult = await consumeAddonBalanceAtomically({
                     subscription: subInSession,
                     addonId: sel.addonId,
                     addonPlanId: sel.addonPlanId || null,
                     category: sel.category || null,
                     balanceBucketId: ownedResolution && ownedResolution.bucket ? ownedResolution.bucket._id : null,
                     entitlement: ownedResolution && ownedResolution.entitlement,
                     session
                  });
                  if (walletResult.consumed) {
                     processedAddonSelections.push({
                       ...sel,
                       addonPlanId: sel.addonPlanId || walletResult.addonPlanId || null,
                       source: "subscription",
                       priceHalala: 0,
                       requestedQty: 1,
                       coveredQty: 1,
                       paidQty: 0,
                       payableTotalHalala: 0,
                       pricingMode: "allowance_covered",
                       isEligibleForAllowance: true,
                       balanceBucketId: walletResult.balanceBucketId || (ownedResolution && ownedResolution.bucket ? ownedResolution.bucket._id : null),
                       entitlementKey: ownedResolution ? ownedResolution.entitlementKey : undefined,
                       category: walletResult.category || (ownedResolution ? ownedResolution.category : (sel.category || "")),
                       unitPriceHalala: walletResult.unitPriceHalala,
                       currency: walletResult.currency || sel.currency || "SAR",
                     });
                  } else {
                     if (walletResult.reason === "bucket_identity_mismatch" || walletResult.reason === "atomic_consume_failed") {
                       const err = new Error(`Add-on balance consume failed: ${walletResult.reason}`);
                       err.code = "ADDON_BALANCE_CONSUME_FAILED";
                       err.status = 409;
                       err.reason = walletResult.reason;
                       throw err;
                     }
                     processedAddonSelections.push({
                       ...sel,
                       source: "pending_payment",
                       priceHalala: Number(sel.unitPriceHalala || sel.priceHalala || 0),
                       requestedQty: 1,
                       coveredQty: 0,
                       paidQty: 1,
                       payableTotalHalala: Number(sel.unitPriceHalala || sel.priceHalala || 0),
                       remainingBefore: 0,
                       remainingAfter: 0,
                       freeQtyAvailable: 0,
                       pricingMode: sel.isEligibleForAllowance === false ? "paid_no_entitlement" : "paid_overage",
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
            const releaseResult = await releaseAddonBalanceAtomically({
               subscription: subInSession,
               addonId: sel.addonId,
               addonPlanId: sel.addonPlanId || null,
               category: sel.category || null,
               unitPriceHalala: hasOwnValue(sel, "unitPriceHalala") ? sel.unitPriceHalala : null,
               currency: sel.currency || null,
               balanceBucketId: sel.balanceBucketId || null,
               session
            });
            assertAddonBalanceReleaseSucceeded(releaseResult, sel);
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
           subInSession.addonSelections.push({
             dayId: day._id,
             date: day.date,
             addonId: sel.addonId,
             productId: sel.productId || sel.addonId || null,
             menuProductId: sel.menuProductId || sel.productId || sel.addonId || null,
             addonPlanId: sel.addonPlanId || null,
             addonKey: sel.addonKey || sel.productKey || "",
             productKey: sel.productKey || sel.addonKey || "",
             name: sel.name || "",
             nameI18n: sel.nameI18n || undefined,
             imageUrl: sel.imageUrl || "",
             qty: Math.max(1, Math.floor(Number(sel.qty || sel.quantity || 1))),
             quantity: Math.max(1, Math.floor(Number(sel.quantity || sel.qty || 1))),
             coveredQty: Math.max(0, Math.floor(Number(sel.coveredQty || (sel.source === "subscription" ? 1 : 0)))),
             paidQty: Math.max(0, Math.floor(Number(sel.paidQty || (sel.source === "subscription" ? 0 : 1)))),
             priceHalala: Number(sel.priceHalala || 0),
             unitPriceHalala: Object.prototype.hasOwnProperty.call(sel, "unitPriceHalala") ? sel.unitPriceHalala : sel.priceHalala,
             payableTotalHalala: Number(sel.payableTotalHalala || sel.priceHalala || 0),
             currency: sel.currency,
             category: sel.category || "",
             entitlementCategory: sel.entitlementCategory || "",
             entitlementKey: sel.entitlementKey || "",
             balanceBucketId: sel.balanceBucketId || null,
             ownedSnapshot: Boolean(sel.ownedSnapshot),
             isEligibleForAllowance: Boolean(sel.isEligibleForAllowance),
             requestedQty: Math.max(1, Math.floor(Number(sel.requestedQty || sel.quantity || sel.qty || 1))),
             includedTotalQty: Math.max(0, Math.floor(Number(sel.includedTotalQty || 0))),
             remainingQty: Math.max(0, Math.floor(Number(sel.remainingQty || 0))),
             freeQtyAvailable: Math.max(0, Math.floor(Number(sel.freeQtyAvailable || 0))),
             remainingBefore: Math.max(0, Math.floor(Number(sel.remainingBefore || 0))),
             remainingAfter: Math.max(0, Math.floor(Number(sel.remainingAfter || 0))),
             pricingMode: sel.pricingMode || "",
             maxPerDay: Math.max(1, Math.floor(Number(sel.maxPerDay || 1))),
             source: sel.source || "",
           });
         }
       }
       subInSession.markModified("addonSelections");
    }
    if (Array.isArray(subInSession.premiumSelections)) {
       subInSession.premiumSelections = subInSession.premiumSelections.filter(s => s.date !== date);
       for (const sel of day.premiumUpgradeSelections) {
         if (sel.premiumSource === "balance" || sel.premiumSource === "pending_payment" || sel.premiumSource === "paid" || sel.premiumSource === "paid_extra") {
           subInSession.premiumSelections.push({
             dayId: day._id,
             date: day.date,
             baseSlotKey: sel.baseSlotKey,
             premiumKey: sel.premiumKey,
             configId: sel.configId || null,
             revision: Number(sel.revision || 0),
             kind: sel.kind || "",
             entityType: sel.entityType || "",
             selectionType: sel.selectionType || "",
             sourceType: sel.sourceType || "",
             sourceModel: sel.sourceModel || "",
             sourceId: sel.sourceId || "",
             sourceProductId: sel.sourceProductId || "",
             sourceGroupId: sel.sourceGroupId || "",
             sourceGroupKey: sel.sourceGroupKey || "",
             sourceKey: sel.sourceKey || "",
             name: sel.name || "",
             nameI18n: sel.nameI18n || undefined,
             imageUrl: sel.imageUrl || "",
             proteinId: sel.proteinId,
             quantity: Number(sel.quantity || 1),
             coveredQty: Number(sel.coveredQty || (sel.source === "subscription" ? 1 : 0)),
             paidQty: Number(sel.paidQty || (sel.source === "subscription" ? 0 : 1)),
             unitExtraFeeHalala: sel.unitExtraFeeHalala,
             payableTotalHalala: Number(sel.payableTotalHalala || 0),
             currency: sel.currency,
             balanceBucketId: sel.balanceBucketId || null,
             premiumWalletRowId: sel.premiumWalletRowId || sel.balanceBucketId || null,
             source: sel.source || premiumSelectionSourceFromPremiumSource(sel.premiumSource),
             paymentId: sel.paymentId || null,
             consumedAt: sel.consumedAt || new Date(),
             paidAt: sel.paidAt || null,
           });
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
    throw { status: 422, code: draft.errorCode || "INVALID_MEAL_PLAN", message: draft.errorMessage || "Meal planner validation failed", slotErrors: draft.slotErrors, debug: draft.debug, rules: getMealPlannerRules(), valid: false };
  }

  preservePersistedValidationTimestamps(draft, day);

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
        debug: draft.debug,
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
        debug: validatedDraft.debug,
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
  assertAddonBalanceReleaseSucceeded,
  resolveMealSlotPlanningLimits,
  buildPlanningDraftSubscriptionView,
  preservePersistedValidationTimestamps,
};
