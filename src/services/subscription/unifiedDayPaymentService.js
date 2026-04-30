const mongoose = require("mongoose");

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");
const { logger } = require("../../utils/logger");
const { buildPaymentDescription } = require("../../utils/subscription/subscriptionWriteLocalization");
const {
  buildPaymentRedirectContext,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
} = require("../paymentProviderMetadataService");
const {
  buildPaymentMetadataWithInitiationFields,
  buildProviderInvoicePayload,
  serializeCheckoutPayment,
} = require("./subscriptionPaymentPayloadService");
const { getPaymentMetadata } = require("./subscriptionCheckoutHelpers");
const { buildErrorResult, buildSuccessResult } = require("./subscriptionNonCheckoutPaymentService");
const { applyCommercialStateToDay } = require("./subscriptionDayCommercialStateService");
const {
  assertSubscriptionDayModifiable,
  localizePolicyErrorMessage,
} = require("./subscriptionDayModificationPolicyService");

const SYSTEM_CURRENCY = "SAR";
const UNIFIED_DAY_PAYMENT_TYPE = "day_planning_payment";
const FINAL_PAYMENT_STATUSES = new Set(["paid", "failed", "canceled", "expired", "refunded"]);

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function buildPendingAddonSnapshot(day) {
  const pending = (Array.isArray(day && day.addonSelections) ? day.addonSelections : [])
    .filter((selection) => selection && selection.source === "pending_payment");

  const oneTimeAddonSelections = pending.map((item) => ({
    addonId: String(item.addonId),
    name: item.name,
    category: item.category,
    unitPriceHalala: normalizeNumber(item.priceHalala),
    currency: normalizeCurrencyValue(item.currency),
  }));

  return {
    oneTimeAddonSelections,
    oneTimeAddonCount: oneTimeAddonSelections.length,
    addonsAmountHalala: oneTimeAddonSelections.reduce((sum, item) => sum + normalizeNumber(item.unitPriceHalala), 0),
    currency: oneTimeAddonSelections[0] && oneTimeAddonSelections[0].currency
      ? oneTimeAddonSelections[0].currency
      : SYSTEM_CURRENCY,
  };
}

function buildUnifiedPaymentPayload({ subscription, day, payment, providerInvoice = null }) {
  const derivedDay = applyCommercialStateToDay(day || {});
  const metadata = getPaymentMetadata(payment);
  const paymentStatus = payment && payment.status ? payment.status : null;
  return {
    subscriptionId: String(subscription._id),
    dayId: day && day._id ? String(day._id) : null,
    date: day && day.date ? day.date : null,
    paymentStatus,
    applied: Boolean(payment && payment.applied),
    isFinal: FINAL_PAYMENT_STATUSES.has(paymentStatus),
    premiumSummary: derivedDay.premiumSummary,
    premiumExtraPayment: derivedDay.premiumExtraPayment,
    addonSelections: Array.isArray(day && day.addonSelections) ? day.addonSelections : [],
    paymentRequirement: derivedDay.paymentRequirement,
    commercialState: derivedDay.commercialState,
    providerInvoice: buildProviderInvoicePayload(providerInvoice, payment, metadata.paymentUrl || ""),
    payment: serializeCheckoutPayment(payment),
  };
}

async function createUnifiedDayPaymentFlow({
  subscriptionId,
  date,
  userId,
  lang,
  headers = {},
  body = {},
  runtime,
  ensureActiveFn,
}) {
  try {
    const sub = await Subscription.findById(subscriptionId);
    if (!sub) return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    if (String(sub.userId) !== String(userId)) return buildErrorResult(403, "FORBIDDEN", "Forbidden");

    ensureActiveFn(sub, date);

    const day = await SubscriptionDay.findOne({ subscriptionId, date });
    if (!day) return buildErrorResult(404, "NOT_FOUND", "Day not found");

    try {
      await assertSubscriptionDayModifiable({ subscription: sub, day, date });
    } catch (err) {
      return buildErrorResult(err.status || 400, err.code || "INVALID_DATE", localizePolicyErrorMessage(err, lang), err.details);
    }
    if (day.status !== "open") return buildErrorResult(409, "LOCKED", "Day is locked");

    const derivedDay = applyCommercialStateToDay(day.toObject ? day.toObject() : day);
    const requirement = derivedDay.paymentRequirement || {};
    if (!requirement.requiresPayment || !requirement.canCreatePayment) {
      return buildErrorResult(409, "DAY_PAYMENT_NOT_REQUIRED", "This day has no payable pending amount", requirement);
    }

    if (
      body
      && body.plannerRevisionHash !== undefined
      && String(body.plannerRevisionHash || "") !== String(derivedDay.plannerRevisionHash)
    ) {
      return buildErrorResult(409, "DAY_PAYMENT_REVISION_MISMATCH", "Planner changed since payment creation", {
        expectedPlannerRevisionHash: derivedDay.plannerRevisionHash,
        receivedPlannerRevisionHash: String(body.plannerRevisionHash || ""),
      });
    }

    const premiumAmountHalala = normalizeNumber(derivedDay.premiumExtraPayment && derivedDay.premiumExtraPayment.amountHalala);
    const addonSnapshot = buildPendingAddonSnapshot(derivedDay);
    const addonsAmountHalala = addonSnapshot.addonsAmountHalala;
    const totalHalala = premiumAmountHalala + addonsAmountHalala;
    if (totalHalala <= 0) {
      return buildErrorResult(409, "DAY_PAYMENT_NOT_REQUIRED", "This day has no payable pending amount", requirement);
    }

    const appUrl = process.env.APP_URL || "https://example.com";
    const redirectContext = buildPaymentRedirectContext({
      appUrl,
      paymentType: UNIFIED_DAY_PAYMENT_TYPE,
      subscriptionId: String(sub._id),
      dayId: String(day._id),
      date: String(day.date),
      successUrl: body && body.successUrl,
      backUrl: body && body.backUrl,
    });

    let invoice;
    try {
      invoice = await runtime.createInvoice({
        amount: totalHalala,
        description: buildPaymentDescription("mealPlannerPayment", lang, {
          count: normalizeNumber(derivedDay.premiumSummary && derivedDay.premiumSummary.pendingPaymentCount)
            + addonSnapshot.oneTimeAddonCount,
        }),
        callbackUrl: `${appUrl}/api/webhooks/moyasar`,
        successUrl: redirectContext.providerSuccessUrl,
        backUrl: redirectContext.providerCancelUrl,
        metadata: {
          type: UNIFIED_DAY_PAYMENT_TYPE,
          subscriptionId: String(sub._id),
          userId: String(userId),
          dayId: String(day._id),
          date: String(day.date),
          revisionHash: derivedDay.plannerRevisionHash,
          premiumAmountHalala,
          addonsAmountHalala,
          totalHalala,
          extraPremiumCount: normalizeNumber(derivedDay.premiumExtraPayment && derivedDay.premiumExtraPayment.extraPremiumCount),
          oneTimeAddonSelections: addonSnapshot.oneTimeAddonSelections,
          oneTimeAddonCount: addonSnapshot.oneTimeAddonCount,
          currency: SYSTEM_CURRENCY,
          redirectToken: redirectContext.token,
        },
      });
    } catch (err) {
      logger.error("Unified day payment initiation: createInvoice failed", { error: err.message, subscriptionId, date });
      return buildErrorResult(err.status || 502, "PAYMENT_PROVIDER_ERROR", "Failed to create payment provider invoice");
    }

    const invoiceCurrency = normalizeCurrencyValue(invoice.currency || SYSTEM_CURRENCY);
    if (invoiceCurrency !== SYSTEM_CURRENCY) {
      return buildErrorResult(500, "CONFIG", `Invoice currency must use ${SYSTEM_CURRENCY}`);
    }

    let payment;
    try {
      payment = await runtime.createPayment({
        provider: "moyasar",
        type: UNIFIED_DAY_PAYMENT_TYPE,
        status: "initiated",
        amount: totalHalala,
        currency: invoiceCurrency,
        userId,
        subscriptionId: sub._id,
        providerInvoiceId: invoice.id,
        metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
          paymentUrl: invoice.url,
          responseShape: UNIFIED_DAY_PAYMENT_TYPE,
          totalHalala,
          redirectContext,
        }),
      });
    } catch (err) {
      logger.error("Unified day payment initiation: createPayment failed", { error: err.message, code: err.code, subscriptionId, date });
      return buildErrorResult(500, "PAYMENT_PERSISTENCE_ERROR", "Failed to record payment initiation");
    }

    const paymentId = payment && payment._id ? payment._id : payment && payment.id ? payment.id : null;
    if (premiumAmountHalala > 0) {
      await SubscriptionDay.updateOne(
        { _id: day._id, status: "open" },
        {
          $set: {
            plannerRevisionHash: derivedDay.plannerRevisionHash,
            "premiumExtraPayment.status": "pending",
            "premiumExtraPayment.revisionHash": derivedDay.plannerRevisionHash,
            "premiumExtraPayment.paymentId": paymentId,
            "premiumExtraPayment.providerInvoiceId": invoice.id,
            "premiumExtraPayment.createdAt": derivedDay.premiumExtraPayment.createdAt || new Date(),
            "premiumExtraPayment.amountHalala": premiumAmountHalala,
            "premiumExtraPayment.extraPremiumCount": normalizeNumber(derivedDay.premiumExtraPayment.extraPremiumCount),
            "premiumExtraPayment.currency": invoiceCurrency,
            "premiumExtraPayment.reused": false,
          },
        }
      );
    }

    const responseDay = await SubscriptionDay.findById(day._id).lean();
    const responseDerivedDay = applyCommercialStateToDay(responseDay || derivedDay);
    const publicPaymentId = paymentId ? String(paymentId) : null;
    return buildSuccessResult(201, {
      payment_id: publicPaymentId,
      paymentId: publicPaymentId,
      payment_url: invoice.url,
      invoice_id: invoice.id,
      providerInvoiceId: invoice.id,
      totalHalala,
      premiumAmountHalala,
      addonsAmountHalala,
      currency: invoiceCurrency,
      plannerRevisionHash: responseDerivedDay.plannerRevisionHash,
      paymentRequirement: responseDerivedDay.paymentRequirement,
      commercialState: responseDerivedDay.commercialState,
    });
  } catch (err) {
    logger.error("Unified day payment initiation: unexpected error", {
      error: err.message,
      stack: err.stack,
      subscriptionId,
      date,
    });
    if (err.status && err.code) return buildErrorResult(err.status, err.code, err.message);
    return buildErrorResult(500, "INTERNAL", "Unified day payment initiation failed");
  }
}

async function verifyUnifiedDayPaymentFlow({
  subscriptionId,
  date,
  paymentId,
  userId,
  getInvoiceFn,
  startSessionFn,
  applyPaymentSideEffectsFn,
}) {
  const sub = await Subscription.findById(subscriptionId).lean();
  if (!sub) return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  if (String(sub.userId) !== String(userId)) return buildErrorResult(403, "FORBIDDEN", "Forbidden");

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId,
    userId,
    type: UNIFIED_DAY_PAYMENT_TYPE,
  }).lean();
  if (!payment) return buildErrorResult(404, "NOT_FOUND", "Day payment not found");

  const metadata = getPaymentMetadata(payment);
  if (String(metadata.date || "") !== String(date)) return buildErrorResult(409, "MISMATCH", "Payment day mismatch");
  if (!payment.providerInvoiceId) return buildErrorResult(409, "CHECKOUT_IN_PROGRESS", "Day payment invoice is not initialized yet");

  if (payment.status === "paid" && payment.applied === true) {
    const latestDay = metadata.dayId && mongoose.Types.ObjectId.isValid(String(metadata.dayId))
      ? await SubscriptionDay.findById(metadata.dayId).lean()
      : await SubscriptionDay.findOne({ subscriptionId, date }).lean();
    return buildSuccessResult(200, {
      ...buildUnifiedPaymentPayload({ subscription: sub, day: latestDay, payment }),
      checkedProvider: false,
      synchronized: true,
    });
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoiceFn(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") return buildErrorResult(500, "CONFIG", err.message);
    if (err.code === "NOT_FOUND") return buildErrorResult(502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    return buildErrorResult(502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) return buildErrorResult(409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");

  const providerAmount = normalizeNumber(providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount);
  if (providerAmount !== normalizeNumber(payment.amount)) return buildErrorResult(409, "MISMATCH", "Amount mismatch");

  const providerCurrency = normalizeCurrencyValue(providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency);
  if (providerCurrency !== normalizeCurrencyValue(payment.currency)) return buildErrorResult(409, "MISMATCH", "Currency mismatch");

  const session = await startSessionFn();
  let synchronized = false;
  let sideEffectResult = null;
  try {
    session.startTransaction();

    const paymentInSession = await Payment.findOne({
      _id: paymentId,
      subscriptionId,
      userId,
      type: UNIFIED_DAY_PAYMENT_TYPE,
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Day payment not found");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
    if (providerInvoiceId && paymentInSession.providerInvoiceId && String(paymentInSession.providerInvoiceId) !== providerInvoiceId) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "MISMATCH", "Invoice ID mismatch");
    }
    if (providerPayment && providerPayment.id && !paymentInSession.providerPaymentId) {
      paymentInSession.providerPaymentId = String(providerPayment.id);
    }
    paymentInSession.status = normalizedStatus;
    if (normalizedStatus === "paid" && !paymentInSession.paidAt) paymentInSession.paidAt = new Date();
    await paymentInSession.save({ session });

    if (normalizedStatus === "paid" && !paymentInSession.applied) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );
      if (claimedPayment) {
        sideEffectResult = await applyPaymentSideEffectsFn({
          payment: claimedPayment,
          session,
          source: "client_manual_verify",
        });
        if (sideEffectResult.applied) {
          synchronized = true;
        } else {
          const nextMetadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: sideEffectResult.reason });
          await Payment.updateOne(
            { _id: claimedPayment._id },
            { $set: { applied: false, status: "paid", metadata: nextMetadata } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    logger.error("Unified day payment verification failed", {
      subscriptionId,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return buildErrorResult(500, "INTERNAL", "Unified day payment verification failed");
  }

  if (sideEffectResult && !sideEffectResult.applied && sideEffectResult.reason === "revision_mismatch") {
    return buildErrorResult(409, "DAY_PAYMENT_REVISION_MISMATCH", "Planner changed since payment creation");
  }
  if (sideEffectResult && !sideEffectResult.applied && sideEffectResult.reason === "payment_snapshot_mismatch") {
    return buildErrorResult(409, "DAY_PAYMENT_SNAPSHOT_MISMATCH", "Payment snapshot no longer matches pending selections");
  }

  const latestPayment = await Payment.findById(paymentId).lean();
  const latestMetadata = getPaymentMetadata(latestPayment);
  const latestDay = latestMetadata.dayId && mongoose.Types.ObjectId.isValid(String(latestMetadata.dayId))
    ? await SubscriptionDay.findById(latestMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId, date }).lean();

  return buildSuccessResult(200, {
    ...buildUnifiedPaymentPayload({
      subscription: sub,
      day: latestDay,
      payment: latestPayment,
      providerInvoice,
    }),
    checkedProvider: true,
    synchronized,
    sideEffectResult,
  });
}

module.exports = {
  UNIFIED_DAY_PAYMENT_TYPE,
  createUnifiedDayPaymentFlow,
  verifyUnifiedDayPaymentFlow,
};
