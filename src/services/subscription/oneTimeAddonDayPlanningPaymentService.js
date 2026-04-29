const mongoose = require("mongoose");
const Addon = require("../../models/Addon");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");
const { logger } = require("../../utils/logger");
const { buildPaymentDescription, localizeWriteOneTimeAddonPaymentStatusPayload } = require("../../utils/subscription/subscriptionWriteLocalization");
const { buildPaymentMetadataWithInitiationFields, buildOneTimeAddonDayPaymentStatusPayload } = require("./subscriptionPaymentPayloadService");
const { getPaymentMetadata } = require("./subscriptionCheckoutHelpers");
const {
  buildErrorResult,
  buildSuccessResult,
  resolveNonCheckoutIdempotency,
} = require("./subscriptionNonCheckoutPaymentService");
const { loadWalletCatalogMapsSafely } = require("./subscriptionClientSerializationService");
const {
  buildPaymentRedirectContext,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
} = require("../paymentProviderMetadataService");
const {
  assertSubscriptionDayModifiable,
  localizePolicyErrorMessage,
} = require("./subscriptionDayModificationPolicyService");

const SYSTEM_CURRENCY = "SAR";
const ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE = "one_time_addon_day_planning";

function normalizeNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
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

async function buildPricedOneTimeAddonPaymentSnapshot({ day } = {}) {
  const selections = (day && Array.isArray(day.addonSelections)) ? day.addonSelections : [];
  const pending = selections.filter((s) => s.source === "pending_payment");
  
  if (pending.length === 0) {
    return {
      oneTimeAddonSelections: [],
      oneTimeAddonCount: 0,
      pricedItems: [],
      totalHalala: 0,
      currency: SYSTEM_CURRENCY,
    };
  }

  const pricedItems = pending.map((item) => {
    return {
      addonId: String(item.addonId),
      name: item.name,
      category: item.category,
      unitPriceHalala: normalizeNumber(item.priceHalala),
      currency: normalizeCurrencyValue(item.currency),
    };
  });

  return {
    oneTimeAddonSelections: pricedItems,
    oneTimeAddonCount: pricedItems.length,
    pricedItems,
    totalHalala: pricedItems.reduce((sum, item) => sum + Number(item.unitPriceHalala || 0), 0),
    currency: pricedItems[0] && pricedItems[0].currency ? pricedItems[0].currency : SYSTEM_CURRENCY,
  };
}

async function createOneTimeAddonDayPlanningPaymentFlow({
  subscriptionId,
  date,
  userId,
  lang,
  headers = {},
  body = {},
  runtime,
  ensureActiveFn,
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
  } catch (err) {
    const status = err.code === "SUB_INACTIVE" || err.code === "SUB_EXPIRED" ? 422 : 400;
    return buildErrorResult(status, err.code || "INVALID_DATE", localizePolicyErrorMessage(err, lang));
  }

  const day = await SubscriptionDay.findOne({ subscriptionId, date });
  if (!day) {
    return buildErrorResult(404, "NOT_FOUND", "Day not found");
  }
  try {
    await assertSubscriptionDayModifiable({
      subscription: sub,
      day,
      date,
    });
  } catch (err) {
    return buildErrorResult(err.status || 400, err.code || "INVALID_DATE", localizePolicyErrorMessage(err, lang), err.details);
  }
  if (!isEligibleForDayFn(sub, day)) {
    return buildErrorResult(409, "ONE_TIME_ADDON_PAYMENT_NOT_SUPPORTED", "One-time add-on payment is not enabled for this day");
  }

  let pricedSnapshot;
  try {
    pricedSnapshot = await buildPricedOneTimeAddonPaymentSnapshot({ day });
  } catch (err) {
    if (err.code === "ONE_TIME_ADDON_PRICING_NOT_FOUND") {
      return buildErrorResult(404, "NOT_FOUND", err.message);
    }
    if (err.code === "CONFIG" || err.code === "VALIDATION_ERROR") {
      return buildErrorResult(409, err.code, err.message);
    }
    throw err;
  }

  if (pricedSnapshot.oneTimeAddonCount <= 0) {
    return buildErrorResult(409, "NO_PENDING_ONE_TIME_ADDONS", "This day has no unpaid one-time add-ons");
  }

  const idempotency = await resolveNonCheckoutIdempotency({
    headers,
    body,
    userId,
    operationScope: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    effectivePayload: {
      subscriptionId: String(sub._id),
      dayId: String(day._id),
      date: String(day.date),
      oneTimeAddonSelections: pricedSnapshot.oneTimeAddonSelections,
    },
    fallbackResponseShape: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
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
    paymentType: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    subscriptionId: String(sub._id),
    dayId: String(day._id),
    date: String(day.date),
    successUrl: body && body.successUrl,
    backUrl: body && body.backUrl,
  });

  const invoice = await runtime.createInvoice({
    amount: pricedSnapshot.totalHalala,
    description: buildPaymentDescription("oneTimeAddons", lang, {
      count: pricedSnapshot.oneTimeAddonCount,
    }),
    callbackUrl: `${appUrl}/api/webhooks/moyasar`,
    successUrl: redirectContext.providerSuccessUrl,
    backUrl: redirectContext.providerCancelUrl,
    metadata: {
      type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
      subscriptionId: String(sub._id),
      userId: String(userId),
      dayId: String(day._id),
      date: String(day.date),
      oneTimeAddonSelections: pricedSnapshot.oneTimeAddonSelections,
      oneTimeAddonCount: pricedSnapshot.oneTimeAddonCount,
      pricedItems: pricedSnapshot.pricedItems,
      currency: pricedSnapshot.currency,
      redirectToken: redirectContext.token,
    },
  });
  const invoiceCurrency = assertSystemCurrencyOrThrow(invoice.currency || SYSTEM_CURRENCY, "Invoice currency");

  const payment = await runtime.createPayment({
    provider: "moyasar",
    type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    status: "initiated",
    amount: pricedSnapshot.totalHalala,
    currency: invoiceCurrency,
    userId,
    subscriptionId: sub._id,
    providerInvoiceId: invoice.id,
    metadata: buildPaymentMetadataWithInitiationFields(invoice.metadata || {}, {
      paymentUrl: invoice.url,
      responseShape: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
      totalHalala: pricedSnapshot.totalHalala,
      redirectContext,
    }),
    ...(idempotency.idempotencyKey
      ? {
        operationScope: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
        operationIdempotencyKey: idempotency.idempotencyKey,
        operationRequestHash: idempotency.operationRequestHash,
      }
      : {}),
  });

  return buildSuccessResult(200, {
    payment_url: invoice.url,
    invoice_id: invoice.id,
    payment_id: payment.id,
    totalHalala: pricedSnapshot.totalHalala,
  });
}

async function findLatestOneTimeAddonDayPlanningPaymentForDay({
  subscriptionId,
  userId,
  date,
  dayId = null,
}) {
  const payments = await Payment.find({
    subscriptionId,
    userId,
    type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
  })
    .sort({ createdAt: -1 })
    .lean();

  return payments.find((payment) => {
    const metadata = getPaymentMetadata(payment);
    if (String(metadata.date || "") === String(date)) {
      return true;
    }
    if (dayId && String(metadata.dayId || "") === String(dayId)) {
      return true;
    }
    return false;
  }) || null;
}

async function verifyOneTimeAddonDayPlanningPaymentFlow({
  subscriptionId,
  date,
  paymentId,
  userId,
  lang,
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

  const requestedDay = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  if (!requestedDay) {
    return buildErrorResult(404, "NOT_FOUND", "Day not found");
  }

  const payment = paymentId
    ? await Payment.findOne({
      _id: paymentId,
      subscriptionId,
      userId,
      type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    }).lean()
    : await findLatestOneTimeAddonDayPlanningPaymentForDay({
      subscriptionId,
      userId,
      date,
      dayId: requestedDay._id,
    });
  if (!payment) {
    return buildErrorResult(404, "NOT_FOUND", "One-time add-on payment not found");
  }
  const effectivePaymentId = String(payment._id);
  const paymentMetadata = getPaymentMetadata(payment);
  if (String(paymentMetadata.date || "") !== String(date)) {
    logger.warn("One-time add-on payment mismatch", {
      subscriptionId,
      paymentId: effectivePaymentId,
      expectedDate: date,
      paymentDate: paymentMetadata.date,
      code: "MISMATCH",
      message: "Payment day mismatch",
    });
    return buildErrorResult(409, "MISMATCH", "Payment day mismatch");
  }

  let day = requestedDay;
  if (paymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(paymentMetadata.dayId))) {
    day = await SubscriptionDay.findById(paymentMetadata.dayId).lean();
  }
  if (!day) {
    return buildErrorResult(404, "NOT_FOUND", "Day not found");
  }
  if (String(day.subscriptionId) !== String(subscriptionId) || String(day.date) !== String(date)) {
    logger.warn("One-time add-on payment mismatch", {
      subscriptionId,
      paymentId: effectivePaymentId,
      expectedDate: date,
      actualDate: day.date,
      expectedDayId: String(requestedDay._id),
      actualDayId: String(day._id),
      code: "MISMATCH",
      message: "Payment day mismatch",
    });
    return buildErrorResult(409, "MISMATCH", "Payment day mismatch");
  }

  if (!payment.providerInvoiceId) {
    return buildErrorResult(409, "CHECKOUT_IN_PROGRESS", "One-time add-on invoice is not initialized yet");
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
    return buildSuccessResult(200, localizeWriteOneTimeAddonPaymentStatusPayload(payload, {
      lang,
      addonNames: catalog.addonNames,
    }));
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
    logger.error("One-time add-on verify failed to fetch invoice", {
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
      _id: effectivePaymentId,
      subscriptionId,
      userId,
      type: ONE_TIME_ADDON_DAY_PLANNING_PAYMENT_TYPE,
    }).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return buildErrorResult(404, "NOT_FOUND", "One-time add-on payment not found");
    }

    const metadataInSession = getPaymentMetadata(paymentInSession);
    if (String(metadataInSession.date || "") !== String(date)) {
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId,
        paymentId: effectivePaymentId,
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
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId,
        paymentId: effectivePaymentId,
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
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId,
        paymentId: effectivePaymentId,
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
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId,
        paymentId: effectivePaymentId,
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
      logger.warn("One-time add-on payment mismatch", {
        subscriptionId,
        paymentId: effectivePaymentId,
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
            { $set: { applied: false, status: "paid", metadata } },
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
      subscriptionId,
      paymentId: effectivePaymentId,
      date,
      error: err.message,
      stack: err.stack,
    });
    return buildErrorResult(500, "INTERNAL", "One-time add-on verification failed");
  }

  const [latestSub, latestPayment] = await Promise.all([
    Subscription.findById(subscriptionId).lean(),
    Payment.findById(effectivePaymentId).lean(),
  ]);
  const latestPaymentMetadata = getPaymentMetadata(latestPayment);
  const latestDay = latestPaymentMetadata.dayId && mongoose.Types.ObjectId.isValid(String(latestPaymentMetadata.dayId))
    ? await SubscriptionDay.findById(latestPaymentMetadata.dayId).lean()
    : await SubscriptionDay.findOne({ subscriptionId, date }).lean();

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

  return buildSuccessResult(200, localizeWriteOneTimeAddonPaymentStatusPayload(payload, {
    lang,
    addonNames: catalog.addonNames,
  }));
}

module.exports = {
  createOneTimeAddonDayPlanningPaymentFlow,
  verifyOneTimeAddonDayPlanningPaymentFlow,
  findLatestOneTimeAddonDayPlanningPaymentForDay,
};
