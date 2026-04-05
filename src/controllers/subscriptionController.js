const crypto = require("crypto");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Plan = require("../models/Plan");
const PremiumMeal = require("../models/PremiumMeal");
const Addon = require("../models/Addon");
const CheckoutDraft = require("../models/CheckoutDraft");
const Subscription = require("../models/Subscription");
const Zone = require("../models/Zone");
const SubscriptionDay = require("../models/SubscriptionDay");
const Payment = require("../models/Payment");
const Setting = require("../models/Setting");
const dateUtils = require("../utils/date");
const { addDaysToKSADateString } = dateUtils;
const { canTransition } = require("../utils/state");
const { writeLog } = require("../utils/log");
const { getEffectiveDeliveryDetails } = require("../utils/delivery");
const { createInvoice, getInvoice } = require("../services/moyasarService");
const { fulfillSubscriptionDay } = require("../services/fulfillmentService");
const {
  applySkipForDate,
  syncSubscriptionValidity,
  buildSubscriptionTimeline,
} = require("../services/subscriptionService");
const {
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
} = require("../services/subscriptionContractService");
const {
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromLegacyDraft,
  isCanonicalCheckoutDraft,
} = require("../services/subscriptionActivationService");
const {
  applyWalletTopupPayment: applyWalletTopupSideEffects,
  applyPaymentSideEffects,
} = require("../services/paymentApplicationService");
const { logger } = require("../utils/logger");
const { getRequestLang, pickLang } = require("../utils/i18n");
const { resolveMealsPerDay, applyDayWalletSelections } = require("../utils/subscriptionDaySelectionSync");
const {
  resolvePickupLocationSelection,
  resolveQuoteSummary,
  resolveAddonChargeTotalHalala,
} = require("../utils/subscriptionCatalog");
const {
  mapRawDayStatusToClientStatus,
  resolveCatalogOrStoredName,
} = require("../utils/subscriptionLocalizationCommon");
const {
  getGenericPremiumCreditsLabel,
  localizeCheckoutDraftStatusReadPayload,
  localizeSubscriptionDayReadPayload,
  localizeSubscriptionReadPayload,
  localizeTimelineReadPayload,
  localizeRenewalSeedReadPayload,
  localizeWalletHistoryEntries,
  localizeWalletTopupStatusReadPayload,
} = require("../utils/subscriptionReadLocalization");
const {
  buildPaymentDescription,
  localizeSkipRangeSummary,
  localizeWriteCheckoutStatusPayload,
  localizeWriteDayPayload,
  localizeWriteOneTimeAddonPaymentStatusPayload,
  localizeWritePremiumOverageStatusPayload,
  localizeWriteSubscriptionPayload,
  localizeWriteWalletTopupStatusPayload,
} = require("../utils/subscriptionWriteLocalization");
const {
  LEGACY_PREMIUM_MEAL_BUCKET_ID,
  LEGACY_PREMIUM_WALLET_MODE,
  sumPremiumRemainingFromBalance,
  syncPremiumRemainingFromBalance,
  ensureLegacyPremiumBalanceFromRemaining,
} = require("../utils/premiumWallet");
const {
  GENERIC_PREMIUM_WALLET_MODE,
  isGenericPremiumWalletMode,
  syncPremiumRemainingFromActivePremiumWallet,
  getRemainingPremiumCredits,
  buildGenericPremiumBalanceRows,
  appendGenericPremiumCredits,
  consumeGenericPremiumCredits,
  refundGenericPremiumSelectionRowsOrThrow,
} = require("../services/genericPremiumWalletService");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const {
  isPhase1CanonicalCheckoutDraftWriteEnabled,
  isPhase1SharedPaymentDispatcherEnabled,
  isPhase1NonCheckoutPaidIdempotencyEnabled,
  isPhase2CanonicalDayPlanningEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../utils/featureFlags");
const {
  getSubscriptionContractReadView,
  resolveSubscriptionFreezePolicy,
  resolveSubscriptionSkipPolicy,
} = require("../services/subscriptionContractReadService");
const { buildSubscriptionRenewalSeed } = require("../services/subscriptionRenewalService");
const {
  isCanonicalDayPlanningEligible,
  applyCanonicalDraftPlanningToDay,
  applyPremiumOverageState,
  confirmCanonicalDayPlanning,
  assertCanonicalPlanningExactCount,
  assertNoPendingPremiumOverage,
  buildCanonicalPlanningView,
  buildScopedCanonicalPlanningSnapshot,
  isCanonicalPremiumOverageEligible,
} = require("../services/subscriptionDayPlanningService");
const {
  isCanonicalRecurringAddonEligible,
  buildRecurringAddonEntitlementsFromQuote,
  resolveProjectedRecurringAddons,
  applyRecurringAddonProjectionToDay,
  buildScopedRecurringAddonSnapshot,
  buildProjectedDayEntry,
} = require("../services/recurringAddonService");
const {
  normalizeOneTimeAddonSelections,
  recomputeOneTimeAddonPlanningState,
  resolveEffectiveOneTimeAddonPlanning,
  buildOneTimeAddonPlanningSnapshot,
  buildOneTimeAddonPaymentSnapshot,
  matchesOneTimeAddonPaymentSnapshot,
  assertNoPendingOneTimeAddonPayment,
} = require("../services/oneTimeAddonPlanningService");
const {
  parseOperationIdempotencyKey,
  buildOperationRequestHash,
  compareIdempotentRequest,
} = require("../services/idempotencyService");
const { reconcileCheckoutDraft, RECONCILE_MODES } = require("../services/reconciliationService");
const { cancelSubscriptionDomain } = require("../services/subscriptionCancellationService");
const { validateRedirectUrl } = require("../utils/security");
const {
  resolveEffectiveSubscriptionStatus,
  buildSubscriptionOperationsMeta,
  buildFreezePreview,
} = require("../services/subscriptionOperationsReadService");
const { resolveSubscriptionDeliveryDefaultsUpdate } = require("../services/subscriptionDeliveryUpdateService");

const SYSTEM_CURRENCY = "SAR";
const STALE_DRAFT_THRESHOLD_MS = 30 * 1000; // 30 seconds - reduced for faster recovery
const LEGACY_DAY_PREMIUM_SLOT_PREFIX = "legacy_day_premium_slot_";
const WALLET_TOPUP_PAYMENT_TYPES = new Set(["premium_topup", "addon_topup"]);
const PREMIUM_OVERAGE_DAY_PAYMENT_TYPE = "premium_overage_day";
const ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE = "one_time_addon_day_planning";
const LEGACY_PREMIUM_TOPUP_SUNSET_HTTP_DATE = "Tue, 30 Jun 2026 23:59:59 GMT";
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
  isCanonicalRecurringAddonEligible: (...args) => isCanonicalRecurringAddonEligible(...args),
  resolveProjectedRecurringAddons: (...args) => resolveProjectedRecurringAddons(...args),
  applyRecurringAddonProjectionToDay: (...args) => applyRecurringAddonProjectionToDay(...args),
  normalizeOneTimeAddonSelections: (...args) => normalizeOneTimeAddonSelections(...args),
  recomputeOneTimeAddonPlanningState: (...args) => recomputeOneTimeAddonPlanningState(...args),
  resolveEffectiveOneTimeAddonPlanning: (...args) => resolveEffectiveOneTimeAddonPlanning(...args),
  buildOneTimeAddonPlanningSnapshot: (...args) => buildOneTimeAddonPlanningSnapshot(...args),
};
const cancelSubscriptionDefaultRuntime = {
  cancelSubscriptionDomain: (...args) => cancelSubscriptionDomain(...args),
  findSubscriptionById(subscriptionId) {
    return Subscription.findById(subscriptionId).lean();
  },
  serializeSubscriptionForClient: (...args) => serializeSubscriptionForClient(...args),
  writeLogSafely: (...args) => writeLogSafely(...args),
};
const subscriptionOperationsMetaDefaultRuntime = {
  buildSubscriptionOperationsMeta: (...args) => buildSubscriptionOperationsMeta(...args),
};
const subscriptionFreezePreviewDefaultRuntime = {
  buildFreezePreview: (...args) => buildFreezePreview(...args),
};

function resolveCancelSubscriptionRuntime(runtimeOverrides = null) {
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return cancelSubscriptionDefaultRuntime;
  }
  return { ...cancelSubscriptionDefaultRuntime, ...runtimeOverrides };
}

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

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function parsePositiveInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInteger(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return null;
  }
  return parseNonNegativeInteger(rawValue);
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
      id: String(item.premiumMeal && item.premiumMeal._id ? item.premiumMeal._id : item.premiumMealId || ""),
      qty: Number(item.qty || 0),
      unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
      currency: normalizeCurrencyValue(item.premiumMeal && item.premiumMeal.currency ? item.premiumMeal.currency : item.currency),
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
    premiumWalletMode: quote.premiumWalletMode || LEGACY_PREMIUM_WALLET_MODE,
    premiumCount: Number(quote.premiumCount || 0),
    premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
    addonItems,
    breakdown: {
      basePlanPriceHalala: Number(quote.breakdown.basePlanPriceHalala || 0),
      premiumTotalHalala: Number(quote.breakdown.premiumTotalHalala || 0),
      addonsTotalHalala: Number(quote.breakdown.addonsTotalHalala || 0),
      deliveryFeeHalala: Number(quote.breakdown.deliveryFeeHalala || 0),
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

function getPaymentMetadata(payment) {
  return payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
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
  const payload = {
    payment_url: metadata.paymentUrl || "",
    invoice_id: payment && payment.providerInvoiceId ? payment.providerInvoiceId : null,
    payment_id: payment && payment.id ? payment.id : (payment && payment._id ? String(payment._id) : null),
  };

  if (
    responseShape === "premium_credits_topup"
    || responseShape === "addon_credits_topup"
    || responseShape === "premium_overage_day"
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
          ok: true,
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
        ok: true,
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

function buildPaymentMetadataWithInitiationFields(baseMetadata, { paymentUrl, responseShape, totalHalala }) {
  const metadata = Object.assign({}, baseMetadata || {});
  metadata.paymentUrl = paymentUrl || "";
  metadata.initiationResponseShape = responseShape;
  if (totalHalala !== undefined) {
    metadata.totalHalala = Number(totalHalala || 0);
  }
  return metadata;
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

function buildCheckoutInitFailureReason(stage, err) {
  const normalizedStage = String(stage || "checkout_init").trim() || "checkout_init";
  const detail = err && err.code
    ? String(err.code).trim()
    : err && err.message
      ? String(err.message).trim()
      : "unknown_error";
  return `${normalizedStage}:${detail || "unknown_error"}`.slice(0, 200);
}

function isCheckoutDraftDuplicateKeyError(err) {
  if (!err || err.code !== 11000) return false;

  const keyNames = Object.keys(err.keyPattern || err.keyValue || {});
  if (keyNames.some((key) => key === "idempotencyKey" || key === "requestHash")) {
    return true;
  }

  const message = String(err.message || "");
  return message.includes("idempotencyKey") || message.includes("requestHash");
}

async function persistCheckoutDraftUpdate(draft, changes, { stage } = {}) {
  if (!draft) return;

  const persistedChanges = Object.fromEntries(
    Object.entries({
      ...changes,
      updatedAt: new Date(),
    }).filter(([, value]) => value !== undefined)
  );

  logger.debug("[DEBUG-CHECKOUT] Persisting draft update", {
    draftId: String(draft._id),
    stage: String(stage || "unknown"),
    status: persistedChanges.status !== undefined ? persistedChanges.status : draft.status,
    providerInvoiceId:
      persistedChanges.providerInvoiceId !== undefined
        ? persistedChanges.providerInvoiceId
        : (draft.providerInvoiceId || ""),
    paymentId:
      persistedChanges.paymentId !== undefined
        ? String(persistedChanges.paymentId || "")
        : (draft.paymentId ? String(draft.paymentId) : ""),
    hasPaymentUrl:
      persistedChanges.paymentUrl !== undefined
        ? Boolean(String(persistedChanges.paymentUrl || "").trim())
        : Boolean(String(draft.paymentUrl || "").trim()),
    failureReason:
      persistedChanges.failureReason !== undefined
        ? persistedChanges.failureReason
        : (draft.failureReason || ""),
  });

  Object.assign(draft, persistedChanges);

  try {
    await draft.save();
    logger.debug("[DEBUG-CHECKOUT] Draft update saved", {
      draftId: String(draft._id),
      stage: String(stage || "unknown"),
    });
  } catch (saveErr) {
    logger.error("[DEBUG-CHECKOUT] Draft save failed; attempting updateOne fallback", {
      draftId: String(draft._id),
      stage: String(stage || "unknown"),
      error: saveErr.message,
    });

    try {
      await CheckoutDraft.updateOne({ _id: draft._id }, { $set: persistedChanges });
      Object.assign(draft, persistedChanges);
      logger.warn("[DEBUG-CHECKOUT] Draft update persisted via updateOne fallback", {
        draftId: String(draft._id),
        stage: String(stage || "unknown"),
      });
    } catch (updateErr) {
      logger.error("[DEBUG-CHECKOUT] Draft updateOne fallback failed", {
        draftId: String(draft._id),
        stage: String(stage || "unknown"),
        error: updateErr.message,
      });
      throw saveErr;
    }
  }
}

async function persistCheckoutInitializationFailure(draft, err, { stage, providerInvoiceId, paymentUrl } = {}) {
  if (!draft) return;

  const failureReason = buildCheckoutInitFailureReason(stage, err);
  logger.error("[DEBUG-CHECKOUT] Checkout initialization failed", {
    draftId: String(draft._id),
    stage: String(stage || "unknown"),
    error: err && err.message ? err.message : "Unknown error",
    code: err && err.code ? err.code : null,
    providerInvoiceId: providerInvoiceId || draft.providerInvoiceId || "",
    hasPaymentUrl: Boolean(String(paymentUrl !== undefined ? paymentUrl : draft.paymentUrl || "").trim()),
    failureReason,
  });

  try {
    await persistCheckoutDraftUpdate(
      draft,
      {
        status: "failed",
        failedAt: new Date(),
        failureReason,
        ...(providerInvoiceId ? { providerInvoiceId } : {}),
        ...(paymentUrl !== undefined ? { paymentUrl } : {}),
      },
      { stage: `${String(stage || "unknown")}_failure` }
    );
  } catch (persistErr) {
    logger.error("[DEBUG-CHECKOUT] Failed to persist checkout initialization failure", {
      draftId: String(draft._id),
      stage: String(stage || "unknown"),
      error: persistErr.message,
      originalError: err && err.message ? err.message : "Unknown error",
    });
  }
}

async function releaseCheckoutDraftIdempotencyKey(draft, { stage, failureReason } = {}) {
  if (!draft || !draft._id) return;

  const currentKey = String(draft.idempotencyKey || "").trim();
  if (!currentKey) return;

  const status = String(draft.status || "").trim();
  if (!["failed", "canceled", "expired"].includes(status)) return;

  const update = {
    idempotencyKey: "",
    updatedAt: new Date(),
  };
  if (failureReason !== undefined) {
    update.failureReason = failureReason;
  }

  await CheckoutDraft.updateOne({ _id: draft._id }, { $set: update });
  draft.idempotencyKey = "";
  if (failureReason !== undefined) {
    draft.failureReason = failureReason;
  }

  logger.debug("[DEBUG-CHECKOUT] Released terminal draft idempotency key", {
    draftId: String(draft._id),
    stage: String(stage || "unknown"),
    status,
    failureReason: failureReason !== undefined ? failureReason : (draft.failureReason || ""),
  });
}

function buildCheckoutReusePayload(draft, payment) {
  const paymentMetadata = getPaymentMetadata(payment);
  return {
    subscriptionId: draft.subscriptionId ? String(draft.subscriptionId) : null,
    draftId: String(draft._id),
    paymentId: payment ? String(payment._id) : (draft.paymentId ? String(draft.paymentId) : null),
    payment_url: draft.paymentUrl || paymentMetadata.paymentUrl || "",
    totals: draft.breakdown,
    reused: true,
  };
}

function isPendingCheckoutReusable(draft, payment) {
  const metadata = getPaymentMetadata(payment);
  const hasPaymentUrl = Boolean(
    (draft && draft.paymentUrl && String(draft.paymentUrl).trim())
    || (typeof metadata.paymentUrl === "string" && metadata.paymentUrl.trim())
  );
  return Boolean(
    draft
    && draft.status === "pending_payment"
    && payment
    && payment.status === "initiated"
    && payment.applied !== true
    && hasPaymentUrl
  );
}

function resolveSubscriptionCheckoutPaymentType({ renewedFromSubscriptionId } = {}) {
  return renewedFromSubscriptionId ? "subscription_renewal" : "subscription_activation";
}

function resolveSubscriptionCheckoutResponseShape(paymentType) {
  return paymentType === "subscription_renewal" ? "subscription_renewal" : "subscription_checkout";
}

function buildSubscriptionCheckoutPaymentMetadata({
  draft,
  paymentType,
  providerInvoiceId,
  paymentUrl,
  totalHalala,
}) {
  const metadata = {
    type: paymentType,
    draftId: String(draft && draft._id ? draft._id : ""),
    userId: String(draft && draft.userId ? draft.userId : ""),
    grams: Number(draft && draft.grams ? draft.grams : 0),
    mealsPerDay: Number(draft && draft.mealsPerDay ? draft.mealsPerDay : 0),
    paymentUrl: paymentUrl || "",
    initiationResponseShape: resolveSubscriptionCheckoutResponseShape(paymentType),
    totalHalala: Number(totalHalala || 0),
  };

  if (providerInvoiceId) {
    metadata.providerInvoiceId = providerInvoiceId;
  }
  if (draft && draft.renewedFromSubscriptionId) {
    metadata.renewedFromSubscriptionId = String(draft.renewedFromSubscriptionId);
  }

  return metadata;
}

async function findSubscriptionCheckoutPayment({ draft, paymentType, providerInvoiceId }) {
  if (!draft) return null;

  let payment = draft.paymentId ? await Payment.findById(draft.paymentId) : null;
  if (!payment && providerInvoiceId) {
    payment = await Payment.findOne({
      provider: "moyasar",
      providerInvoiceId,
    }).sort({ createdAt: -1 });
  }
  if (!payment) {
    payment = await Payment.findOne({
      userId: draft.userId,
      type: paymentType,
      "metadata.draftId": String(draft._id),
    }).sort({ createdAt: -1 });
  }

  return payment;
}

async function ensureSubscriptionCheckoutPayment({
  draft,
  paymentType,
  totalHalala,
  invoiceCurrency,
  providerInvoiceId,
  paymentUrl,
}) {
  if (!draft) return null;

  const paymentMetadata = buildSubscriptionCheckoutPaymentMetadata({
    draft,
    paymentType,
    providerInvoiceId,
    paymentUrl,
    totalHalala,
  });

  let payment = await findSubscriptionCheckoutPayment({ draft, paymentType, providerInvoiceId });

  if (!payment) {
    try {
      payment = await Payment.create({
        provider: "moyasar",
        type: paymentType,
        status: "initiated",
        amount: totalHalala,
        currency: invoiceCurrency,
        userId: draft.userId,
        providerInvoiceId,
        metadata: paymentMetadata,
      });
    } catch (err) {
      if (!err || err.code !== 11000) {
        throw err;
      }
      payment = await findSubscriptionCheckoutPayment({ draft, paymentType, providerInvoiceId });
      if (!payment) {
        throw err;
      }
    }
  }

  let paymentChanged = false;
  if (!payment.providerInvoiceId && providerInvoiceId) {
    payment.providerInvoiceId = providerInvoiceId;
    paymentChanged = true;
  }
  const mergedMetadata = Object.assign({}, payment.metadata || {}, paymentMetadata);
  if (JSON.stringify(mergedMetadata) !== JSON.stringify(payment.metadata || {})) {
    payment.metadata = mergedMetadata;
    paymentChanged = true;
  }
  if (!payment.currency && invoiceCurrency) {
    payment.currency = invoiceCurrency;
    paymentChanged = true;
  }
  if (paymentChanged) {
    await payment.save();
  }

  return payment;
}

function normalizeProviderPaymentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "cancelled" || normalized === "voided") return "canceled";
  if (normalized === "captured") return "paid";
  if (["authorized", "verified", "on_hold"].includes(normalized)) return "initiated";
  if (["initiated", "paid", "failed", "canceled", "expired", "refunded"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function pickProviderInvoicePayment(invoice, payment) {
  const attempts = Array.isArray(invoice && invoice.payments)
    ? invoice.payments.filter((item) => item && typeof item === "object")
    : [];
  if (!attempts.length) return null;

  if (payment && payment.providerPaymentId) {
    const matched = attempts.find((item) => String(item.id || "") === String(payment.providerPaymentId));
    if (matched) return matched;
  }

  const paidAttempts = attempts.filter((item) => normalizeProviderPaymentStatus(item.status) === "paid");
  if (paidAttempts.length) {
    return paidAttempts[paidAttempts.length - 1];
  }

  return attempts[attempts.length - 1];
}

function serializeCheckoutPayment(payment) {
  if (!payment) return null;
  return {
    id: String(payment._id),
    provider: payment.provider,
    type: payment.type,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    applied: Boolean(payment.applied),
    paidAt: payment.paidAt || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
  };
}

function isWalletTopupPaymentType(type) {
  return WALLET_TOPUP_PAYMENT_TYPES.has(String(type || ""));
}

function resolveWalletTopupKind(type) {
  return String(type || "") === "addon_topup" ? "addon" : "premium";
}

function buildProviderInvoicePayload(providerInvoice, fallbackUrl) {
  if (!providerInvoice) return null;
  const providerPayment = pickProviderInvoicePayment(providerInvoice, null);
  const providerStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  return {
    id: providerInvoice.id || null,
    status: providerStatus || String(providerInvoice.status || "").trim().toLowerCase() || null,
    amount: Number.isFinite(Number(providerInvoice.amount)) ? Number(providerInvoice.amount) : null,
    currency: providerInvoice.currency || null,
    url: providerInvoice.url || fallbackUrl || "",
    updatedAt: providerInvoice.updated_at || providerInvoice.updatedAt || null,
    attemptsCount: Array.isArray(providerInvoice.payments) ? providerInvoice.payments.length : 0,
  };
}

async function loadWalletCatalogMaps({ subscription = null, payments = [], days = [], lang }) {
  const premiumIds = new Set();
  const addonIds = new Set();

  for (const payment of payments) {
    const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
    if (Array.isArray(metadata.items)) {
      for (const item of metadata.items) {
        if (!item || typeof item !== "object") continue;
        if (item.premiumMealId) premiumIds.add(String(item.premiumMealId));
        if (item.addonId) addonIds.add(String(item.addonId));
      }
    }
  }

  if (subscription && typeof subscription === "object") {
    for (const row of subscription.premiumBalance || []) {
      if (row && row.premiumMealId) premiumIds.add(String(row.premiumMealId));
    }
    for (const row of subscription.premiumSelections || []) {
      if (row && row.premiumMealId) premiumIds.add(String(row.premiumMealId));
    }
    for (const row of subscription.addonBalance || []) {
      if (row && row.addonId) addonIds.add(String(row.addonId));
    }
    for (const row of subscription.addonSelections || []) {
      if (row && row.addonId) addonIds.add(String(row.addonId));
    }
    for (const row of subscription.addonSubscriptions || []) {
      if (row && row.addonId) addonIds.add(String(row.addonId));
    }
  }

  for (const day of Array.isArray(days) ? days : []) {
    for (const row of day && Array.isArray(day.recurringAddons) ? day.recurringAddons : []) {
      const hasStoredName = Boolean(
        row
        && (
          (typeof row.name === "string" && row.name.trim())
          || (row.name && typeof row.name === "object")
        )
      );
      const snapshotBacked = Boolean(day && (day.lockedSnapshot || day.fulfilledSnapshot));
      if (row && row.addonId && !(snapshotBacked && hasStoredName)) {
        addonIds.add(String(row.addonId));
      }
    }
    for (const row of day && Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : []) {
      const hasStoredName = Boolean(
        row
        && (
          (typeof row.name === "string" && row.name.trim())
          || (row.name && typeof row.name === "object")
        )
      );
      const snapshotBacked = Boolean(day && (day.lockedSnapshot || day.fulfilledSnapshot));
      if (row && row.addonId && !(snapshotBacked && hasStoredName)) {
        addonIds.add(String(row.addonId));
      }
    }
    const snapshots = [
      day && day.lockedSnapshot && typeof day.lockedSnapshot === "object" ? day.lockedSnapshot : null,
      day && day.fulfilledSnapshot && typeof day.fulfilledSnapshot === "object" ? day.fulfilledSnapshot : null,
    ].filter(Boolean);
    for (const snapshot of snapshots) {
      for (const row of Array.isArray(snapshot.recurringAddons) ? snapshot.recurringAddons : []) {
        const hasStoredName = Boolean(
          row
          && (
            (typeof row.name === "string" && row.name.trim())
            || (row.name && typeof row.name === "object")
          )
        );
        if (row && row.addonId && !hasStoredName) addonIds.add(String(row.addonId));
      }
      for (const row of Array.isArray(snapshot.oneTimeAddonSelections) ? snapshot.oneTimeAddonSelections : []) {
        const hasStoredName = Boolean(
          row
          && (
            (typeof row.name === "string" && row.name.trim())
            || (row.name && typeof row.name === "object")
          )
        );
        if (row && row.addonId && !hasStoredName) addonIds.add(String(row.addonId));
      }
    }
  }

  premiumIds.delete(LEGACY_PREMIUM_MEAL_BUCKET_ID);

  const [premiumDocs, addonDocs] = await Promise.all([
    premiumIds.size
      ? PremiumMeal.find({ _id: { $in: Array.from(premiumIds) } }).select("_id name").lean()
      : Promise.resolve([]),
    addonIds.size
      ? Addon.find({ _id: { $in: Array.from(addonIds) } }).select("_id name").lean()
      : Promise.resolve([]),
  ]);

  return {
    premiumNames: new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)])),
    addonNames: new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)])),
    legacyPremiumLabel: getGenericPremiumCreditsLabel(lang),
  };
}

async function loadWalletCatalogMapsSafely(options = {}) {
  try {
    return await loadWalletCatalogMaps(options);
  } catch (err) {
    logger.warn("Wallet catalog localization fallback engaged", {
      error: err.message,
      context: options && options.context ? options.context : "unknown",
    });
    return {
      premiumNames: new Map(),
      addonNames: new Map(),
      legacyPremiumLabel: getGenericPremiumCreditsLabel(options.lang),
    };
  }
}

function buildWalletTopupItems(payment, catalog) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const walletType = resolveWalletTopupKind(payment.type);

  if (walletType === "premium" && metadata.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE) {
    const qty = Number(metadata.premiumCount || metadata.count || 0);
    const unitAmountHalala = Number(metadata.unitCreditPriceHalala || 0);
    if (qty > 0) {
      return [{
        id: String(payment._id),
        walletType,
        itemId: null,
        name: catalog.legacyPremiumLabel,
        qty,
        unitAmountHalala,
        totalAmountHalala: qty * unitAmountHalala,
        currency: metadata.currency || payment.currency || SYSTEM_CURRENCY,
      }];
    }
  }

  if (Array.isArray(metadata.items) && metadata.items.length) {
    return metadata.items.map((item, index) => {
      const qty = Number(item.qty || 0);
      const isPremium = walletType === "premium";
      const unitAmountHalala = isPremium
        ? Number(item.unitExtraFeeHalala || 0)
        : Number(item.unitPriceHalala || 0);
      const itemId = isPremium
        ? (item.premiumMealId ? String(item.premiumMealId) : null)
        : (item.addonId ? String(item.addonId) : null);
      const name = isPremium
        ? (itemId ? catalog.premiumNames.get(itemId) || "" : catalog.legacyPremiumLabel)
        : (itemId ? catalog.addonNames.get(itemId) || "" : "");

      return {
        id: `${payment._id}:${index}`,
        walletType,
        itemId,
        name,
        qty,
        unitAmountHalala,
        totalAmountHalala: qty * unitAmountHalala,
        currency: item.currency || payment.currency || SYSTEM_CURRENCY,
      };
    });
  }

  if (walletType === "premium") {
    const qty = Number(metadata.premiumCount || metadata.count || 0);
    const unitAmountHalala = Number(metadata.unitExtraFeeHalala || 0);
    if (qty > 0) {
      return [{
        id: String(payment._id),
        walletType,
        itemId: null,
        name: catalog.legacyPremiumLabel,
        qty,
        unitAmountHalala,
        totalAmountHalala: qty * unitAmountHalala,
        currency: metadata.currency || payment.currency || SYSTEM_CURRENCY,
      }];
    }
  }

  return [{
    id: String(payment._id),
    walletType,
    itemId: null,
    name: "",
    qty: 0,
    unitAmountHalala: 0,
    totalAmountHalala: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
  }];
}

function buildWalletTopupStatusPayload({ subscription, payment, catalog, providerInvoice = null }) {
  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  return {
    subscriptionId: String(subscription._id),
    paymentId: String(payment._id),
    walletType: resolveWalletTopupKind(payment.type),
    paymentStatus: payment.status,
    isFinal: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    amount: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
    applied: Boolean(payment.applied),
    providerInvoiceId:
      payment.providerInvoiceId
      || (providerInvoice && providerInvoice.id)
      || null,
    providerPaymentId:
      payment.providerPaymentId
      || (providerPayment && providerPayment.id)
      || null,
    paidAt: payment.paidAt || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    items: buildWalletTopupItems(payment, catalog),
    payment: serializeCheckoutPayment(payment),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, null),
  };
}

function buildPremiumOveragePaymentStatusPayload({ subscription, day, payment, providerInvoice = null }) {
  return {
    subscriptionId: String(subscription._id),
    dayId: day && day._id ? String(day._id) : null,
    date: day && day.date ? day.date : null,
    premiumOverageCount: Number(day && day.premiumOverageCount ? day.premiumOverageCount : 0),
    premiumOverageStatus: day && day.premiumOverageStatus ? day.premiumOverageStatus : null,
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    isFinal: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    amount: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
    applied: Boolean(payment.applied),
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    payment: serializeCheckoutPayment(payment),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, getPaymentMetadata(payment).paymentUrl || ""),
  };
}

function buildOneTimeAddonDayPaymentStatusPayload({ subscription, day, payment, providerInvoice = null }) {
  const effectivePlanning = resolveEffectiveOneTimeAddonPlanning({ day }) || {
    oneTimeAddonSelections: [],
    oneTimeAddonPendingCount: 0,
    oneTimeAddonPaymentStatus: null,
  };
  return {
    subscriptionId: String(subscription._id),
    dayId: day && day._id ? String(day._id) : null,
    date: day && day.date ? day.date : null,
    oneTimeAddonSelections: effectivePlanning.oneTimeAddonSelections,
    oneTimeAddonPendingCount: Number(effectivePlanning.oneTimeAddonPendingCount || 0),
    oneTimeAddonPaymentStatus: effectivePlanning.oneTimeAddonPaymentStatus,
    paymentId: String(payment._id),
    paymentStatus: payment.status,
    isFinal: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    amount: Number(payment.amount || 0),
    currency: payment.currency || SYSTEM_CURRENCY,
    applied: Boolean(payment.applied),
    providerInvoiceId: payment.providerInvoiceId || null,
    providerPaymentId: payment.providerPaymentId || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    payment: serializeCheckoutPayment(payment),
    providerInvoice: buildProviderInvoicePayload(providerInvoice, getPaymentMetadata(payment).paymentUrl || ""),
  };
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

async function buildPricedOneTimeAddonPaymentSnapshot({ day } = {}) {
  const snapshot = buildOneTimeAddonPaymentSnapshot({ day });
  if (snapshot.oneTimeAddonCount <= 0) {
    return {
      oneTimeAddonSelections: [],
      oneTimeAddonCount: 0,
      pricedItems: [],
      totalHalala: 0,
      currency: SYSTEM_CURRENCY,
    };
  }

  const addonDocs = await Addon.find({
    _id: { $in: snapshot.oneTimeAddonSelections.map((item) => item.addonId) },
  }).lean();
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

  const pricedItems = snapshot.oneTimeAddonSelections.map((item) => {
    const doc = addonById.get(String(item.addonId));
    if (!doc) {
      const err = new Error(`Add-on ${item.addonId} pricing not found`);
      err.code = "ONE_TIME_ADDON_PRICING_NOT_FOUND";
      throw err;
    }

    return {
      addonId: String(item.addonId),
      name: item.name,
      category: item.category,
      unitPriceHalala: buildAddonUnitFromDoc(doc),
      currency: assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon ${item.addonId} currency`),
    };
  });

  return {
    oneTimeAddonSelections: snapshot.oneTimeAddonSelections,
    oneTimeAddonCount: snapshot.oneTimeAddonCount,
    pricedItems,
    totalHalala: pricedItems.reduce((sum, item) => sum + Number(item.unitPriceHalala || 0), 0),
    currency: pricedItems[0] && pricedItems[0].currency ? pricedItems[0].currency : SYSTEM_CURRENCY,
  };
}

async function applyPremiumTopupPayment({ subscription, payment, session }) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  if (metadata.subscriptionId && String(metadata.subscriptionId) !== String(subscription._id)) {
    return { applied: false, reason: "subscription_mismatch" };
  }

  if (isGenericPremiumWalletMode(subscription)) {
    const count = parseInt(
      metadata.premiumCount
      || metadata.count
      || (Array.isArray(metadata.items)
        ? metadata.items.reduce((sum, item) => sum + parseInt(item && item.qty, 10), 0)
        : 0),
      10
    );
    if (count <= 0) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const configuredUnit = Number(metadata.unitCreditPriceHalala);
    const fallbackUnit = Math.round(Number(payment.amount || 0) / count);
    const unitCreditPriceHalala = Number.isInteger(configuredUnit) && configuredUnit >= 0
      ? configuredUnit
      : Number.isFinite(fallbackUnit) && fallbackUnit >= 0
        ? fallbackUnit
        : 0;

    appendGenericPremiumCredits(subscription, {
      premiumCount: count,
      unitCreditPriceHalala,
      currency: payment.currency || SYSTEM_CURRENCY,
      source: "topup_payment",
    });
    await subscription.save({ session });
    return { applied: true, addedCount: count };
  }

  subscription.premiumBalance = subscription.premiumBalance || [];
  if (Array.isArray(metadata.items) && metadata.items.length) {
    let addedCount = 0;
    for (const item of metadata.items) {
      const qty = parseInt(item.qty, 10);
      const unitExtraFeeHalala = Number(item.unitExtraFeeHalala || 0);
      if (!item.premiumMealId || !qty || qty <= 0) continue;
      subscription.premiumBalance.push({
        premiumMealId: item.premiumMealId,
        purchasedQty: qty,
        remainingQty: qty,
        unitExtraFeeHalala,
        currency: item.currency || SYSTEM_CURRENCY,
      });
      addedCount += qty;
    }
    if (addedCount <= 0) {
      return { applied: false, reason: "invalid_items" };
    }
    syncPremiumRemainingFromBalance(subscription);
    await subscription.save({ session });
    return { applied: true, addedCount };
  }

  const count = parseInt(metadata.premiumCount || metadata.count || 0, 10);
  if (count <= 0) {
    return { applied: false, reason: "invalid_metadata" };
  }

  const configuredUnit = Number(metadata.unitExtraFeeHalala);
  const fallbackUnit = Math.round(Number(payment.amount || 0) / count);
  const unitExtraFeeHalala = Number.isInteger(configuredUnit) && configuredUnit >= 0
    ? configuredUnit
    : Number.isFinite(fallbackUnit) && fallbackUnit >= 0
      ? fallbackUnit
      : 0;

  ensureLegacyPremiumBalanceFromRemaining(subscription, {
    unitExtraFeeHalala,
    currency: payment.currency || SYSTEM_CURRENCY,
  });
  subscription.premiumBalance.push({
    premiumMealId: LEGACY_PREMIUM_MEAL_BUCKET_ID,
    purchasedQty: count,
    remainingQty: count,
    unitExtraFeeHalala,
    currency: payment.currency || SYSTEM_CURRENCY,
  });
  syncPremiumRemainingFromBalance(subscription);
  await subscription.save({ session });
  return { applied: true, addedCount: count };
}

async function applyAddonTopupPayment({ subscription, payment, session }) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  if (metadata.subscriptionId && String(metadata.subscriptionId) !== String(subscription._id)) {
    return { applied: false, reason: "subscription_mismatch" };
  }
  if (!Array.isArray(metadata.items) || !metadata.items.length) {
    return { applied: false, reason: "invalid_metadata" };
  }

  subscription.addonBalance = subscription.addonBalance || [];
  let addedCount = 0;
  for (const item of metadata.items) {
    const qty = parseInt(item.qty, 10);
    const unitPriceHalala = Number(item.unitPriceHalala || 0);
    if (!item.addonId || !qty || qty <= 0) continue;
    subscription.addonBalance.push({
      addonId: item.addonId,
      purchasedQty: qty,
      remainingQty: qty,
      unitPriceHalala,
      currency: item.currency || SYSTEM_CURRENCY,
    });
    addedCount += qty;
  }
  if (addedCount <= 0) {
    return { applied: false, reason: "invalid_items" };
  }
  await subscription.save({ session });
  return { applied: true, addedCount };
}

async function applyWalletTopupPayment({ subscription, payment, session }) {
  return applyWalletTopupSideEffects({ payment, session, source: "client_manual_verify" }, {
    async findSubscriptionById() {
      return subscription;
    },
  });
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

async function finalizeSubscriptionDraftPayment({ draft, payment, session }, runtimeOverrides = null) {
  const runtime = runtimeOverrides
    ? {
      isCanonicalCheckoutDraft:
        runtimeOverrides.isCanonicalCheckoutDraft || sliceBDefaultRuntime().isCanonicalCheckoutDraft,
      activateSubscriptionFromCanonicalDraft:
        runtimeOverrides.activateSubscriptionFromCanonicalDraft || sliceBDefaultRuntime().activateSubscriptionFromCanonicalDraft,
      activateSubscriptionFromLegacyDraft:
        runtimeOverrides.activateSubscriptionFromLegacyDraft || sliceBDefaultRuntime().activateSubscriptionFromLegacyDraft,
    }
    : null;
  return sliceBDefaultRuntime().finalizeSubscriptionDraftPaymentFlow({ draft, payment, session }, runtime);
}

function resolveAddonUnitPriceHalala(addon) {
  if (Number.isInteger(addon.priceHalala) && addon.priceHalala >= 0) {
    return addon.priceHalala;
  }
  const parsedPrice = Number(addon.price);
  if (Number.isFinite(parsedPrice) && parsedPrice >= 0) {
    return Math.round(parsedPrice * 100);
  }
  return 0;
}

function toPremiumWalletRowsFIFO(sub) {
  const rows = Array.isArray(sub && sub.premiumBalance) ? sub.premiumBalance : [];
  return rows
    .filter((row) => Number(row && row.remainingQty) > 0)
    .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime());
}

function parseLegacyDayPremiumSlotIndex(baseSlotKey) {
  const raw = String(baseSlotKey || "");
  if (!raw.startsWith(LEGACY_DAY_PREMIUM_SLOT_PREFIX)) return null;
  const value = Number(raw.slice(LEGACY_DAY_PREMIUM_SLOT_PREFIX.length));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function getLegacyDayPremiumSelections(sub, { dayId, date }) {
  const rows = Array.isArray(sub && sub.premiumSelections) ? sub.premiumSelections : [];
  const expectedDayId = dayId ? String(dayId) : null;
  return rows.filter((row) => {
    const slotKey = String(row && row.baseSlotKey ? row.baseSlotKey : "");
    if (!slotKey.startsWith(LEGACY_DAY_PREMIUM_SLOT_PREFIX)) return false;
    if (expectedDayId && row.dayId && String(row.dayId) === expectedDayId) return true;
    return Boolean(row.date && date && String(row.date) === String(date));
  });
}

function getNextLegacyDayPremiumSlotIndex(existingRows) {
  const maxIndex = existingRows.reduce((max, row) => {
    const parsed = parseLegacyDayPremiumSlotIndex(row && row.baseSlotKey);
    if (parsed === null) return max;
    return parsed > max ? parsed : max;
  }, -1);
  return maxIndex + 1;
}

function extractAddedPremiumSelectionIds(previousSelections, nextSelections, qty) {
  const remainingCounts = new Map();
  for (const mealId of Array.isArray(previousSelections) ? previousSelections : []) {
    const key = String(mealId || "");
    remainingCounts.set(key, (remainingCounts.get(key) || 0) + 1);
  }

  const added = [];
  for (const mealId of Array.isArray(nextSelections) ? nextSelections : []) {
    const key = String(mealId || "");
    const existingCount = remainingCounts.get(key) || 0;
    if (existingCount > 0) {
      remainingCounts.set(key, existingCount - 1);
      continue;
    }
    if (key) {
      added.push(key);
    }
  }

  return added.slice(0, qty);
}

function sortDayPremiumRowsByConsumedAt(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => new Date(a && a.consumedAt ? a.consumedAt : 0).getTime() - new Date(b && b.consumedAt ? b.consumedAt : 0).getTime());
}

function reconcileWalletBackedPremiumRowsForRequestedSelections(currentRows, requestedPremiumSelections) {
  const requestedCounts = new Map();
  for (const mealId of Array.isArray(requestedPremiumSelections) ? requestedPremiumSelections : []) {
    const key = String(mealId || "");
    if (!key) continue;
    requestedCounts.set(key, (requestedCounts.get(key) || 0) + 1);
  }

  const retainedRows = [];
  const refundableRows = [];
  for (const row of sortDayPremiumRowsByConsumedAt(currentRows)) {
    const key = String(row && row.premiumMealId ? row.premiumMealId : "");
    const remainingRequested = requestedCounts.get(key) || 0;
    if (remainingRequested > 0) {
      retainedRows.push(row);
      requestedCounts.set(key, remainingRequested - 1);
    } else {
      refundableRows.push(row);
    }
  }

  const retainedCounts = new Map();
  for (const row of retainedRows) {
    const key = String(row && row.premiumMealId ? row.premiumMealId : "");
    retainedCounts.set(key, (retainedCounts.get(key) || 0) + 1);
  }

  const unmetRequestedMealIds = [];
  for (const mealId of Array.isArray(requestedPremiumSelections) ? requestedPremiumSelections : []) {
    const key = String(mealId || "");
    const retainedCount = retainedCounts.get(key) || 0;
    if (retainedCount > 0) {
      retainedCounts.set(key, retainedCount - 1);
      continue;
    }
    if (key) {
      unmetRequestedMealIds.push(mealId);
    }
  }

  return {
    retainedRows,
    refundableRows,
    unmetRequestedMealIds,
  };
}

function consumePremiumBalanceFifoRows(sub, qty) {
  const rows = toPremiumWalletRowsFIFO(sub);
  const available = rows.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
  if (available < qty) {
    return null;
  }

  const consumed = [];
  let remaining = qty;
  for (const row of rows) {
    if (remaining <= 0) break;
    const rowAvailable = Number(row.remainingQty || 0);
    if (rowAvailable <= 0) continue;
    const used = Math.min(rowAvailable, remaining);
    row.remainingQty = rowAvailable - used;
    remaining -= used;
    for (let i = 0; i < used; i += 1) {
      consumed.push({
        premiumMealId: row.premiumMealId,
        unitExtraFeeHalala: Number(row.unitExtraFeeHalala || 0),
        currency: row.currency || SYSTEM_CURRENCY,
      });
    }
  }
  return consumed;
}

function logWalletIntegrityError(context, meta = {}) {
  logger.error("Wallet integrity error", { context, ...meta });
}

function refundPremiumSelectionRowsToBalanceOrThrow(sub, selections) {
  for (const selection of selections) {
    const match = (sub.premiumBalance || [])
      .find(
        (row) =>
          String(row.premiumMealId) === String(selection.premiumMealId)
          && Number(row.unitExtraFeeHalala || 0) === Number(selection.unitExtraFeeHalala || 0)
          && String(row.currency || SYSTEM_CURRENCY).toUpperCase()
            === String(selection.currency || SYSTEM_CURRENCY).toUpperCase()
      );
    if (!match) {
      const err = new Error("Cannot refund premium credits because the original wallet bucket was not found");
      err.code = "DATA_INTEGRITY_ERROR";
      throw err;
    }
    const nextRemainingQty = Number(match.remainingQty || 0) + 1;
    const purchasedQty = Number(match.purchasedQty || 0);
    if (nextRemainingQty > purchasedQty) {
      const err = new Error("Cannot refund premium credits because refund exceeds purchased quantity");
      err.code = "DATA_INTEGRITY_ERROR";
      throw err;
    }
    match.remainingQty = nextRemainingQty;
  }
}

function normalizeSlotInput(slot = {}) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    return { type: "delivery", window: "", slotId: "" };
  }
  const type = slot.type && ["delivery", "pickup"].includes(slot.type) ? slot.type : "delivery";
  return {
    type,
    window: slot.window === undefined || slot.window === null ? "" : String(slot.window).trim(),
    slotId: slot.slotId === undefined || slot.slotId === null ? "" : String(slot.slotId).trim(),
  };
}

function normalizeCheckoutItemsOrThrow(rawItems, idField, itemName) {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error(`${itemName} must be an array`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const byId = new Map();
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const err = new Error(`${itemName} must contain objects`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const itemId = item[idField];
    try {
      validateObjectId(itemId, idField);
    } catch (_err) {
      const err = new Error(`${idField} must be a valid ObjectId`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const qty = parsePositiveInteger(item.qty);
    if (!qty) {
      const err = new Error(`qty must be a positive integer for ${itemName}`);
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    byId.set(String(itemId), (byId.get(String(itemId)) || 0) + qty);
  }

  return Array.from(byId.entries()).map(([id, qty]) => ({ id, qty }));
}

function normalizeCheckoutAddonSelectionsOrThrow(rawItems, itemName = "addons") {
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  if (!Array.isArray(rawItems)) {
    const err = new Error(`${itemName} must be an array`);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const selectedIds = new Set();
  for (const item of rawItems) {
    const addonId = typeof item === "string"
      ? item
      : item && typeof item === "object" && !Array.isArray(item)
        ? item.addonId
        : null;

    try {
      validateObjectId(addonId, "addonId");
    } catch (_err) {
      const err = new Error("addonId must be a valid ObjectId");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    selectedIds.add(String(addonId));
  }

  return Array.from(selectedIds.values()).map((id) => ({ id, qty: 1 }));
}

function resolveDeliveryInput(payload = {}) {
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const type = delivery.type || payload.deliveryMode || (delivery.slot && delivery.slot.type) || "delivery";
  const normalizedType = ["delivery", "pickup"].includes(type) ? type : null;
  if (!normalizedType) {
    const err = new Error("delivery.type must be one of: delivery, pickup");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const pickupLocationId = String(
    delivery.pickupLocationId
    || delivery.locationId
    || payload.pickupLocationId
    || payload.locationId
    || ""
  ).trim();
  const address = delivery.address || payload.deliveryAddress || null;
  const slot = normalizeSlotInput(
    delivery.slot || {
      type: normalizedType,
      window: delivery.window || payload.deliveryWindow || "",
      slotId: delivery.slotId || payload.deliverySlotId || payload.slotId || "",
    }
  );
  if (!slot.type) {
    slot.type = normalizedType;
  }
  if (slot.type !== normalizedType) {
    slot.type = normalizedType;
  }
  const isDelivery = normalizedType === "delivery";
  const zoneId = isDelivery && delivery.zoneId ? delivery.zoneId : null;
  const zoneName = isDelivery && delivery.zoneName ? String(delivery.zoneName || "").trim() : "";

  return { type: normalizedType, address, slot, pickupLocationId, zoneId, zoneName };
}

async function resolveCheckoutQuoteOrThrow(
  payload,
  {
    enforceActivePlan = true,
    lang = "ar",
    useGenericPremiumWallet = false,
    allowMissingDeliveryAddress = false,
  } = {}
) {
  const planId = payload && payload.planId;
  try {
    validateObjectId(planId, "planId");
  } catch (_err) {
    const err = new Error("planId must be a valid ObjectId");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const grams = parsePositiveInteger(payload.grams);
  if (!grams) {
    const err = new Error("grams must be a positive integer");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const mealsPerDay = parsePositiveInteger(payload.mealsPerDay);
  if (!mealsPerDay) {
    const err = new Error("mealsPerDay must be a positive integer");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const delivery = resolveDeliveryInput(payload || {});
  const startValidation = parseFutureStartDate(payload.startDate);
  if (!startValidation.ok) {
    const err = new Error(startValidation.message);
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const planQuery = { _id: planId };
  if (enforceActivePlan) {
    planQuery.isActive = true;
  }
  const plan = await Plan.findOne(planQuery).lean();
  if (!plan) {
    const err = new Error("Plan not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const planCurrency = assertSystemCurrencyOrThrow(plan.currency || SYSTEM_CURRENCY, "Plan currency");

  const gramsOptions = Array.isArray(plan.gramsOptions) ? plan.gramsOptions : [];
  const gramsOption = gramsOptions.find((item) => item && item.grams === grams && item.isActive !== false);
  if (!gramsOption) {
    const err = new Error("Selected grams option is not available");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const mealsOptions = Array.isArray(gramsOption.mealsOptions) ? gramsOption.mealsOptions : [];
  const mealOption = mealsOptions.find((item) => item && item.mealsPerDay === mealsPerDay && item.isActive !== false);
  if (!mealOption) {
    const err = new Error("Selected mealsPerDay option is not available");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const basePlanPriceHalala = parseNonNegativeInteger(mealOption.priceHalala);
  if (basePlanPriceHalala === null) {
    const err = new Error("Plan price is invalid");
    err.code = "INVALID_SELECTION";
    throw err;
  }

  const premiumItems = normalizeCheckoutItemsOrThrow(payload.premiumItems, "premiumMealId", "premiumItems");
  const addonItems = normalizeCheckoutAddonSelectionsOrThrow(payload.addons, "addons");

  const premiumCountInput = parseOptionalNonNegativeInteger(payload.premiumCount);
  const compatibilityPremiumCount = sumCheckoutPremiumItemsQty(premiumItems);
  if (
    useGenericPremiumWallet
    && premiumCountInput !== null
    && compatibilityPremiumCount > 0
    && premiumCountInput !== compatibilityPremiumCount
  ) {
    const err = new Error("premiumCount must match the total qty of premiumItems when both are provided");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const premiumIds = useGenericPremiumWallet ? [] : premiumItems.map((item) => item.id);
  const addonIds = addonItems.map((item) => item.id);

  const [premiumDocs, addonDocs] = await Promise.all([
    premiumIds.length ? PremiumMeal.find({ _id: { $in: premiumIds }, isActive: true }).lean() : Promise.resolve([]),
    addonIds.length ? Addon.find({ _id: { $in: addonIds }, isActive: true }).lean() : Promise.resolve([]),
  ]);

  const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));
  const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

  let premiumTotalHalala = 0;
  let resolvedPremiumItems = [];
  let premiumCount = 0;
  let premiumUnitPriceHalala = 0;
  let premiumWalletMode = LEGACY_PREMIUM_WALLET_MODE;
  if (useGenericPremiumWallet) {
    premiumCount = premiumCountInput !== null ? premiumCountInput : compatibilityPremiumCount;
    const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
    premiumUnitPriceHalala =
      Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0
        ? Math.round(premiumPriceSar * 100)
        : 0;
    premiumTotalHalala = premiumUnitPriceHalala * premiumCount;
    premiumWalletMode = GENERIC_PREMIUM_WALLET_MODE;
    resolvedPremiumItems = [];
  } else {
    for (const item of premiumItems) {
      const doc = premiumById.get(item.id);
      if (!doc) {
        const err = new Error(`Premium meal ${item.id} not found or inactive`);
        err.code = "NOT_FOUND";
        throw err;
      }
      const unit = parseNonNegativeInteger(doc.extraFeeHalala);
      if (unit === null) {
        const err = new Error(`Premium meal ${item.id} has invalid price`);
        err.code = "INVALID_SELECTION";
        throw err;
      }
      assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Premium meal ${item.id} currency`);
      premiumTotalHalala += unit * item.qty;
      resolvedPremiumItems.push({ premiumMeal: doc, qty: item.qty, unitExtraFeeHalala: unit, currency: SYSTEM_CURRENCY });
    }
    premiumCount = compatibilityPremiumCount;
  }

  let addonsTotalHalala = 0;
  const resolvedAddonItems = [];
  for (const item of addonItems) {
    const doc = addonById.get(item.id);
    if (!doc) {
      const err = new Error(`Addon ${item.id} not found or inactive`);
      err.code = "NOT_FOUND";
      throw err;
    }
    const unit = resolveAddonUnitPriceHalala(doc);
    assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon ${item.id} currency`);
    addonsTotalHalala += resolveAddonChargeTotalHalala({
      unitPriceHalala: unit,
      qty: item.qty,
      daysCount: plan.daysCount,
      type: doc.type || "subscription",
    });
    resolvedAddonItems.push({ addon: doc, qty: item.qty, unitPriceHalala: unit, currency: SYSTEM_CURRENCY });
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (delivery.slot.window && Array.isArray(windows) && windows.length && !windows.includes(delivery.slot.window)) {
    const err = new Error("Invalid delivery window");
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  if (delivery.type === "pickup" && delivery.pickupLocationId && !delivery.address) {
    const pickupLocations = await getSettingValue("pickup_locations", []);
    const resolvedPickupLocation = resolvePickupLocationSelection(
      pickupLocations,
      delivery.pickupLocationId,
      lang,
      windows
    );
    if (!resolvedPickupLocation) {
      const err = new Error("Invalid pickup location");
      err.code = "VALIDATION_ERROR";
      throw err;
    }
    delivery.address = resolvedPickupLocation.address || null;
  }
  if (delivery.type === "delivery" && !delivery.address && !allowMissingDeliveryAddress) {
    const err = new Error("Missing delivery address");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  let deliveryFeeHalala = 0;
  if (delivery.type === "delivery") {
    if (!delivery.zoneId) {
      const err = new Error("Delivery zone is required for delivery subscriptions");
      err.code = "VALIDATION_ERROR";
      throw err;
    }

    const zone = await Zone.findById(delivery.zoneId).lean();
    if (!zone) {
      const err = new Error("Delivery zone not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    // BUSINESS RULE: Inactive zones block new subscriptions only.
    if (!zone.isActive && !payload.renewedFromSubscriptionId) {
      const err = new Error("Selected delivery zone is currently inactive for new subscriptions");
      err.code = "INVALID_SELECTION";
      throw err;
    }

    delivery.zoneName = pickLang(zone.name, lang) || "";
    deliveryFeeHalala = Number(zone.deliveryFeeHalala || 0);
  }

  const subtotalHalala = basePlanPriceHalala + premiumTotalHalala + addonsTotalHalala + deliveryFeeHalala;
  const vatPercentageRaw = await getSettingValue("vat_percentage", null);
  const vatPercentage = Number(vatPercentageRaw);
  const vatHalala = Number.isFinite(vatPercentage) && vatPercentage > 0
    ? Math.round((subtotalHalala * vatPercentage) / 100)
    : 0;
  const totalHalala = subtotalHalala + vatHalala;

  return {
    plan,
    grams,
    mealsPerDay,
    startDate: startValidation.value,
    delivery,
    premiumWalletMode,
    premiumCount,
    premiumUnitPriceHalala,
    premiumItems: resolvedPremiumItems,
    addonItems: resolvedAddonItems,
    breakdown: {
      basePlanPriceHalala,
      premiumTotalHalala,
      addonsTotalHalala,
      deliveryFeeHalala,
      vatHalala,
      totalHalala,
      currency: planCurrency,
    },
  };
}

const sliceBDefaultRuntime = () => ({
  resolveCheckoutQuoteOrThrow,
  createInvoice,
  buildPhase1SubscriptionContract,
  buildCanonicalDraftPersistenceFields,
  finalizeSubscriptionDraftPaymentFlow,
  activateSubscriptionFromCanonicalDraft,
  activateSubscriptionFromLegacyDraft,
  isCanonicalCheckoutDraft,
});

function validateFutureDateOrThrow(date, sub, endDateOverride) {
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    throw err;
  }

  // CR-09 FIX: Add lower bound validation - date must be >= today
  if (!dateUtils.isOnOrAfterTodayKSADate(date)) {
    const err = new Error("Date cannot be in the past");
    err.code = "INVALID_DATE";
    throw err;
  }

  const tomorrow = dateUtils.getTomorrowKSADate();
  if (!dateUtils.isOnOrAfterKSADate(date, tomorrow)) {
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

function serializeSubscriptionDayForClient(subscription, day, runtime = sliceP2S1DefaultRuntime) {
  const serializedDay = { ...day, status: mapRawDayStatusToClientStatus(day.status) };

  // P2-S7-S1: Explicit mapping so the field is reliably included for canonical days
  // and cleanly absent (not null) for legacy days, regardless of whether spread
  // enumerates undefined Mongoose schema fields.
  const actionType = day.canonicalDayActionType;
  if (actionType !== undefined && actionType !== null) {
    serializedDay.canonicalDayActionType = actionType;
  } else {
    delete serializedDay.canonicalDayActionType;
  }

  if (runtime.isCanonicalRecurringAddonEligible(subscription)) {
    serializedDay.recurringAddons = runtime.resolveProjectedRecurringAddons({ subscription, day });
  }
  if (runtime.isCanonicalDayPlanningEligible(subscription, {
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  })) {
    const oneTimeAddonPlanning = runtime.resolveEffectiveOneTimeAddonPlanning({ day });
    if (oneTimeAddonPlanning) {
      serializedDay.oneTimeAddonSelections = oneTimeAddonPlanning.oneTimeAddonSelections;
      serializedDay.oneTimeAddonPendingCount = oneTimeAddonPlanning.oneTimeAddonPendingCount;
      serializedDay.oneTimeAddonPaymentStatus = oneTimeAddonPlanning.oneTimeAddonPaymentStatus;
    }
    const planning = runtime.buildCanonicalPlanningView({ subscription, day });
    if (planning) {
      serializedDay.planning = planning;
    }
  }
  return serializedDay;
}

function resolveSkipRemainingDays(skipPolicy, subscription) {
  return Math.max(
    Number(skipPolicy && skipPolicy.maxDays ? skipPolicy.maxDays : 0) - Number(subscription && subscription.skipDaysUsed ? subscription.skipDaysUsed : 0),
    0
  );
}

function buildProjectedOpenDayForClient(subscription, date, runtime = sliceP2S1DefaultRuntime) {
  return serializeSubscriptionDayForClient(
    subscription,
    buildProjectedDayEntry({ subscription, date, status: "open" }),
    runtime
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

function buildSkipRangeMessage(summary) {
  const requestedDays = Number(summary && summary.requestedDays ? summary.requestedDays : 0);
  const appliedDays = Number(summary && summary.appliedDays ? summary.appliedDays : 0);
  const alreadySkippedCount = Array.isArray(summary && summary.alreadySkipped) ? summary.alreadySkipped.length : 0;
  const rejected = Array.isArray(summary && summary.rejected) ? summary.rejected : [];
  const hasPlanLimitRejection = rejected.some((entry) => entry && entry.reason === "PLAN_LIMIT_REACHED");

  if (hasPlanLimitRejection) {
    return appliedDays > 0
      ? `Only ${appliedDays} day${appliedDays === 1 ? "" : "s"} applied due to plan limit`
      : "No days applied due to plan limit";
  }
  if (appliedDays === requestedDays && rejected.length === 0 && alreadySkippedCount === 0) {
    return `${appliedDays} day${appliedDays === 1 ? "" : "s"} applied`;
  }
  if (appliedDays === 0 && alreadySkippedCount > 0 && rejected.length === 0) {
    return "All requested days were already skipped";
  }
  return `Applied ${appliedDays} of ${requestedDays} requested day${requestedDays === 1 ? "" : "s"}`;
}

function resolveFreezePolicy(planDoc) {
  const source = planDoc && typeof planDoc === "object" && planDoc.freezePolicy && typeof planDoc.freezePolicy === "object"
    ? planDoc.freezePolicy
    : {};
  return {
    enabled: source.enabled === undefined ? true : Boolean(source.enabled),
    maxDays: Number.isInteger(source.maxDays) && source.maxDays >= 1 ? source.maxDays : 31,
    maxTimes: Number.isInteger(source.maxTimes) && source.maxTimes >= 0 ? source.maxTimes : 1,
  };
}

function buildDateRangeOrThrow(startDate, days, fieldName = "days") {
  if (!startDate || !dateUtils.isValidKSADateString(startDate)) {
    const err = new Error("Invalid startDate");
    err.code = "INVALID_DATE";
    throw err;
  }

  const parsedDays = parsePositiveInteger(days);
  if (!parsedDays) {
    const err = new Error(`${fieldName} must be a positive integer`);
    err.code = "INVALID";
    throw err;
  }

  return Array.from({ length: parsedDays }, (_, index) => addDaysToKSADateString(startDate, index));
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

function validateFreezeRangeOrThrow(subscription, startDate, days) {
  const targetDates = buildDateRangeOrThrow(startDate, days);
  const baseEndDate = subscription.endDate || subscription.validityEndDate;

  for (const date of targetDates) {
    validateFutureDateOrThrow(date, subscription, baseEndDate);
  }

  return { targetDates };
}

async function ensureDateRangeDoesNotIncludeLockedTomorrow(dateStrings) {
  if (!Array.isArray(dateStrings) || dateStrings.length === 0) {
    return;
  }

  const tomorrow = dateUtils.getTomorrowKSADate();
  if (!dateStrings.includes(tomorrow)) {
    return;
  }

  await enforceTomorrowCutoffOrThrow(tomorrow);
}

async function getFrozenDateStrings(subscriptionId, session) {
  const query = SubscriptionDay.find({
    subscriptionId,
    status: "frozen",
  }).select("date");
  if (session) {
    query.session(session);
  }
  const frozenDays = await query.lean();
  return frozenDays
    .map((day) => day.date)
    .filter((date) => typeof date === "string")
    .sort();
}

function countFrozenBlocks(dateStrings) {
  const uniqueSorted = Array.from(new Set(dateStrings)).sort();
  let blocks = 0;
  let previousDate = null;

  for (const date of uniqueSorted) {
    if (!previousDate || addDaysToKSADateString(previousDate, 1) !== date) {
      blocks += 1;
    }
    previousDate = date;
  }

  return blocks;
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

function parseFutureStartDate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: true, value: null };
  }
  const normalized = String(rawValue).trim();
  const bareDateMatch = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  const parsed = bareDateMatch
    ? new Date(`${normalized}T00:00:00+03:00`)
    : new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: "startDate must be a valid date" };
  }
  const parsedDate = dateUtils.toKSADateString(parsed);
  const tomorrow = dateUtils.getTomorrowKSADate();
  if (!dateUtils.isOnOrAfterKSADate(parsedDate, tomorrow)) {
    return { ok: false, message: "startDate must be a future date" };
  }
  return { ok: true, value: parsed };
}

async function enforceTomorrowCutoffOrThrow(dateStr) {
  // MEDIUM AUDIT FIX: Centralize tomorrow cutoff validation to avoid bypasses across endpoints.
  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const tomorrow = dateUtils.getTomorrowKSADate();
  if (dateStr === tomorrow && !dateUtils.isBeforeCutoff(cutoffTime)) {
    const err = new Error("Cutoff time passed for tomorrow");
    err.code = "LOCKED";
    throw err;
  }
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
      useGenericPremiumWallet:
        isPhase2GenericPremiumWalletEnabled()
        && isPhase1CanonicalCheckoutDraftWriteEnabled(),
      allowMissingDeliveryAddress: true,
    });
    return res.status(200).json({
      ok: true,
      data: {
        breakdown: quote.breakdown,
        totalSar: quote.breakdown.totalHalala / 100,
        summary: resolveQuoteSummary(quote, lang),
      },
    });
  } catch (err) {
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
  const runtime = runtimeOverrides ? { ...sliceBDefaultRuntime(), ...runtimeOverrides } : sliceBDefaultRuntime();
  let draft;
  let idempotencyKey = "";
  let requestHash = "";
  let canonicalContract = null;
  let checkoutStage = "pre_draft";
  let providerInvoiceId = "";
  let paymentUrl = "";
  try {
    const body = req.body || {};
    idempotencyKey = parseIdempotencyKey(
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
    const quote = await runtime.resolveCheckoutQuoteOrThrow(body, {
      lang,
      useGenericPremiumWallet:
        isPhase2GenericPremiumWalletEnabled()
        && isPhase1CanonicalCheckoutDraftWriteEnabled(),
    });
    const normalizedDelivery = normalizeCheckoutDeliveryForPersistence(quote.delivery);
    if (isPhase1CanonicalCheckoutDraftWriteEnabled()) {
      canonicalContract = runtime.buildPhase1SubscriptionContract({
        payload: body,
        resolvedQuote: quote,
        actorContext: { actorRole: "client", actorUserId: req.userId },
        source: "customer_checkout",
        now: new Date(),
      });
    }
    requestHash = buildCheckoutRequestHash({ userId: req.userId, quote });

    const existingByKey = await CheckoutDraft.findOne({
      userId: req.userId,
      idempotencyKey,
    }).sort({ createdAt: -1 }).lean();

    if (existingByKey) {
      if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          "idempotencyKey is already used with a different checkout payload"
        );
      }

      const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(existingByKey._id, { mode: RECONCILE_MODES.PERSIST });
      const currentDraft = reconciledDraft || existingByKey;
      const currentPayment = reconciledPayment;

      if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
      }

      if (currentDraft.status === "completed") {
        return res.status(200).json({
          ok: true,
          data: {
            ...buildCheckoutReusePayload(currentDraft, currentPayment),
            checkoutStatusLabel: resolveReadLabel("checkoutStatuses", "completed", lang),
            paymentStatusLabel: resolveReadLabel("paymentStatuses", "paid", lang),
            checkedProvider: true,
            synchronized: true,
          }
        });
      }

      if (currentDraft.status === "pending_payment") {
        const isStale = (new Date() - new Date(currentDraft.createdAt)) > STALE_DRAFT_THRESHOLD_MS;
        if (isStale) {
          // It's a zombie. Mark as abandoned to allow retry.
          await CheckoutDraft.updateOne(
            { _id: currentDraft._id },
            { $set: { status: "failed", failureReason: "stale_abandoned", updatedAt: new Date() } }
          );
          currentDraft.status = "failed";
          currentDraft.failureReason = "stale_abandoned";
          await releaseCheckoutDraftIdempotencyKey(currentDraft, {
            stage: "existing_by_key_stale",
            failureReason: "stale_abandoned",
          });
        } else {
          // Before returning 409, check if the invoice has a resolved status
          if (currentPayment && currentPayment.providerInvoiceId) {
            try {
              const invoice = await getInvoice(currentPayment.providerInvoiceId);
              const invoiceStatus = (invoice && invoice.status || "").toLowerCase();
              
              // If invoice is paid, we can reuse this draft
              if (invoiceStatus === "paid" || invoiceStatus === "captured") {
                return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
              }
              
              // If invoice is failed/expired/canceled, mark draft as failed and allow new checkout
              if (["failed", "expired", "canceled"].includes(invoiceStatus)) {
                await CheckoutDraft.updateOne(
                  { _id: currentDraft._id },
                  { $set: { status: "failed", failureReason: `invoice_${invoiceStatus}`, updatedAt: new Date() } }
                );
                currentDraft.status = "failed";
                currentDraft.failureReason = `invoice_${invoiceStatus}`;
                await releaseCheckoutDraftIdempotencyKey(currentDraft, {
                  stage: "existing_by_key_invoice_terminal",
                  failureReason: `invoice_${invoiceStatus}`,
                });
                // Continue to create new draft below
              } else {
                // Invoice is still pending, return 409
                return errorResponse(
                  res,
                  409,
                  "CHECKOUT_IN_PROGRESS",
                  "Checkout initialization is still in progress. Retry with the same idempotency key.",
                  { draftId: String(currentDraft._id) }
                );
              }
            } catch (err) {
              // If we can't fetch invoice status, be conservative and return 409
              logger.warn("Failed to fetch invoice status during checkout reconciliation", { 
                draftId: String(currentDraft._id),
                error: err.message
              });
              return errorResponse(
                res,
                409,
                "CHECKOUT_IN_PROGRESS",
                "Checkout initialization is still in progress. Retry with the same idempotency key.",
                { draftId: String(currentDraft._id) }
              );
            }
          } else {
            // No payment info, return 409
            return errorResponse(
              res,
              409,
              "CHECKOUT_IN_PROGRESS",
              "Checkout initialization is still in progress. Retry with the same idempotency key.",
              { draftId: String(currentDraft._id) }
            );
          }
        }
      } else if (["failed", "canceled", "expired"].includes(String(currentDraft.status || "").trim())) {
        await releaseCheckoutDraftIdempotencyKey(currentDraft, {
          stage: "existing_by_key_terminal_retry",
        });
      } else {
        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `idempotencyKey is already finalized with status ${currentDraft.status}`
        );
      }
    }

    const existingByHash = await CheckoutDraft.findOne({
      userId: req.userId,
      requestHash,
      status: "pending_payment",
    }).sort({ createdAt: -1 }).lean();

    if (existingByHash) {
      const { draft: reconciledByHash, payment: reconciledPaymentByHash } = await reconcileCheckoutDraft(existingByHash._id, { mode: RECONCILE_MODES.PERSIST });
      const currentDraft = reconciledByHash || existingByHash;
      const currentPayment = reconciledPaymentByHash;

      if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
      }

      if (currentDraft.status === "completed") {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
      }

      const isStale = (new Date() - new Date(currentDraft.createdAt)) > STALE_DRAFT_THRESHOLD_MS;
      if (isStale) {
        // It's a zombie. Mark as abandoned to allow retry with new idempotency key/hash lock.
        await CheckoutDraft.updateOne({ _id: currentDraft._id }, { $set: { status: "failed", failureReason: "stale_abandoned" } });
      } else {
        // Before returning 409, check if the invoice has a resolved status
        if (currentPayment && currentPayment.providerInvoiceId) {
          try {
            const invoice = await getInvoice(currentPayment.providerInvoiceId);
            const invoiceStatus = (invoice && invoice.status || "").toLowerCase();
            
            // If invoice is paid, we can reuse this draft
            if (invoiceStatus === "paid" || invoiceStatus === "captured") {
              return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
            }
            
            // If invoice is failed/expired/canceled, mark draft as failed and allow new checkout
            if (["failed", "expired", "canceled"].includes(invoiceStatus)) {
              await CheckoutDraft.updateOne(
                { _id: currentDraft._id },
                { $set: { status: "failed", failureReason: `invoice_${invoiceStatus}` } }
              );
              // Continue to create new draft below
            } else {
              // Invoice is still pending, return 409
              return errorResponse(
                res,
                409,
                "CHECKOUT_IN_PROGRESS",
                "Checkout initialization is still in progress. Retry with the same idempotency key.",
                { draftId: String(currentDraft._id) }
              );
            }
          } catch (err) {
            // If we can't fetch invoice status, be conservative and return 409
            logger.warn("Failed to fetch invoice status during checkout reconciliation (by hash)", { 
              draftId: String(currentDraft._id),
              error: err.message
            });
            return errorResponse(
              res,
              409,
              "CHECKOUT_IN_PROGRESS",
              "Checkout initialization is still in progress. Retry with the same idempotency key.",
              { draftId: String(currentDraft._id) }
            );
          }
        } else {
          // No payment info, return 409
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same idempotency key.",
            { draftId: String(currentDraft._id) }
          );
        }
      }
    }

    const addonSubscriptions = canonicalContract
      ? buildRecurringAddonEntitlementsFromQuote({ addonItems: quote.addonItems, lang })
      : quote.addonItems
        .filter((item) => String(item && item.addon && item.addon.type ? item.addon.type : "subscription") !== "one_time")
        .map((item) => ({
          addonId: item.addon._id,
          name: pickLang(item.addon.name, lang),
          price: item.unitPriceHalala / 100,
          type: item.addon.type || "subscription",
          category: item.addon.category || "",
          maxPerDay: 1,
        }));

    logger.debug("[DEBUG-CHECKOUT] Creating draft", { userId: String(req.userId) });
    checkoutStage = "draft_create";
    draft = await CheckoutDraft.create({
      userId: req.userId,
      planId: quote.plan._id,
      idempotencyKey,
      requestHash,
      daysCount: quote.plan.daysCount,
      grams: quote.grams,
      mealsPerDay: quote.mealsPerDay,
      startDate: canonicalContract ? canonicalContract.resolvedStart.resolvedStartDate : (quote.startDate || undefined),
      delivery: normalizedDelivery,
      premiumItems: quote.premiumItems.map((item) => ({
        premiumMealId: item.premiumMeal._id,
        qty: item.qty,
        unitExtraFeeHalala: item.unitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      })),
      premiumWalletMode: quote.premiumWalletMode || LEGACY_PREMIUM_WALLET_MODE,
      premiumCount: Number(quote.premiumCount || 0),
      premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
      addonItems: quote.addonItems.map((item) => ({
        addonId: item.addon._id,
        qty: item.qty,
        unitPriceHalala: item.unitPriceHalala,
        currency: SYSTEM_CURRENCY,
      })),
      addonSubscriptions,
      breakdown: { ...quote.breakdown, currency: SYSTEM_CURRENCY },
      ...(canonicalContract ? runtime.buildCanonicalDraftPersistenceFields({ contract: canonicalContract }) : {}),
    });

    logger.debug("[DEBUG-CHECKOUT] Draft created", { draftId: String(draft._id) });
    const appUrl = process.env.APP_URL || "https://example.com";
    checkoutStage = "invoice_create";
    logger.debug("[DEBUG-CHECKOUT] Calling createInvoice", {
      draftId: String(draft._id),
      totalHalala: Number(quote && quote.breakdown && quote.breakdown.totalHalala || 0),
    });
    const invoice = await runtime.createInvoice({
      amount: quote.breakdown.totalHalala,
      description: buildPaymentDescription("subscriptionCheckout", lang, {
        daysCount: Number(quote.plan.daysCount || 0),
      }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(body.successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(body.backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "subscription_activation",
        draftId: String(draft._id),
        userId: String(req.userId),
        grams: quote.grams,
        mealsPerDay: quote.mealsPerDay,
      },
    });
    providerInvoiceId = getInvoiceResponseId(invoice);
    paymentUrl = getInvoiceResponseUrl(invoice);
    logger.debug("[DEBUG-CHECKOUT] createInvoice returned", {
      draftId: String(draft._id),
      hasInvoiceId: Boolean(providerInvoiceId),
    });

    if (!providerInvoiceId || !paymentUrl) {
      const invalidInvoiceErr = new Error("Invoice response missing required payment fields");
      invalidInvoiceErr.code = "PAYMENT_PROVIDER_INVALID_RESPONSE";
      throw invalidInvoiceErr;
    }

    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");
    const paymentType = resolveSubscriptionCheckoutPaymentType({ renewedFromSubscriptionId: null });
    const paymentPromise = ensureSubscriptionCheckoutPayment({
      draft,
      paymentType,
      totalHalala: quote.breakdown.totalHalala,
      invoiceCurrency,
      providerInvoiceId,
      paymentUrl,
    });

    checkoutStage = "draft_invoice_persist";
    await persistCheckoutDraftUpdate(
      draft,
      {
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      },
      { stage: checkoutStage }
    );

    checkoutStage = "payment_create";
    logger.debug("[DEBUG-CHECKOUT] Creating payment record", {
      draftId: String(draft._id),
    });
    const payment = await paymentPromise;
    logger.debug("[DEBUG-CHECKOUT] Payment record created", {
      draftId: String(draft._id),
      paymentId: String(payment._id),
    });

    checkoutStage = "draft_payment_link_persist";
    await persistCheckoutDraftUpdate(
      draft,
      {
        paymentId: payment._id,
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      },
      { stage: checkoutStage }
    );

    return res.status(201).json({
      ok: true,
      data: {
        subscriptionId: null,
        draftId: draft.id,
        paymentId: payment.id,
        payment_url: draft.paymentUrl,
        totals: quote.breakdown,
      },
    });
  } catch (err) {
    if (!draft && err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (!draft && err.code === "NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (!draft && err.code === "INVALID_SELECTION") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    if (!draft && isCheckoutDraftDuplicateKeyError(err)) {
      let existingDraft = null;
      existingDraft = await CheckoutDraft.findOne({ userId: req.userId, idempotencyKey }).lean();
      if (!existingDraft && requestHash) {
        existingDraft = await CheckoutDraft.findOne({
          userId: req.userId,
          requestHash,
          status: "pending_payment",
        }).sort({ createdAt: -1 }).lean();
      }
      if (existingDraft) {
        const existingPayment = existingDraft.paymentId ? await Payment.findById(existingDraft.paymentId).lean() : null;
        if (isPendingCheckoutReusable(existingDraft, existingPayment)) {
          return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(existingDraft, existingPayment) });
        }

        if (existingDraft.status === "pending_payment") {
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same idempotency key.",
            { draftId: String(existingDraft._id) }
          );
        }

        if (existingDraft.status === "completed") {
          return res.status(200).json({
            ok: true,
            data: {
              ...buildCheckoutReusePayload(existingDraft, existingPayment),
              checkoutStatusLabel: resolveReadLabel("checkoutStatuses", "completed", lang),
              paymentStatusLabel: resolveReadLabel("paymentStatuses", "paid", lang),
              checkedProvider: true,
              synchronized: true,
            }
          });
        }

        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `idempotencyKey is already finalized with status ${existingDraft.status}`
        );
      }
    }
    await persistCheckoutInitializationFailure(draft, err, {
      stage: checkoutStage,
      providerInvoiceId,
      paymentUrl,
    });
    logger.error("Subscription checkout failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Checkout failed");
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
    const { draft, payment, invoice } = await reconcileCheckoutDraft(draftId, { mode: RECONCILE_MODES.READ_ONLY });
    if (!draft) {
      return errorResponse(res, 404, "NOT_FOUND", "Checkout draft not found");
    }
    if (String(draft.userId) !== String(req.userId)) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    return res.status(200).json({
      ok: true,
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
      ok: true,
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
        ok: true,
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
      ok: true,
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
  const { id } = req.params;
  // SECURITY FIX: Mock activation endpoint must be disabled in production.
  if (process.env.NODE_ENV === "production") {
    return errorResponse(res, 403, "FORBIDDEN", "Mock activation is disabled in production");
  }
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  if (sub.status === "active") return res.status(200).json({ ok: true, message: "Already active" });

  sub.status = "active";
  const start = new Date(sub.startDate);
  sub.endDate = addDays(start, sub.planId.daysCount - 1);
  sub.validityEndDate = sub.endDate;
  await sub.save();

  const dayEntries = [];
  for (let i = 0; i < sub.planId.daysCount; i++) {
    const currentDate = addDays(start, i);
    dayEntries.push(buildProjectedDayEntry({
      subscription: sub,
      date: dateUtils.toKSADateString(currentDate),
      status: "open",
    }));
  }
  await SubscriptionDay.insertMany(dayEntries);

  res.status(200).json({ ok: true, data: sub });
}

async function buildSubscriptionSummaries(subscription, lang) {
  if (isGenericPremiumWalletMode(subscription)) {
    const genericRows = (Array.isArray(subscription.genericPremiumBalance) ? subscription.genericPremiumBalance : [])
      .slice()
      .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime());
    const purchasedQtyTotal = genericRows.reduce((sum, row) => sum + Number(row.purchasedQty || 0), 0);
    const remainingQtyTotal = genericRows.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    const unitValues = genericRows.map((row) => Number(row.unitCreditPriceHalala || 0));
    return {
      premiumSummary: [{
        premiumMealId: null,
        name: getGenericPremiumCreditsLabel(lang),
        purchasedQtyTotal,
        remainingQtyTotal,
        consumedQtyTotal: Math.max(0, purchasedQtyTotal - remainingQtyTotal),
        minUnitPriceHalala: unitValues.length ? Math.min(...unitValues) : 0,
        maxUnitPriceHalala: unitValues.length ? Math.max(...unitValues) : 0,
      }],
      addonsSummary: await (async () => {
        const addonBalance = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
        const addonSelections = Array.isArray(subscription.addonSelections) ? subscription.addonSelections : [];
        const addonById = new Map();
        for (const row of addonBalance) {
          const key = String(row.addonId);
          const current = addonById.get(key) || {
            addonId: key,
            purchasedQtyTotal: 0,
            remainingQtyTotal: 0,
            consumedQtyTotal: 0,
            minUnitPriceHalala: null,
            maxUnitPriceHalala: null,
          };
          current.purchasedQtyTotal += Number(row.purchasedQty || 0);
          current.remainingQtyTotal += Number(row.remainingQty || 0);
          const unit = Number(row.unitPriceHalala || 0);
          current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
          current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
          addonById.set(key, current);
        }
        for (const row of addonSelections) {
          const key = String(row.addonId);
          const current = addonById.get(key) || {
            addonId: key,
            purchasedQtyTotal: 0,
            remainingQtyTotal: 0,
            consumedQtyTotal: 0,
            minUnitPriceHalala: Number(row.unitPriceHalala || 0),
            maxUnitPriceHalala: Number(row.unitPriceHalala || 0),
          };
          current.consumedQtyTotal += Number(row.qty || 0);
          addonById.set(key, current);
        }
        const addonIds = Array.from(addonById.keys());
        const addonDocs = addonIds.length ? await Addon.find({ _id: { $in: addonIds } }).lean() : [];
        const addonNames = new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)]));
        return Array.from(addonById.values()).map((row) => ({
          addonId: row.addonId,
          name: addonNames.get(row.addonId) || "",
          purchasedQtyTotal: row.purchasedQtyTotal,
          remainingQtyTotal: row.remainingQtyTotal,
          consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
          minUnitPriceHalala: row.minUnitPriceHalala || 0,
          maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
        }));
      })(),
    };
  }

  const premiumBalance = Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance : [];
  const addonBalance = Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [];
  const premiumSelections = Array.isArray(subscription.premiumSelections) ? subscription.premiumSelections : [];
  const addonSelections = Array.isArray(subscription.addonSelections) ? subscription.addonSelections : [];

  const premiumById = new Map();
  for (const row of premiumBalance) {
    const key = String(row.premiumMealId);
    const current = premiumById.get(key) || {
      premiumMealId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: null,
      maxUnitPriceHalala: null,
    };
    current.purchasedQtyTotal += Number(row.purchasedQty || 0);
    current.remainingQtyTotal += Number(row.remainingQty || 0);
    const unit = Number(row.unitExtraFeeHalala || 0);
    current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
    current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
    premiumById.set(key, current);
  }
  for (const row of premiumSelections) {
    const key = String(row.premiumMealId);
    const current = premiumById.get(key) || {
      premiumMealId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: Number(row.unitExtraFeeHalala || 0),
      maxUnitPriceHalala: Number(row.unitExtraFeeHalala || 0),
    };
    current.consumedQtyTotal += 1;
    premiumById.set(key, current);
  }

  const addonById = new Map();
  for (const row of addonBalance) {
    const key = String(row.addonId);
    const current = addonById.get(key) || {
      addonId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: null,
      maxUnitPriceHalala: null,
    };
    current.purchasedQtyTotal += Number(row.purchasedQty || 0);
    current.remainingQtyTotal += Number(row.remainingQty || 0);
    const unit = Number(row.unitPriceHalala || 0);
    current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
    current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
    addonById.set(key, current);
  }
  for (const row of addonSelections) {
    const key = String(row.addonId);
    const current = addonById.get(key) || {
      addonId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: Number(row.unitPriceHalala || 0),
      maxUnitPriceHalala: Number(row.unitPriceHalala || 0),
    };
    current.consumedQtyTotal += Number(row.qty || 0);
    addonById.set(key, current);
  }

  const premiumIds = Array.from(premiumById.keys());
  const addonIds = Array.from(addonById.keys());
  const [premiumDocs, addonDocs] = await Promise.all([
    premiumIds.length ? PremiumMeal.find({ _id: { $in: premiumIds } }).lean() : Promise.resolve([]),
    addonIds.length ? Addon.find({ _id: { $in: addonIds } }).lean() : Promise.resolve([]),
  ]);
  const premiumNames = new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)]));
  const addonNames = new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang)]));

  const premiumSummary = Array.from(premiumById.values()).map((row) => ({
    premiumMealId: row.premiumMealId,
    name: premiumNames.get(row.premiumMealId) || "",
    purchasedQtyTotal: row.purchasedQtyTotal,
    remainingQtyTotal: row.remainingQtyTotal,
    consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
    minUnitPriceHalala: row.minUnitPriceHalala || 0,
    maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
  }));

  const addonsSummary = Array.from(addonById.values()).map((row) => ({
    addonId: row.addonId,
    name: addonNames.get(row.addonId) || "",
    purchasedQtyTotal: row.purchasedQtyTotal,
    remainingQtyTotal: row.remainingQtyTotal,
    consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
    minUnitPriceHalala: row.minUnitPriceHalala || 0,
    maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
  }));

  return { premiumSummary, addonsSummary };
}

async function buildSubscriptionWalletSnapshot(subscription, lang) {
  const { premiumSummary, addonsSummary } = await buildSubscriptionSummaries(subscription, lang);
  const catalog = await loadWalletCatalogMaps({ subscription, lang });
  const premiumBalance = isGenericPremiumWalletMode(subscription)
    ? (Array.isArray(subscription.genericPremiumBalance) ? subscription.genericPremiumBalance : [])
      .slice()
      .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime())
      .map((row) => ({
        id: row._id ? String(row._id) : null,
        premiumMealId: null,
        purchasedQty: Number(row.purchasedQty || 0),
        remainingQty: Number(row.remainingQty || 0),
        unitExtraFeeHalala: Number(row.unitCreditPriceHalala || 0),
        currency: row.currency || SYSTEM_CURRENCY,
        purchasedAt: row.purchasedAt || null,
        walletMode: GENERIC_PREMIUM_WALLET_MODE,
        name: catalog.legacyPremiumLabel,
      }))
    : (Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance : [])
      .slice()
      .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime())
      .map((row) => ({
        id: row._id ? String(row._id) : null,
        premiumMealId: row.premiumMealId ? String(row.premiumMealId) : null,
        purchasedQty: Number(row.purchasedQty || 0),
        remainingQty: Number(row.remainingQty || 0),
        unitExtraFeeHalala: Number(row.unitExtraFeeHalala || 0),
        currency: row.currency || SYSTEM_CURRENCY,
        purchasedAt: row.purchasedAt || null,
        walletMode: LEGACY_PREMIUM_WALLET_MODE,
        name: row && row.premiumMealId && String(row.premiumMealId) !== LEGACY_PREMIUM_MEAL_BUCKET_ID
          ? resolveCatalogOrStoredName({
            id: String(row.premiumMealId),
            liveName: catalog.premiumNames.get(String(row.premiumMealId)) || "",
            storedName: "",
            lang,
          })
          : catalog.legacyPremiumLabel,
      }));
  const addonBalance = (Array.isArray(subscription.addonBalance) ? subscription.addonBalance : [])
    .slice()
    .sort((a, b) => new Date(a.purchasedAt || 0).getTime() - new Date(b.purchasedAt || 0).getTime())
    .map((row) => ({
      id: row._id ? String(row._id) : null,
      addonId: row.addonId ? String(row.addonId) : null,
      purchasedQty: Number(row.purchasedQty || 0),
      remainingQty: Number(row.remainingQty || 0),
      unitPriceHalala: Number(row.unitPriceHalala || 0),
      currency: row.currency || SYSTEM_CURRENCY,
      purchasedAt: row.purchasedAt || null,
      name: row && row.addonId
        ? resolveCatalogOrStoredName({
          id: String(row.addonId),
          liveName: catalog.addonNames.get(String(row.addonId)) || "",
          storedName: "",
          lang,
        })
        : "",
    }));

  return {
    subscriptionId: String(subscription._id),
    premiumWalletMode: isGenericPremiumWalletMode(subscription)
      ? GENERIC_PREMIUM_WALLET_MODE
      : LEGACY_PREMIUM_WALLET_MODE,
    premiumRemaining: getRemainingPremiumCredits(subscription),
    premiumSummary,
    addonsSummary,
    premiumBalance,
    addonBalance,
    totals: {
      premiumPurchasedQtyTotal: premiumBalance.reduce((sum, row) => sum + row.purchasedQty, 0),
      premiumRemainingQtyTotal: premiumBalance.reduce((sum, row) => sum + row.remainingQty, 0),
      addonPurchasedQtyTotal: addonBalance.reduce((sum, row) => sum + row.purchasedQty, 0),
      addonRemainingQtyTotal: addonBalance.reduce((sum, row) => sum + row.remainingQty, 0),
    },
  };
}

async function serializeSubscriptionForClient(subscription, lang) {
  const { premiumSummary, addonsSummary } = await buildSubscriptionSummaries(subscription, lang);
  const catalog = await loadWalletCatalogMaps({ subscription, lang });
  const contractReadView = getSubscriptionContractReadView(subscription, {
    audience: "client",
    lang,
    context: "client_subscription_read",
  });
  const deliverySlot = subscription.deliverySlot && typeof subscription.deliverySlot === "object"
    ? subscription.deliverySlot
    : {
      type: subscription.deliveryMode,
      window: subscription.deliveryWindow || "",
      slotId: "",
    };
  const data = { ...subscription };
  delete data.__v;
  delete data.premiumBalance;
  delete data.genericPremiumBalance;
  delete data.addonBalance;
  delete data.premiumSelections;
  delete data.addonSelections;

  data.status = resolveEffectiveSubscriptionStatus(data, dateUtils.getTodayKSADate()) || data.status;

  return localizeSubscriptionReadPayload({
    ...data,
    deliveryAddress: subscription.deliveryAddress || null,
    deliverySlot,
    premiumSummary,
    addonsSummary,
    contract: contractReadView.contract,
  }, {
    lang,
    addonNames: catalog.addonNames,
    planName: contractReadView.planName || "",
  });
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
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const lang = getRequestLang(req);

  return res.status(200).json({
    ok: true,
    data: await serializeSubscriptionForClient(sub, lang),
  });
}

async function getCurrentSubscriptionOverview(req, res) {
  const userId = req.userId;
  const lang = getRequestLang(req);

  try {
    // Find active or pending_payment subscription, most recent first
    const sub = await Subscription.findOne(
      {
        userId,
        status: { $in: ["active", "pending_payment"] },
      },
      null,
      { sort: { createdAt: -1 } }
    ).lean();

    if (!sub) {
      return res.status(200).json({
        ok: true,
        data: null,
      });
    }

    return res.status(200).json({
      ok: true,
      data: await serializeSubscriptionForClient(sub, lang),
    });
  } catch (err) {
    logger.error("subscriptionController.getCurrentSubscriptionOverview failed", {
      error: err.message,
      stack: err.stack,
      userId: userId ? String(userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL", "Failed to retrieve current subscription");
  }
}

async function cancelSubscription(req, res, runtimeOverrides = null) {
  const { id } = req.params;
  const runtime = resolveCancelSubscriptionRuntime(runtimeOverrides);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  let result;
  try {
    result = await runtime.cancelSubscriptionDomain({
      subscriptionId: id,
      actor: { kind: "client", userId: req.userId },
    });
  } catch (err) {
    logger.error("subscriptionController.cancelSubscription failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: id,
      userId: req.userId ? String(req.userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL", "Subscription cancellation failed");
  }

  if (result.outcome === "not_found") {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }

  if (result.outcome === "forbidden") {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  if (result.outcome === "invalid_transition") {
    return errorResponse(
      res,
      409,
      "INVALID_TRANSITION",
      "Only pending_payment or active subscriptions can be canceled"
    );
  }

  if (!["canceled", "already_canceled"].includes(result.outcome)) {
    logger.error("subscriptionController.cancelSubscription received unsupported outcome", {
      outcome: result.outcome,
      subscriptionId: id,
      userId: req.userId ? String(req.userId) : undefined,
    });
    return errorResponse(res, 500, "INTERNAL", "Subscription cancellation failed");
  }

  const subscription = await runtime.findSubscriptionById(result.subscriptionId || id);
  if (!subscription) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }

  const serialized = await runtime.serializeSubscriptionForClient(subscription, getRequestLang(req));

  if (result.outcome === "already_canceled") {
    return res.status(200).json({
      ok: true,
      data: serialized,
      idempotent: true,
    });
  }

  await runtime.writeLogSafely({
    entityType: "subscription",
    entityId: result.subscriptionId || id,
    action: "subscription_canceled_by_client",
    byUserId: req.userId,
    byRole: "client",
    meta: result.mutation,
  }, {
    subscriptionId: id,
    userId: req.userId ? String(req.userId) : undefined,
  });

  return res.status(200).json({
    ok: true,
    data: serialized,
  });
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
      ok: true,
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
      ok: true,
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
    ok: true,
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
    ok: true,
    data: localizeTimelineReadPayload(timeline, lang),
  });
}

async function listCurrentUserSubscriptions(req, res) {
  const subscriptions = await Subscription.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  const lang = getRequestLang(req);
  const data = await Promise.all(subscriptions.map((subscription) => serializeSubscriptionForClient(subscription, lang)));
  return res.status(200).json({ ok: true, data });
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
      ok: true,
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
  const runtime = runtimeOverrides ? { ...sliceBDefaultRuntime(), ...runtimeOverrides } : sliceBDefaultRuntime();
  const { id } = req.params;
  const body = req.body || {};
  const lang = getRequestLang(req);
  let draft;
  let requestHash = "";
  let renewalStage = "pre_draft";
  let providerInvoiceId = "";
  let paymentUrl = "";

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const previousSubscription = await Subscription.findById(id).lean();
  if (!previousSubscription) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(previousSubscription.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  // Verify subscription is eligible for renewal (either expired or in final stages)
  const today = dateUtils.getTodayKSADate();
  const endDate = previousSubscription.validityEndDate || previousSubscription.endDate;
  const endDateStr = endDate ? dateUtils.toKSADateString(endDate) : null;
  if (endDateStr && endDateStr > today) {
    return errorResponse(res, 422, "RENEWAL_PREMATURE", "Cannot renew an active subscription");
  }

  // Extract renewal parameters from previous subscription or body
  const candidatePlanId = previousSubscription.contractSnapshot
    && previousSubscription.contractSnapshot.plan
    && previousSubscription.contractSnapshot.plan.planId
    ? previousSubscription.contractSnapshot.plan.planId
    : previousSubscription.planId;

  if (!candidatePlanId) {
    return errorResponse(res, 422, "RENEWAL_UNAVAILABLE", "Subscription does not have enough base configuration to renew");
  }

  // Use previous parameters as defaults, allow overrides from body
  const renewalPayload = {
    planId: body.planId || candidatePlanId,
    grams: body.grams !== undefined ? body.grams : (previousSubscription.selectedGrams || 1000),
    mealsPerDay: body.mealsPerDay !== undefined ? body.mealsPerDay : (previousSubscription.selectedMealsPerDay || 1),
    premiumItems: body.premiumItems || [],
    addons: body.addons || [],
    delivery: {
      type: body.delivery && body.delivery.type ? body.delivery.type : (previousSubscription.deliveryMode || "delivery"),
      address: body.delivery && body.delivery.address ? body.delivery.address : (previousSubscription.deliveryAddress || null),
      slot: body.delivery && body.delivery.slot ? body.delivery.slot : (previousSubscription.deliverySlot || {}),
      zoneId: body.delivery && body.delivery.zoneId ? body.delivery.zoneId : (previousSubscription.deliveryZoneId || null),
      pickupLocationId: body.delivery && body.delivery.pickupLocationId ? body.delivery.pickupLocationId : null,
    },
    renewedFromSubscriptionId: id,
    startDate: body.startDate || null,
    idempotencyKey: parseIdempotencyKey(
      req.get("Idempotency-Key")
      || req.get("X-Idempotency-Key")
      || body.idempotencyKey
    ),
  };

  if (!renewalPayload.idempotencyKey) {
    return sendValidationError(
      res,
      "idempotencyKey is required (Idempotency-Key header, X-Idempotency-Key header, or body.idempotencyKey)"
    );
  }

  try {
    // Use same checkout quote resolver with renewal context
    const quote = await runtime.resolveCheckoutQuoteOrThrow(renewalPayload, {
      lang,
      useGenericPremiumWallet:
        isPhase2GenericPremiumWalletEnabled()
        && isPhase1CanonicalCheckoutDraftWriteEnabled(),
      enforceActivePlan: true,
    });
    const normalizedDelivery = normalizeCheckoutDeliveryForPersistence(quote.delivery);

    // Proceed with checkout (standard flow)
    if (isPhase1CanonicalCheckoutDraftWriteEnabled()) {
      const canonicalContract = runtime.buildPhase1SubscriptionContract({
        payload: renewalPayload,
        resolvedQuote: quote,
        actorContext: { actorRole: "client", actorUserId: req.userId },
        source: "renewal",
        now: new Date(),
      });
      renewalPayload.contractVersion = canonicalContract.contractVersion;
      renewalPayload.contractMode = canonicalContract.contractMode;
    }

    requestHash = buildCheckoutRequestHash({ userId: req.userId, quote });
    const existingByKey = await CheckoutDraft.findOne({
      userId: req.userId,
      idempotencyKey: renewalPayload.idempotencyKey,
    }).sort({ createdAt: -1 }).lean();

    if (existingByKey) {
      if (existingByKey.requestHash && existingByKey.requestHash !== requestHash) {
        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          "idempotencyKey is already used with a different renewal payload"
        );
      }

      const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(existingByKey._id, {
        mode: RECONCILE_MODES.PERSIST,
      });
      const currentDraft = reconciledDraft || existingByKey;
      const currentPayment = reconciledPayment;

      if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
        return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
      }
      if (currentDraft.status === "completed" && currentDraft.subscriptionId) {
        const newSub = await Subscription.findById(currentDraft.subscriptionId).lean();
        return res.status(200).json({
          ok: true,
          data: await serializeSubscriptionForClient(newSub, lang),
        });
      }

      if (currentDraft.status === "pending_payment") {
        const isStale = (new Date() - new Date(currentDraft.createdAt)) > STALE_DRAFT_THRESHOLD_MS;
        if (isStale) {
          await CheckoutDraft.updateOne(
            { _id: currentDraft._id },
            { $set: { status: "failed", failureReason: "stale_abandoned", updatedAt: new Date() } }
          );
          currentDraft.status = "failed";
          currentDraft.failureReason = "stale_abandoned";
          await releaseCheckoutDraftIdempotencyKey(currentDraft, {
            stage: "renewal_existing_by_key_stale",
            failureReason: "stale_abandoned",
          });
        } else if (currentPayment && currentPayment.providerInvoiceId) {
          try {
            const invoice = await getInvoice(currentPayment.providerInvoiceId);
            const invoiceStatus = String(invoice && invoice.status || "").toLowerCase();

            if (invoiceStatus === "paid" || invoiceStatus === "captured") {
              return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
            }

            if (["failed", "expired", "canceled"].includes(invoiceStatus)) {
              await CheckoutDraft.updateOne(
                { _id: currentDraft._id },
                { $set: { status: "failed", failureReason: `invoice_${invoiceStatus}`, updatedAt: new Date() } }
              );
              currentDraft.status = "failed";
              currentDraft.failureReason = `invoice_${invoiceStatus}`;
              await releaseCheckoutDraftIdempotencyKey(currentDraft, {
                stage: "renewal_existing_by_key_invoice_terminal",
                failureReason: `invoice_${invoiceStatus}`,
              });
            } else {
              return errorResponse(
                res,
                409,
                "CHECKOUT_IN_PROGRESS",
                "Checkout initialization is still in progress. Retry with the same idempotency key.",
                { draftId: String(currentDraft._id) }
              );
            }
          } catch (err) {
            logger.warn("Failed to fetch renewal invoice status during checkout reconciliation", {
              draftId: String(currentDraft._id),
              error: err.message,
            });
            return errorResponse(
              res,
              409,
              "CHECKOUT_IN_PROGRESS",
              "Checkout initialization is still in progress. Retry with the same idempotency key.",
              { draftId: String(currentDraft._id) }
            );
          }
        } else {
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same idempotency key.",
            { draftId: String(currentDraft._id) }
          );
        }
      } else if (["failed", "canceled", "expired"].includes(String(currentDraft.status || "").trim())) {
        await releaseCheckoutDraftIdempotencyKey(currentDraft, {
          stage: "renewal_existing_by_key_terminal_retry",
        });
      } else {
        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `idempotencyKey is already finalized with status ${currentDraft.status}`
        );
      }
    }

    // Create checkout draft - same as regular checkout
    const draftPayload = {
      userId: req.userId,
      planId: quote.plan._id,
      idempotencyKey: renewalPayload.idempotencyKey,
      requestHash,
      daysCount: quote.plan.daysCount,
      grams: quote.grams,
      mealsPerDay: quote.mealsPerDay,
      startDate: quote.startDate || undefined,
      delivery: normalizedDelivery,
      premiumItems: quote.premiumItems.map((item) => ({
        premiumMealId: item.premiumMeal._id,
        qty: item.qty,
        unitExtraFeeHalala: item.unitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      })),
      premiumWalletMode: quote.premiumWalletMode || LEGACY_PREMIUM_WALLET_MODE,
      premiumCount: Number(quote.premiumCount || 0),
      premiumUnitPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
      addonItems: quote.addonItems.map((item) => ({
        addonId: item.addon._id,
        qty: item.qty,
        unitPriceHalala: item.unitPriceHalala,
        currency: SYSTEM_CURRENCY,
      })),
      addonSubscriptions: buildRecurringAddonEntitlementsFromQuote({ addonItems: quote.addonItems, lang }),
      breakdown: { ...quote.breakdown, currency: SYSTEM_CURRENCY },
      renewedFromSubscriptionId: id,
    };

    if (isPhase1CanonicalCheckoutDraftWriteEnabled()) {
      const canonicalContract = runtime.buildPhase1SubscriptionContract({
        payload: renewalPayload,
        resolvedQuote: quote,
        actorContext: { actorRole: "client", actorUserId: req.userId },
        source: "renewal",
        now: new Date(),
      });
      Object.assign(draftPayload, runtime.buildCanonicalDraftPersistenceFields({ contract: canonicalContract }));
    }

    renewalStage = "draft_create";
    draft = await CheckoutDraft.create(draftPayload);

    const appUrl = process.env.APP_URL || "https://example.com";
    renewalStage = "invoice_create";
    logger.debug("[DEBUG-CHECKOUT] Calling renewal createInvoice", {
      draftId: String(draft._id),
      totalHalala: Number(quote && quote.breakdown && quote.breakdown.totalHalala || 0),
    });
    const invoice = await runtime.createInvoice({
      amount: quote.breakdown.totalHalala,
      description: buildPaymentDescription("subscriptionRenewal", lang, {
        daysCount: Number(quote.plan.daysCount || 0),
        previousSubscriptionId: id,
      }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(body.successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(body.backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "subscription_renewal",
        draftId: String(draft._id),
        userId: String(req.userId),
        renewedFromSubscriptionId: id,
        grams: quote.grams,
        mealsPerDay: quote.mealsPerDay,
      },
    });

    providerInvoiceId = getInvoiceResponseId(invoice);
    paymentUrl = getInvoiceResponseUrl(invoice);
    logger.debug("[DEBUG-CHECKOUT] Renewal createInvoice returned", {
      draftId: String(draft._id),
      hasInvoiceId: Boolean(providerInvoiceId),
    });

    if (!providerInvoiceId || !paymentUrl) {
      const invalidInvoiceErr = new Error("Invoice response missing required payment fields");
      invalidInvoiceErr.code = "PAYMENT_PROVIDER_INVALID_RESPONSE";
      throw invalidInvoiceErr;
    }

    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");
    const paymentPromise = ensureSubscriptionCheckoutPayment({
      draft,
      paymentType: resolveSubscriptionCheckoutPaymentType({ renewedFromSubscriptionId: id }),
      totalHalala: quote.breakdown.totalHalala,
      invoiceCurrency,
      providerInvoiceId,
      paymentUrl,
    });

    renewalStage = "draft_invoice_persist";
    await persistCheckoutDraftUpdate(
      draft,
      {
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      },
      { stage: renewalStage }
    );

    renewalStage = "payment_create";
    logger.debug("[DEBUG-CHECKOUT] Creating renewal payment record", {
      draftId: String(draft._id),
    });
    const payment = await paymentPromise;

    renewalStage = "draft_payment_link_persist";
    await persistCheckoutDraftUpdate(
      draft,
      {
        paymentId: payment._id,
        providerInvoiceId,
        paymentUrl,
        failureReason: "",
      },
      { stage: renewalStage }
    );

    return res.status(201).json({
      ok: true,
      data: {
        draftId: draft.id,
        paymentId: payment.id,
        payment_url: draft.paymentUrl,
        renewedFromSubscriptionId: id,
        totals: quote.breakdown,
      },
    });
  } catch (err) {
    if (!draft && err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (!draft && err.code === "NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (!draft && err.code === "INVALID_SELECTION") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    if (!draft && isCheckoutDraftDuplicateKeyError(err)) {
      let existingDraft = await CheckoutDraft.findOne({
        userId: req.userId,
        idempotencyKey: renewalPayload.idempotencyKey,
      }).sort({ createdAt: -1 }).lean();

      if (!existingDraft && requestHash) {
        existingDraft = await CheckoutDraft.findOne({
          userId: req.userId,
          requestHash,
          status: "pending_payment",
        }).sort({ createdAt: -1 }).lean();
      }

      if (existingDraft) {
        const { draft: reconciledDraft, payment: reconciledPayment } = await reconcileCheckoutDraft(existingDraft._id, {
          mode: RECONCILE_MODES.PERSIST,
        });
        const currentDraft = reconciledDraft || existingDraft;
        const currentPayment = reconciledPayment;

        if (isPendingCheckoutReusable(currentDraft, currentPayment)) {
          return res.status(200).json({ ok: true, data: buildCheckoutReusePayload(currentDraft, currentPayment) });
        }

        if (currentDraft.status === "completed" && currentDraft.subscriptionId) {
          const newSub = await Subscription.findById(currentDraft.subscriptionId).lean();
          return res.status(200).json({
            ok: true,
            data: await serializeSubscriptionForClient(newSub, lang),
          });
        }

        if (currentDraft.status === "pending_payment") {
          return errorResponse(
            res,
            409,
            "CHECKOUT_IN_PROGRESS",
            "Checkout initialization is still in progress. Retry with the same idempotency key.",
            { draftId: String(currentDraft._id) }
          );
        }

        return errorResponse(
          res,
          409,
          "IDEMPOTENCY_CONFLICT",
          `idempotencyKey is already finalized with status ${currentDraft.status}`
        );
      }
    }
    await persistCheckoutInitializationFailure(draft, err, {
      stage: renewalStage,
      providerInvoiceId,
      paymentUrl,
    });
    logger.error("Subscription renewal failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Renewal failed");
  }
}

async function getSubscriptionWallet(req, res) {
  const { id } = req.params;
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
    ok: true,
    data: await buildSubscriptionWalletSnapshot(sub, lang),
  });
}

async function getSubscriptionWalletHistory(req, res) {
  const { id } = req.params;
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

  const payments = await Payment.find({
    subscriptionId: id,
    userId: req.userId,
    type: { $in: Array.from(WALLET_TOPUP_PAYMENT_TYPES) },
  }).sort({ createdAt: -1 }).lean();
  const lang = getRequestLang(req);
  const catalog = await loadWalletCatalogMaps({ subscription: sub, payments, lang });
  const entries = [];

  for (const payment of payments) {
    const topupItems = buildWalletTopupItems(payment, catalog);
    for (const item of topupItems) {
      entries.push({
        id: item.id,
        source: "topup_payment",
        direction: "credit",
        walletType: item.walletType,
        status: payment.status,
        paymentId: String(payment._id),
        providerInvoiceId: payment.providerInvoiceId || null,
        providerPaymentId: payment.providerPaymentId || null,
        itemId: item.itemId,
        name: item.name,
        qty: Number(item.qty || 0),
        unitAmountHalala: Number(item.unitAmountHalala || 0),
        totalAmountHalala: Number(item.totalAmountHalala || payment.amount || 0),
        currency: item.currency || payment.currency || SYSTEM_CURRENCY,
        applied: Boolean(payment.applied),
        date: null,
        dayId: null,
        occurredAt: payment.paidAt || payment.createdAt || null,
      });
    }
  }

  for (const row of sub.premiumSelections || []) {
    const itemId = row.premiumMealId ? String(row.premiumMealId) : null;
    entries.push({
      id: row._id ? String(row._id) : `${row.dayId || row.date || "premium"}:${row.baseSlotKey || "slot"}`,
      source: "wallet_selection",
      direction: "debit",
      walletType: "premium",
      status: "consumed",
      paymentId: null,
      providerInvoiceId: null,
      providerPaymentId: null,
      itemId,
      name: itemId === LEGACY_PREMIUM_MEAL_BUCKET_ID ? catalog.legacyPremiumLabel : (itemId ? catalog.premiumNames.get(itemId) || "" : ""),
      qty: 1,
      unitAmountHalala: Number(row.unitExtraFeeHalala || 0),
      totalAmountHalala: Number(row.unitExtraFeeHalala || 0),
      currency: row.currency || SYSTEM_CURRENCY,
      applied: true,
      date: row.date || null,
      dayId: row.dayId ? String(row.dayId) : null,
      occurredAt: row.consumedAt || null,
    });
  }

  for (const row of sub.addonSelections || []) {
    const itemId = row.addonId ? String(row.addonId) : null;
    const qty = Number(row.qty || 0);
    const unitAmountHalala = Number(row.unitPriceHalala || 0);
    entries.push({
      id: row._id ? String(row._id) : `${row.dayId || row.date || "addon"}:${itemId || "item"}`,
      source: "wallet_selection",
      direction: "debit",
      walletType: "addon",
      status: "consumed",
      paymentId: null,
      providerInvoiceId: null,
      providerPaymentId: null,
      itemId,
      name: itemId ? catalog.addonNames.get(itemId) || "" : "",
      qty,
      unitAmountHalala,
      totalAmountHalala: qty * unitAmountHalala,
      currency: row.currency || SYSTEM_CURRENCY,
      applied: true,
      date: row.date || null,
      dayId: row.dayId ? String(row.dayId) : null,
      occurredAt: row.consumedAt || null,
    });
  }

  entries.sort((a, b) => {
    const left = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const right = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return right - left;
  });

  return res.status(200).json({
    ok: true,
    data: {
      subscriptionId: String(sub._id),
      entries: localizeWalletHistoryEntries(entries, lang),
    },
  });
}

async function getWalletTopupPaymentStatus(req, res) {
  const { id, paymentId } = req.params;
  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(paymentId, "paymentId");
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

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId: id,
    userId: req.userId,
    type: { $in: Array.from(WALLET_TOPUP_PAYMENT_TYPES) },
  }).lean();
  if (!payment) {
    return errorResponse(res, 404, "NOT_FOUND", "Top-up payment not found");
  }

  const lang = getRequestLang(req);
  const catalog = await loadWalletCatalogMaps({ subscription: sub, payments: [payment], lang });
  const payload = buildWalletTopupStatusPayload({ subscription: sub, payment, catalog });
  return res.status(200).json({
    ok: true,
    data: localizeWalletTopupStatusReadPayload({
      ...payload,
      checkedProvider: false,
      synchronized: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    }, lang),
  });
}

async function verifyWalletTopupPayment(req, res) {
  const { id, paymentId } = req.params;
  const lang = getRequestLang(req);
  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(paymentId, "paymentId");
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

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId: id,
    userId: req.userId,
    type: { $in: Array.from(WALLET_TOPUP_PAYMENT_TYPES) },
  }).lean();
  if (!payment) {
    return errorResponse(res, 404, "NOT_FOUND", "Top-up payment not found");
  }
  if (!payment.providerInvoiceId) {
    return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "Top-up invoice is not initialized yet");
  }

  if (payment.status === "paid" && payment.applied === true) {
    const catalog = await loadWalletCatalogMapsSafely({
      subscription: sub,
      payments: [payment],
      lang,
      context: "verify_wallet_topup_paid_short_circuit",
    });
    const payload = {
      ...buildWalletTopupStatusPayload({ subscription: sub, payment, catalog }),
      checkedProvider: false,
      synchronized: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    };
    return res.status(200).json({
      ok: true,
      data: localizeWriteWalletTopupStatusPayload(payload, { lang }),
    });
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoice(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    }
    logger.error("Wallet top-up verify failed to fetch invoice", {
      subscriptionId: id,
      paymentId,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    return errorResponse(res, 409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }

  const session = await mongoose.startSession();
  let synchronized = false;
  try {
    session.startTransaction();

    const subInSession = await Subscription.findOne({ _id: id, userId: req.userId }).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    const paymentInSession = await Payment.findOne({
      _id: paymentId,
      subscriptionId: id,
      userId: req.userId,
      type: { $in: Array.from(WALLET_TOPUP_PAYMENT_TYPES) },
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Top-up payment not found");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
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

    if (normalizedStatus === "paid" && !paymentInSession.applied) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );
      if (claimedPayment) {
        const result = isPhase1SharedPaymentDispatcherEnabled()
          ? await applyPaymentSideEffects({
            payment: claimedPayment,
            session,
            source: "client_manual_verify",
          })
          : await applyWalletTopupPayment({
            subscription: subInSession,
            payment: claimedPayment,
            session,
          });
        if (result.applied) {
          synchronized = true;
        } else {
          const metadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: result.reason });
          await Payment.updateOne(
            { _id: claimedPayment._id },
            { $set: { applied: true, status: "paid", metadata } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("Wallet top-up verification failed", {
      subscriptionId: id,
      paymentId,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Top-up verification failed");
  }

  const [latestSub, latestPayment] = await Promise.all([
    Subscription.findById(id).lean(),
    Payment.findById(paymentId).lean(),
  ]);
  const catalog = await loadWalletCatalogMapsSafely({
    subscription: latestSub,
    payments: [latestPayment],
    lang,
    context: "verify_wallet_topup_result",
  });
  const payload = {
    ...buildWalletTopupStatusPayload({
      subscription: latestSub,
      payment: latestPayment,
      catalog,
      providerInvoice,
    }),
    checkedProvider: true,
    synchronized,
  };
  return res.status(200).json({
    ok: true,
    data: localizeWriteWalletTopupStatusPayload(payload, { lang }),
  });
}

async function createPremiumOverageDayPayment(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  const { id, date } = req.params;
  const lang = getRequestLang(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message);
  }

  const day = await SubscriptionDay.findOne({ subscriptionId: id, date });
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found");
  }
  if (!isCanonicalGenericPremiumOverageEligibleForDay(sub, day)) {
    return errorResponse(res, 409, "PREMIUM_OVERAGE_NOT_SUPPORTED", "Premium overage payment is not enabled for this day");
  }

  const premiumOverageCount = Number(day.premiumOverageCount || 0);
  if (premiumOverageCount <= 0) {
    return errorResponse(res, 409, "NO_PENDING_OVERAGE", "This day has no unpaid premium overage");
  }
  if (day.premiumOverageStatus === "paid") {
    return errorResponse(res, 409, "OVERAGE_ALREADY_PAID", "This day premium overage is already paid");
  }

  const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
  const unitOveragePriceHalala =
    Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0
      ? Math.round(premiumPriceSar * 100)
      : 0;
  const amount = premiumOverageCount * unitOveragePriceHalala;

  const idempotency = await maybeHandleNonCheckoutIdempotency({
    req,
    res,
    operationScope: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    effectivePayload: {
      subscriptionId: String(sub._id),
      dayId: String(day._id),
      date: String(day.date),
      premiumOverageCount,
    },
    fallbackResponseShape: "premium_overage_day",
    runtime,
  });
  if (!idempotency.shouldContinue) {
    return idempotency.response;
  }

  const appUrl = process.env.APP_URL || "https://example.com";
  const successUrl = validateRedirectUrl(req.body && req.body.successUrl, `${appUrl}/payments/success`);
  const backUrl = validateRedirectUrl(req.body && req.body.backUrl, `${appUrl}/payments/cancel`);
  const invoice = await runtime.createInvoice({
    amount,
    description: buildPaymentDescription("premiumOverageSettlement", lang, {
      count: premiumOverageCount,
    }),
    callbackUrl: `${appUrl}/api/webhooks/moyasar`,
    successUrl,
    backUrl,
    metadata: {
      type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
      subscriptionId: String(sub._id),
      userId: String(req.userId),
      dayId: String(day._id),
      date: String(day.date),
      premiumOverageCount,
      unitOveragePriceHalala,
      currency: SYSTEM_CURRENCY,
    },
  });
  const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

  const payment = await runtime.createPayment({
    provider: "moyasar",
    type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    status: "initiated",
    amount,
    currency: invoiceCurrency,
    userId: req.userId,
    subscriptionId: sub._id,
    providerInvoiceId: invoice.id,
    metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
      paymentUrl: invoice.url,
      responseShape: "premium_overage_day",
      totalHalala: amount,
    }),
    ...(idempotency.idempotencyKey
      ? {
        operationScope: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
        operationIdempotencyKey: idempotency.idempotencyKey,
        operationRequestHash: idempotency.operationRequestHash,
      }
      : {}),
  });

  return res.status(200).json({
    ok: true,
    data: {
      payment_url: invoice.url,
      invoice_id: invoice.id,
      payment_id: payment.id,
      totalHalala: amount,
    },
  });
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

  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId: id,
    userId: req.userId,
    type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
  }).lean();
  if (!payment) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium overage payment not found");
  }
  const paymentMetadata = getPaymentMetadata(payment);
  if (String(paymentMetadata.date || "") !== String(date)) {
    logger.warn("Premium overage payment mismatch", {
      subscriptionId: id,
      paymentId,
      expectedDate: date,
      paymentDate: paymentMetadata.date,
      code: "MISMATCH",
      message: "Payment day mismatch",
    });
    return errorResponse(res, 409, "MISMATCH", "Payment day mismatch");
  }
  if (!payment.providerInvoiceId) {
    return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "Premium overage invoice is not initialized yet");
  }

  let day = null;
  if (paymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(paymentMetadata.dayId))) {
    day = await SubscriptionDay.findById(paymentMetadata.dayId).lean();
  } else {
    day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  }
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found");
  }

  if (payment.status === "paid" && payment.applied === true) {
    const payload = {
      ...buildPremiumOveragePaymentStatusPayload({ subscription: sub, day, payment }),
      checkedProvider: false,
      synchronized: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    };
    return res.status(200).json({
      ok: true,
      data: localizeWritePremiumOverageStatusPayload(payload, { lang }),
    });
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoiceFn(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    }
    logger.error("Premium overage verify failed to fetch invoice", {
      subscriptionId: id,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
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

    const subInSession = await Subscription.findOne({ _id: id, userId: req.userId }).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    const paymentInSession = await Payment.findOne({
      _id: paymentId,
      subscriptionId: id,
      userId: req.userId,
      type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Premium overage payment not found");
    }

    const metadataInSession = getPaymentMetadata(paymentInSession);
    if (String(metadataInSession.date || "") !== String(date)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedDate: date,
        paymentDate: metadataInSession.date,
        code: "MISMATCH",
        message: "Payment day mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment day mismatch");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
    if (providerInvoiceId && paymentInSession.providerInvoiceId && String(paymentInSession.providerInvoiceId) !== providerInvoiceId) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedInvoiceId: providerInvoiceId,
        paymentInvoiceId: paymentInSession.providerInvoiceId,
        code: "MISMATCH",
        message: "Invoice ID mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
    }
    if (providerPayment && providerPayment.id && paymentInSession.providerPaymentId && String(paymentInSession.providerPaymentId) !== String(providerPayment.id)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedPaymentId: providerPayment.id,
        paymentPaymentId: paymentInSession.providerPaymentId,
        code: "MISMATCH",
        message: "Payment ID mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch");
    }

    const providerAmount = Number(providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount);
    if (Number.isFinite(providerAmount) && providerAmount !== Number(paymentInSession.amount)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedAmount: providerAmount,
        paymentAmount: paymentInSession.amount,
        code: "MISMATCH",
        message: "Amount mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch");
    }

    const providerCurrency = normalizeCurrencyValue(
      providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency
    );
    if (providerCurrency !== normalizeCurrencyValue(paymentInSession.currency)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedCurrency: providerCurrency,
        paymentCurrency: paymentInSession.currency,
        code: "MISMATCH",
        message: "Currency mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch");
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

    if (normalizedStatus === "paid" && !paymentInSession.applied) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );
      if (claimedPayment) {
        const result = await applyPaymentSideEffectsFn({
          payment: claimedPayment,
          session,
          source: "client_manual_verify",
        });
        if (result.applied) {
          synchronized = true;
        } else {
          const metadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: result.reason });
          await Payment.updateOne(
            { _id: claimedPayment._id },
            { $set: { applied: true, status: "paid", metadata } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("Premium overage verification failed", {
      subscriptionId: id,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Premium overage verification failed");
  }

  const [latestSub, latestPayment] = await Promise.all([
    Subscription.findById(id).lean(),
    Payment.findById(paymentId).lean(),
  ]);
  const latestPaymentMetadata = getPaymentMetadata(latestPayment);
  const latestDay = latestPaymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(latestPaymentMetadata.dayId))
    ? await SubscriptionDay.findById(latestPaymentMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();

  const payload = {
    ...buildPremiumOveragePaymentStatusPayload({
      subscription: latestSub,
      day: latestDay,
      payment: latestPayment,
      providerInvoice,
    }),
    checkedProvider: true,
    synchronized,
  };

  return res.status(200).json({
    ok: true,
    data: localizeWritePremiumOverageStatusPayload(payload, { lang }),
  });
}

async function createOneTimeAddonDayPlanningPayment(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  const { id, date } = req.params;
  const lang = getRequestLang(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message);
  }

  const day = await SubscriptionDay.findOne({ subscriptionId: id, date });
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found");
  }
  if (!isCanonicalOneTimeAddonPlanningPaymentEligibleForDay(sub, day)) {
    return errorResponse(res, 409, "ONE_TIME_ADDON_PAYMENT_NOT_SUPPORTED", "One-time add-on payment is not enabled for this day");
  }
  if (Number(day.oneTimeAddonPendingCount || 0) <= 0) {
    return errorResponse(res, 409, "NO_PENDING_ONE_TIME_ADDONS", "This day has no unpaid one-time add-ons");
  }
  if (day.oneTimeAddonPaymentStatus === "paid") {
    return errorResponse(res, 409, "ONE_TIME_ADDONS_ALREADY_PAID", "This day one-time add-on selection is already paid");
  }

  let pricedSnapshot;
  try {
    pricedSnapshot = await buildPricedOneTimeAddonPaymentSnapshot({ day });
  } catch (err) {
    if (err.code === "ONE_TIME_ADDON_PRICING_NOT_FOUND") {
      return errorResponse(res, 404, "NOT_FOUND", err.message);
    }
    if (err.code === "CONFIG" || err.code === "VALIDATION_ERROR") {
      return errorResponse(res, 409, err.code, err.message);
    }
    throw err;
  }

  if (pricedSnapshot.oneTimeAddonCount <= 0) {
    return errorResponse(res, 409, "NO_PENDING_ONE_TIME_ADDONS", "This day has no unpaid one-time add-ons");
  }

  const idempotency = await maybeHandleNonCheckoutIdempotency({
    req,
    res,
    operationScope: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    effectivePayload: {
      subscriptionId: String(sub._id),
      dayId: String(day._id),
      date: String(day.date),
      oneTimeAddonSelections: pricedSnapshot.oneTimeAddonSelections,
    },
    fallbackResponseShape: "one_time_addon_day_planning",
    runtime,
  });
  if (!idempotency.shouldContinue) {
    return idempotency.response;
  }

  const appUrl = process.env.APP_URL || "https://example.com";
  const successUrl = validateRedirectUrl(req.body && req.body.successUrl, `${appUrl}/payments/success`);
  const backUrl = validateRedirectUrl(req.body && req.body.backUrl, `${appUrl}/payments/cancel`);
  const invoice = await runtime.createInvoice({
    amount: pricedSnapshot.totalHalala,
    description: buildPaymentDescription("oneTimeAddons", lang, {
      count: pricedSnapshot.oneTimeAddonCount,
    }),
    callbackUrl: `${appUrl}/api/webhooks/moyasar`,
    successUrl,
    backUrl,
    metadata: {
      type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
      subscriptionId: String(sub._id),
      userId: String(req.userId),
      dayId: String(day._id),
      date: String(day.date),
      oneTimeAddonSelections: pricedSnapshot.oneTimeAddonSelections,
      oneTimeAddonCount: pricedSnapshot.oneTimeAddonCount,
      pricedItems: pricedSnapshot.pricedItems,
      currency: pricedSnapshot.currency,
    },
  });
  const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

  const payment = await runtime.createPayment({
    provider: "moyasar",
    type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    status: "initiated",
    amount: pricedSnapshot.totalHalala,
    currency: invoiceCurrency,
    userId: req.userId,
    subscriptionId: sub._id,
    providerInvoiceId: invoice.id,
    metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
      paymentUrl: invoice.url,
      responseShape: "one_time_addon_day_planning",
      totalHalala: pricedSnapshot.totalHalala,
    }),
    ...(idempotency.idempotencyKey
      ? {
        operationScope: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
        operationIdempotencyKey: idempotency.idempotencyKey,
        operationRequestHash: idempotency.operationRequestHash,
      }
      : {}),
  });

  return res.status(200).json({
    ok: true,
    data: {
      payment_url: invoice.url,
      invoice_id: invoice.id,
      payment_id: payment.id,
      totalHalala: pricedSnapshot.totalHalala,
    },
  });
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
    validateObjectId(paymentId, "paymentId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).lean();
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId: id,
    userId: req.userId,
    type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
  }).lean();
  if (!payment) {
    return errorResponse(res, 404, "NOT_FOUND", "One-time add-on payment not found");
  }
  const paymentMetadata = getPaymentMetadata(payment);
  if (String(paymentMetadata.date || "") !== String(date)) {
    logger.warn("One-time add-on payment mismatch", {
      subscriptionId: id,
      paymentId,
      expectedDate: date,
      paymentDate: paymentMetadata.date,
      code: "MISMATCH",
      message: "Payment day mismatch",
    });
    return errorResponse(res, 409, "MISMATCH", "Payment day mismatch");
  }
  if (!payment.providerInvoiceId) {
    return errorResponse(res, 409, "CHECKOUT_IN_PROGRESS", "One-time add-on invoice is not initialized yet");
  }

  let day = null;
  if (paymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(paymentMetadata.dayId))) {
    day = await SubscriptionDay.findById(paymentMetadata.dayId).lean();
  } else {
    day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  }
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found");
  }

  if (payment.status === "paid" && payment.applied === true) {
    const catalog = await loadWalletCatalogMapsSafely({
      days: [day],
      lang,
      context: "verify_one_time_addon_paid_short_circuit",
    });
    const payload = {
      ...buildOneTimeAddonDayPaymentStatusPayload({ subscription: sub, day, payment }),
      checkedProvider: false,
      synchronized: ["paid", "failed", "canceled", "expired", "refunded"].includes(payment.status),
    };
    return res.status(200).json({
      ok: true,
      data: localizeWriteOneTimeAddonPaymentStatusPayload(payload, {
        lang,
        addonNames: catalog.addonNames,
      }),
    });
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoiceFn(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    }
    logger.error("One-time add-on verify failed to fetch invoice", {
      subscriptionId: id,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
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

    const subInSession = await Subscription.findOne({ _id: id, userId: req.userId }).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    const paymentInSession = await Payment.findOne({
      _id: paymentId,
      subscriptionId: id,
      userId: req.userId,
      type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "One-time add-on payment not found");
    }

    const metadataInSession = getPaymentMetadata(paymentInSession);
    if (String(metadataInSession.date || "") !== String(date)) {
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedDate: date,
        paymentDate: metadataInSession.date,
        code: "MISMATCH",
        message: "Payment day mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment day mismatch");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
    if (providerInvoiceId && paymentInSession.providerInvoiceId && String(paymentInSession.providerInvoiceId) !== providerInvoiceId) {
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedInvoiceId: providerInvoiceId,
        paymentInvoiceId: paymentInSession.providerInvoiceId,
        code: "MISMATCH",
        message: "Invoice ID mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
    }
    if (providerPayment && providerPayment.id && paymentInSession.providerPaymentId && String(paymentInSession.providerPaymentId) !== String(providerPayment.id)) {
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedPaymentId: providerPayment.id,
        paymentPaymentId: paymentInSession.providerPaymentId,
        code: "MISMATCH",
        message: "Payment ID mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch");
    }

    const providerAmount = Number(providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount);
    if (Number.isFinite(providerAmount) && providerAmount !== Number(paymentInSession.amount)) {
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedAmount: providerAmount,
        paymentAmount: paymentInSession.amount,
        code: "MISMATCH",
        message: "Amount mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch");
    }

    const providerCurrency = normalizeCurrencyValue(
      providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency
    );
    if (providerCurrency !== normalizeCurrencyValue(paymentInSession.currency)) {
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId: id,
        paymentId,
        expectedCurrency: providerCurrency,
        paymentCurrency: paymentInSession.currency,
        code: "MISMATCH",
        message: "Currency mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch");
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

    if (normalizedStatus === "paid" && !paymentInSession.applied) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );
      if (claimedPayment) {
        const result = await applyPaymentSideEffectsFn({
          payment: claimedPayment,
          session,
          source: "client_manual_verify",
        });
        if (result.applied) {
          synchronized = true;
        } else {
          const metadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: result.reason });
          await Payment.updateOne(
            { _id: claimedPayment._id },
            { $set: { applied: true, status: "paid", metadata } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("One-time add-on verification failed", {
      subscriptionId: id,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "One-time add-on verification failed");
  }

  const [latestSub, latestPayment] = await Promise.all([
    Subscription.findById(id).lean(),
    Payment.findById(paymentId).lean(),
  ]);
  const latestPaymentMetadata = getPaymentMetadata(latestPayment);
  const latestDay = latestPaymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(latestPaymentMetadata.dayId))
    ? await SubscriptionDay.findById(latestPaymentMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();

  const catalog = await loadWalletCatalogMapsSafely({
    days: latestDay ? [latestDay] : [],
    lang,
    context: "verify_one_time_addon_result",
  });
  const payload = {
    ...buildOneTimeAddonDayPaymentStatusPayload({
      subscription: latestSub,
      day: latestDay,
      payment: latestPayment,
      providerInvoice,
    }),
    checkedProvider: true,
    synchronized,
  };

  return res.status(200).json({
    ok: true,
    data: localizeWriteOneTimeAddonPaymentStatusPayload(payload, {
      lang,
      addonNames: catalog.addonNames,
    }),
  });
}

async function freezeSubscription(req, res) {
  const { id } = req.params;
  const { startDate, days } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  const freezePolicy = resolveSubscriptionFreezePolicy(sub, sub.planId, {
    context: "freeze_subscription",
  });
  if (!freezePolicy.enabled) {
    return errorResponse(res, 422, "FREEZE_DISABLED", "Freeze is disabled for this plan");
  }

  let targetDates;
  try {
    ensureActive(sub, startDate);
    ({ targetDates } = validateFreezeRangeOrThrow(sub, startDate, days));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);
  } catch (err) {
    if (err.code === "FREEZE_DISABLED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    const status =
      err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 :
        err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED" ? 400 :
          400;
    return errorResponse(res, status, err.code || "INVALID", err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    ensureActive(subInSession, startDate);
    const policyInSession = resolveSubscriptionFreezePolicy(subInSession, subInSession.planId, {
      context: "freeze_subscription",
    });
    if (!policyInSession.enabled) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, "FREEZE_DISABLED", "Freeze is disabled for this plan");
    }

    ({ targetDates } = validateFreezeRangeOrThrow(subInSession, startDate, days));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);

    const targetDays = await SubscriptionDay.find({
      subscriptionId: subInSession._id,
      date: { $in: targetDates },
    }).session(session);
    const targetDaysByDate = new Map(targetDays.map((day) => [day.date, day]));

    const blockedDay = targetDates.find((date) => {
      const day = targetDaysByDate.get(date);
      return day && !["open", "frozen"].includes(day.status);
    });
    if (blockedDay) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", `Day ${blockedDay} is not open for freeze`);
    }

    const currentFrozenDates = await getFrozenDateStrings(subInSession._id, session);
    const prospectiveFrozenSet = new Set(currentFrozenDates);
    const newlyFrozenDates = [];
    const alreadyFrozen = [];

    for (const date of targetDates) {
      if (prospectiveFrozenSet.has(date)) {
        alreadyFrozen.push(date);
      } else {
        prospectiveFrozenSet.add(date);
        newlyFrozenDates.push(date);
      }
    }

    if (prospectiveFrozenSet.size > policyInSession.maxDays) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        403,
        "FREEZE_LIMIT_REACHED",
        `Freeze days exceed plan limit of ${policyInSession.maxDays}`
      );
    }
    if (countFrozenBlocks(Array.from(prospectiveFrozenSet)) > policyInSession.maxTimes) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        403,
        "FREEZE_LIMIT_REACHED",
        `Freeze periods exceed plan limit of ${policyInSession.maxTimes}`
      );
    }

    for (const date of targetDates) {
      const existingDay = targetDaysByDate.get(date);
      if (existingDay) {
        if (existingDay.status !== "frozen") {
          existingDay.status = "frozen";
          existingDay.canonicalDayActionType = "freeze"; // P2-S7-S1: always overwrite (handles stale "skip" value)
          await existingDay.save({ session });
        }
      } else {
        await SubscriptionDay.create([{ subscriptionId: subInSession._id, date, status: "frozen", canonicalDayActionType: "freeze" }], { session }); // P2-S7-S1
      }
    }

    const syncResult = await syncSubscriptionValidity(subInSession, session);

    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription",
      entityId: subInSession._id,
      action: "freeze",
      byUserId: req.userId,
      byRole: "client",
      meta: { startDate, days: targetDates.length, frozenDates: targetDates },
    }, { subscriptionId: id, startDate });

    return res.status(200).json({
      ok: true,
      data: {
        subscriptionId: subInSession.id,
        frozenDates: targetDates,
        newlyFrozenDates,
        alreadyFrozen,
        frozenDaysTotal: syncResult.frozenCount,
        validityEndDate: dateUtils.toKSADateString(syncResult.validityEndDate),
        freezePolicy: policyInSession,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    if (err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED") {
      return errorResponse(res, 400, err.code, err.message);
    }
    if (err.code === "FREEZE_CONFLICT") {
      return errorResponse(res, 409, err.code, err.message);
    }
    logger.error("Freeze subscription failed", { subscriptionId: id, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Freeze failed");
  }
}

async function unfreezeSubscription(req, res) {
  const { id } = req.params;
  const { startDate, days } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }

  let targetDates;
  try {
    ensureActive(sub, startDate);
    ({ targetDates } = validateFreezeRangeOrThrow(sub, startDate, days));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);
  } catch (err) {
    const status =
      err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 :
        err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED" ? 400 :
          400;
    return errorResponse(res, status, err.code || "INVALID", err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    ensureActive(subInSession, startDate);
    ({ targetDates } = validateFreezeRangeOrThrow(subInSession, startDate, days));
    await ensureDateRangeDoesNotIncludeLockedTomorrow(targetDates);

    const targetDays = await SubscriptionDay.find({
      subscriptionId: subInSession._id,
      date: { $in: targetDates },
    }).session(session);
    const targetDaysByDate = new Map(targetDays.map((day) => [day.date, day]));

    const unfrozenDates = [];
    const notFrozen = [];
    for (const date of targetDates) {
      const day = targetDaysByDate.get(date);
      if (!day || day.status !== "frozen") {
        notFrozen.push(date);
        continue;
      }
      day.status = "open";
      // P2-S7-S1: clear canonical action type on unfreeze; absence is valid for legacy and open days
      await SubscriptionDay.updateOne(
        { _id: day._id },
        { $set: { status: "open" }, $unset: { canonicalDayActionType: 1 } },
        { session }
      );
      unfrozenDates.push(date);
    }

    const syncResult = await syncSubscriptionValidity(subInSession, session);

    await session.commitTransaction();
    session.endSession();

    if (unfrozenDates.length > 0) {
      await writeLogSafely({
        entityType: "subscription",
        entityId: subInSession._id,
        action: "unfreeze",
        byUserId: req.userId,
        byRole: "client",
        meta: { startDate, days: targetDates.length, unfrozenDates },
      }, { subscriptionId: id, startDate });
    }

    return res.status(200).json({
      ok: true,
      data: {
        subscriptionId: subInSession.id,
        unfrozenDates,
        notFrozen,
        frozenDaysTotal: syncResult.frozenCount,
        validityEndDate: dateUtils.toKSADateString(syncResult.validityEndDate),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    if (err.code === "INVALID_DATE" || err.code === "INVALID" || err.code === "LOCKED") {
      return errorResponse(res, 400, err.code, err.message);
    }
    if (err.code === "FREEZE_CONFLICT") {
      return errorResponse(res, 409, err.code, err.message);
    }
    logger.error("Unfreeze subscription failed", { subscriptionId: id, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Unfreeze failed");
  }
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
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const days = await SubscriptionDay.find({ subscriptionId: id }).sort({ date: 1 }).lean();
  const serializedDays = days.map((day) => serializeSubscriptionDayForClient(sub, day));
  const catalog = await loadWalletCatalogMaps({ days: serializedDays, lang });
  const mappedDays = serializedDays.map((day) => localizeSubscriptionDayReadPayload(day, {
    lang,
    addonNames: catalog.addonNames,
  }));
  return res.status(200).json({ ok: true, data: mappedDays });
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
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
  }
  const serializedDay = serializeSubscriptionDayForClient(sub, day);
  const catalog = await loadWalletCatalogMaps({ days: [serializedDay], lang });
  return res.status(200).json({
    ok: true,
    data: localizeSubscriptionDayReadPayload(serializedDay, {
      lang,
      addonNames: catalog.addonNames,
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
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  }
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  const today = dateUtils.getTodayKSADate();
  const day = await SubscriptionDay.findOne({ subscriptionId: id, date: today }).lean();
  if (!day) {
    return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
  }
  const serializedDay = serializeSubscriptionDayForClient(sub, day);
  const catalog = await loadWalletCatalogMaps({ days: [serializedDay], lang });
  return res.status(200).json({
    ok: true,
    data: localizeSubscriptionDayReadPayload(serializedDay, {
      lang,
      addonNames: catalog.addonNames,
    }),
  });
}

async function updateDaySelection(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceP2S1DefaultRuntime, ...runtimeOverrides } : sliceP2S1DefaultRuntime;
  const body = req.body || {};
  const selections = body.selections || [];
  const premiumSelections = body.premiumSelections || [];
  const requestedOneTimeAddonIds = body.oneTimeAddonSelections;
  const { id, date } = req.params;

  try {
    validateObjectId(id, "subscriptionId");
    if (requestedOneTimeAddonIds !== undefined) {
      if (!Array.isArray(requestedOneTimeAddonIds)) {
        return sendValidationError(res, "oneTimeAddonSelections must be an array");
      }
      for (const addonId of requestedOneTimeAddonIds) {
        validateObjectId(addonId, "addonId");
      }
    }
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  const totalSelected = selections.length + premiumSelections.length;
  const mealsPerDayLimit = resolveMealsPerDay(sub);
  if (totalSelected > mealsPerDayLimit) {
    return errorResponse(res, 400, "DAILY_CAP", "Selections exceed meals per day");
  }
  const useCanonicalPremiumOverage = runtime.isCanonicalPremiumOverageEligible(sub, {
    dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
  });
  const useCanonicalOneTimeAddonPlanning = runtime.isCanonicalDayPlanningEligible(sub, {
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  });
  const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
  const legacyPremiumUnitHalala =
    Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0
      ? Math.round(premiumPriceSar * 100)
      : 0;
  const lang = getRequestLang(req);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    try {
      ensureActive(subInSession, date);
      validateFutureDateOrThrow(date, subInSession);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID_DATE", err.message);
    }

    const existingDay = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);

    // CR-04 FIX: Check for idempotency - if same selections, return early
    if (existingDay && existingDay.status === "open") {
      const toStringSet = (values) => new Set((Array.isArray(values) ? values : []).map((value) => String(value)));
      const existingRegSet = toStringSet(existingDay.selections);
      const existingPremSet = toStringSet(existingDay.premiumSelections);
      const newRegSet = toStringSet(selections);
      const newPremSet = toStringSet(premiumSelections);

      const setsEqual = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));

      if (
        !useCanonicalPremiumOverage
        && !(useCanonicalOneTimeAddonPlanning && requestedOneTimeAddonIds !== undefined)
        && setsEqual(existingRegSet, newRegSet)
        && setsEqual(existingPremSet, newPremSet)
      ) {
        await session.commitTransaction();
        session.endSession();
        const serializedDay = serializeSubscriptionDayForClient(
          subInSession,
          existingDay.toObject ? existingDay.toObject() : existingDay,
          runtime
        );
        const catalog = await loadWalletCatalogMapsSafely({
          days: [serializedDay],
          lang,
          context: "update_day_selection_idempotent",
        });
        return res.status(200).json({
          ok: true,
          data: localizeWriteDayPayload(serializedDay, {
            lang,
            addonNames: catalog.addonNames,
          }),
          idempotent: true,
        });
      }
    }

    if (existingDay && existingDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked" );
    }

    const useGenericPremiumWallet = isGenericPremiumWalletMode(subInSession);
    const usePremiumOverageFlow = runtime.isCanonicalPremiumOverageEligible(subInSession, {
      dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
      genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
    });
    if (!useGenericPremiumWallet) {
      // Compatibility bridge: migrate legacy numeric premiumRemaining into wallet rows once.
      ensureLegacyPremiumBalanceFromRemaining(subInSession, {
        unitExtraFeeHalala: legacyPremiumUnitHalala,
        currency: SYSTEM_CURRENCY,
      });
    }

    const currentLegacyRows = getLegacyDayPremiumSelections(subInSession, {
      dayId: existingDay ? existingDay._id : null,
      date,
    });
    const insertedSelectionRows = [];
    let walletBackedConsumedCount = currentLegacyRows.length;

    if (usePremiumOverageFlow) {
      const {
        retainedRows,
        refundableRows,
        unmetRequestedMealIds,
      } = reconcileWalletBackedPremiumRowsForRequestedSelections(currentLegacyRows, premiumSelections);

      if (refundableRows.length > 0) {
        refundGenericPremiumSelectionRowsOrThrow(subInSession, refundableRows);
        const rowsToRemove = new Set(refundableRows);
        subInSession.premiumSelections = (subInSession.premiumSelections || []).filter(
          (row) => !rowsToRemove.has(row)
        );
      }

      const availableCredits = getRemainingPremiumCredits(subInSession);
      const consumeQty = Math.min(unmetRequestedMealIds.length, availableCredits);
      const consumedRows = consumeQty > 0
        ? consumeGenericPremiumCredits(subInSession, consumeQty)
        : [];

      if (consumeQty > 0 && (!consumedRows || consumedRows.length !== consumeQty)) {
        const err = new Error("Generic premium wallet could not satisfy the requested partial consumption");
        err.code = "DATA_INTEGRITY_ERROR";
        throw err;
      }

      let nextSlotIndex = getNextLegacyDayPremiumSlotIndex(retainedRows);
      for (let index = 0; index < consumeQty; index += 1) {
        const consumed = consumedRows[index];
        const insertedRow = {
          dayId: existingDay ? existingDay._id : undefined,
          date,
          baseSlotKey: `${LEGACY_DAY_PREMIUM_SLOT_PREFIX}${nextSlotIndex}`,
          premiumMealId: unmetRequestedMealIds[index],
          unitExtraFeeHalala: Number(consumed.unitCreditPriceHalala || 0),
          currency: consumed.currency || SYSTEM_CURRENCY,
          premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
          premiumWalletRowId: consumed.premiumWalletRowId || null,
        };
        subInSession.premiumSelections = subInSession.premiumSelections || [];
        subInSession.premiumSelections.push(insertedRow);
        insertedSelectionRows.push(insertedRow);
        nextSlotIndex += 1;
      }

      walletBackedConsumedCount = retainedRows.length + consumeQty;
    } else {
      const diff = premiumSelections.length - currentLegacyRows.length;
      const addedPremiumMealIds = extractAddedPremiumSelectionIds(
        existingDay && Array.isArray(existingDay.premiumSelections) ? existingDay.premiumSelections : [],
        premiumSelections,
        diff > 0 ? diff : 0
      );

      if (diff > 0) {
        const consumedRows = useGenericPremiumWallet
          ? consumeGenericPremiumCredits(subInSession, diff)
          : consumePremiumBalanceFifoRows(subInSession, diff);
        if (!consumedRows) {
          await session.abortTransaction();
          session.endSession();
          return errorResponse(res, 400, "INSUFFICIENT_PREMIUM", "Not enough premium credits" );
        }
        let nextSlotIndex = getNextLegacyDayPremiumSlotIndex(currentLegacyRows);
        const firstInsertedOffset = nextSlotIndex;
        for (const consumed of consumedRows) {
          const insertedOffset = nextSlotIndex - firstInsertedOffset;
          const insertedRow = {
            dayId: existingDay ? existingDay._id : undefined,
            date,
            baseSlotKey: `${LEGACY_DAY_PREMIUM_SLOT_PREFIX}${nextSlotIndex}`,
            premiumMealId: addedPremiumMealIds[insertedOffset]
              || premiumSelections[insertedOffset]
              || consumed.premiumMealId,
            unitExtraFeeHalala: useGenericPremiumWallet
              ? Number(consumed.unitCreditPriceHalala || 0)
              : Number(consumed.unitExtraFeeHalala || 0),
            currency: consumed.currency || SYSTEM_CURRENCY,
            premiumWalletMode: useGenericPremiumWallet ? GENERIC_PREMIUM_WALLET_MODE : LEGACY_PREMIUM_WALLET_MODE,
            premiumWalletRowId:
              useGenericPremiumWallet && consumed.premiumWalletRowId
                ? consumed.premiumWalletRowId
                : null,
          };
          subInSession.premiumSelections = subInSession.premiumSelections || [];
          subInSession.premiumSelections.push(insertedRow);
          insertedSelectionRows.push(insertedRow);
          nextSlotIndex += 1;
        }
      } else if (diff < 0) {
        const rowsToRefund = currentLegacyRows
          .slice()
          .sort((a, b) => new Date(b.consumedAt || 0).getTime() - new Date(a.consumedAt || 0).getTime())
          .slice(0, -diff);

        if (useGenericPremiumWallet) {
          refundGenericPremiumSelectionRowsOrThrow(subInSession, rowsToRefund);
        } else {
          refundPremiumSelectionRowsToBalanceOrThrow(subInSession, rowsToRefund);
        }

        const rowsToRemove = new Set(rowsToRefund);
        subInSession.premiumSelections = (subInSession.premiumSelections || []).filter(
          (row) => !rowsToRemove.has(row)
        );
      }

      walletBackedConsumedCount = getLegacyDayPremiumSelections(subInSession, {
        dayId: existingDay ? existingDay._id : null,
        date,
      }).length;
    }

    let finalOneTimeAddonSelections;
    if (useCanonicalOneTimeAddonPlanning) {
      if (requestedOneTimeAddonIds !== undefined) {
        const addonDocs = requestedOneTimeAddonIds.length
          ? await Addon.find({ _id: { $in: requestedOneTimeAddonIds }, isActive: true }).session(session).lean()
          : [];
        finalOneTimeAddonSelections = runtime.normalizeOneTimeAddonSelections({
          requestedAddonIds: requestedOneTimeAddonIds,
          addonDocs,
          lang,
        });
      } else {
        finalOneTimeAddonSelections = Array.isArray(existingDay && existingDay.oneTimeAddonSelections)
          ? existingDay.oneTimeAddonSelections
          : [];
      }
    }

    const update = { selections, premiumSelections };
    if (body.addonsOneTime !== undefined) {
      update.addonsOneTime = body.addonsOneTime;
    }
    if (useCanonicalOneTimeAddonPlanning && requestedOneTimeAddonIds !== undefined) {
      update.oneTimeAddonSelections = finalOneTimeAddonSelections;
    }

    const day = await SubscriptionDay.findOneAndUpdate(
      { subscriptionId: id, date: date },
      update,
      { upsert: true, new: true, session }
    );

    if (insertedSelectionRows.length > 0) {
      for (const row of insertedSelectionRows) {
        row.dayId = day._id;
        row.date = day.date;
      }
    }

    syncPremiumRemainingFromActivePremiumWallet(subInSession);
    if (usePremiumOverageFlow) {
      runtime.applyPremiumOverageState({
        day,
        requestedPremiumSelectionCount: premiumSelections.length,
        walletBackedConsumedCount,
      });
    }
    if (useCanonicalOneTimeAddonPlanning) {
      runtime.recomputeOneTimeAddonPlanningState({
        day,
        selections: finalOneTimeAddonSelections,
      });
    }
    applyDayWalletSelections({ subscription: subInSession, day });
    if (runtime.isCanonicalRecurringAddonEligible(subInSession)) {
      runtime.applyRecurringAddonProjectionToDay({
        subscription: subInSession,
        day,
      });
    }
    if (runtime.isCanonicalDayPlanningEligible(subInSession, {
      flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    })) {
      runtime.applyCanonicalDraftPlanningToDay({
        subscription: subInSession,
        day,
        selections,
        premiumSelections,
        assignmentSource: "client",
      });
    }

    await subInSession.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: day._id,
      action: "day_selection_update",
      byUserId: req.userId,
      byRole: "client",
      meta: { date, selectionsCount: selections.length, premiumCount: premiumSelections.length },
    }, { subscriptionId: id, date });
    const serializedDay = serializeSubscriptionDayForClient(subInSession, day.toObject ? day.toObject() : day, runtime);
    const catalog = await loadWalletCatalogMapsSafely({
      days: [serializedDay],
      lang,
      context: "update_day_selection_result",
    });
    return res.status(200).json({
      ok: true,
      data: localizeWriteDayPayload(serializedDay, {
        lang,
        addonNames: catalog.addonNames,
      }),
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err && err.code === "DATA_INTEGRITY_ERROR") {
      logWalletIntegrityError("update_day_selection_refund", {
        subscriptionId: id,
        date,
        reason: err.message,
      });
      return errorResponse(res, 409, "DATA_INTEGRITY_ERROR", err.message);
    }
    if (
      err.code === "VALIDATION_ERROR"
      || err.code === "INVALID_ONE_TIME_ADDON_SELECTION"
      || err.code === "ONE_TIME_ADDON_CATEGORY_CONFLICT"
    ) {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Selection failed" );
  }
}

async function confirmDayPlanning(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceP2S1DefaultRuntime, ...runtimeOverrides } : sliceP2S1DefaultRuntime;
  const { id, date } = req.params;
  const lang = getRequestLang(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(req.userId)) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  if (!runtime.isCanonicalDayPlanningEligible(sub, {
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  })) {
    return errorResponse(res, 409, "CANONICAL_DAY_PLANNING_DISABLED", "Canonical day planning is not enabled for this subscription");
  }

  try {
    validateFutureDateOrThrow(date, sub);
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message);
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (!runtime.isCanonicalDayPlanningEligible(subInSession, {
      flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
    })) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "CANONICAL_DAY_PLANNING_DISABLED", "Canonical day planning is not enabled for this subscription");
    }

    ensureActive(subInSession, date);
    validateFutureDateOrThrow(date, subInSession);
    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    try {
      runtime.assertCanonicalPlanningExactCount({
        subscription: subInSession,
        day,
      });
      runtime.assertNoPendingPremiumOverage({
        subscription: subInSession,
        day,
        overageEligible: runtime.isCanonicalPremiumOverageEligible(subInSession, {
          dayPlanningFlagEnabled: isPhase2CanonicalDayPlanningEnabled(),
          genericPremiumWalletFlagEnabled: isPhase2GenericPremiumWalletEnabled(),
        }),
      });
      runtime.assertNoPendingOneTimeAddonPayment({ day });
      runtime.confirmCanonicalDayPlanning({
        subscription: subInSession,
        day,
        actorRole: "client",
      });
      runtime.applyRecurringAddonProjectionToDay({
        subscription: subInSession,
        day,
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      if (
        err.code === "PLANNING_INCOMPLETE"
        || err.code === "PREMIUM_OVERAGE_PAYMENT_REQUIRED"
        || err.code === "ONE_TIME_ADDON_PAYMENT_REQUIRED"
      ) {
        // Operational visibility for failure modes that require user action or payment.
        logger.warn("Confirm day planning blocked", {
          subscriptionId: id,
          date,
          code: err.code,
          message: err.message,
        });
        return errorResponse(res, 422, err.code, err.message);
      }
      throw err;
    }

    await day.save({ session });
    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: day._id,
      action: "day_plan_confirm",
      byUserId: req.userId,
      byRole: "client",
      meta: { date },
    }, { subscriptionId: id, date });
    const serializedDay = serializeSubscriptionDayForClient(subInSession, day.toObject ? day.toObject() : day, runtime);
    const catalog = await loadWalletCatalogMapsSafely({
      days: [serializedDay],
      lang,
      context: "confirm_day_planning_result",
    });

    return res.status(200).json({
      ok: true,
      data: localizeWriteDayPayload(serializedDay, {
        lang,
        addonNames: catalog.addonNames,
      }),
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    if (err.code === "INVALID_DATE" || err.code === "LOCKED") {
      return errorResponse(res, 400, err.code, err.message);
    }
    logger.error("Confirm day planning failed", { subscriptionId: id, date, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Day planning confirmation failed");
  }
}

async function lockDaySnapshot(sub, day, session) {
  if (day.lockedSnapshot) return day.lockedSnapshot;
  const { premiumUpgradeSelections, addonCreditSelections } = applyDayWalletSelections({
    subscription: sub,
    day,
  });
  const planningSnapshot = buildScopedCanonicalPlanningSnapshot({
    subscription: sub,
    day,
    flagEnabled: isPhase2CanonicalDayPlanningEnabled(),
  });
  const recurringAddonSnapshot = buildScopedRecurringAddonSnapshot({
    subscription: sub,
    day,
  });
  const oneTimeAddonSnapshot = buildOneTimeAddonPlanningSnapshot({ day });
  const { address, deliveryWindow } = getEffectiveDeliveryDetails(sub, day);
  const snapshot = {
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    addonsOneTime: day.addonsOneTime,
    premiumUpgradeSelections,
    addonCreditSelections,
    customSalads: day.customSalads || [],
    customMeals: day.customMeals || [],
    subscriptionAddons: sub.addonSubscriptions || [],
    address,
    deliveryWindow,
    pricing: {
      planId: sub.planId,
      premiumPrice: sub.premiumPrice,
      addons: sub.addonSubscriptions,
    },
    mealsPerDay: resolveMealsPerDay(sub),
  };
  if (planningSnapshot) {
    snapshot.planning = planningSnapshot;
  }
  if (recurringAddonSnapshot) {
    snapshot.recurringAddons = recurringAddonSnapshot;
  }
  if (oneTimeAddonSnapshot) {
    Object.assign(snapshot, oneTimeAddonSnapshot);
  }
  day.lockedSnapshot = snapshot;
  day.lockedAt = new Date();
  await day.save({ session });
  return snapshot;
}


async function skipDay(req, res) {
  const { id, date } = req.params;
  const lang = getRequestLang(req);
  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    if (subInSession.status !== "active") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, "SUB_INACTIVE", "Subscription not active" );
    }

    const result = await applySkipForDate({ sub: subInSession, date, session });
    const policy = result.policy || resolveSubscriptionSkipPolicy(subInSession, subInSession.planId, {
      context: "skip_day",
    });
    const remainingSkipDays = resolveSkipRemainingDays(policy, subInSession);

    if (result.status === "already_skipped") {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({
        ok: true,
        data: {
          day: localizeWriteDayPayload(result.day, { lang }),
          requestedDays: 1,
          appliedDays: 0,
          remainingSkipDays,
          compensatedDaysAdded: 0,
          message: buildSingleSkipMessage({ appliedDays: 0, alreadySkipped: true }),
        },
      });
    }
    if (result.status === "skip_disabled") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, "SKIP_DISABLED", "Skip is disabled for this plan");
    }
    if (result.status === "frozen") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "FROZEN", "Day is frozen");
    }
    if (result.status === "locked") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Cannot skip after lock" );
    }
    if (result.status === "limit_reached") {
      await session.commitTransaction();
      session.endSession();
      const projectedDay = result.day
        ? serializeSubscriptionDayForClient(subInSession, result.day)
        : buildProjectedOpenDayForClient(subInSession, date);
      return res.status(200).json({
        ok: true,
        data: {
          day: localizeWriteDayPayload(projectedDay, { lang }),
          requestedDays: 1,
          appliedDays: 0,
          remainingSkipDays,
          compensatedDaysAdded: 0,
          message: buildSingleSkipMessage({ appliedDays: 0, dueToLimit: true }),
        },
      });
    }
    if (result.status !== "skipped") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Skip failed" );
    }

    await session.commitTransaction();
    session.endSession();
    await writeLogSafely({
      entityType: "subscription_day",
      entityId: result.day._id,
      action: "skip",
      byUserId: req.userId,
      byRole: "client",
      meta: {
        date: result.day.date,
        compensated: true,
        compensatedDaysAdded: Number(result.compensatedDaysAdded || 0),
      },
    }, { subscriptionId: id, date: result.day.date });
    return res.status(200).json({
      ok: true,
      data: {
        day: localizeWriteDayPayload(result.day, { lang }),
        requestedDays: 1,
        appliedDays: 1,
        remainingSkipDays,
        compensatedDaysAdded: Number(result.compensatedDaysAdded || 0),
        message: buildSingleSkipMessage({ appliedDays: 1 }),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Skip failed" );
  }
}

async function unskipDay(req, res) {
  const { id, date } = req.params;
  const lang = getRequestLang(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }

    ensureActive(subInSession, date);
    validateFutureDateOrThrow(date, subInSession);

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
    }
    if (day.status !== "skipped") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "CONFLICT", "Day is not skipped" );
    }
    if (day.lockedSnapshot || day.fulfilledSnapshot || day.fulfilledAt || day.assignedByKitchen || day.pickupRequested) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "CONFLICT", "Cannot unskip a processed day" );
    }
    const isCompensatedSkip = Boolean(day.skipCompensated);

    if (isCompensatedSkip) {
      const updatedSubscription = await Subscription.findOneAndUpdate(
        {
          _id: subInSession._id,
          skipDaysUsed: { $gte: 1 },
        },
        { $inc: { skipDaysUsed: -1 } },
        { new: true, session }
      );
      if (!updatedSubscription) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "DATA_INTEGRITY_ERROR", "Cannot restore credits for this skipped day" );
      }

      subInSession.skipDaysUsed = Number(updatedSubscription.skipDaysUsed || 0);
      await SubscriptionDay.updateOne(
        { _id: day._id },
        {
          $set: {
            status: "open",
            skippedByUser: false,
            skipCompensated: false,
            creditsDeducted: false,
          },
          $unset: { canonicalDayActionType: 1 },
        },
        { session }
      );
      await syncSubscriptionValidity(subInSession, session);
      day.status = "open";
      day.skippedByUser = false;
      day.skipCompensated = false;
      day.creditsDeducted = false;
    } else {
      if (!day.creditsDeducted) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "CONFLICT", "Skipped day has no deducted credits to restore" );
      }

      const mealsToRestore = resolveMealsPerDay(subInSession);
      const restoredSub = await Subscription.findOneAndUpdate(
        {
          _id: subInSession._id,
          skippedCount: { $gte: 1 },
          remainingMeals: { $lte: Number(subInSession.totalMeals || 0) - mealsToRestore },
        },
        { $inc: { remainingMeals: mealsToRestore, skippedCount: -1 } },
        { new: true, session }
      );
      if (!restoredSub) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "DATA_INTEGRITY_ERROR", "Cannot restore credits for this skipped day" );
      }

      day.status = "open";
      day.skippedByUser = false;
      day.creditsDeducted = false;
      await SubscriptionDay.updateOne(
        { _id: day._id },
        {
          $set: {
            status: "open",
            skippedByUser: false,
            skipCompensated: false,
            creditsDeducted: false,
          },
          $unset: { canonicalDayActionType: 1 },
        },
        { session }
      );
    }

    const responseDay = day.toObject ? day.toObject() : { ...day };
    delete responseDay.canonicalDayActionType;

    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: day._id,
      action: "unskip",
      byUserId: req.userId,
      byRole: "client",
      meta: { date },
    }, { subscriptionId: id, date });
    return res.status(200).json({
      ok: true,
      data: localizeWriteDayPayload(responseDay, { lang }),
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    if (err.code === "INVALID_DATE" || err.code === "LOCKED") {
      return errorResponse(res, 400, err.code, err.message);
    }
    logger.error("Unskip failed", { subscriptionId: id, date, error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Unskip failed" );
  }
}

async function skipRange(req, res) {
  const { id } = req.params;
  const { startDate, days, endDate } = req.body || {};
  const lang = getRequestLang(req);

  try {
    validateObjectId(id, "subscriptionId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  let rangeRequest;
  try {
    rangeRequest = resolveSkipRangeInputOrThrow({ startDate, days, endDate });
  } catch (err) {
    const status = err.code === "INVALID_DATE" ? 400 : 400;
    return errorResponse(res, status, err.code || "INVALID", err.message);
  }

  const sub = await Subscription.findById(id).populate("planId");
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub);
  } catch (err) {
    return errorResponse(res, 422, err.code, err.message );
  }

  const tomorrow = dateUtils.getTomorrowKSADate();
  if (!dateUtils.isOnOrAfterKSADate(startDate, tomorrow)) {
    return errorResponse(res, 400, "INVALID_DATE", "startDate must be from tomorrow onward" );
  }

  const cutoffTime = await getSettingValue("cutoff_time", "00:00");
  const summary = {
    requestedRange: {
      startDate: rangeRequest.startDate,
      endDate: rangeRequest.endDate,
      days: rangeRequest.days,
    },
    requestedDays: rangeRequest.days,
    appliedDays: 0,
    remainingSkipDays: 0,
    compensatedDaysAdded: 0,
    appliedDates: [],
    alreadySkipped: [],
    rejected: [],
    message: "",
  };
  const skippedForLog = [];

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const subInSession = await Subscription.findById(id).populate("planId").session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    try {
      ensureActive(subInSession, startDate);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, err.code, err.message);
    }
    const skipPolicy = resolveSubscriptionSkipPolicy(subInSession, subInSession.planId, {
      context: "skip_range",
    });
    if (!skipPolicy.enabled) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 422, "SKIP_DISABLED", "Skip is disabled for this plan");
    }
    const baseEndDate = subInSession.validityEndDate || subInSession.endDate;
    let appliedAny = false;

    for (const dateStr of rangeRequest.targetDates) {
      if (!dateUtils.isOnOrAfterKSADate(dateStr, tomorrow)) {
        summary.rejected.push({ date: dateStr, reason: "BEFORE_TOMORROW" });
        continue;
      }
      if (!dateUtils.isInSubscriptionRange(dateStr, baseEndDate)) {
        summary.rejected.push({ date: dateStr, reason: "OUTSIDE_VALIDITY" });
        continue;
      }
      if (dateStr === tomorrow && !dateUtils.isBeforeCutoff(cutoffTime)) {
        summary.rejected.push({ date: dateStr, reason: "CUTOFF_PASSED" });
        continue;
      }

      const result = await applySkipForDate({
        sub: subInSession,
        date: dateStr,
        session,
        syncValidityAfterApply: false,
      });
      if (result.status === "already_skipped") {
        summary.alreadySkipped.push(dateStr);
        continue;
      }
      if (result.status === "frozen") {
        summary.rejected.push({ date: dateStr, reason: "FROZEN" });
        continue;
      }
      if (result.status === "locked") {
        summary.rejected.push({ date: dateStr, reason: "LOCKED" });
        continue;
      }
      if (result.status === "limit_reached") {
        summary.rejected.push({ date: dateStr, reason: "PLAN_LIMIT_REACHED" });
        continue;
      }
      if (result.status !== "skipped") {
        summary.rejected.push({ date: dateStr, reason: "UNKNOWN" });
        continue;
      }

      appliedAny = true;
      summary.appliedDays += 1;
      summary.compensatedDaysAdded += Number(result.compensatedDaysAdded || 0);
      summary.appliedDates.push(dateStr);
      skippedForLog.push({ dayId: result.day._id, date: result.day.date });
    }

    if (appliedAny) {
      await syncSubscriptionValidity(subInSession, session);
    }

    summary.remainingSkipDays = resolveSkipRemainingDays(skipPolicy, subInSession);
    summary.message = buildSkipRangeMessage(summary);

    await session.commitTransaction();
    session.endSession();

    for (const item of skippedForLog) {
      await writeLogSafely({
        entityType: "subscription_day",
        entityId: item.dayId,
        action: "skip",
        byUserId: req.userId,
        byRole: "client",
        meta: { date: item.date },
      }, { subscriptionId: id, date: item.date });
    }

    return res.status(200).json({
      ok: true,
      data: localizeSkipRangeSummary(summary, { lang }),
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Skip range failed" );
  }
}

function matchSelectionDay(selection, { dayId, date }) {
  if (dayId) {
    return String(selection.dayId) === String(dayId);
  }
  return selection.date === date;
}

async function resolveSubscriptionDay({ subscriptionId, dayId, date, session }) {
  if (dayId) {
    return SubscriptionDay.findOne({ _id: dayId, subscriptionId }).session(session);
  }
  return SubscriptionDay.findOne({ subscriptionId, date }).session(session);
}

function buildAddonUnitFromDoc(addonDoc) {
  return resolveAddonUnitPriceHalala(addonDoc);
}

async function consumePremiumSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, baseSlotKey, premiumMealId } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(premiumMealId, "premiumMealId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }
  if (!baseSlotKey || !String(baseSlotKey).trim()) {
    return sendValidationError(res, "baseSlotKey is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub, date);

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    const existingSelection = (sub.premiumSelections || []).find(
      (item) =>
        matchSelectionDay(item, { dayId: day._id, date: day.date })
        && String(item.baseSlotKey) === String(baseSlotKey)
    );
    const existingDaySelection = (day.premiumUpgradeSelections || []).find(
      (item) => String(item.baseSlotKey) === String(baseSlotKey)
    );
    if (existingSelection || existingDaySelection) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "CONFLICT", "baseSlotKey already upgraded for this day");
    }

    if (isGenericPremiumWalletMode(sub)) {
      const consumedRows = consumeGenericPremiumCredits(sub, 1);
      if (!consumedRows || !consumedRows.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INSUFFICIENT_PREMIUM", "Not enough premium credits");
      }

      sub.premiumSelections.push({
        dayId: day._id,
        date: day.date,
        baseSlotKey: String(baseSlotKey),
        premiumMealId,
        unitExtraFeeHalala: Number(consumedRows[0].unitCreditPriceHalala || 0),
        currency: consumedRows[0].currency || "SAR",
        premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
        premiumWalletRowId: consumedRows[0].premiumWalletRowId || null,
      });
      syncPremiumRemainingFromActivePremiumWallet(sub);
    } else {
      const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
      const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
      if (hasLegacyPremiumOnly) {
        const subPremiumPriceSar = Number(sub.premiumPrice);
        const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
        const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
          ? subPremiumPriceSar
          : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
            ? settingsPremiumPriceSar
            : 0;
        const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
        const migrated = ensureLegacyPremiumBalanceFromRemaining(sub, {
          premiumMealId,
          unitExtraFeeHalala: legacyUnitExtraFeeHalala,
          currency: SYSTEM_CURRENCY,
        });
        if (migrated) {
          syncPremiumRemainingFromBalance(sub);
        }
      }

      const hasRequestedPremiumBucket = (sub.premiumBalance || []).some(
        (row) => String(row.premiumMealId) === String(premiumMealId)
      );
      if (!hasRequestedPremiumBucket) {
        for (const row of sub.premiumBalance || []) {
          if (String(row.premiumMealId) !== LEGACY_PREMIUM_MEAL_BUCKET_ID) continue;
          if (Number(row.remainingQty || 0) <= 0 && Number(row.purchasedQty || 0) <= 0) continue;
          row.premiumMealId = premiumMealId;
        }
      }

      const candidates = (sub.premiumBalance || [])
        .filter((row) => String(row.premiumMealId) === String(premiumMealId) && Number(row.remainingQty) > 0)
        .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());
      if (!candidates.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 400, "INSUFFICIENT_PREMIUM", "Not enough premium credits");
      }

      candidates[0].remainingQty = Number(candidates[0].remainingQty) - 1;
      sub.premiumSelections.push({
        dayId: day._id,
        date: day.date,
        baseSlotKey: String(baseSlotKey),
        premiumMealId,
        unitExtraFeeHalala: Number(candidates[0].unitExtraFeeHalala || 0),
        currency: candidates[0].currency || "SAR",
        premiumWalletMode: LEGACY_PREMIUM_WALLET_MODE,
      });
      syncPremiumRemainingFromActivePremiumWallet(sub);
    }
    applyDayWalletSelections({ subscription: sub, day });
    await sub.save({ session });
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();

    const remainingQtyTotal = isGenericPremiumWalletMode(sub)
      ? getRemainingPremiumCredits(sub)
      : (sub.premiumBalance || [])
        .filter((row) => String(row.premiumMealId) === String(premiumMealId))
        .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    return res.status(200).json({
      ok: true,
      data: {
        subscriptionId: sub.id,
        premiumMealId: String(premiumMealId),
        remainingQtyTotal,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Premium selection failed");
  }
}

async function removePremiumSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, baseSlotKey } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }
  if (!baseSlotKey || !String(baseSlotKey).trim()) {
    return sendValidationError(res, "baseSlotKey is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    const targetDay = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!targetDay) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    try {
      ensureActive(sub, targetDay.date);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID", err.message);
    }
    if (targetDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }
    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;
    const rows = sub.premiumSelections || [];
    const index = rows.findIndex(
      (row) =>
        matchSelectionDay(row, { dayId: targetDayId, date: targetDate })
        && String(row.baseSlotKey) === String(baseSlotKey)
    );

    if (index === -1) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Premium selection not found");
    }

    const [removed] = rows.splice(index, 1);
    try {
      if (isGenericPremiumWalletMode(sub)) {
        refundGenericPremiumSelectionRowsOrThrow(sub, [removed]);
      } else {
        refundPremiumSelectionRowsToBalanceOrThrow(sub, [removed]);
      }
    } catch (err) {
      logWalletIntegrityError("premium_refund_remove_selection", {
        subscriptionId: id,
        dayId: targetDayId,
        date: targetDate,
        baseSlotKey: String(baseSlotKey),
        premiumMealId: String(removed.premiumMealId),
        unitExtraFeeHalala: Number(removed.unitExtraFeeHalala || 0),
        reason: err.message,
      });
      await session.abortTransaction();
      session.endSession();
      return errorResponse(
        res,
        409,
        "DATA_INTEGRITY_ERROR",
        err.message
      );
    }

    syncPremiumRemainingFromActivePremiumWallet(sub);
    applyDayWalletSelections({ subscription: sub, day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({ ok: true, data: { subscriptionId: sub.id } });
  } catch (_err) {
    await session.abortTransaction();
    session.endSession();
    if (_err && _err.code === "DATA_INTEGRITY_ERROR") {
      return errorResponse(res, 409, "DATA_INTEGRITY_ERROR", _err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Premium selection refund failed");
  }
}

async function consumeAddonSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, addonId, qty } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(addonId, "addonId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }
  const parsedQty = parsePositiveInteger(qty);
  if (!parsedQty) {
    return sendValidationError(res, "qty must be a positive integer");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub, date);

    const day = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!day) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    if (day.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }

    const balances = (sub.addonBalance || [])
      .filter((row) => String(row.addonId) === String(addonId) && Number(row.remainingQty) > 0)
      .sort((a, b) => new Date(a.purchasedAt).getTime() - new Date(b.purchasedAt).getTime());

    const totalAvailable = balances.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    if (totalAvailable < parsedQty) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INSUFFICIENT_ADDON", "Not enough addon credits");
    }

    let remaining = parsedQty;
    for (const row of balances) {
      if (remaining <= 0) break;
      const available = Number(row.remainingQty || 0);
      const deduct = Math.min(available, remaining);
      if (!deduct) continue;
      row.remainingQty = available - deduct;
      sub.addonSelections.push({
        dayId: day._id,
        date: day.date,
        addonId,
        qty: deduct,
        unitPriceHalala: Number(row.unitPriceHalala || 0),
        currency: row.currency || "SAR",
      });
      remaining -= deduct;
    }

    applyDayWalletSelections({ subscription: sub, day });
    await sub.save({ session });
    await day.save({ session });
    await session.commitTransaction();
    session.endSession();

    const remainingQtyTotal = (sub.addonBalance || [])
      .filter((row) => String(row.addonId) === String(addonId))
      .reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    return res.status(200).json({
      ok: true,
      data: { subscriptionId: sub.id, addonId: String(addonId), remainingQtyTotal },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    return errorResponse(res, 500, "INTERNAL", "Addon selection failed");
  }
}

async function removeAddonSelection(req, res) {
  const { id } = req.params;
  const { dayId, date, addonId } = req.body || {};

  try {
    validateObjectId(id, "subscriptionId");
    validateObjectId(addonId, "addonId");
    if (dayId) validateObjectId(dayId, "dayId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }
  if (!dayId && !date) {
    return sendValidationError(res, "dayId or date is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    const targetDay = await resolveSubscriptionDay({ subscriptionId: sub._id, dayId, date, session });
    if (!targetDay) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Day not found");
    }
    try {
      ensureActive(sub, targetDay.date);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID", err.message);
    }
    if (targetDay.status !== "open") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "LOCKED", "Day is locked");
    }
    const targetDayId = String(targetDay._id);
    const targetDate = targetDay.date;

    const toRefund = (sub.addonSelections || []).filter(
      (row) =>
        String(row.addonId) === String(addonId)
        && matchSelectionDay(row, { dayId: targetDayId, date: targetDate })
    );
    if (!toRefund.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Addon selection not found");
    }

    sub.addonSelections = (sub.addonSelections || []).filter(
      (row) =>
        !(String(row.addonId) === String(addonId) && matchSelectionDay(row, { dayId: targetDayId, date: targetDate }))
    );

    for (const row of toRefund) {
      const match = (sub.addonBalance || []).find(
        (balance) =>
          String(balance.addonId) === String(addonId)
          && Number(balance.unitPriceHalala || 0) === Number(row.unitPriceHalala || 0)
      );
      if (!match) {
        logWalletIntegrityError("addon_refund_remove_selection_missing_bucket", {
          subscriptionId: id,
          dayId: targetDayId,
          date: targetDate,
          addonId: String(addonId),
          unitPriceHalala: Number(row.unitPriceHalala || 0),
        });
        await session.abortTransaction();
        session.endSession();
        return errorResponse(
          res,
          409,
          "DATA_INTEGRITY_ERROR",
          "Cannot refund addon credits because the original wallet bucket was not found"
        );
      }
      const refundQty = Number(row.qty || 0);
      const nextRemainingQty = Number(match.remainingQty || 0) + refundQty;
      const purchasedQty = Number(match.purchasedQty || 0);
      if (nextRemainingQty > purchasedQty) {
        logWalletIntegrityError("addon_refund_remove_selection_exceeds_purchased", {
          subscriptionId: id,
          dayId: targetDayId,
          date: targetDate,
          addonId: String(addonId),
          unitPriceHalala: Number(row.unitPriceHalala || 0),
          attemptedRemainingQty: nextRemainingQty,
          purchasedQty,
        });
        await session.abortTransaction();
        session.endSession();
        return errorResponse(
          res,
          409,
          "DATA_INTEGRITY_ERROR",
          "Cannot refund addon credits because refund exceeds purchased quantity"
        );
      }
      match.remainingQty = nextRemainingQty;
    }

    const hasPremiumBalanceRows = Array.isArray(sub.premiumBalance) && sub.premiumBalance.length > 0;
    const hasLegacyPremiumOnly = Number(sub.premiumRemaining || 0) > 0 && !hasPremiumBalanceRows;
    if (hasLegacyPremiumOnly) {
      const subPremiumPriceSar = Number(sub.premiumPrice);
      const settingsPremiumPriceSar = Number(await getSettingValue("premium_price", 20));
      const fallbackPremiumPriceSar = Number.isFinite(subPremiumPriceSar) && subPremiumPriceSar >= 0
        ? subPremiumPriceSar
        : Number.isFinite(settingsPremiumPriceSar) && settingsPremiumPriceSar >= 0
          ? settingsPremiumPriceSar
          : 0;
      const legacyUnitExtraFeeHalala = Math.round(fallbackPremiumPriceSar * 100);
      ensureLegacyPremiumBalanceFromRemaining(sub, {
        unitExtraFeeHalala: legacyUnitExtraFeeHalala,
        currency: SYSTEM_CURRENCY,
      });
    }
    syncPremiumRemainingFromBalance(sub);
    applyDayWalletSelections({ subscription: sub, day: targetDay });
    await sub.save({ session });
    await targetDay.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({ ok: true, data: { subscriptionId: sub.id } });
  } catch (_err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Addon selection refund failed");
  }
}

function applyLegacyPremiumTopupHeaders(res, subscriptionId) {
  res.set("Deprecation", "true");
  res.set("Sunset", LEGACY_PREMIUM_TOPUP_SUNSET_HTTP_DATE);
  res.append(
    "Link",
    `</api/subscriptions/${subscriptionId}/premium-credits/topup>; rel="successor-version"`
  );
}

async function topupPremium(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  applyLegacyPremiumTopupHeaders(res, req.params.id);

  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "items")) {
    return topupPremiumCredits(req, res, runtime);
  }

  try {
    const { id } = req.params;
    const { count, successUrl, backUrl } = req.body || {};
    const lang = getRequestLang(req);
    const premiumCount = parseInt(count, 10);
    if (!premiumCount || premiumCount <= 0) {
      return errorResponse(res, 400, "INVALID", "Invalid premium count" );
    }

    const sub = await Subscription.findById(id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    if (sub.userId.toString() !== req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    try {
      ensureActive(sub);
    } catch (err) {
      return errorResponse(res, 422, err.code, err.message );
    }

    const idempotency = await maybeHandleNonCheckoutIdempotency({
      req,
      res,
      operationScope: "premium_topup",
      effectivePayload: {
        subscriptionId: String(sub._id),
        premiumCount,
      },
      fallbackResponseShape: "legacy_premium_topup",
      runtime,
    });
    if (!idempotency.shouldContinue) {
      return idempotency.response;
    }

    const premiumPrice = await getSettingValue("premium_price", 20);
    const amount = Math.round(premiumPrice * premiumCount * 100);
    const unitExtraFeeHalala = Math.round(Number(premiumPrice || 0) * 100);
    const appUrl = process.env.APP_URL || "https://example.com";
    const genericTopup = isGenericPremiumWalletMode(sub);

    const invoice = await runtime.createInvoice({
      amount,
      description: buildPaymentDescription("legacyPremiumTopup", lang, {
        count: premiumCount,
      }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "premium_topup",
        subscriptionId: String(sub._id),
        userId: String(req.userId),
        premiumCount,
        ...(genericTopup
          ? {
            premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
            unitCreditPriceHalala: unitExtraFeeHalala >= 0 ? unitExtraFeeHalala : 0,
          }
          : {
            unitExtraFeeHalala: unitExtraFeeHalala >= 0 ? unitExtraFeeHalala : 0,
          }),
        currency: SYSTEM_CURRENCY,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await runtime.createPayment({
      provider: "moyasar",
      type: "premium_topup",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
      userId: req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
        paymentUrl: invoice.url,
        responseShape: "legacy_premium_topup",
      }),
      ...(idempotency.idempotencyKey
        ? {
          operationScope: "premium_topup",
          operationIdempotencyKey: idempotency.idempotencyKey,
          operationRequestHash: idempotency.operationRequestHash,
        }
        : {}),
    });

    return res.status(200).json({
      ok: true,
      data: { payment_url: invoice.url, invoice_id: invoice.id, payment_id: payment.id },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    logger.error("Topup error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Top-up failed" );
  }
}

async function topupPremiumCredits(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  try {
    const { id } = req.params;
    const { items, successUrl, backUrl } = req.body || {};
    const lang = getRequestLang(req);
    const normalizedItems = normalizeCheckoutItemsOrThrow(items, "premiumMealId", "items");
    if (!normalizedItems.length) {
      return sendValidationError(res, "items must contain at least one premium meal");
    }

    const sub = await Subscription.findById(id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    if (sub.userId.toString() !== req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub);

    const genericTopup = isGenericPremiumWalletMode(sub);
    let amount = 0;
    let itemsForPayment = [];
    let premiumCount = 0;
    let unitCreditPriceHalala = 0;
    if (genericTopup) {
      premiumCount = normalizedItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
      const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
      unitCreditPriceHalala =
        Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0
          ? Math.round(premiumPriceSar * 100)
          : 0;
      amount = premiumCount * unitCreditPriceHalala;
    } else {
      const premiumDocs = await PremiumMeal.find({
        _id: { $in: normalizedItems.map((item) => item.id) },
        isActive: true,
      }).lean();
      const premiumById = new Map(premiumDocs.map((doc) => [String(doc._id), doc]));

      for (const item of normalizedItems) {
        const doc = premiumById.get(item.id);
        if (!doc) {
          return errorResponse(res, 404, "NOT_FOUND", `Premium meal ${item.id} not found`);
        }
        assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Premium meal ${item.id} currency`);
        const unit = Number(doc.extraFeeHalala || 0);
        amount += unit * item.qty;
        itemsForPayment.push({
          premiumMealId: item.id,
          qty: item.qty,
          unitExtraFeeHalala: unit,
          currency: SYSTEM_CURRENCY,
        });
      }
    }

    const idempotency = await maybeHandleNonCheckoutIdempotency({
      req,
      res,
      operationScope: "premium_topup",
      effectivePayload: genericTopup
        ? {
          subscriptionId: String(sub._id),
          premiumCount,
        }
        : {
          subscriptionId: String(sub._id),
          items: normalizeOperationItemsForHash(itemsForPayment, "premiumMealId"),
        },
      fallbackResponseShape: "premium_credits_topup",
      runtime,
    });
    if (!idempotency.shouldContinue) {
      return idempotency.response;
    }

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await runtime.createInvoice({
      amount,
      description: buildPaymentDescription("premiumCreditsTopup", lang),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "premium_topup",
        subscriptionId: String(sub._id),
        userId: String(req.userId),
        ...(genericTopup
          ? {
            premiumWalletMode: GENERIC_PREMIUM_WALLET_MODE,
            premiumCount,
            unitCreditPriceHalala,
            currency: SYSTEM_CURRENCY,
          }
          : {
            items: itemsForPayment,
          }),
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await runtime.createPayment({
      provider: "moyasar",
      type: "premium_topup",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
      userId: req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
        paymentUrl: invoice.url,
        responseShape: "premium_credits_topup",
        totalHalala: amount,
      }),
      ...(idempotency.idempotencyKey
        ? {
          operationScope: "premium_topup",
          operationIdempotencyKey: idempotency.idempotencyKey,
          operationRequestHash: idempotency.operationRequestHash,
        }
        : {}),
    });

    return res.status(200).json({
      ok: true,
      data: {
        payment_url: invoice.url,
        invoice_id: invoice.id,
        payment_id: payment.id,
        totalHalala: amount,
      },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    logger.error("Premium top-up error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Top-up failed");
  }
}

async function topupAddonCredits(req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  try {
    const { id } = req.params;
    const { items, successUrl, backUrl } = req.body || {};
    const lang = getRequestLang(req);
    const normalizedItems = normalizeCheckoutItemsOrThrow(items, "addonId", "items");
    if (!normalizedItems.length) {
      return sendValidationError(res, "items must contain at least one addon");
    }

    const sub = await Subscription.findById(id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    if (sub.userId.toString() !== req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    ensureActive(sub);

    const addonDocs = await Addon.find({
      _id: { $in: normalizedItems.map((item) => item.id) },
      isActive: true,
    }).lean();
    const addonById = new Map(addonDocs.map((doc) => [String(doc._id), doc]));

    let amount = 0;
    const itemsForPayment = [];
    for (const item of normalizedItems) {
      const doc = addonById.get(item.id);
      if (!doc) {
        return errorResponse(res, 404, "NOT_FOUND", `Addon ${item.id} not found`);
      }
      assertSystemCurrencyOrThrow(doc.currency || SYSTEM_CURRENCY, `Addon ${item.id} currency`);
      const unit = buildAddonUnitFromDoc(doc);
      amount += unit * item.qty;
      itemsForPayment.push({
        addonId: item.id,
        qty: item.qty,
        unitPriceHalala: unit,
        currency: SYSTEM_CURRENCY,
      });
    }

    const idempotency = await maybeHandleNonCheckoutIdempotency({
      req,
      res,
      operationScope: "addon_topup",
      effectivePayload: {
        subscriptionId: String(sub._id),
        items: normalizeOperationItemsForHash(itemsForPayment, "addonId"),
      },
      fallbackResponseShape: "addon_credits_topup",
      runtime,
    });
    if (!idempotency.shouldContinue) {
      return idempotency.response;
    }

    const appUrl = process.env.APP_URL || "https://example.com";
    const invoice = await runtime.createInvoice({
      amount,
      description: buildPaymentDescription("addonCreditsTopup", lang),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "addon_topup",
        subscriptionId: String(sub._id),
        userId: String(req.userId),
        items: itemsForPayment,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await runtime.createPayment({
      provider: "moyasar",
      type: "addon_topup",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
      userId: req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
        paymentUrl: invoice.url,
        responseShape: "addon_credits_topup",
        totalHalala: amount,
      }),
      ...(idempotency.idempotencyKey
        ? {
          operationScope: "addon_topup",
          operationIdempotencyKey: idempotency.idempotencyKey,
          operationRequestHash: idempotency.operationRequestHash,
        }
        : {}),
    });

    return res.status(200).json({
      ok: true,
      data: {
        payment_url: invoice.url,
        invoice_id: invoice.id,
        payment_id: payment.id,
        totalHalala: amount,
      },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    if (err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED") {
      return errorResponse(res, 422, err.code, err.message);
    }
    logger.error("Addon top-up error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Top-up failed");
  }
}

async function addOneTimeAddon(_req, res, runtimeOverrides = null) {
  const runtime = runtimeOverrides ? { ...sliceEDefaultRuntime, ...runtimeOverrides } : sliceEDefaultRuntime;
  try {
    const { id } = _req.params;
    const { addonId, date, successUrl, backUrl } = _req.body || {};
    if (!addonId || !date) {
      return errorResponse(res, 400, "INVALID", "Missing addonId or date" );
    }

    const sub = await Subscription.findById(id).populate("planId");
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    if (sub.userId.toString() !== _req.userId.toString()) {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }
    try {
      ensureActive(sub, date);
      validateFutureDateOrThrow(date, sub);
    } catch (err) {
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
    }
    // MEDIUM AUDIT FIX: One-time add-on purchases must obey the same tomorrow cutoff guard as meal edits.
    try {
      await enforceTomorrowCutoffOrThrow(date);
    } catch (err) {
      return errorResponse(res, 400, err.code || "LOCKED", err.message );
    }

    const addon = await Addon.findById(addonId).lean();
    if (!addon || addon.type !== "one_time" || addon.isActive === false) {
      return errorResponse(res, 404, "NOT_FOUND", "Addon not found" );
    }
    assertSystemCurrencyOrThrow(addon.currency || SYSTEM_CURRENCY, `Addon ${addonId} currency`);

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
    if (day && day.status !== "open") {
      return errorResponse(res, 409, "LOCKED", "Day is locked" );
    }

    const idempotency = await maybeHandleNonCheckoutIdempotency({
      req: _req,
      res,
      operationScope: "one_time_addon",
      effectivePayload: {
        subscriptionId: String(sub._id),
        addonId: String(addon._id),
        date,
      },
      fallbackResponseShape: "one_time_addon",
      runtime,
    });
    if (!idempotency.shouldContinue) {
      return idempotency.response;
    }

    const amount = buildAddonUnitFromDoc(addon);
    const appUrl = process.env.APP_URL || "https://example.com";
    const lang = getRequestLang(_req);
    const addonDisplayName = pickLang(addon.name, lang);

    const invoice = await runtime.createInvoice({
      amount,
      description: buildPaymentDescription("oneTimeAddon", lang, {
        name: addonDisplayName,
      }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: validateRedirectUrl(successUrl, `${appUrl}/payments/success`),
      backUrl: validateRedirectUrl(backUrl, `${appUrl}/payments/cancel`),
      metadata: {
        type: "one_time_addon",
        subscriptionId: String(sub._id),
        userId: String(_req.userId),
        addonId: String(addon._id),
        date,
      },
    });
    const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

    const payment = await runtime.createPayment({
      provider: "moyasar",
      type: "one_time_addon",
      status: "initiated",
      amount,
      currency: invoiceCurrency,
      userId: _req.userId,
      subscriptionId: sub._id,
      providerInvoiceId: invoice.id,
      metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
        paymentUrl: invoice.url,
        responseShape: "one_time_addon",
      }),
      ...(idempotency.idempotencyKey
        ? {
          operationScope: "one_time_addon",
          operationIdempotencyKey: idempotency.idempotencyKey,
          operationRequestHash: idempotency.operationRequestHash,
        }
        : {}),
    });

    return res.status(200).json({
      ok: true,
      data: { payment_url: invoice.url, invoice_id: invoice.id, payment_id: payment.id },
    });
  } catch (err) {
    if (err.code === "VALIDATION_ERROR") {
      return sendValidationError(res, err.message);
    }
    logger.error("Addon error", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Addon purchase failed" );
  }
}

async function preparePickup(req, res) {
  const { id, date } = req.params;
  const lang = getRequestLang(req);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }
    if (sub.userId.toString() !== req.userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    try {
      ensureActive(sub, date);
      validateFutureDateOrThrow(date, sub);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
      return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
    }

    try {
      await enforceTomorrowCutoffOrThrow(date);
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, err.code || "LOCKED", err.message );
    }

    if (sub.deliveryMode !== "pickup") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Delivery mode is not pickup" );
    }

    const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).session(session);

    // CR-03 FIX: Check if already processed (idempotency)
    if (day && day.pickupRequested) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({
        ok: true,
        data: localizeWriteDayPayload(day, { lang }),
      });
    }

    if (day && day.creditsDeducted) {
      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({
        ok: true,
        data: localizeWriteDayPayload(day, { lang }),
      });
    }

    if (day && !canTransition(day.status, "locked")) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition" );
    }

    const mealsToDeduct = resolveMealsPerDay(sub);

    let updatedDay;
    if (!day) {
      const created = await SubscriptionDay.create([{
        subscriptionId: id,
        date,
        pickupRequested: true,
        status: "locked",
        creditsDeducted: true
      }], { session });
      updatedDay = created[0];
    } else {
      updatedDay = await SubscriptionDay.findOneAndUpdate(
        { _id: day._id, status: { $in: ["open", null] } },
        { $set: { pickupRequested: true, status: "locked", creditsDeducted: true } },
        { new: true, session }
      );
      if (!updatedDay) {
        await session.abortTransaction();
        session.endSession();
        return errorResponse(res, 409, "LOCKED", "Day already locked" );
      }
    }

    // Capture Snapshot (Rule requirement)
    await lockDaySnapshot(sub, updatedDay, session);

    // CR-03 FIX: Atomic credit deduction with conditional update
    const subUpdate = await Subscription.updateOne(
      { _id: id, remainingMeals: { $gte: mealsToDeduct } },
      { $inc: { remainingMeals: -mealsToDeduct } },
      { session }
    );

    if (!subUpdate.modifiedCount) {
      // Rollback day update
      await SubscriptionDay.updateOne(
        { _id: updatedDay._id },
        { $set: { pickupRequested: false, status: "open", creditsDeducted: false } },
        { session }
      );
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INSUFFICIENT_CREDITS", "Not enough credits" );
    }

    await session.commitTransaction();
    session.endSession();

    await writeLogSafely({
      entityType: "subscription_day",
      entityId: updatedDay._id,
      action: "pickup_prepare",
      byUserId: req.userId,
      byRole: "client",
      meta: { date: updatedDay.date, deductedCredits: mealsToDeduct },
    }, { subscriptionId: id, date: updatedDay.date });
    return res.status(200).json({
      ok: true,
      data: localizeWriteDayPayload(updatedDay, { lang }),
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("Pickup prepare failed", { error: err.message, stack: err.stack });
    return errorResponse(res, 500, "INTERNAL", "Pickup prepare failed" );
  }
}

async function updateDeliveryDetails(req, res, runtimeOverrides = null) {
  const { id } = req.params;
  const lang = getRequestLang(req);

  const sub = await Subscription.findById(id);
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub);
  } catch (err) {
    return errorResponse(res, 422, err.code, err.message );
  }

  let resolvedUpdate;
  try {
    resolvedUpdate = await resolveSubscriptionDeliveryDefaultsUpdate({
      subscription: sub.toObject ? sub.toObject() : sub,
      payload: req.body || {},
      lang,
      allowModeChange: false,
      runtime: runtimeOverrides,
    });
  } catch (err) {
    return errorResponse(res, err.status || 400, err.code || "INVALID", err.message);
  }

  // MEDIUM AUDIT FIX: Global delivery updates must not mutate tomorrow's effective details after cutoff has passed.
  if (resolvedUpdate.willChangeAddress || resolvedUpdate.willChangeWindow) {
    const tomorrow = dateUtils.getTomorrowKSADate();
    const endDate = sub.validityEndDate || sub.endDate;
    if (dateUtils.isInSubscriptionRange(tomorrow, endDate)) {
      const tomorrowDay = await SubscriptionDay.findOne({ subscriptionId: id, date: tomorrow }).lean();
      const isTomorrowEditable = !tomorrowDay || tomorrowDay.status === "open";
      const addressImpactsTomorrow = resolvedUpdate.willChangeAddress && !hasDeliveryAddressOverride(tomorrowDay);
      const windowImpactsTomorrow = resolvedUpdate.willChangeWindow && !hasDeliveryWindowOverride(tomorrowDay);
      if (isTomorrowEditable && (addressImpactsTomorrow || windowImpactsTomorrow)) {
        try {
          await enforceTomorrowCutoffOrThrow(tomorrow);
        } catch (err) {
          return errorResponse(res, 400, err.code || "LOCKED", err.message );
        }
      }
    }
  }

  Object.assign(sub, resolvedUpdate.patch);
  await sub.save();
  await writeLogSafely({
    entityType: "subscription",
    entityId: sub._id,
    action: "delivery_update",
    byUserId: req.userId,
    byRole: "client",
    meta: resolvedUpdate.logMeta,
  }, { subscriptionId: id });
  return res.status(200).json({
    ok: true,
    data: localizeWriteSubscriptionPayload(sub.toObject ? sub.toObject() : sub, { lang }),
  });
}

async function updateDeliveryDetailsForDate(req, res) {
  const { id, date } = req.params;
  const { deliveryAddress, deliveryWindow } = req.body || {};
  const lang = getRequestLang(req);
  if (deliveryAddress === undefined && deliveryWindow === undefined) {
    return errorResponse(res, 400, "INVALID", "Missing delivery update fields" );
  }

  const sub = await Subscription.findById(id);
  if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
  if (sub.userId.toString() !== req.userId.toString()) {
    return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
  }
  try {
    ensureActive(sub, date);
    validateFutureDateOrThrow(date, sub);
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return errorResponse(res, status, err.code || "INVALID_DATE", err.message );
  }

  try {
    await enforceTomorrowCutoffOrThrow(date);
  } catch (err) {
    return errorResponse(res, 400, err.code || "LOCKED", err.message );
  }

  if (sub.deliveryMode !== "delivery") {
    return errorResponse(res, 400, "INVALID", "Delivery mode is not delivery" );
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
    return errorResponse(res, 400, "INVALID", "Invalid delivery window" );
  }

  const day = await SubscriptionDay.findOne({ subscriptionId: id, date }).lean();
  if (day && day.status !== "open") {
    return errorResponse(res, 409, "LOCKED", "Day is locked" );
  }

  const update = {};
  if (deliveryAddress !== undefined) update.deliveryAddressOverride = deliveryAddress;
  if (deliveryWindow !== undefined) update.deliveryWindowOverride = deliveryWindow;

  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    { subscriptionId: id, date },
    { $set: update },
    { upsert: true, new: true }
  );

  await writeLogSafely({
    entityType: "subscription_day",
    entityId: updatedDay._id,
    action: "delivery_update_day",
    byUserId: req.userId,
    byRole: "client",
    meta: { date, deliveryWindow: updatedDay.deliveryWindowOverride },
  }, { subscriptionId: id, date });

  return res.status(200).json({
    ok: true,
    data: localizeWriteDayPayload(updatedDay, { lang }),
  });
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
      return errorResponse(res, 404, "NOT_FOUND", "Day not found" );
    }
    if (!canTransition(day.status, toStatus)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Invalid state transition" );
    }

    const sub = await Subscription.findById(id).populate("planId").session(session);
    if (!sub) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found" );
    }

    if (toStatus === "locked") {
      await lockDaySnapshot(sub, day, session);
    }

    day.status = toStatus;
    await day.save({ session });

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true, data: day });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Transition failed" );
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
      return errorResponse(res, status, result.code, result.message );
    }

    await session.commitTransaction();
    session.endSession();
    return res.status(200).json({ ok: true, data: result.day, alreadyFulfilled: result.alreadyFulfilled });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return errorResponse(res, 500, "INTERNAL", "Fulfillment failed" );
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
  getSubscriptionWallet,
  getSubscriptionWalletHistory,
  getWalletTopupPaymentStatus,
  verifyWalletTopupPayment,
  createPremiumOverageDayPayment,
  verifyPremiumOverageDayPayment,
  createOneTimeAddonDayPlanningPayment,
  verifyOneTimeAddonDayPlanningPayment,
  applyWalletTopupPayment,
  freezeSubscription,
  unfreezeSubscription,
  getSubscriptionDays,
  getSubscriptionToday,
  getSubscriptionDay,
  updateDaySelection,
  confirmDayPlanning,
  skipDay,
  unskipDay,
  skipRange,
  consumePremiumSelection,
  removePremiumSelection,
  consumeAddonSelection,
  removeAddonSelection,
  topupPremium,
  topupPremiumCredits,
  topupAddonCredits,
  addOneTimeAddon,
  preparePickup,
  updateDeliveryDetails,
  updateDeliveryDetailsForDate,
  transitionDay,
  fulfillDay,
  ensureActive,
};
