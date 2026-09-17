"use strict";

const dateUtils = require("../../utils/date");

function toDate(value, fieldName) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error(`${fieldName} must be a valid date`);
    err.code = "INVALID_STACKING_BATCH_DATE";
    throw err;
  }
  return parsed;
}

function normalizeNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizePositiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.code = "INVALID_STACKING_BATCH_VALUE";
    throw err;
  }
  return parsed;
}

function normalizeBusinessDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return dateUtils.toKSADateString(toDate(value, "businessDate"));
}

function lifecycleStatusForDate({
  effectiveStartDate,
  validityEndDate,
  remainingMeals,
  businessDate,
}) {
  const target = normalizeBusinessDate(businessDate);
  const start = dateUtils.toKSADateString(effectiveStartDate);
  const end = dateUtils.toKSADateString(validityEndDate);

  if (target < start) return "paid_scheduled";
  if (target > end) return "expired";
  if (normalizeNonNegativeInteger(remainingMeals) === 0) return "exhausted";
  return "active";
}

function buildSourceKey({ paymentId, checkoutDraftId, subscriptionId }) {
  if (paymentId) return `payment:${String(paymentId)}`;
  if (checkoutDraftId) return `checkout:${String(checkoutDraftId)}`;
  if (subscriptionId) return `legacy:${String(subscriptionId)}`;

  const err = new Error("paymentId, checkoutDraftId, or subscriptionId is required");
  err.code = "STACKING_SOURCE_ID_REQUIRED";
  throw err;
}

function resolveLegacyBalance(subscription) {
  const totalMeals = normalizeNonNegativeInteger(subscription && subscription.totalMeals);
  const remainingMeals = Math.min(
    totalMeals,
    normalizeNonNegativeInteger(subscription && subscription.remainingMeals)
  );
  const hasLedger = normalizeNonNegativeInteger(subscription && subscription.entitlementVersion) >= 2;
  const reservedMeals = hasLedger
    ? Math.min(
      Math.max(0, totalMeals - remainingMeals),
      normalizeNonNegativeInteger(subscription && subscription.reservedMeals)
    )
    : 0;
  const availableForConsumed = Math.max(0, totalMeals - remainingMeals - reservedMeals);
  const consumedMeals = hasLedger
    ? Math.min(
      availableForConsumed,
      normalizeNonNegativeInteger(subscription && subscription.consumedMeals)
    )
    : availableForConsumed;
  const availableForForfeited = Math.max(
    0,
    totalMeals - remainingMeals - reservedMeals - consumedMeals
  );
  const forfeitedMeals = hasLedger
    ? Math.min(
      availableForForfeited,
      normalizeNonNegativeInteger(subscription && subscription.forfeitedMeals)
    )
    : 0;

  return {
    totalMeals,
    remainingMeals,
    reservedMeals,
    consumedMeals,
    forfeitedMeals,
  };
}

function buildDeliverySnapshotFromSubscription(subscription = {}) {
  return {
    mode: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
    address: subscription.deliveryAddress || null,
    zoneId: subscription.deliveryZoneId || null,
    zoneName: subscription.deliveryZoneName || "",
    pickupLocationId: subscription.pickupLocationId || "",
    slot: subscription.deliverySlot || {
      type: subscription.deliveryMode === "pickup" ? "pickup" : "delivery",
      window: subscription.deliveryWindow || "",
      slotId: "",
      label: "",
    },
  };
}

function buildLegacyEntitlementBatchPayload({
  subscription,
  businessDate,
  now = new Date(),
} = {}) {
  if (!subscription || !subscription._id || !subscription.userId || !subscription.planId) {
    const err = new Error("subscription with _id, userId, and planId is required");
    err.code = "INVALID_LEGACY_STACKING_SOURCE";
    throw err;
  }

  const startDate = toDate(subscription.startDate, "subscription.startDate");
  const endDate = toDate(subscription.endDate, "subscription.endDate");
  const validityEndDate = toDate(
    subscription.validityEndDate || subscription.endDate,
    "subscription.validityEndDate"
  );
  const mealsPerDay = normalizePositiveInteger(
    subscription.selectedMealsPerDay || subscription.mealsPerDay,
    "subscription.selectedMealsPerDay"
  );
  const proteinGrams = normalizePositiveInteger(
    subscription.selectedGrams,
    "subscription.selectedGrams"
  );
  const balance = resolveLegacyBalance(subscription);
  const inferredDaysCount = Math.max(
    1,
    Math.ceil(balance.totalMeals / mealsPerDay)
  );
  const status = lifecycleStatusForDate({
    effectiveStartDate: startDate,
    validityEndDate,
    remainingMeals: balance.remainingMeals,
    businessDate,
  });

  return {
    userId: subscription.userId,
    containerSubscriptionId: subscription._id,
    planId: subscription.planId && subscription.planId._id
      ? subscription.planId._id
      : subscription.planId,
    paymentId: null,
    checkoutDraftId: null,
    sourceKey: buildSourceKey({ subscriptionId: subscription._id }),
    sourceType: "legacy_seed",
    requestedStartDate: startDate,
    effectiveStartDate: startDate,
    endDate,
    validityEndDate,
    baseValidityEndDate: validityEndDate,
    compensationDays: 0,
    compensationRevision: 0,
    daysCount: Number(
      subscription.contractSnapshot
      && subscription.contractSnapshot.plan
      && subscription.contractSnapshot.plan.daysCount
    ) || inferredDaysCount,
    mealsPerDay,
    proteinGrams,
    ...balance,
    premiumSnapshot: Array.isArray(subscription.premiumBalance)
      ? subscription.premiumBalance
      : [],
    addonSnapshot: {
      subscriptions: Array.isArray(subscription.addonSubscriptions)
        ? subscription.addonSubscriptions
        : [],
      balances: Array.isArray(subscription.addonBalance)
        ? subscription.addonBalance
        : [],
    },
    deliverySnapshot: buildDeliverySnapshotFromSubscription(subscription),
    contractSnapshot: subscription.contractSnapshot || null,
    pricingSnapshot: {
      basePlanPriceHalala: normalizeNonNegativeInteger(subscription.basePlanPriceHalala),
      discountHalala: normalizeNonNegativeInteger(subscription.discountHalala),
      subtotalHalala: normalizeNonNegativeInteger(subscription.subtotalHalala),
      vatHalala: normalizeNonNegativeInteger(subscription.vatHalala),
      totalPriceHalala: normalizeNonNegativeInteger(subscription.totalPriceHalala),
      currency: subscription.checkoutCurrency || "SAR",
    },
    status,
    applicationState: "applied",
    appliedAt: now,
    activatedAt: status === "active" ? now : null,
    exhaustedAt: status === "exhausted" ? now : null,
    expiredAt: status === "expired" ? now : null,
    stackVersion: 1,
    metadata: {
      seededFromLegacySubscription: true,
      originalStatus: subscription.status || "",
    },
  };
}

function buildPurchaseEntitlementBatchPayload({
  draft,
  payment,
  subscriptionPayload,
  authoritativeExtraSnapshot = null,
  containerSubscriptionId,
  businessDate,
  now = new Date(),
} = {}) {
  if (!draft || !draft._id || !draft.userId || !draft.planId) {
    const err = new Error("draft with _id, userId, and planId is required");
    err.code = "INVALID_STACKING_DRAFT";
    throw err;
  }
  if (!subscriptionPayload) {
    const err = new Error("subscriptionPayload is required");
    err.code = "INVALID_STACKING_ACTIVATION_PAYLOAD";
    throw err;
  }
  if (!containerSubscriptionId) {
    const err = new Error("containerSubscriptionId is required");
    err.code = "STACKING_CONTAINER_REQUIRED";
    throw err;
  }

  const startDate = toDate(subscriptionPayload.startDate, "subscriptionPayload.startDate");
  const endDate = toDate(subscriptionPayload.endDate, "subscriptionPayload.endDate");
  const validityEndDate = toDate(
    subscriptionPayload.validityEndDate || subscriptionPayload.endDate,
    "subscriptionPayload.validityEndDate"
  );
  const totalMeals = normalizePositiveInteger(
    subscriptionPayload.totalMeals,
    "subscriptionPayload.totalMeals"
  );
  const mealsPerDay = normalizePositiveInteger(
    subscriptionPayload.selectedMealsPerDay,
    "subscriptionPayload.selectedMealsPerDay"
  );
  const proteinGrams = normalizePositiveInteger(
    subscriptionPayload.selectedGrams,
    "subscriptionPayload.selectedGrams"
  );
  const status = lifecycleStatusForDate({
    effectiveStartDate: startDate,
    validityEndDate,
    remainingMeals: totalMeals,
    businessDate,
  });

  return {
    userId: draft.userId,
    containerSubscriptionId,
    planId: draft.planId,
    paymentId: payment && payment._id ? payment._id : null,
    checkoutDraftId: draft._id,
    sourceKey: buildSourceKey({
      paymentId: payment && payment._id,
      checkoutDraftId: draft._id,
    }),
    sourceType: draft.renewedFromSubscriptionId ? "renewal" : "checkout",
    requestedStartDate: draft.startDate
      ? toDate(draft.startDate, "draft.startDate")
      : startDate,
    effectiveStartDate: startDate,
    endDate,
    validityEndDate,
    baseValidityEndDate: validityEndDate,
    compensationDays: 0,
    compensationRevision: 0,
    daysCount: normalizePositiveInteger(draft.daysCount, "draft.daysCount"),
    mealsPerDay,
    proteinGrams,
    totalMeals,
    remainingMeals: totalMeals,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    premiumSnapshot: authoritativeExtraSnapshot
      ? authoritativeExtraSnapshot.premium
      : (Array.isArray(subscriptionPayload.premiumBalance)
        ? subscriptionPayload.premiumBalance
        : []),
    addonSnapshot: authoritativeExtraSnapshot
      ? authoritativeExtraSnapshot.addons
      : {
        subscriptions: Array.isArray(subscriptionPayload.addonSubscriptions)
          ? subscriptionPayload.addonSubscriptions
          : [],
        balances: Array.isArray(subscriptionPayload.addonBalance)
          ? subscriptionPayload.addonBalance
          : [],
      },
    deliverySnapshot: {
      mode: subscriptionPayload.deliveryMode || "delivery",
      address: subscriptionPayload.deliveryAddress || null,
      zoneId: subscriptionPayload.deliveryZoneId || null,
      zoneName: subscriptionPayload.deliveryZoneName || "",
      pickupLocationId: subscriptionPayload.pickupLocationId || "",
      slot: subscriptionPayload.deliverySlot || null,
    },
    contractSnapshot: subscriptionPayload.contractSnapshot || draft.contractSnapshot || null,
    pricingSnapshot: {
      basePlanPriceHalala: normalizeNonNegativeInteger(subscriptionPayload.basePlanPriceHalala),
      discountHalala: normalizeNonNegativeInteger(subscriptionPayload.discountHalala),
      subtotalHalala: normalizeNonNegativeInteger(subscriptionPayload.subtotalHalala),
      vatHalala: normalizeNonNegativeInteger(subscriptionPayload.vatHalala),
      totalPriceHalala: normalizeNonNegativeInteger(subscriptionPayload.totalPriceHalala),
      currency: subscriptionPayload.checkoutCurrency || "SAR",
    },
    status,
    applicationState: "pending",
    appliedAt: null,
    activatedAt: null,
    stackVersion: 1,
    metadata: {
      activationSubscriptionId: draft.activationSubscriptionId
        ? String(draft.activationSubscriptionId)
        : "",
    },
  };
}

module.exports = {
  buildDeliverySnapshotFromSubscription,
  buildLegacyEntitlementBatchPayload,
  buildPurchaseEntitlementBatchPayload,
  buildSourceKey,
  lifecycleStatusForDate,
  resolveLegacyBalance,
};
