const mongoose = require("mongoose");

const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const Subscription = require("../models/Subscription");
const CheckoutDraft = require("../models/CheckoutDraft");
const { computeVatBreakdown } = require("../utils/pricing");
const { runMongoTransactionWithRetry } = require("./mongoTransactionRetryService");

const SYSTEM_CURRENCY = "SAR";

const PROMO_ERROR_MESSAGES = {
  PROMO_NOT_FOUND: "Promo code was not found",
  PROMO_INACTIVE: "Promo code is inactive",
  PROMO_EXPIRED: "Promo code has expired",
  PROMO_NOT_STARTED: "Promo code is not active yet",
  PROMO_NOT_ELIGIBLE: "Promo code is not eligible for this subscription",
  PROMO_USAGE_LIMIT_REACHED: "Promo code usage limit has been reached",
  PROMO_USER_LIMIT_REACHED: "You have already used this promo code the maximum number of times",
  PROMO_MINIMUM_NOT_MET: "Subscription amount does not meet the promo minimum",
  PROMO_NOT_APPLICABLE_TO_ORDER_TYPE: "Promo code is not applicable to this order type",
  PROMO_INVALID_CONFIGURATION: "Promo code configuration is invalid",
};

function normalizePromoCodeInput(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function createPromoError(code, message = null, extra = {}) {
  const err = new Error(message || PROMO_ERROR_MESSAGES[code] || "Promo code could not be applied");
  err.code = code;
  err.status = 400;
  Object.assign(err, extra);
  return err;
}

function toMoneyLabel(amountHalala, currency = SYSTEM_CURRENCY) {
  const absolute = Math.abs(Number(amountHalala || 0));
  const sar = absolute / 100;
  const formatted = Number.isInteger(sar) ? String(sar) : sar.toFixed(2).replace(/\.?0+$/, "");
  const prefix = Number(amountHalala || 0) < 0 ? "-" : "";
  return `${prefix}${formatted} ${currency || SYSTEM_CURRENCY}`;
}

function buildAppliedPromoPayload({
  promo,
  discountAmountHalala,
  message,
}) {
  const normalizedDiscountAmount = Math.max(0, Math.round(Number(discountAmountHalala || 0)));
  return {
    promoCodeId: promo && promo._id ? promo._id : null,
    code: String(promo && promo.code ? promo.code : ""),
    title: String(promo && promo.title ? promo.title : ""),
    description: String(promo && promo.description ? promo.description : ""),
    discountType: String(promo && promo.discountType ? promo.discountType : ""),
    discountValue: Number(promo && promo.discountValue ? promo.discountValue : 0),
    discountAmountHalala: normalizedDiscountAmount,
    discountAmountSar: normalizedDiscountAmount / 100,
    maxDiscountAmountHalala:
      promo && promo.maxDiscountAmountHalala !== undefined && promo.maxDiscountAmountHalala !== null
        ? Number(promo.maxDiscountAmountHalala)
        : null,
    message:
      String(message || "").trim()
      || String((promo && promo.title) || "").trim()
      || "Promo applied",
    isApplied: normalizedDiscountAmount >= 0,
    validityState: "applied",
  };
}

function applyPromoDiscountToBreakdown(breakdown, discountAmountHalala) {
  const basePlanPriceHalala = Number(breakdown.basePlanPriceHalala || 0);
  const premiumTotalHalala = Number(breakdown.premiumTotalHalala || 0);
  const addonsTotalHalala = Number(breakdown.addonsTotalHalala || 0);
  const deliveryFeeHalala = Number(breakdown.deliveryFeeHalala || 0);
  const vatPercentage = Number(breakdown.vatPercentage || 0);
  const currency = String(breakdown.currency || SYSTEM_CURRENCY);

  const rawSubtotal =
    basePlanPriceHalala +
    premiumTotalHalala +
    addonsTotalHalala +
    deliveryFeeHalala;
  const normalizedDiscount = Math.max(0, Math.min(Math.round(Number(discountAmountHalala || 0)), rawSubtotal));
  const discountedSubtotal = Math.max(0, rawSubtotal - normalizedDiscount);
  const vatBreakdown = computeVatBreakdown({
    basePriceHalala: discountedSubtotal,
    vatPercentage,
  });

  return {
    ...breakdown,
    discountHalala: normalizedDiscount,
    subtotalHalala: vatBreakdown.subtotalHalala,
    vatPercentage: vatBreakdown.vatPercentage,
    vatHalala: vatBreakdown.vatHalala,
    totalHalala: vatBreakdown.totalHalala,
    currency,
  };
}

async function countUserPromoUsages({ promoCodeId, userId, session = null }) {
  let query = PromoUsage.countDocuments({
    promoCodeId,
    userId,
    status: { $in: ["reserved", "consumed"] },
  });
  if (session) {
    query = query.session(session);
  }
  return query;
}

async function countExistingSubscriptionsForUser({ userId, session = null }) {
  let query = Subscription.countDocuments({
    userId,
    status: { $in: ["active", "expired", "canceled"] },
  });
  if (session) {
    query = query.session(session);
  }
  return query;
}

async function resolvePromoCodeOrThrow({ promoCode, session = null }) {
  const normalizedCode = normalizePromoCodeInput(promoCode);
  if (!normalizedCode) {
    return null;
  }

  let query = PromoCode.findOne({
    codeNormalized: normalizedCode,
    deletedAt: null,
  });
  if (session) {
    query = query.session(session);
  }
  const promo = await query;
  if (!promo) {
    throw createPromoError("PROMO_NOT_FOUND");
  }
  return promo;
}

async function validatePromoEligibilityOrThrow({
  promo,
  userId,
  quote,
  session = null,
}) {
  if (!promo) {
    return null;
  }

  if (promo.appliesTo !== "subscription") {
    throw createPromoError("PROMO_NOT_APPLICABLE_TO_ORDER_TYPE");
  }
  if (!promo.isActive) {
    throw createPromoError("PROMO_INACTIVE");
  }

  const now = new Date();
  if (promo.startsAt && new Date(promo.startsAt) > now) {
    throw createPromoError("PROMO_NOT_STARTED");
  }
  if (promo.expiresAt && new Date(promo.expiresAt) < now) {
    throw createPromoError("PROMO_EXPIRED");
  }

  const breakdown = quote && quote.breakdown && typeof quote.breakdown === "object"
    ? quote.breakdown
    : {};
  const rawSubtotal =
    Number(breakdown.basePlanPriceHalala || 0) +
    Number(breakdown.premiumTotalHalala || 0) +
    Number(breakdown.addonsTotalHalala || 0) +
    Number(breakdown.deliveryFeeHalala || 0);

  if (promo.minimumSubscriptionAmountHalala !== null
      && promo.minimumSubscriptionAmountHalala !== undefined
      && rawSubtotal < Number(promo.minimumSubscriptionAmountHalala || 0)) {
    throw createPromoError("PROMO_MINIMUM_NOT_MET");
  }

  if (Array.isArray(promo.eligiblePlanIds) && promo.eligiblePlanIds.length > 0) {
    const isPlanEligible = promo.eligiblePlanIds.some(
      (planId) => String(planId) === String(quote.plan && quote.plan._id ? quote.plan._id : quote.planId || "")
    );
    if (!isPlanEligible) {
      throw createPromoError("PROMO_NOT_ELIGIBLE");
    }
  }

  if (Array.isArray(promo.eligiblePlanDaysCounts) && promo.eligiblePlanDaysCounts.length > 0) {
    const daysCount = Number(quote.plan && quote.plan.daysCount ? quote.plan.daysCount : 0);
    if (!promo.eligiblePlanDaysCounts.some((value) => Number(value) === daysCount)) {
      throw createPromoError("PROMO_NOT_ELIGIBLE");
    }
  }

  if (Array.isArray(promo.allowedUserIds) && promo.allowedUserIds.length > 0) {
    const isAllowedUser = promo.allowedUserIds.some((id) => String(id) === String(userId));
    if (!isAllowedUser) {
      throw createPromoError("PROMO_NOT_ELIGIBLE");
    }
  }

  if (promo.firstPurchaseOnly) {
    const existingSubscriptionCount = await countExistingSubscriptionsForUser({
      userId,
      session,
    });
    if (existingSubscriptionCount > 0) {
      throw createPromoError("PROMO_NOT_ELIGIBLE");
    }
  }

  if (promo.usageLimitTotal !== null && promo.usageLimitTotal !== undefined) {
    if (Number(promo.currentUsageCount || 0) >= Number(promo.usageLimitTotal || 0)) {
      throw createPromoError("PROMO_USAGE_LIMIT_REACHED");
    }
  }

  if (promo.usageLimitPerUser !== null && promo.usageLimitPerUser !== undefined) {
    const userUsageCount = await countUserPromoUsages({
      promoCodeId: promo._id,
      userId,
      session,
    });
    if (userUsageCount >= Number(promo.usageLimitPerUser || 0)) {
      throw createPromoError("PROMO_USER_LIMIT_REACHED");
    }
  }

  if (promo.discountType === "percentage" && Number(promo.discountValue || 0) > 100) {
    throw createPromoError("PROMO_INVALID_CONFIGURATION");
  }

  return {
    rawSubtotalHalala: rawSubtotal,
  };
}

function computePromoDiscountAmountHalala({
  promo,
  rawSubtotalHalala,
}) {
  const subtotal = Math.max(0, Math.round(Number(rawSubtotalHalala || 0)));
  if (!promo || subtotal <= 0) return 0;

  let discountAmountHalala = 0;
  if (promo.discountType === "percentage") {
    discountAmountHalala = Math.round((subtotal * Number(promo.discountValue || 0)) / 100);
    if (promo.maxDiscountAmountHalala !== null && promo.maxDiscountAmountHalala !== undefined) {
      discountAmountHalala = Math.min(
        discountAmountHalala,
        Math.max(0, Math.round(Number(promo.maxDiscountAmountHalala || 0)))
      );
    }
  } else if (promo.discountType === "fixed") {
    discountAmountHalala = Math.max(0, Math.round(Number(promo.discountValue || 0)));
  }

  return Math.max(0, Math.min(discountAmountHalala, subtotal));
}

async function applyPromoCodeToSubscriptionQuote({
  promoCode,
  userId,
  quote,
  session = null,
}) {
  const normalizedCode = normalizePromoCodeInput(promoCode);
  if (!normalizedCode) {
    return {
      quote,
      appliedPromo: null,
    };
  }

  const promo = await resolvePromoCodeOrThrow({ promoCode: normalizedCode, session });
  const eligibility = await validatePromoEligibilityOrThrow({
    promo,
    userId,
    quote,
    session,
  });
  const discountAmountHalala = computePromoDiscountAmountHalala({
    promo,
    rawSubtotalHalala: eligibility.rawSubtotalHalala,
  });
  const appliedPromo = buildAppliedPromoPayload({
    promo,
    discountAmountHalala,
    message:
      discountAmountHalala > 0
        ? `Promo ${promo.code} applied`
        : `Promo ${promo.code} is valid but does not change this subscription total`,
  });

  return {
    quote: {
      ...quote,
      breakdown: applyPromoDiscountToBreakdown(quote.breakdown || {}, discountAmountHalala),
      promoCode: appliedPromo,
    },
    appliedPromo,
    promo,
  };
}

async function reservePromoCodeUsageForCheckout({
  promo,
  appliedPromo,
  userId,
  checkoutDraftId,
}) {
  if (!promo || !appliedPromo || !checkoutDraftId) {
    return null;
  }

  return runMongoTransactionWithRetry(async (session) => {
    const promoInSession = await PromoCode.findById(promo._id).session(session);
    if (!promoInSession) {
      throw createPromoError("PROMO_NOT_FOUND");
    }

    const draft = await CheckoutDraft.findById(checkoutDraftId).session(session);
    if (!draft) {
      throw createPromoError("PROMO_NOT_ELIGIBLE", "Checkout draft not found for promo reservation");
    }

    const existingUsage = await PromoUsage.findOne({
      checkoutDraftId,
      promoCodeId: promo._id,
      status: { $in: ["reserved", "consumed"] },
    }).session(session);

    if (existingUsage) {
      draft.promo = {
        promoCodeId: promoInSession._id,
        usageId: existingUsage._id,
        code: promoInSession.code,
        title: promoInSession.title || "",
        description: promoInSession.description || "",
        discountType: promoInSession.discountType,
        discountValue: Number(promoInSession.discountValue || 0),
        discountAmountHalala: Number(appliedPromo.discountAmountHalala || 0),
        message: appliedPromo.message || "",
        isApplied: true,
      };
      await draft.save({ session });
      return existingUsage;
    }

    await validatePromoEligibilityOrThrow({
      promo: promoInSession,
      userId,
      quote: {
        plan: { _id: draft.planId, daysCount: draft.daysCount },
        breakdown: {
          basePlanPriceHalala: draft.breakdown.basePlanPriceHalala,
          premiumTotalHalala: draft.breakdown.premiumTotalHalala,
          addonsTotalHalala: draft.breakdown.addonsTotalHalala,
          deliveryFeeHalala: draft.breakdown.deliveryFeeHalala,
        },
      },
      session,
    });

    if (promoInSession.usageLimitTotal !== null && promoInSession.usageLimitTotal !== undefined) {
      if (Number(promoInSession.currentUsageCount || 0) >= Number(promoInSession.usageLimitTotal || 0)) {
        throw createPromoError("PROMO_USAGE_LIMIT_REACHED");
      }
    }

    const usage = await PromoUsage.create(
      [
        {
          promoCodeId: promoInSession._id,
          userId,
          checkoutDraftId,
          code: promoInSession.code,
          discountAmountHalala: Number(appliedPromo.discountAmountHalala || 0),
          status: "reserved",
          orderType: "subscription_checkout",
          metadata: {
            appliesTo: "subscription",
          },
        },
      ],
      { session }
    );

    promoInSession.currentUsageCount = Number(promoInSession.currentUsageCount || 0) + 1;
    await promoInSession.save({ session });

    draft.promo = {
      promoCodeId: promoInSession._id,
      usageId: usage[0]._id,
      code: promoInSession.code,
      title: promoInSession.title || "",
      description: promoInSession.description || "",
      discountType: promoInSession.discountType,
      discountValue: Number(promoInSession.discountValue || 0),
      discountAmountHalala: Number(appliedPromo.discountAmountHalala || 0),
      message: appliedPromo.message || "",
      isApplied: true,
    };
    await draft.save({ session });

    return usage[0];
  }, {
    label: "reserve_subscription_promo_usage",
    context: {
      promoCodeId: String(promo._id),
      userId: String(userId),
      checkoutDraftId: String(checkoutDraftId),
    },
  });
}

async function releasePromoCodeUsageReservation({
  checkoutDraftId,
  session = null,
  reason = "cancelled",
}) {
  if (!checkoutDraftId) return null;

  const usage = session
    ? await PromoUsage.findOne({
      checkoutDraftId,
      status: "reserved",
    }).session(session)
    : await PromoUsage.findOne({
      checkoutDraftId,
      status: "reserved",
    });

  if (!usage) return null;

  const promo = session
    ? await PromoCode.findById(usage.promoCodeId).session(session)
    : await PromoCode.findById(usage.promoCodeId);

  usage.status = "cancelled";
  usage.cancelledAt = new Date();
  usage.metadata = {
    ...(usage.metadata && typeof usage.metadata === "object" ? usage.metadata : {}),
    releaseReason: reason,
  };
  await usage.save(session ? { session } : undefined);

  if (promo) {
    promo.currentUsageCount = Math.max(0, Number(promo.currentUsageCount || 0) - 1);
    await promo.save(session ? { session } : undefined);
  }

  const draft = session
    ? await CheckoutDraft.findById(checkoutDraftId).session(session)
    : await CheckoutDraft.findById(checkoutDraftId);
  if (draft && draft.promo) {
    draft.promo.usageId = null;
    await draft.save(session ? { session } : undefined);
  }

  return usage;
}

async function consumePromoCodeUsageReservation({
  checkoutDraftId,
  subscriptionId,
  paymentId = null,
  session = null,
}) {
  if (!checkoutDraftId) return null;

  const usage = session
    ? await PromoUsage.findOne({
      checkoutDraftId,
      status: { $in: ["reserved", "consumed"] },
    }).session(session)
    : await PromoUsage.findOne({
      checkoutDraftId,
      status: { $in: ["reserved", "consumed"] },
    });

  if (!usage) return null;

  if (usage.status !== "consumed") {
    usage.status = "consumed";
    usage.subscriptionId = subscriptionId || usage.subscriptionId || null;
    usage.paymentId = paymentId || usage.paymentId || null;
    usage.consumedAt = usage.consumedAt || new Date();
    await usage.save(session ? { session } : undefined);
  }

  return usage;
}

function buildPromoResponseBlock(appliedPromo) {
  if (!appliedPromo) return null;
  return {
    code: appliedPromo.code,
    title: appliedPromo.title || "",
    description: appliedPromo.description || "",
    discountType: appliedPromo.discountType || "",
    discountValue: Number(appliedPromo.discountValue || 0),
    discountAmountHalala: Number(appliedPromo.discountAmountHalala || 0),
    discountAmountSar: Number(appliedPromo.discountAmountSar || 0),
    message: appliedPromo.message || "",
    isApplied: Boolean(appliedPromo.isApplied),
    validityState: appliedPromo.validityState || "applied",
    amountLabel: toMoneyLabel(-Math.abs(Number(appliedPromo.discountAmountHalala || 0))),
  };
}

function serializePromoCodeForAdmin(promo) {
  if (!promo) return null;
  const now = new Date();
  const isExpired = Boolean(promo.expiresAt && new Date(promo.expiresAt) < now);
  const isStarted = !promo.startsAt || new Date(promo.startsAt) <= now;

  return {
    id: String(promo._id),
    code: promo.code,
    title: promo.title || "",
    description: promo.description || "",
    isActive: Boolean(promo.isActive),
    appliesTo: promo.appliesTo,
    discountType: promo.discountType,
    discountValue: Number(promo.discountValue || 0),
    maxDiscountAmountHalala:
      promo.maxDiscountAmountHalala !== null && promo.maxDiscountAmountHalala !== undefined
        ? Number(promo.maxDiscountAmountHalala)
        : null,
    minimumSubscriptionAmountHalala:
      promo.minimumSubscriptionAmountHalala !== null && promo.minimumSubscriptionAmountHalala !== undefined
        ? Number(promo.minimumSubscriptionAmountHalala)
        : null,
    startsAt: promo.startsAt || null,
    expiresAt: promo.expiresAt || null,
    usageLimitTotal:
      promo.usageLimitTotal !== null && promo.usageLimitTotal !== undefined
        ? Number(promo.usageLimitTotal)
        : null,
    usageLimitPerUser:
      promo.usageLimitPerUser !== null && promo.usageLimitPerUser !== undefined
        ? Number(promo.usageLimitPerUser)
        : null,
    currentUsageCount: Number(promo.currentUsageCount || 0),
    eligiblePlanIds: Array.isArray(promo.eligiblePlanIds)
      ? promo.eligiblePlanIds.map((id) => String(id))
      : [],
    eligiblePlanDaysCounts: Array.isArray(promo.eligiblePlanDaysCounts)
      ? promo.eligiblePlanDaysCounts.map((value) => Number(value))
      : [],
    firstPurchaseOnly: Boolean(promo.firstPurchaseOnly),
    allowedUserIds: Array.isArray(promo.allowedUserIds)
      ? promo.allowedUserIds.map((id) => String(id))
      : [],
    currency: promo.currency || SYSTEM_CURRENCY,
    metadata: promo.metadata || null,
    deletedAt: promo.deletedAt || null,
    createdAt: promo.createdAt || null,
    updatedAt: promo.updatedAt || null,
    state: {
      isExpired,
      isStarted,
      isDeleted: Boolean(promo.deletedAt),
      isCurrentlyValid: Boolean(promo.isActive && !promo.deletedAt && isStarted && !isExpired),
    },
  };
}

function normalizeNullableInteger(value, { fieldName, min = 0 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw createPromoError("PROMO_INVALID_CONFIGURATION", `${fieldName} must be an integer >= ${min}`);
  }
  return parsed;
}

function normalizeNullableMoneyMinorUnits({
  halalaValue,
  sarValue,
  fieldName,
}) {
  if (halalaValue !== undefined && halalaValue !== null && halalaValue !== "") {
    return normalizeNullableInteger(halalaValue, { fieldName, min: 0 });
  }
  if (sarValue !== undefined && sarValue !== null && sarValue !== "") {
    const parsedSar = Number(sarValue);
    if (!Number.isFinite(parsedSar) || parsedSar < 0) {
      throw createPromoError("PROMO_INVALID_CONFIGURATION", `${fieldName} must be >= 0`);
    }
    return Math.round(parsedSar * 100);
  }
  return null;
}

function normalizeOptionalDate(value, { fieldName } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createPromoError("PROMO_INVALID_CONFIGURATION", `${fieldName} must be a valid date`);
  }
  return parsed;
}

function normalizePromoPayload(payload = {}) {
  const code = normalizePromoCodeInput(payload.code);
  if (!code) {
    throw createPromoError("PROMO_INVALID_CONFIGURATION", "code is required");
  }

  const discountType = String(payload.discountType || "").trim().toLowerCase();
  if (!["percentage", "fixed"].includes(discountType)) {
    throw createPromoError("PROMO_INVALID_CONFIGURATION", "discountType must be percentage or fixed");
  }

  const discountValue = Number(payload.discountValue);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw createPromoError("PROMO_INVALID_CONFIGURATION", "discountValue must be >= 0");
  }

  return {
    code,
    codeNormalized: code,
    title: String(payload.title || "").trim(),
    description: String(payload.description || "").trim(),
    isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
    appliesTo: "subscription",
    discountType,
    discountValue,
    maxDiscountAmountHalala: normalizeNullableMoneyMinorUnits({
      halalaValue: payload.maxDiscountAmountHalala,
      sarValue: payload.maxDiscountAmountSar,
      fieldName: "maxDiscountAmount",
    }),
    minimumSubscriptionAmountHalala: normalizeNullableMoneyMinorUnits({
      halalaValue: payload.minimumSubscriptionAmountHalala,
      sarValue: payload.minimumSubscriptionAmountSar,
      fieldName: "minimumSubscriptionAmount",
    }),
    startsAt: normalizeOptionalDate(payload.startsAt, { fieldName: "startsAt" }),
    expiresAt: normalizeOptionalDate(payload.expiresAt, { fieldName: "expiresAt" }),
    usageLimitTotal: normalizeNullableInteger(payload.usageLimitTotal, {
      fieldName: "usageLimitTotal",
      min: 0,
    }),
    usageLimitPerUser: normalizeNullableInteger(payload.usageLimitPerUser, {
      fieldName: "usageLimitPerUser",
      min: 0,
    }),
    eligiblePlanIds: Array.isArray(payload.eligiblePlanIds)
      ? payload.eligiblePlanIds
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)))
      : [],
    eligiblePlanDaysCounts: Array.isArray(payload.eligiblePlanDaysCounts)
      ? payload.eligiblePlanDaysCounts
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
      : [],
    firstPurchaseOnly: Boolean(payload.firstPurchaseOnly),
    allowedUserIds: Array.isArray(payload.allowedUserIds)
      ? payload.allowedUserIds
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)))
      : [],
    currency: String(payload.currency || SYSTEM_CURRENCY).trim().toUpperCase() || SYSTEM_CURRENCY,
    metadata:
      payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata
        : null,
  };
}

async function cleanupAbandonedPromoReservations(timeoutMinutes = 60) {
  const cutoffDate = new Date(Date.now() - timeoutMinutes * 60 * 1000);
  
  const staleUsages = await PromoUsage.find({
    status: "reserved",
    createdAt: { $lt: cutoffDate },
  });

  const results = {
    totalStale: staleUsages.length,
    releasedCount: 0,
    failedCount: 0,
    errors: [],
  };

  for (const usage of staleUsages) {
    try {
      if (usage.checkoutDraftId) {
        await releasePromoCodeUsageReservation({
          checkoutDraftId: usage.checkoutDraftId,
          reason: "timeout",
        });
        results.releasedCount++;
      } else {
        usage.status = "cancelled";
        usage.cancelledAt = new Date();
        usage.metadata = {
          ...(usage.metadata && typeof usage.metadata === "object" ? usage.metadata : {}),
          releaseReason: "timeout_no_draft",
        };
        await usage.save();

        if (usage.promoCodeId) {
          const promo = await PromoCode.findById(usage.promoCodeId);
          if (promo) {
            promo.currentUsageCount = Math.max(0, Number(promo.currentUsageCount || 0) - 1);
            await promo.save();
          }
        }
        results.releasedCount++;
      }
    } catch (err) {
      results.failedCount++;
      results.errors.push({ usageId: String(usage._id), error: err.message });
    }
  }

  return results;
}

module.exports = {
  SYSTEM_CURRENCY,
  normalizePromoCodeInput,
  createPromoError,
  applyPromoDiscountToBreakdown,
  applyPromoCodeToSubscriptionQuote,
  reservePromoCodeUsageForCheckout,
  releasePromoCodeUsageReservation,
  consumePromoCodeUsageReservation,
  buildPromoResponseBlock,
  serializePromoCodeForAdmin,
  normalizePromoPayload,
  resolvePromoCodeOrThrow,
  validatePromoEligibilityOrThrow,
  computePromoDiscountAmountHalala,
  cleanupAbandonedPromoReservations,
};
