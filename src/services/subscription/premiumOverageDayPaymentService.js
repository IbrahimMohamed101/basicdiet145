const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");
const Setting = require("../../models/Setting");
const { logger } = require("../../utils/logger");
const { buildPaymentDescription } = require("../../utils/subscription/subscriptionWriteLocalization");
const { buildPaymentMetadataWithInitiationFields, buildPremiumOveragePaymentStatusPayload } = require("./subscriptionPaymentPayloadService");
const { getPaymentMetadata } = require("./subscriptionCheckoutHelpers");
const {
  buildErrorResult,
  buildSuccessResult,
  resolveNonCheckoutIdempotency,
} = require("./subscriptionNonCheckoutPaymentService");
const {
  buildPaymentRedirectContext,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
} = require("../paymentProviderMetadataService");

const SYSTEM_CURRENCY = "SAR";
const PREMIUM_OVERAGE_DAY_PAYMENT_TYPE = "premium_overage_day";
const FINAL_PAYMENT_STATUSES = new Set(["paid", "failed", "canceled", "expired", "refunded"]);

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function normalizeCurrencyValue(value) {
  return String(value || SYSTEM_CURRENCY).trim().toUpperCase();
}

function assertSystemCurrencyOrThrow(value, fieldName) {
  const currency = normalizeCurrencyValue(value);
  if (currency !== SYSTEM_CURRENCY) {
    const err = new Error(`${fieldName} must use ${SYSTEM_CURRENCY}`);
    err.code = "CONFIG";
    err.status = 500;
    throw err;
  }
  return currency;
}

async function createPremiumOverageDayPaymentFlow({
  subscriptionId,
  date,
  userId,
  lang,
  headers = {},
  body = {},
  runtime,
  ensureActiveFn,
  validateFutureDateOrThrowFn,
  assertTomorrowCutoffAllowedFn,
  cutoffAction,
  isEligibleForDayFn,
}) {
  const sub = await Subscription.findById(subscriptionId).populate("planId");
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  try {
    ensureActiveFn(sub, date);
    await validateFutureDateOrThrowFn(date, sub);
    await assertTomorrowCutoffAllowedFn({
      action: cutoffAction,
      date,
    });
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return buildErrorResult(status, err.code || "INVALID_DATE", err.message);
  }

  const day = await SubscriptionDay.findOne({ subscriptionId, date });
  if (!day) {
    return buildErrorResult(404, "NOT_FOUND", "Day not found");
  }
  if (!isEligibleForDayFn(sub, day)) {
    return buildErrorResult(409, "PREMIUM_OVERAGE_NOT_SUPPORTED", "Premium overage payment is not enabled for this day");
  }

  const premiumOverageCount = Number(day.premiumOverageCount || 0);
  if (premiumOverageCount <= 0) {
    return buildErrorResult(409, "NO_PENDING_OVERAGE", "This day has no unpaid premium overage");
  }
  if (day.premiumOverageStatus === "paid") {
    return buildErrorResult(409, "OVERAGE_ALREADY_PAID", "This day premium overage is already paid");
  }

  const premiumPriceSar = Number(await getSettingValue("premium_price", 20));
  const unitOveragePriceHalala =
    Number.isFinite(premiumPriceSar) && premiumPriceSar >= 0
      ? Math.round(premiumPriceSar * 100)
      : 0;
  const amount = premiumOverageCount * unitOveragePriceHalala;

  const idempotency = await resolveNonCheckoutIdempotency({
    headers,
    body,
    userId,
    operationScope: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    effectivePayload: {
      subscriptionId: String(sub._id),
      dayId: String(day._id),
      date: String(day.date),
      premiumOverageCount,
    },
    fallbackResponseShape: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    runtime,
  });
  if (!idempotency.ok) {
    return idempotency;
  }
  if (!idempotency.shouldContinue) {
    return idempotency;
  }

  const appUrl = process.env.APP_URL || "https://example.com";
  const redirectContext = buildPaymentRedirectContext({
    appUrl,
    paymentType: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    subscriptionId: String(sub._id),
    dayId: String(day._id),
    date: String(day.date),
    successUrl: body && body.successUrl,
    backUrl: body && body.backUrl,
  });

  let invoice;
  try {
    invoice = await runtime.createInvoice({
      amount,
      description: buildPaymentDescription("premiumOverageSettlement", lang, {
        count: premiumOverageCount,
      }),
      callbackUrl: `${appUrl}/api/webhooks/moyasar`,
      successUrl: redirectContext.providerSuccessUrl,
      backUrl: redirectContext.providerCancelUrl,
      metadata: {
        type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
        subscriptionId: String(sub._id),
        userId: String(userId),
        dayId: String(day._id),
        date: String(day.date),
        premiumOverageCount,
        unitOveragePriceHalala,
        currency: SYSTEM_CURRENCY,
        redirectToken: redirectContext.token,
      },
    });
  } catch (err) {
    return buildErrorResult(err.status || 502, "PAYMENT_PROVIDER_ERROR", "Failed to create payment provider invoice");
  }

  const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

  const payment = await runtime.createPayment({
    provider: "moyasar",
    type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    status: "initiated",
    amount,
    currency: invoiceCurrency,
    userId,
    subscriptionId: sub._id,
    providerInvoiceId: invoice.id,
    metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
      paymentUrl: invoice.url,
      responseShape: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
      totalHalala: amount,
      redirectContext,
    }),
    ...(idempotency.idempotencyKey
      ? {
        operationScope: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
        operationIdempotencyKey: idempotency.idempotencyKey,
        operationRequestHash: idempotency.operationRequestHash,
      }
      : {}),
  });

  return buildSuccessResult(200, {
    payment_url: invoice.url,
    invoice_id: invoice.id,
    payment_id: payment.id,
    totalHalala: amount,
  });
}

async function verifyPremiumOverageDayPaymentFlow({
  subscriptionId,
  date,
  paymentId,
  userId,
  getInvoiceFn,
  startSessionFn,
  applyPaymentSideEffectsFn,
}) {
  const sub = await Subscription.findById(subscriptionId).lean();
  if (!sub) {
    return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    return buildErrorResult(403, "FORBIDDEN", "Forbidden");
  }

  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId,
    userId,
    type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
  }).lean();
  if (!payment) {
    return buildErrorResult(404, "NOT_FOUND", "Premium overage payment not found");
  }
  const paymentMetadata = getPaymentMetadata(payment);
  if (String(paymentMetadata.date || "") !== String(date)) {
    logger.warn("Premium overage payment mismatch", {
      subscriptionId,
      paymentId,
      expectedDate: date,
      paymentDate: paymentMetadata.date,
      code: "MISMATCH",
      message: "Payment day mismatch",
    });
    return buildErrorResult(409, "MISMATCH", "Payment day mismatch");
  }
  if (!payment.providerInvoiceId) {
    return buildErrorResult(409, "CHECKOUT_IN_PROGRESS", "Premium overage invoice is not initialized yet");
  }

  let day = null;
  if (paymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(paymentMetadata.dayId))) {
    day = await SubscriptionDay.findById(paymentMetadata.dayId).lean();
  } else {
    day = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  }
  if (!day) {
    return buildErrorResult(404, "NOT_FOUND", "Day not found");
  }

  if (payment.status === "paid" && payment.applied === true) {
    return buildSuccessResult(200, {
      ...buildPremiumOveragePaymentStatusPayload({ subscription: sub, day, payment }),
      checkedProvider: false,
      synchronized: FINAL_PAYMENT_STATUSES.has(payment.status),
    });
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoiceFn(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") {
      return buildErrorResult(500, "CONFIG", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return buildErrorResult(502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    }
    logger.error("Premium overage verify failed to fetch invoice", {
      subscriptionId,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return buildErrorResult(502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    return buildErrorResult(409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }

  const session = await startSessionFn();
  let synchronized = false;
  try {
    session.startTransaction();

    const subInSession = await Subscription.findOne({ _id: subscriptionId, userId }).session(session);
    if (!subInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Subscription not found");
    }

    const paymentInSession = await Payment.findOne({
      _id: paymentId,
      subscriptionId,
      userId,
      type: PREMIUM_OVERAGE_DAY_PAYMENT_TYPE,
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "Premium overage payment not found");
    }

    const metadataInSession = getPaymentMetadata(paymentInSession);
    if (String(metadataInSession.date || "") !== String(date)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId,
        paymentId,
        expectedDate: date,
        paymentDate: metadataInSession.date,
        code: "MISMATCH",
        message: "Payment day mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "MISMATCH", "Payment day mismatch");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
    if (providerInvoiceId && paymentInSession.providerInvoiceId && String(paymentInSession.providerInvoiceId) !== providerInvoiceId) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId,
        paymentId,
        expectedInvoiceId: providerInvoiceId,
        paymentInvoiceId: paymentInSession.providerInvoiceId,
        code: "MISMATCH",
        message: "Invoice ID mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "MISMATCH", "Invoice ID mismatch");
    }
    if (providerPayment && providerPayment.id && paymentInSession.providerPaymentId && String(paymentInSession.providerPaymentId) !== String(providerPayment.id)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId,
        paymentId,
        expectedPaymentId: providerPayment.id,
        paymentPaymentId: paymentInSession.providerPaymentId,
        code: "MISMATCH",
        message: "Payment ID mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "MISMATCH", "Payment ID mismatch");
    }

    const providerAmount = Number(providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount);
    if (Number.isFinite(providerAmount) && providerAmount !== Number(paymentInSession.amount)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId,
        paymentId,
        expectedAmount: providerAmount,
        paymentAmount: paymentInSession.amount,
        code: "MISMATCH",
        message: "Amount mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "MISMATCH", "Amount mismatch");
    }

    const providerCurrency = normalizeCurrencyValue(
      providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency
    );
    if (providerCurrency !== normalizeCurrencyValue(paymentInSession.currency)) {
      logger.warn("Premium overage payment mismatch", {
        subscriptionId,
        paymentId,
        expectedCurrency: providerCurrency,
        paymentCurrency: paymentInSession.currency,
        code: "MISMATCH",
        message: "Currency mismatch",
      });
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(409, "MISMATCH", "Currency mismatch");
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
      subscriptionId,
      paymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return buildErrorResult(500, "INTERNAL", "Premium overage verification failed");
  }

  const [latestSub, latestPayment] = await Promise.all([
    Subscription.findById(subscriptionId).lean(),
    Payment.findById(paymentId).lean(),
  ]);
  const latestPaymentMetadata = getPaymentMetadata(latestPayment);
  const latestDay = latestPaymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(latestPaymentMetadata.dayId))
    ? await SubscriptionDay.findById(latestPaymentMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId, date }).lean();

  return buildSuccessResult(200, {
    ...buildPremiumOveragePaymentStatusPayload({
      subscription: latestSub,
      day: latestDay,
      payment: latestPayment,
      providerInvoice,
    }),
    checkedProvider: true,
    synchronized,
  });
}

module.exports = {
  createPremiumOverageDayPaymentFlow,
  verifyPremiumOverageDayPaymentFlow,
};
