const crypto = require("crypto");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const CheckoutDraft = require("../models/CheckoutDraft");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Payment = require("../models/Payment");
const dateUtils = require("../utils/date");
const { addDaysToKSADateString } = dateUtils;
const { canTransition } = require("../utils/state");
const { writeLog } = require("../utils/log");
const { createInvoice, getInvoice } = require("../services/moyasarService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const {
  lockDaySnapshot,
} = require("../services/subscription/subscriptionDayOperationalSnapshotService");
const {
  buildSubscriptionTimeline,
} = require("../services/subscription/subscriptionService");
const {
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
} = require("../services/subscription/subscriptionContractService");
const {
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
} = require("../services/subscription/subscriptionActivationService");

const {
  applyPaymentSideEffects,
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
} = require("../services/paymentApplicationService");
const { logger } = require("../utils/logger");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscription/subscriptionDaySelectionSync");
const {
  resolveQuoteSummary,
} = require("../utils/subscription/subscriptionCatalog");
const { buildPromoResponseBlock } = require("../services/promoCodeService");
const {
  resolveCatalogOrStoredName,
} = require("../utils/subscription/subscriptionLocalizationCommon");
const {
  getGenericPremiumCreditsLabel,
  localizeCheckoutDraftStatusReadPayload,
  localizeSubscriptionDayReadPayload,
  localizeTimelineReadPayload,
  localizeRenewalSeedReadPayload,
} = require("../utils/subscription/subscriptionReadLocalization");
const {
  buildPaymentDescription,
  localizeSkipRangeSummary,
  localizeWriteCheckoutStatusPayload,
  localizeWritePremiumOverageStatusPayload,
  localizeWriteSubscriptionPayload,
} = require("../utils/subscription/subscriptionWriteLocalization");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { serializeForApi } = require("../utils/apiSerializer");
const {
  isPhase1CanonicalCheckoutDraftWriteEnabled,
  isPhase1SharedPaymentDispatcherEnabled,
  isPhase1NonCheckoutPaidIdempotencyEnabled,
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../utils/featureFlags");
const { sliceBDefaultRuntime } = require("../services/subscription/runtime");
const { performSubscriptionCheckout } = require("../services/subscription/subscriptionCheckoutService");
const { resolveCheckoutQuoteOrThrow } = require("../services/subscription/subscriptionQuoteService");
const { buildCurrentSubscriptionOverview } = require("../services/subscription/subscriptionClientOverviewService");
const { performClientSubscriptionCancellation } = require("../services/subscription/subscriptionClientCancellationService");
const {
  resolveSubscriptionSkipPolicy,
} = require("../services/subscription/subscriptionContractReadService");
const { buildSubscriptionRenewalSeed, performSubscriptionRenewal } = require("../services/subscription/subscriptionRenewalService");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("../services/subscription/subscriptionCutoffPolicyService");
const {
  isCanonicalDayPlanningEligible,
  applyCanonicalDraftPlanningToDay,
  applyPremiumOverageState,
  confirmCanonicalDayPlanning,
  assertCanonicalPlanningExactCount,
  assertNoPendingPremiumOverage,
  assertNoPendingOneTimeAddonPayment,
  buildCanonicalPlanningView,
  isCanonicalPremiumOverageEligible,
} = require("../services/subscription/subscriptionDayPlanningService");
const {
  parseOperationIdempotencyKey,
  buildOperationRequestHash,
  compareIdempotentRequest,
} = require("../services/idempotencyService");

const { reconcileCheckoutDraft, RECONCILE_MODES } = require("../services/reconciliationService");
const {
  normalizeStoredVatBreakdown,
  buildMoneySummary,
} = require("../utils/pricing");
const {
  validateDayBeforeLockOrPrepare,
  resolveDayExecutionValidationErrorStatus,
} = require("../services/subscription/subscriptionDayExecutionValidationService");
const {
  getRestaurantHours,
  getRestaurantBusinessDate,
  getRestaurantBusinessTomorrow,
} = require("../services/restaurantHoursService");
const {
} = require("../services/subscription/subscriptionSkipService");
const {
  buildPremiumExtraRevisionHash,
} = require("../services/subscription/mealSlotPlannerService");
const {
  buildDayCommercialState,
} = require("../services/subscription/subscriptionDayCommercialStateService");
const {
  createPremiumExtraDayPaymentFlow,
  verifyPremiumExtraDayPaymentFlow,
} = require("../services/subscription/premiumExtraDayPaymentService");
const {
  createPremiumOverageDayPaymentFlow,
  verifyPremiumOverageDayPaymentFlow,
} = require("../services/subscription/premiumOverageDayPaymentService");
const {
  createOneTimeAddonDayPlanningPaymentFlow,
  verifyOneTimeAddonDayPlanningPaymentFlow,
} = require("../services/subscription/oneTimeAddonDayPlanningPaymentService");
const {
  createLegacyOneTimeAddonPaymentFlow,
} = require("../services/subscription/legacyOneTimeAddonPaymentService");
const {
  buildPaymentRedirectContext,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
} = require("../services/paymentProviderMetadataService");
const { validateRedirectUrl, resolveProviderRedirectUrl } = require("../utils/security");
const {
  buildSubscriptionOperationsMeta,
  buildFreezePreview,
} = require("../services/subscription/subscriptionOperationsReadService");
const {
  loadWalletCatalogMaps,
  loadWalletCatalogMapsSafely,
  serializeSubscriptionForClient,
} = require("../services/subscription/subscriptionClientSerializationService");
const {
  resolveSubscriptionDeliveryDefaultsUpdate,
  performDeliveryDetailsUpdate,
  performDeliveryDetailsUpdateForDate,
} = require("../services/subscription/subscriptionDeliveryUpdateService");
const {
  persistCheckoutDraftUpdate,
  ensureSubscriptionCheckoutPayment,
  buildCheckoutReusePayload,
  isPendingCheckoutReusable,
  getPaymentMetadata,
} = require("../services/subscription/subscriptionCheckoutHelpers");
const {
  getPickupStatusForClient,
  preparePickupForClient,
} = require("../services/subscription/subscriptionPickupClientService");
const {
  skipDayForClient,
  skipRangeForClient,
  unskipDayForClient,
} = require("../services/subscription/subscriptionSkipClientService");
const {
  freezeSubscriptionForClient,
  unfreezeSubscriptionForClient,
} = require("../services/subscription/subscriptionFreezeClientService");
const {
  confirmDayPlanningForClient,
  updateDaySelectionForClient,
  validateDaySelectionForClient,
} = require("../services/subscription/subscriptionPlanningClientService");
const {
  consumePremiumSelectionForClient,
  consumeAddonSelectionForClient,
  removePremiumSelectionForClient,
  removeAddonSelectionForClient,
  updateBulkDaySelectionsForClient,
} = require("../services/subscription/subscriptionSelectionClientService");
const {
  buildControllerErrorDetails,
  buildSingleSkipMessage,
  logWalletIntegrityError,
  resolveBulkDaySelectionRequests,
  resolveRequestedDate,
  serializeSubscriptionDayForClient,
  shapeMealPlannerReadFields,
} = require("../services/subscription/subscriptionClientSupportService");
const {
  buildPaymentMetadataWithInitiationFields,
  buildPremiumOveragePaymentStatusPayload,
  serializeCheckoutPayment,
} = require("../services/subscription/subscriptionPaymentPayloadService");
// Removed legacySubscriptionAdapter imports as part of the radical architecture cleanup.


const SYSTEM_CURRENCY = "SAR";
const STALE_DRAFT_THRESHOLD_MS = 30 * 1000; 
const LEGACY_DAY_PREMIUM_SLOT_PREFIX = "legacy_day_premium_slot_";


const PREMIUM_OVERAGE_DAY_PAYMENT_TYPE = "premium_overage_day";
const PREMIUM_EXTRA_DAY_PAYMENT_TYPE = "premium_extra_day";
const sliceEDefaultRuntime = {
  createInvoice: (...args) => createInvoice(...args),
  parseOperationIdempotencyKey: (...args) => parseOperationIdempotencyKey(...args),
  buildOperationRequestHash: (...args) => buildOperationRequestHash(...args),
  compareIdempotentRequest: (...args) => compareIdempotentRequest(...args),
  async findPaymentByOperationKey({ userId, operationScope, operationIdempotencyKey }) {
    return Payment.findOne({
      userId,
      operationScope,
      operationIdempotencyKey,
    }).sort({ createdAt: -1 }).lean();
  },
  async findReusableInitiatedPaymentByHash({ userId, operationScope, operationRequestHash }) {
    return Payment.findOne({
      userId,
      operationScope,
      operationRequestHash,
      status: "initiated",
      applied: false,
    }).sort({ createdAt: -1 }).lean();
  },
  async createPayment(payload) {
    return Payment.create(payload);
  },
};
const sliceP2S1DefaultRuntime = {
  isCanonicalDayPlanningEligible: (...args) => isCanonicalDayPlanningEligible(...args),
  isCanonicalPremiumOverageEligible: (...args) => isCanonicalPremiumOverageEligible(...args),
  applyCanonicalDraftPlanningToDay: (...args) => applyCanonicalDraftPlanningToDay(...args),
  applyPremiumOverageState: (...args) => applyPremiumOverageState(...args),
  confirmCanonicalDayPlanning: (...args) => confirmCanonicalDayPlanning(...args),
  assertCanonicalPlanningExactCount: (...args) => assertCanonicalPlanningExactCount(...args),
  assertNoPendingPremiumOverage: (...args) => assertNoPendingPremiumOverage(...args),
  assertNoPendingOneTimeAddonPayment: (...args) => assertNoPendingOneTimeAddonPayment(...args),
  buildCanonicalPlanningView: (...args) => buildCanonicalPlanningView(...args),
};
const subscriptionOperationsMetaDefaultRuntime = {
  buildSubscriptionOperationsMeta: (...args) => buildSubscriptionOperationsMeta(...args),
};
const subscriptionFreezePreviewDefaultRuntime = {
  buildFreezePreview: (...args) => buildFreezePreview(...args),
};

function resolveOperationsMetaRuntime(runtimeOverrides = null) {
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return subscriptionOperationsMetaDefaultRuntime;
  }
  return { ...subscriptionOperationsMetaDefaultRuntime, ...runtimeOverrides };
}

function resolveFreezePreviewRuntime(runtimeOverrides = null) {
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return subscriptionFreezePreviewDefaultRuntime;
  }
  return { ...subscriptionFreezePreviewDefaultRuntime, ...runtimeOverrides };
}

function isGenericPremiumWalletMode(subscription) {
  return false;
}


function parsePositiveInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = normalizeCurrencyValue(value);
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must be ${SYSTEM_CURRENCY}`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return currency;
}

function parseIdempotencyKey(rawValue) {
  if (rawValue === undefined || rawValue === null) return "";
  const value = String(rawValue).trim();
  if (!value) return "";
  if (value.length > 128) {
    const err = new Error("idempotencyKey must be at most 128 characters");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  return value;
}

function buildCheckoutRequestHash({ userId, quote }) {
  const premiumItems = (quote.premiumItems || [])
    .map((item) => ({
      id: String(item.protein && item.protein._id ? item.protein._id : item.proteinId || ""),
      qty: Number(item.qty || 0),
      unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
      currency: normalizeCurrencyValue(item.protein && item.protein.currency ? item.protein.currency : item.currency),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const addonItems = (quote.addonItems || [])
    .map((item) => ({
      id: String(item.addon && item.addon._id ? item.addon._id : item.addonId || ""),
      qty: Number(item.qty || 0),
      unitPriceHalala: Number(item.unitPriceHalala || 0),
      currency: normalizeCurrencyValue(item.addon && item.addon.currency ? item.addon.currency : item.currency),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const canonicalPayload = {
    userId: String(userId),
    planId: String(quote.plan && quote.plan._id ? quote.plan._id : ""),
    planCurrency: normalizeCurrencyValue(quote.plan && quote.plan.currency),
    daysCount: Number(quote.plan && quote.plan.daysCount ? quote.plan.daysCount : 0),
    grams: Number(quote.grams || 0),
    mealsPerDay: Number(quote.mealsPerDay || 0),
    startDate: quote.startDate ? new Date(quote.startDate).toISOString() : null,
    delivery: {
      type: quote.delivery && quote.delivery.type ? quote.delivery.type : "delivery",
      zoneId:
        quote.delivery && quote.delivery.zoneId
          ? String(quote.delivery.zoneId)
          : "",
      zoneName:
        quote.delivery && quote.delivery.zoneName
          ? String(quote.delivery.zoneName)
          : "",
      slotType:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.type
          ? quote.delivery.slot.type
          : "delivery",
      window:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.window
          ? String(quote.delivery.slot.window)
          : "",
      slotId:
        quote.delivery && quote.delivery.slot && quote.delivery.slot.slotId
          ? String(quote.delivery.slot.slotId)
          : "",
      pickupLocationId:
        quote.delivery && quote.delivery.pickupLocationId
          ? String(quote.delivery.pickupLocationId)
          : "",
      address: quote.delivery && quote.delivery.address ? quote.delivery.address : null,
    },
    premiumItems,
    premiumCount: Number(quote.premiumCount || 0),
    premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),

    addonItems,
    breakdown: {
      basePlanPriceHalala: Number(quote.breakdown.basePlanPriceHalala || 0),
      premiumTotalHalala: Number(quote.breakdown.premiumTotalHalala || 0),
      addonsTotalHalala: Number(quote.breakdown.addonsTotalHalala || 0),
      deliveryFeeHalala: Number(quote.breakdown.deliveryFeeHalala || 0),
      subtotalHalala: Number(quote.breakdown.subtotalHalala || 0),
      vatPercentage: Number(quote.breakdown.vatPercentage || 0),
      vatHalala: Number(quote.breakdown.vatHalala || 0),
      totalHalala: Number(quote.breakdown.totalHalala || 0),
    },
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

function sumCheckoutPremiumItemsQty(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Number(item && item.qty ? item.qty : 0),
    0
  );
}

function normalizeOperationItemsForHash(items, idKey) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item && item[idKey] ? item[idKey] : item && item.id ? item.id : "").trim(),
      qty: Number(item && item.qty ? item.qty : 0),
    }))
    .filter((item) => item.id && item.qty > 0)
    .sort((a, b) => a.id.localeCompare(b.id) || a.qty - b.qty);
}


function buildAddonUnitFromDoc(doc) {
  if (!doc) return 0;
  return Number.isInteger(doc.priceHalala)
    ? doc.priceHalala
    : Math.max(0, Math.round(Number(doc.price || 0) * 100));
}


function isReusableInitiatedPayment(payment) {
  const metadata = getPaymentMetadata(payment);
  return Boolean(
    payment
    && payment.status === "initiated"
    && payment.applied !== true
    && payment.providerInvoiceId
    && typeof metadata.paymentUrl === "string"
    && metadata.paymentUrl.trim()
  );
}

function buildNonCheckoutInitiationPayload(payment, fallbackResponseShape) {
  const metadata = getPaymentMetadata(payment);
  const responseShape = String(metadata.initiationResponseShape || fallbackResponseShape || "").trim();
  const redirectContext = metadata.redirectContext && typeof metadata.redirectContext === "object"
    ? metadata.redirectContext
    : null;
  const payload = {
    payment_url: metadata.paymentUrl || "",
    invoice_id: payment && payment.providerInvoiceId ? payment.providerInvoiceId : null,
    payment_id: payment && payment.id ? payment.id : (payment && payment._id ? String(payment._id) : null),
  };

  if (redirectContext && redirectContext.token && redirectContext.paymentType) {
    const verifyParams = new URLSearchParams({
      payment_type: String(redirectContext.paymentType || ""),
      token: String(redirectContext.token || ""),
    });
    if (redirectContext.draftId) verifyParams.set("draft_id", String(redirectContext.draftId));
    if (redirectContext.subscriptionId) verifyParams.set("subscription_id", String(redirectContext.subscriptionId));
    if (redirectContext.dayId) verifyParams.set("day_id", String(redirectContext.dayId));
    if (redirectContext.date) verifyParams.set("date", String(redirectContext.date));
    payload.verify_url = `/api/payments/verify?${verifyParams.toString()}`;
  }

  if (
    responseShape === "premium_overage_day"
    || responseShape === "premium_extra_day"
    || responseShape === "one_time_addon_day_planning"
  ) {
    payload.totalHalala = Number(
      metadata.totalHalala !== undefined && metadata.totalHalala !== null
        ? metadata.totalHalala
        : payment && payment.amount !== undefined
          ? payment.amount
          : 0
    );
  }

  return payload;
}

async function maybeHandleNonCheckoutIdempotency({
  req,
  res,
  operationScope,
  effectivePayload,
  fallbackResponseShape,
  runtime,
}) {
  if (!isPhase1NonCheckoutPaidIdempotencyEnabled()) {
    return { shouldContinue: true, idempotencyKey: "", operationRequestHash: "" };
  }

  let operationIdempotencyKey = "";
  try {
    operationIdempotencyKey = runtime.parseOperationIdempotencyKey({
      headers: req.headers || {},
      body: req.body || {},
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return {
        shouldContinue: false,
        response: sendValidationError(res, err.message),
      };
    }
    throw err;
  }

  if (!operationIdempotencyKey) {
    return { shouldContinue: true, idempotencyKey: "", operationRequestHash: "" };
  }

  const operationRequestHash = runtime.buildOperationRequestHash({
    scope: operationScope,
    userId: req.userId,
    effectivePayload,
  });

  const existingByKey = await runtime.findPaymentByOperationKey({
    userId: req.userId,
    operationScope,
    operationIdempotencyKey,
  });

  if (existingByKey) {
    if (!existingByKey.operationRequestHash) {
      return {
        shouldContinue: false,
        response: errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          "idempotencyKey is already used by an incompatible payment initiation"
        ),
      };
    }

    const decision = runtime.compareIdempotentRequest({
      existingRequestHash: existingByKey.operationRequestHash,
      incomingRequestHash: operationRequestHash,
    });

    if (decision === "conflict") {
      return {
        shouldContinue: false,
        response: errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          "idempotencyKey is already used with a different payment payload"
        ),
      };
    }

    if (decision === "reuse" && isReusableInitiatedPayment(existingByKey)) {
      return {
        shouldContinue: false,
        response: res.status(200).json({
          status: true,
          data: buildNonCheckoutInitiationPayload(existingByKey, fallbackResponseShape),
        }),
      };
    }

    return {
      shouldContinue: false,
      response: errorResponse(
        res,
        409,
        "IDEMPOTENCY_CONFLICT",
        "idempotencyKey is already used with a non-reusable payment initiation"
      ),
    };
  }

  const existingByHash = await runtime.findReusableInitiatedPaymentByHash({
    userId: req.userId,
    operationScope,
    operationRequestHash,
  });

  if (existingByHash && isReusableInitiatedPayment(existingByHash)) {
    return {
      shouldContinue: false,
      response: res.status(200).json({
        status: true,
        data: buildNonCheckoutInitiationPayload(existingByHash, fallbackResponseShape),
      }),
    };
  }

  return {
    shouldContinue: true,
    idempotencyKey: operationIdempotencyKey,
    operationRequestHash,
  };
}

function normalizeCheckoutDeliveryForPersistence(delivery = {}) {
  const normalizedType = delivery && delivery.type === "pickup" ? "pickup" : "delivery";
  const slot = delivery && delivery.slot && typeof delivery.slot === "object" ? delivery.slot : {};

  return {
    type: normalizedType,
    address: delivery && delivery.address ? delivery.address : null,
    zoneId: normalizedType === "delivery" ? (delivery && delivery.zoneId ? delivery.zoneId : null) : null,
    zoneName:
      normalizedType === "delivery"
        ? String(delivery && delivery.zoneName ? delivery.zoneName : "").trim()
        : "",
    slot: {
      type: normalizedType,
      window: slot && slot.window ? String(slot.window) : "",
      slotId: slot && slot.slotId ? String(slot.slotId) : "",
    },
  };
}

function summarizeCheckoutDeliveryForDebug(delivery = {}) {
  const normalized = normalizeCheckoutDeliveryForPersistence(delivery);
  return {
    type: normalized.type,
    hasAddress: Boolean(normalized.address),
    zoneId: normalized.zoneId ? String(normalized.zoneId) : null,
    zoneName: normalized.zoneName || "",
    slotType: normalized.slot.type,
    slotId: normalized.slot.slotId || "",
    window: normalized.slot.window || "",
  };
}

function getInvoiceResponseId(invoice) {
  if (!invoice || typeof invoice !== "object") return "";
  return String(invoice.id || invoice.invoice_id || invoice.invoiceId || "").trim();
}

function getInvoiceResponseUrl(invoice) {
  if (!invoice || typeof invoice !== "object") return "";
  return String(invoice.url || invoice.payment_url || invoice.paymentUrl || "").trim();
}













function resolveSubscriptionCheckoutPaymentType({ renewedFromSubscriptionId } = {}) {
  return renewedFromSubscriptionId ? "subscription_renewal" : "subscription_activation";
}

function isCanonicalGenericPremiumOverageEligibleForDay(subscription, day) {
  return Boolean(
    day
    && day.status === "open"
    && isCanonicalPremiumOverageEligible(subscription, {
      dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
      genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
    })
  );
}

function isCanonicalOneTimeAddonPlanningPaymentEligibleForDay(subscription, day) {
  return Boolean(
    day
    && day.status === "open"
    && isCanonicalDayPlanningEligible(subscription, {
      flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    })
  );
}

function buildSubscriptionCheckoutStatusPayload({ draft, payment, providerInvoice = null }) {
  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const providerStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice && providerInvoice.status
  );

  return {
    draftId: String(draft._id),
    subscriptionId: draft.subscriptionId ? String(draft.subscriptionId) : null,
    checkoutStatus: draft.status,
    paymentStatus: payment && payment.status ? payment.status : null,
    isFinal: ["completed", "failed", "canceled", "expired"].includes(draft.status),
    paymentId: payment ? String(payment._id) : (draft.paymentId ? String(draft.paymentId) : null),
    payment_url: draft.paymentUrl || "",
    providerInvoiceId:
      draft.providerInvoiceId
      || (payment && payment.providerInvoiceId)
      || (providerInvoice && providerInvoice.id)
      || null,
    providerPaymentId:
      (payment && payment.providerPaymentId)
      || (providerPayment && providerPayment.id)
      || null,
    totals: draft.breakdown || null,
    pricingSummary: draft && draft.breakdown
      ? buildMoneySummary({
        basePriceHalala: draft.breakdown.subtotalHalala || 0,
        vatPercentage: draft.breakdown.vatPercentage || 0,
        vatHalala: draft.breakdown.vatHalala || 0,
        totalPriceHalala: draft.breakdown.totalHalala || 0,
        currency: draft.breakdown.currency || SYSTEM_CURRENCY,
      })
      : null,
    promoCode: buildPromoResponseBlock(
      draft && draft.promo && draft.promo.isApplied
        ? {
          ...draft.promo,
          discountAmountSar: Number(draft.promo.discountAmountHalala || 0) / 100,
          validityState: "applied",
          isApplied: true,
        }
        : null
    ),
    failureReason: draft.failureReason || "",
    completedAt: draft.completedAt || null,
    failedAt: draft.failedAt || null,
    createdAt: draft.createdAt || null,
    updatedAt: draft.updatedAt || null,
    payment: serializeCheckoutPayment(payment),
    providerInvoice: providerInvoice
      ? {
        id: providerInvoice.id || null,
        status: providerStatus || String(providerInvoice.status || "").trim().toLowerCase() || null,
        amount: Number.isFinite(Number(providerInvoice.amount)) ? Number(providerInvoice.amount) : null,
        currency: providerInvoice.currency || null,
        url: providerInvoice.url || draft.paymentUrl || "",
        updatedAt: providerInvoice.updated_at || providerInvoice.updatedAt || null,
        attemptsCount: Array.isArray(providerInvoice.payments) ? providerInvoice.payments.length : 0,
      }
      : null,
  };
}

async function autoFinalizePaidCheckoutDraft({ draft, payment, providerInvoice }, runtimeOverrides = null) {
  if (!draft || !payment || !payment._id || payment.applied) {
    return { applied: false, alreadyApplied: Boolean(payment && payment.applied) };
  }
  if (String(payment.status).trim().toLowerCase() !== "paid") {
    return { applied: false, reason: "payment_not_paid" };
  }

  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => mongoose.startSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;
  const finalizeSubscriptionDraftPaymentFn = runtimeOverrides && runtimeOverrides.finalizeSubscriptionDraftPayment
    ? runtimeOverrides.finalizeSubscriptionDraftPayment
    : finalizeSubscriptionDraftPayment;
  const isSharedPaymentDispatcherEnabledFn = runtimeOverrides && runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    ? runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    : isPhase1SharedPaymentDispatcherEnabled;
  const supportedSharedPaymentTypes = runtimeOverrides && runtimeOverrides.supportedPaymentTypes
    ? runtimeOverrides.supportedPaymentTypes
    : SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES;

  const session = await startSessionFn();
  session.startTransaction();
  try {
    const paymentInSession = await Payment.findOne({ _id: payment._id }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return { applied: false, reason: "payment_not_found" };
    }
    if (paymentInSession.applied) {
      await session.commitTransaction();
      session.endSession();
      return { applied: false, alreadyApplied: true };
    }

    const claimedPayment = await Payment.findOneAndUpdate(
      { _id: paymentInSession._id, applied: false },
      { $set: { applied: true, status: "paid" } },
      { new: true, session }
    );
    if (!claimedPayment) {
      await session.commitTransaction();
      session.endSession();
      return { applied: false, reason: "already_claimed" };
    }

    const useSharedDispatcher = supportedSharedPaymentTypes.has(String(claimedPayment.type || ""))
      && (
        isSharedPaymentDispatcherEnabledFn()
        || String(claimedPayment.type || "") === "premium_overage_day"
        || String(claimedPayment.type || "") === "premium_extra_day"
        || String(claimedPayment.type || "") === "one_time_addon_day_planning"
      );

    let result;
    if (useSharedDispatcher) {
      result = await applyPaymentSideEffectsFn({
        payment: claimedPayment,
        session,
        source: "auto_finalize",
      });
    } else {
      result = await finalizeSubscriptionDraftPaymentFn({ draft, payment: claimedPayment, session });
    }

    if (!result.applied) {
      const metadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: result.reason });
      await Payment.updateOne(
        { _id: claimedPayment._id },
        { $set: { applied: true, status: "paid", metadata } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();
    return { applied: Boolean(result.applied), reason: result.reason };
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("Subscription checkout auto-finalization failed", {
      draftId: String(draft._id),
      paymentId: String(payment._id),
      error: err.message,
      stack: err.stack,
    });
    return { applied: false, reason: "auto_finalize_failed" };
  }
}

async function finalizeSubscriptionDraftPayment({ draft, payment, session }, runtimeOverrides = null) {
  const runtime = runtimeOverrides
    ? {
      activateSubscriptionFromCanonicalDraft:
        runtimeOverrides.activateSubscriptionFromCanonicalDraft || sliceBDefaultRuntime().activateSubscriptionFromCanonicalDraft,
    }
    : null;

  return sliceBDefaultRuntime().finalizeSubscriptionDraftPaymentFlow({ draft, payment, session }, runtime);
}

async function validateFutureDateOrThrow(date, sub, endDateOverride, options = {}) {
  const { allowToday = false } = options;
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    throw err;
  }

  const businessDate = await getRestaurantBusinessDate();
  if (!dateUtils.isOnOrAfterKSADate(date, businessDate)) {
    const err = new Error("Date cannot be in the past");
    err.code = "INVALID_DATE";
    throw err;
  }

  const minimumDate = allowToday
    ? businessDate
    : await getRestaurantBusinessTomorrow();
  if (!dateUtils.isOnOrAfterKSADate(date, minimumDate)) {
    const err = new Error("Date must be from tomorrow onward");
    err.code = "INVALID_DATE";
    throw err;
  }
  const endDate = endDateOverride || sub.validityEndDate || sub.endDate;
  if (!dateUtils.isInSubscriptionRange(date, endDate)) {
    const err = new Error("Date outside subscription validity");
    err.code = "INVALID_DATE";
    throw err;
  }
}

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    throw err;
  }
  const endDate = subscription.validityEndDate || subscription.endDate;
  if (endDate) {
    const endStr = dateUtils.toKSADateString(endDate);
    const compareTo = dateStr || dateUtils.getTodayKSADate();
    if (compareTo > endStr) {
      const err = new Error("Subscription expired");
      err.code = "SUB_EXPIRED";
      throw err;
    }
  }
}

function buildDateRangeFromStartAndEndOrThrow(startDate, endDate) {
  if (!startDate || !dateUtils.isValidKSADateString(startDate)) {
    const err = new Error("Invalid startDate");
    err.code = "INVALID_DATE";
    throw err;
  }
  if (!endDate || !dateUtils.isValidKSADateString(endDate)) {
    const err = new Error("Invalid endDate");
    err.code = "INVALID_DATE";
    throw err;
  }
  if (!dateUtils.isOnOrAfterKSADate(endDate, startDate)) {
    const err = new Error("endDate must be on or after startDate");
    err.code = "INVALID_DATE";
    throw err;
  }

  const targetDates = [];
  for (let current = startDate; ; current = addDaysToKSADateString(current, 1)) {
    targetDates.push(current);
    if (current === endDate) {
      break;
    }
  }
  return targetDates;
}

function resolveSkipRangeInputOrThrow({ startDate, days, endDate }) {
  const hasDays = days !== undefined && days !== null && String(days).trim() !== "";
  const hasEndDate = endDate !== undefined && endDate !== null && String(endDate).trim() !== "";

  if (!hasDays && !hasEndDate) {
    const err = new Error("Either days or endDate is required");
    err.code = "INVALID";
    throw err;
  }

  let targetDates;
  if (hasEndDate) {
    targetDates = buildDateRangeFromStartAndEndOrThrow(startDate, String(endDate).trim());
    if (hasDays) {
      const expectedDays = parseInt(days, 10);
      if (!expectedDays || expectedDays <= 0 || expectedDays !== targetDates.length) {
        const err = new Error("days must match the inclusive range from startDate to endDate");
        err.code = "INVALID";
        throw err;
      }
    }
  } else {
    targetDates = buildDateRangeOrThrow(startDate, days);
  }

  return {
    startDate,
    endDate: targetDates[targetDates.length - 1],
    days: targetDates.length,
    targetDates,
  };
}

function sendValidationError(res, message) {
  // MEDIUM AUDIT FIX: Normalize client input failures under a controlled 400 VALIDATION_ERROR response shape.
  return errorResponse(res, 400, "VALIDATION_ERROR", message);
}

async function writeLogSafely(payload, context = {}) {
  try {
    await writeLog(payload);
  } catch (err) {
    logger.error("Activity log write failed", {
      error: err.message,
      stack: err.stack,
      action: payload && payload.action ? payload.action : undefined,
      entityType: payload && payload.entityType ? payload.entityType : undefined,
      entityId: payload && payload.entityId ? String(payload.entityId) : undefined,
      ...context,
    });
  }
}

function parsePremiumCount(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function hasDeliveryAddressOverride(day) {
  return Boolean(day && day.deliveryAddressOverride && Object.keys(day.deliveryAddressOverride).length > 0);
}

function hasDeliveryWindowOverride(day) {
  return Boolean(day && day.deliveryWindowOverride);
}

async function quoteSubscription(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides
    ? { resolveCheckoutQuoteOrThrow: runtimeOverrides.resolveCheckoutQuoteOrThrow || resolveCheckoutQuoteOrThrow }
    : { resolveCheckoutQuoteOrThrow };
  try {
    const lang = getRequestLang(req);
    const quote = await runtime.resolveCheckoutQuoteOrThrow(req.body || {}, {
      lang,
      userId: req.userId,
      useGenericPremiumWallet:
        isPhase2GenericPremiumWalletEnabled()
        && isPhase1CanonicalCheckoutDraftWriteEnabled(),
      allowMissingDeliveryAddress: true,
    });
    return res.status(200).json({
      status: true,
      data: {
        breakdown: quote.breakdown,
        totalSar: quote.breakdown.totalHalala / 100,
        pricingSummary: buildMoneySummary({
          basePriceHalala: quote.breakdown.subtotalHalala || 0,
          vatPercentage: quote.breakdown.vatPercentage || 0,
          vatHalala: quote.breakdown.vatHalala || 0,
          totalPriceHalala: quote.breakdown.totalHalala || 0,
          currency: quote.breakdown.currency || SYSTEM_CURRENCY,
        }),
        promoCode: buildPromoResponseBlock(quote.promoCode || null),
        summary: resolveQuoteSummary(quote, lang),
        premiumItemCount: Array.isArray(quote.premiumItems) ? quote.premiumItems.length : 0,
      },
    });
  } catch (err) {
    if (String(err.code || "").startsWith("PROMO_")) {
      return errorResponse(res, err.status || 400, err.code, err.message, {
        promoErrorCode: err.code,
        promoErrorMessage: err.message,
      });
    }
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "RECURRING_ADDON_CATEGORY_CONFLICT") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (err.code === "INVALID_SELECTION") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    throw err;
  }
}

async function checkoutSubscription(req, res, runtimeOverrides = null) {
  try {
    const body = req.body || {};
    const idempotencyKey = parseIdempotencyKey(
      req.get("Idempotency-Key")
      || req.get("X-Idempotency-Key")
      || body.idempotencyKey
    );
    if (!idempotencyKey) {
      return sendValidationError(
        res,
        "idempotencyKey is required (Idempotency-Key header, X-Idempotency-Key header, or body.idempotencyKey)"
      );
    }
    const lang = getRequestLang(req);
    const result = await performSubscriptionCheckout(req.userId, idempotencyKey, body, lang, runtimeOverrides);
    return res.status(result.status || 200).json(result);
  } catch (err) {
    if (String(err.code || "").startsWith("PROMO_")) {
      return errorResponse(res, err.status || 400, err.code, err.message, {
        promoErrorCode: err.code,
        promoErrorMessage: err.message,
      });
    }
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (err.code === "INVALID_SELECTION") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    if (err.code === "INVALID_PREMIUM_ITEM" || err.code === "UNKNOWN_PREMIUM_KEY") {
      return errorResponse(res, 422, "INVALID_PREMIUM_ITEM", err.message);
    }
    if (err.status === 409 && err.code === "IDEMPOTENCY_CONFLICT") {
      return errorResponse(res, 409, "IDEMPOTENCY_CONFLICT", err.message);
    }
    if (err.status === 400 && err.code === "CHECKOUT_FAILED") {
      return errorResponse(res, 400, "CHECKOUT_FAILED", err.message);
    }
    logger.error("Subscription checkout failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", `Checkout failed: ${err.message}`);
  }
}

async function getCheckoutDraftStatus(req, res) {
  const { draftId } = req.params;
  const lang = getRequestLang(req);
  try {
    validateObjectId(draftId, "draftId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    let { draft, payment, invoice } = await reconcileCheckoutDraft(draftId, { mode: RECONCILE_MODES.READ_ONLY });
    if (!draft) {
      return errorResponse(res, 404, "NOT_FOUND", "Checkout draft not found");
    }
    if (String(draft.userId) !== String(req.userId)) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    if (
      draft.status === "pending_payment"
      && payment
      && String(payment.status).trim().toLowerCase() === "paid"
      && payment.applied !== true
    ) {
      const autoFinalizeResult = await autoFinalizePaidCheckoutDraft({ draft, payment, providerInvoice: invoice });
      if (autoFinalizeResult.applied || autoFinalizeResult.reason) {
        const reconciled = await reconcileCheckoutDraft(draftId, { mode: RECONCILE_MODES.PERSIST });
        draft = reconciled.draft;
        payment = reconciled.payment;
        invoice = reconciled.invoice;
      }
    }

    return res.status(200).json({
      status: true,
      data: localizeCheckoutDraftStatusReadPayload({
        ...buildSubscriptionCheckoutStatusPayload({ draft, payment, providerInvoice: invoice }),
        checkedProvider: Boolean(invoice),
        synchronized: ["completed", "failed", "canceled", "expired"].includes(draft.status),
      }, { lang, draft }),
    });
  } catch (err) {
    logger.error("Failed to get checkout draft status", { draftId, error: err.message });
    return errorResponse(res, 500, "INTERNAL", "Failed to get checkout draft status");
  }
}

async function verifyCheckoutDraftPayment(req, res, runtimeOverrides = null) {
  const getInvoiceFn = runtimeOverrides && runtimeOverrides.getInvoice
    ? runtimeOverrides.getInvoice
    : getInvoice;
  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => mongoose.startSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;
  const finalizeSubscriptionDraftPaymentFn = runtimeOverrides && runtimeOverrides.finalizeSubscriptionDraftPayment
    ? runtimeOverrides.finalizeSubscriptionDraftPayment
    : finalizeSubscriptionDraftPayment;

  const { draftId } = req.params;
  const lang = getRequestLang(req);
  try {
    validateObjectId(draftId, "draftId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const {
    draft,
    payment,
    invoice: providerInvoice,
  } = await reconcileCheckoutDraft(draftId, {
    mode: RECONCILE_MODES.PERSIST,
    getInvoiceFn,
  });

  if (!draft) {
    return errorResponse(res, 404, "NOT_FOUND", "Checkout draft not found");
  }
  if (String(draft.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  // Idempotency: Handle terminal states immediately
  if (["completed", "failed", "canceled", "expired"].includes(draft.status)) {
    const payload = buildSubscriptionCheckoutStatusPayload({
      draft,
      payment,
      providerInvoice,
    });
    return res.status(200).json({
      status: true,
      data: localizeWriteCheckoutStatusPayload({
        ...payload,
        checkedProvider: Boolean(providerInvoice),
        synchronized: true,
      }, { lang, draft }),
    });
  }

  if (!payment) {
    return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "Checkout payment is not initialized yet");
  }
  if (!["subscription_activation", "subscription_renewal"].includes(payment.type)) {
    return errorResponse(res, 409, "INVALID", "Payment does not belong to a subscription checkout");
  }

  if (!providerInvoice) {
    return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "Checkout invoice is not initialized yet");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    return errorResponse(res, 409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }

  const session = await startSessionFn();
  let synchronized = false;
  try {
    session.startTransaction();

    const draftInSession = await CheckoutDraft.findOne({ _id: draftId, userId: req.userId }).session(session);
    if (!draftInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Checkout draft not found");
    }

    let paymentInSession = await Payment.findOne({ _id: payment._id, userId: req.userId }).session(session);
    if (!paymentInSession && draftInSession.paymentId) {
      paymentInSession = await Payment.findOne({ _id: draftInSession.paymentId, userId: req.userId }).session(session);
    }
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Payment not found");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
    if (providerInvoiceId && draftInSession.providerInvoiceId && String(draftInSession.providerInvoiceId) !== providerInvoiceId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
    }
    if (providerInvoiceId && paymentInSession.providerInvoiceId && String(paymentInSession.providerInvoiceId) !== providerInvoiceId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
    }

    if (providerPayment && providerPayment.id && paymentInSession.providerPaymentId && String(paymentInSession.providerPaymentId) !== String(providerPayment.id)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch");
    }

    const providerAmount = Number(providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount);
    if (Number.isFinite(providerAmount) && providerAmount !== Number(paymentInSession.amount)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch");
    }

    const providerCurrency = normalizeCurrencyValue(
      providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency
    );
    if (providerCurrency !== normalizeCurrencyValue(paymentInSession.currency)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch");
    }

    if (providerInvoiceId && !draftInSession.providerInvoiceId) {
      draftInSession.providerInvoiceId = providerInvoiceId;
      await draftInSession.save({ session });
    }
    if (providerInvoiceId && !paymentInSession.providerInvoiceId) {
      paymentInSession.providerInvoiceId = providerInvoiceId;
    }
    if (providerPayment && providerPayment.id && !paymentInSession.providerPaymentId) {
      paymentInSession.providerPaymentId = String(providerPayment.id);
    }

    paymentInSession.status = normalizedStatus;
    if (normalizedStatus === "paid" && !paymentInSession.paidAt) {
      paymentInSession.paidAt = new Date();
    }
    await paymentInSession.save({ session });

    const terminalFailureStatuses = new Set(["failed", "canceled", "expired"]);
    if (normalizedStatus !== "paid") {
      if (
        terminalFailureStatuses.has(normalizedStatus)
        && !draftInSession.subscriptionId
        && ["pending_payment", "failed", "canceled", "expired"].includes(draftInSession.status)
      ) {
        draftInSession.status = normalizedStatus === "canceled"
          ? "canceled"
          : normalizedStatus === "expired"
            ? "expired"
            : "failed";
        draftInSession.failedAt = new Date();
        draftInSession.failureReason = `payment_${draftInSession.status}`;
        await draftInSession.save({ session });
        synchronized = true;
      }

      await session.commitTransaction();
      session.endSession();

      const [latestDraft, latestPayment] = await Promise.all([
        CheckoutDraft.findById(draftId).lean(),
        Payment.findById(paymentInSession._id).lean(),
      ]);

      const payload = {
        ...buildSubscriptionCheckoutStatusPayload({
          draft: latestDraft,
          payment: latestPayment,
          providerInvoice,
        }),
        checkedProvider: true,
        synchronized,
      };
      return res.status(200).json({
        status: true,
        data: localizeWriteCheckoutStatusPayload(payload, { lang, draft: latestDraft }),
      });
    }

    if (!paymentInSession.applied) {
      // Atomic guard: exactly one process can transition applied from false to true
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );

      if (claimedPayment) {
        // We are the winner of the race. Apply side effects.
        const result = isPhase1SharedPaymentDispatcherEnabled()
          ? await applyPaymentSideEffectsFn({
            payment: claimedPayment,
            session,
            source: "client_manual_verify",
          })
          : await finalizeSubscriptionDraftPaymentFn({
            draft: draftInSession,
            payment: claimedPayment,
            session,
          });
        if (!result.applied) {
          const metadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: result.reason });
          await Payment.updateOne(
            { _id: claimedPayment._id },
            { $set: { applied: true, status: "paid", metadata } },
            { session }
          );
        } else {
          synchronized = true;
        }
      } else {
        // We lost the race or it was already applied.
        // We will proceed to commit and re-read the state below to return the final result.
        logger.debug("Subscription checkout verify: payment already applied or race lost", { draftId, paymentId: String(payment._id) });
        synchronized = true;
      }
    } else {
      synchronized = true;
    }

    await session.commitTransaction();
    session.endSession();

    const [latestDraft, latestPayment] = await Promise.all([
      CheckoutDraft.findById(draftId).lean(),
      Payment.findById(paymentInSession._id).lean(),
    ]);

    const payload = {
      ...buildSubscriptionCheckoutStatusPayload({
        draft: latestDraft,
        payment: latestPayment,
        providerInvoice,
      }),
      checkedProvider: true,
      synchronized,
    };

    return res.status(200).json({
      status: true,
      data: localizeWriteCheckoutStatusPayload(payload, { lang, draft: latestDraft }),
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("Subscription checkout verification failed", {
      draftId,
      paymentId: String(payment._id),
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Checkout verification failed");
  }
}

async function activateSubscription(req, res) {
  // DEV-ONLY: Simulates webhook payment activation for a CheckoutDraft.
  // Accepts either a draftId (preferred) OR a legacy subscriptionId (falls back to old path).
  if (process.env.NODE_ENV === "production") {
    return errorResponse(res, 403, "FORBIDDEN", "Mock activation is disabled in production");
  }

  const { id } = req.params;
  const lang = getRequestLang(req);

  let draft = null;

  // First: try to find the draft directly (id = draftId)
  try {
    validateObjectId(id, "id");
    draft = await CheckoutDraft.findOne({ _id: id, userId: req.userId });
  } catch (_) {
    draft = null;
  }

  // Fallback: try finding the draft linked to a subscription (legacy path)
  if (!draft) {
    draft = await CheckoutDraft.findOne({ subscriptionId: id, userId: req.userId }).sort({ createdAt: -1 });
  }

  // If no draft found, try the old direct-subscription mock as last resort
  if (!draft) {
    const sub = await Subscription.findById(id).populate("planId");
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription or draft not found");
    if (sub.userId.toString() !== req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    if (sub.status === "active") {
      return res.status(200).json({ status: true, data: await serializeSubscriptionForClient(sub, lang) });
    }
    sub.status = "active";
    const start = new Date(sub.startDate);
    if (sub.planId && sub.planId.daysCount) {
      sub.endDate = addDays(start, sub.planId.daysCount - 1);
      sub.validityEndDate = sub.endDate;
    }
    await sub.save();
    return res.status(200).json({ status: true, data: await serializeSubscriptionForClient(sub, lang) });
  }

  if (String(draft.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  // If draft already has a subscriptionId, return the existing subscription
  if (draft.subscriptionId) {
    const existingSub = await Subscription.findById(draft.subscriptionId).lean();
    if (existingSub) {
      return res.status(200).json({ status: true, data: await serializeSubscriptionForClient(existingSub, lang) });
    }
  }

  if (!["pending_payment", "failed"].includes(draft.status)) {
    return errorResponse(res, 409, "INVALID_DRAFT_STATUS", `Draft status is '${draft.status}', cannot activate`);
  }

  // Find or create a mock payment for the draft
  let payment = draft.paymentId ? await Payment.findById(draft.paymentId) : null;
  if (!payment) {
    payment = await Payment.findOne({ "metadata.draftId": String(draft._id) }).sort({ createdAt: -1 });
  }
  if (!payment) {
    return errorResponse(res, 409, "NO_PAYMENT", "No payment found for this draft. Complete checkout first.");
  }

  // Simulate the canonical webhook activation path
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const draftInSession = await CheckoutDraft.findById(draft._id).session(session);
    const paymentInSession = await Payment.findById(payment._id).session(session);

    if (!draftInSession || !paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Draft or payment not found in session");
    }

    // Simulate payment being marked as paid
    paymentInSession.status = "paid";
    paymentInSession.paidAt = paymentInSession.paidAt || new Date();
    if (!paymentInSession.applied) {
      paymentInSession.applied = true;
    }
    await paymentInSession.save({ session });

    // Run the real canonical activation
    const result = await finalizeSubscriptionDraftPaymentFlow(
      { draft: draftInSession, payment: paymentInSession, session }
    );

    if (!result.applied) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 500, "ACTIVATION_FAILED", `Activation not applied: ${result.reason}`);
    }

    await session.commitTransaction();
    session.endSession();

    const activatedSub = await Subscription.findById(result.subscriptionId).lean();
    if (!activatedSub) {
      return errorResponse(res, 500, "INTERNAL", "Subscription not found after activation");
    }

    return res.status(200).json({
      status: true,
      data: await serializeSubscriptionForClient(activatedSub, lang),
    });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    logger.error("Mock activateSubscription failed", { error: err.message, stack: err.stack, draftId: String(draft._id) });
    return errorResponse(res, 500, "INTERNAL", `Mock activation failed: ${err.message}`);
  }
}


async function getSubscription(req, res) {
  const { id } = req.params;
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const lang = getRequestLang(req);

  return res.status(200).json({
    status: true,
    data: await serializeSubscriptionForClient(sub, lang),
  });
}

async function getCurrentSubscriptionOverview(req, res) {
  const userId = req.userId;
  const lang = getRequestLang(req);

  try {
    const result = await buildCurrentSubscriptionOverview({ userId, lang });
    return res.status(200).json({
      status: true,
      data: serializeForApi(result.data)
    });
  } catch (err) {
    logger.error("subscriptionController.getCurrentSubscriptionOverview failed", {
      error: err.message,
      stack: err.stack,
      userId: userId ? String(userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL_CURRENT_OVERVIEW", "Failed to retrieve current subscription");
  }
}

async function cancelSubscription(req, res, runtimeOverrides = null) {
  const { id } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await performClientSubscriptionCancellation({
    subscriptionId: id,
    userId: req.userId,
    lang: getRequestLang(req),
    runtime: runtimeOverrides,
  });

  if (result.kind === "error") {
    return errorResponse(res, result.status, result.code, result.message);
  }

  return res.status(result.status || 200).json(result.body);
}

async function getSubscriptionOperationsMeta(req, res, runtimeOverrides = null) {
  const { id } = req.params;
  const runtime = resolveOperationsMetaRuntime(runtimeOverrides);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const result = await runtime.buildSubscriptionOperationsMeta({
      subscriptionId: id,
      actor: { kind: "client", userId: req.userId },
    });

    if (result.outcome === "not_found") {
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (result.outcome === "forbidden") {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    if (result.outcome !== "success") {
      logger.error("subscriptionController.getSubscriptionOperationsMeta received unsupported outcome", {
        outcome: result.outcome,
        subscriptionId: id,
        userId: req.userId ? String(req.userId) : undefined,
      });
      return errorResponse(res, 500, "INTERNAL", "Failed to load operations metadata");
    }

    return res.status(200).json({
      status: true,
      data: result.data,
    });
  } catch (err) {
    logger.error("subscriptionController.getSubscriptionOperationsMeta failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: id,
      userId: req.userId ? String(req.userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL", "Failed to load operations metadata");
  }
}

async function getSubscriptionFreezePreview(req, res, runtimeOverrides = null) {
  const { id } = req.params;
  const { startDate, days } = req.query || {};
  const runtime = resolveFreezePreviewRuntime(runtimeOverrides);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    const result = await runtime.buildFreezePreview({
      subscriptionId: id,
      actor: { kind: "client", userId: req.userId },
      startDate,
      days,
    });

    if (result.outcome === "not_found") {
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (result.outcome === "forbidden") {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    if (result.outcome === "error") {
      return errorResponse(res, result.status, result.code, result.message);
    }
    if (result.outcome !== "success") {
      logger.error("subscriptionController.getSubscriptionFreezePreview received unsupported outcome", {
        outcome: result.outcome,
        subscriptionId: id,
        userId: req.userId ? String(req.userId) : undefined,
      });
      return errorResponse(res, 500, "INTERNAL", "Failed to build freeze preview");
    }

    return res.status(200).json({
      status: true,
      data: result.data,
    });
  } catch (err) {
    logger.error("subscriptionController.getSubscriptionFreezePreview failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: id,
      userId: req.userId ? String(req.userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL", "Failed to build freeze preview");
  }
}

async function getSubscriptionPaymentMethods(_req, res) {
  return res.status(200).json({
    status: true,
    data: {
      supported: false,
      canManage: false,
      provider: "moyasar",
      mode: "invoice_only",
      reasonCode: "PROVIDER_TOKENIZATION_UNAVAILABLE",
      methods: [],
    },
  });
}

async function getSubscriptionTimeline(req, res) {
  const { id } = req.params;
  const lang = getRequestLang(req);
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }

  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  const timeline = await buildSubscriptionTimeline(id);

  return res.status(200).json({
    status: true,
    data: localizeTimelineReadPayload(timeline, lang),
  });
}

async function listCurrentUserSubscriptions(req, res) {
  const subscriptions = await Subscription.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  const lang = getRequestLang(req);
  const data = await Promise.all(subscriptions.map((subscription) => serializeSubscriptionForClient(subscription, lang)));
  return res.status(200).json({ status: true, data });
}

async function getSubscriptionRenewalSeed(req, res, runtimeOverrides = null) {
  const defaultRuntime = {
    async findSubscriptionById(subscriptionId) {
      return Subscription.findById(subscriptionId).lean();
    },
    async findActivePlanById(planId) {
      return Plan.findOne({ _id: planId, isActive: true }).lean();
    },
    buildSubscriptionRenewalSeed: (...args) => buildSubscriptionRenewalSeed(...args),
  };
  const runtime = runtimeOverrides ? { ...defaultRuntime, ...runtimeOverrides } : defaultRuntime;
  const lang = getRequestLang(req);

  const { id } = req.params;
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const previousSubscription = await runtime.findSubscriptionById(id);
  if (!previousSubscription) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(previousSubscription.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  const candidatePlanId = previousSubscription.contractSnapshot
    && previousSubscription.contractSnapshot.plan
    && previousSubscription.contractSnapshot.plan.planId
    ? previousSubscription.contractSnapshot.plan.planId
    : previousSubscription.planId;

  if (!candidatePlanId) {
    return errorResponse(res, 422, "RENEWAL_UNAVAILABLE", "Subscription does not have enough base configuration to renew");
  }

  const livePlan = await runtime.findActivePlanById(candidatePlanId);

  try {
    const renewalSeed = runtime.buildSubscriptionRenewalSeed({
      previousSubscription,
      livePlan,
    });
    return res.status(200).json({
      status: true,
      data: localizeRenewalSeedReadPayload(renewalSeed, {
        lang,
        livePlan,
        previousSubscription,
      }),
    });
  } catch (err) {
    return errorResponse(
      res,
      422,
      err && err.code ? err.code : "RENEWAL_UNAVAILABLE",
      err && err.message ? err.message : "Renewal is not available for this subscription"
    );
  }
}

async function renewSubscription(req, res, runtimeOverrides = null) {
  const { id } = req.params;
  const body = req.body || {};
  const lang = getRequestLang(req);

  // Parse idempotency key from headers or body
  body.idempotencyKey = req.get("Idempotency-Key") || req.get("X-Idempotency-Key") || body.idempotencyKey;

  try {
    const result = await performSubscriptionRenewal(req.userId, id, body, lang, runtimeOverrides);
    return res.status(result.status).json({ status: true, data: result.data });
  } catch (err) {
    if (err.data) {
      return errorResponse(res, err.status, err.code, err.message, err.data);
    }
    return errorResponse(res, err.status, err.code, err.message);
  }
}

async function createPremiumOverageDayPayment(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  const { id, date } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const result = await createPremiumOverageDayPaymentFlow({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    headers: req.headers || {},
    body: req.body || {},
    runtime,
    ensureActiveFn: ensureActive,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    assertTomorrowCutoffAllowedFn: assertTomorrowCutoffAllowed,
    cutoffAction: CUTOFF_ACTIONS.MEAL_PLANNER_PREMIUM_OVERAGE_PAYMENT,
    isEligibleForDayFn: isCanonicalGenericPremiumOverageEligibleForDay,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function createPremiumExtraDayPayment(req, res, runtimeOverrides = null) {
  const { id, date } = req.params;
  try {
    const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
    validateObjectId(id, "subscriptionId");
    const result = await createPremiumExtraDayPaymentFlow({
      subscriptionId: id,
      date,
      userId: req.userId,
      lang: getRequestLang(req),
      headers: req.headers || {},
      body: req.body || {},
      runtime,
      ensureActiveFn: ensureActive,
      validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    });
    if (!result.ok) {
      return errorResponse(res, result.status, result.code, result.message, result.details);
    }
    return res.status(result.status).json({ status: true, data: result.data });
  } catch (err) {
    logger.error("Premium extra payment initiation: unexpected error", { error: err.message, stack: err.stack, subscriptionId: id, date });
    if (err.status && err.code) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "An unexpected error occurred during payment initiation");
  }
}

async function verifyPremiumExtraDayPayment(req, res, runtimeOverrides = null) {
  const { id, date, paymentId } = req.params;
  const getInvoiceFn = runtimeOverrides && runtimeOverrides.getInvoice
    ? runtimeOverrides.getInvoice
    : getInvoice;

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(paymentId, "paymentId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const result = await verifyPremiumExtraDayPaymentFlow({
    subscriptionId: id,
    date,
    paymentId,
    userId: req.userId,
    getInvoiceFn,
    writeLogFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function verifyPremiumOverageDayPayment(req, res, runtimeOverrides = null) {
  const { id, date, paymentId } = req.params;
  const lang = getRequestLang(req);
  const getInvoiceFn = runtimeOverrides && runtimeOverrides.getInvoice
    ? runtimeOverrides.getInvoice
    : getInvoice;
  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => mongoose.startSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(paymentId, "paymentId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await verifyPremiumOverageDayPaymentFlow({
    subscriptionId: id,
    date,
    paymentId,
    userId: req.userId,
    getInvoiceFn,
    startSessionFn,
    applyPaymentSideEffectsFn,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({
    status: true,
    data: localizeWritePremiumOverageStatusPayload(result.data, { lang }),
  });
}

async function createOneTimeAddonDayPlanningPayment(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  const { id, date } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await createOneTimeAddonDayPlanningPaymentFlow({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    headers: req.headers || {},
    body: req.body || {},
    runtime,
    ensureActiveFn: ensureActive,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    assertTomorrowCutoffAllowedFn: assertTomorrowCutoffAllowed,
    cutoffAction: CUTOFF_ACTIONS.ONE_TIME_ADDON_LOGISTICS_CHANGE,
    isEligibleForDayFn: isCanonicalOneTimeAddonPlanningPaymentEligibleForDay,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function verifyOneTimeAddonDayPlanningPayment(req, res, runtimeOverrides = null) {
  const { id, date, paymentId } = req.params;
  const lang = getRequestLang(req);
  const getInvoiceFn = runtimeOverrides && runtimeOverrides.getInvoice
    ? runtimeOverrides.getInvoice
    : getInvoice;
  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => mongoose.startSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;

  try {
    validateObjectId(id, "subscriptionId");
    if (paymentId !== undefined) {
      validateObjectId(paymentId, "paymentId");
    }
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await verifyOneTimeAddonDayPlanningPaymentFlow({
    subscriptionId: id,
    date,
    paymentId,
    userId: req.userId,
    lang,
    getInvoiceFn,
    startSessionFn,
    applyPaymentSideEffectsFn,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function freezeSubscription(req, res) {
  const { id } = req.params;
  const { startDate, days } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const result = await freezeSubscriptionForClient({
    subscriptionId: id,
    startDate,
    days,
    userId: req.userId,
    ensureActiveFn: ensureActive,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    writeLogSafelyFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function unfreezeSubscription(req, res) {
  const { id } = req.params;
  const { startDate, days } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const result = await unfreezeSubscriptionForClient({
    subscriptionId: id,
    startDate,
    days,
    userId: req.userId,
    ensureActiveFn: ensureActive,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    writeLogSafelyFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function getSubscriptionDays(req, res) {
  const { id } = req.params;
  const lang = getRequestLang(req);
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const days = await SubscriptionDay.find({ subscriptionId: id }).sort({ date: 1 }).lean();
  const serializedDays = days.map((day) => serializeSubscriptionDayForClient(sub, day));
  const catalog = await loadWalletCatalogMaps({ days: serializedDays, lang });
  const mappedDays = serializedDays.map((day) => shapeMealPlannerReadFields({
    subscription: sub,
    day: localizeSubscriptionDayReadPayload(day, {
      lang,
      addonNames: catalog.addonNames,
    }),
    lang,
  }));
  return res.status(200).json({ status: true, data: mappedDays });
}

async function getSubscriptionDay(req, res) {
  const { id, date } = req.params;
  const lang = getRequestLang(req);
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found");
  }
  const serializedDay = serializeSubscriptionDayForClient(sub, day);
  const catalog = await loadWalletCatalogMaps({ days: [serializedDay], lang });
  const localizedDay = localizeSubscriptionDayReadPayload(serializedDay, {
    lang,
    addonNames: catalog.addonNames,
  });
  return res.status(200).json({
    status: true,
    data: shapeMealPlannerReadFields({
      subscription: sub,
      day: localizedDay,
      lang,
    }),
  });
}

async function getSubscriptionToday(req, res) {
  const { id } = req.params;
  const lang = getRequestLang(req);
  // MEDIUM AUDIT FIX: Validate ObjectId up front to return 400 INVALID_ID instead of CastError 500.
  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const today = await getRestaurantBusinessDate();
  const day = await SubscriptionDay.findOne({ subscriptionId: id, date: today }).lean();
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found");
  }
  const serializedDay = serializeSubscriptionDayForClient(sub, day);
  const catalog = await loadWalletCatalogMaps({ days: [serializedDay], lang });
  const localizedDay = localizeSubscriptionDayReadPayload(serializedDay, {
    lang,
    addonNames: catalog.addonNames,
  });
  return res.status(200).json({
    status: true,
    data: shapeMealPlannerReadFields({
      subscription: sub,
      day: localizedDay,
      lang,
    }),
  });
}

async function updateDaySelection(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceP2S1DefaultRuntime, ...runtimeOverrides } : sliceP2S1DefaultRuntime;
  const { id } = req.params;
  const date = resolveRequestedDate(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await updateDaySelectionForClient({
    subscriptionId: id,
    date,
    body: req.body || {},
    userId: req.userId,
    lang: getRequestLang(req),
    runtime,
    writeLogSafelyFn: writeLogSafely,
    loadWalletCatalogMapsSafelyFn: loadWalletCatalogMapsSafely,
    logWalletIntegrityErrorFn: logWalletIntegrityError,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  const payload = { status: true, data: result.data };
  if (result.idempotent) {
    payload.idempotent = true;
  }
  return res.status(result.status).json(payload);
}

async function validateDaySelection(req, res) {
  const { id } = req.params;
  const date = resolveRequestedDate(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await validateDaySelectionForClient({
    subscriptionId: id,
    date,
    mealSlots: req.body && req.body.mealSlots,
    requestedOneTimeAddonIds:
      req.body && req.body.addonsOneTime !== undefined
        ? req.body.addonsOneTime
        : (req.body && req.body.oneTimeAddonSelections),
    userId: req.userId,
    lang: getRequestLang(req),
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function updateBulkDaySelections(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceP2S1DefaultRuntime, ...runtimeOverrides } : sliceP2S1DefaultRuntime;
  const { id } = req.params;
  const requests = resolveBulkDaySelectionRequests(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  if (!requests.length) {
    return errorResponse(res, 400, "INVALID", "days or dates array is required");
  }

  const dates = requests.map((entry) => String(entry.date || ""));
  if (dates.some((date) => !date)) {
    return errorResponse(res, 400, "INVALID", "Each day entry must include date");
  }

  const uniqueDates = new Set(dates);
  if (uniqueDates.size !== requests.length) {
    return errorResponse(res, 400, "INVALID", "Bulk selection request must not contain duplicate dates");
  }
  const result = await updateBulkDaySelectionsForClient({
    subscriptionId: id,
    requests,
    userId: req.userId,
    lang: getRequestLang(req),
    runtime,
    writeLogSafelyFn: writeLogSafely,
    loadWalletCatalogMapsSafelyFn: loadWalletCatalogMapsSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function confirmDayPlanning(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceP2S1DefaultRuntime, ...runtimeOverrides } : sliceP2S1DefaultRuntime;
  const { id, date } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await confirmDayPlanningForClient({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    runtime,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    writeLogSafelyFn: writeLogSafely,
    loadWalletCatalogMapsSafelyFn: loadWalletCatalogMapsSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({
    status: true,
    success: true,
    plannerState: result.plannerState,
    data: result.data,
  });
}

async function skipDay(req, res) {
  const { id } = req.params;
  const date = resolveRequestedDate(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await skipDayForClient({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    ensureActiveFn: ensureActive,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    writeLogSafelyFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function unskipDay(req, res) {
  const { id, date } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  const result = await unskipDayForClient({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    ensureActiveFn: ensureActive,
    validateFutureDateOrThrowFn: validateFutureDateOrThrow,
    writeLogSafelyFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function skipRange(req, res) {
  const { id } = req.params;
  const { startDate, days, endDate } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  let rangeRequest;
  try {
    rangeRequest = resolveSkipRangeInputOrThrow({ startDate, days, endDate });
  } catch (err) {
    return errorResponse(res, 400, err.code || "INVALID", err.message);
  }
  const result = await skipRangeForClient({
    subscriptionId: id,
    rangeRequest,
    userId: req.userId,
    lang: getRequestLang(req),
    writeLogSafelyFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function consumePremiumSelection(req, res) {
  return errorResponse(
    res,
    422,
    "LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED",
    "Premium helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
  );
}

async function removePremiumSelection(req, res) {
  return errorResponse(
    res,
    422,
    "LEGACY_PREMIUM_SELECTION_ENDPOINT_UNSUPPORTED",
    "Premium helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
  );
}

async function consumeAddonSelection(req, res) {
  return errorResponse(
    res,
    422,
    "LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED",
    "Addon helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
  );
}

async function removeAddonSelection(req, res) {
  return errorResponse(
    res,
    422,
    "LEGACY_ADDON_SELECTION_ENDPOINT_UNSUPPORTED",
    "Addon helper endpoint is no longer supported. Submit canonical mealSlots via /days/:date/selection."
  );
}

async function addOneTimeAddon(_req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  try {
    const { id } = _req.params;
    const { addonId, date, successUrl, backUrl } = _req.body || {};
    const result = await createLegacyOneTimeAddonPaymentFlow({
      subscriptionId: id,
      addonId,
      date,
      userId: _req.userId,
      lang: getRequestLang(_req),
      successUrl,
      backUrl,
      headers: _req.headers || {},
      body: _req.body || {},
      runtime,
      ensureActiveFn: ensureActive,
      validateFutureDateOrThrowFn: validateFutureDateOrThrow,
      assertTomorrowCutoffAllowedFn: assertTomorrowCutoffAllowed,
      cutoffAction: CUTOFF_ACTIONS.ONE_TIME_ADDON_LOGISTICS_CHANGE,
      validateRedirectUrlFn: validateRedirectUrl,
    });
    if (!result.ok) {
      return errorResponse(res, result.status, result.code, result.message, result.details);
    }
    return res.status(result.status).json({ status: true, data: result.data });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    logger.error("Addon error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Addon purchase failed");
  }
}

async function preparePickup(req, res) {
  const { id, date } = req.params;
  const result = await preparePickupForClient({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    ensureActiveFn: ensureActive,
    getRestaurantHoursSettingsFn: getRestaurantHours,
    validateDayBeforeLockOrPrepareFn: validateDayBeforeLockOrPrepare,
    resolveDayExecutionValidationErrorStatusFn: resolveDayExecutionValidationErrorStatus,
    lockDaySnapshotFn: lockDaySnapshot,
    writeLogSafelyFn: writeLogSafely,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function getPickupStatus(req, res) {
  const { id, date } = req.params;
  const result = await getPickupStatusForClient({
    subscriptionId: id,
    date,
    userId: req.userId,
    lang: getRequestLang(req),
    ensureActiveFn: ensureActive,
    getRestaurantHoursSettingsFn: getRestaurantHours,
  });
  if (!result.ok) {
    return errorResponse(res, result.status, result.code, result.message, result.details);
  }
  return res.status(result.status).json({ status: true, data: result.data });
}

async function updateDeliveryDetails(req, res, runtimeOverrides = null) {
  const { id } = req.params;
  const lang = getRequestLang(req);

  try {
    const result = await performDeliveryDetailsUpdate({
      userId: req.userId,
      subscriptionId: id,
      payload: req.body || {},
      lang,
      runtimeOverrides,
    });

    await writeLogSafely({
      entityType: "subscription",
      entityId: result.sub._id,
      action: "delivery_update",
      byUserId: req.userId,
      byRole: "client",
      meta: result.logMeta,
    }, { subscriptionId: id });

    return res.status(200).json({
      status: true,
      data: localizeWriteSubscriptionPayload(result.sub.toObject ? result.sub.toObject() : result.sub, { lang }),
    });
  } catch (err) {
    if (err.status && err.code) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    logger.error("Delivery update failed", { subscriptionId: id, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery update failed");
  }
}

async function updateDeliveryDetailsForDate(req, res) {
  const { id, date } = req.params;
  const { deliveryAddress, deliveryWindow } = req.body || {};
  const lang = getRequestLang(req);
  if (deliveryAddress === undefined && deliveryWindow === undefined) {
    return errorResponse(res, 400, "INVALID", "Missing delivery update fields");
  }

  try {
    const result = await performDeliveryDetailsUpdateForDate({
      userId: req.userId,
      subscriptionId: id,
      date,
      payload: req.body || {},
      lang,
    });

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: String(result.subscriptionId),
      action: "delivery_update_day",
      byUserId: req.userId,
      byRole: "client",
      meta: { date: result.date, deliveryWindow: result.updatedDay.deliveryWindowOverride },
    }, { subscriptionId: id, date: result.date });

    return res.status(200).json({ status: true, data: { subscriptionId: result.subscriptionId } });
  } catch (err) {
    if (err.status && err.code) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    logger.error("Delivery update for date failed", { subscriptionId: id, date, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Delivery update for date failed");
  }
}

/** @unwired - NOT mounted on any route. Do not call without review. */
async function transitionDay(req, res, toStatus) {
  const { id, date } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (!canTransition(day.status, toStatus)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition");
    }

    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    if (toStatus === "locked") {
      await lockDaySnapshot(sub, day, session);
    }

    day.status = toStatus;
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ status: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Transition failed");
  }
}

/** @unwired - NOT mounted on any route. Do not call without review. */
async function fulfillDay(req, res) {
  const { id, date } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await fulfillSubscriptionDay({ subscriptionId: id, date, session });
    if (!result.ok) {
      await session.abortTransaction();
      session.endSession();
      const status =
        result.code === "NOT_FOUND" ? 404 :
          result.code === "INSUFFICIENT_CREDITS" ? 400 :
            result.code === "INVALID_TRANSITION" ? 409 :
              400;
      return errorResponse(res, status, result.code, result.message);
    }

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ status: true, data: result.day, alreadyFulfilled: result.alreadyFulfilled });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Fulfillment failed");
  }
}

module.exports = {
  resolveCheckoutQuoteOrThrow,
  quoteSubscription,
  checkoutSubscription,
  getCheckoutDraftStatus,
  verifyCheckoutDraftPayment,
  finalizeSubscriptionDraftPayment,
  activateSubscription,
  getSubscription,
  getCurrentSubscriptionOverview,
  cancelSubscription,
  getSubscriptionOperationsMeta,
  getSubscriptionFreezePreview,
  getSubscriptionPaymentMethods,
  getSubscriptionTimeline,
  getSubscriptionRenewalSeed,
  renewSubscription,
  listCurrentUserSubscriptions,
  serializeSubscriptionForClient,
  createPremiumExtraDayPayment,
  verifyPremiumExtraDayPayment,
  createPremiumOverageDayPayment,
  verifyPremiumOverageDayPayment,
  createOneTimeAddonDayPlanningPayment,
  verifyOneTimeAddonDayPlanningPayment,
  freezeSubscription,
  unfreezeSubscription,
  getSubscriptionDays,
  getSubscriptionToday,
  getSubscriptionDay,
  updateDaySelection,
  validateDaySelection,
  updateBulkDaySelections,
  confirmDayPlanning,
  skipDay,
  unskipDay,
  skipRange,
  consumePremiumSelection,
  removePremiumSelection,
  consumeAddonSelection,
  removeAddonSelection,
  addOneTimeAddon,
  preparePickup,
  getPickupStatus,
  updateDeliveryDetails,
  updateDeliveryDetailsForDate,
  transitionDay,
  fulfillDay,
  ensureActive,
};
