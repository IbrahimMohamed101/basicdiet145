const crypto = require("crypto");
const mongoose = require("mongoose");

const Payment = require("../models/Payment");
const CheckoutDraft = require("../models/CheckoutDraft");
const { getInvoice } = require("./moyasarService");
const { applyPaymentSideEffects } = require("./paymentApplicationService");
const { runMongoTransactionWithRetry } = require("./mongoTransactionRetryService");
const { logger } = require("../utils/logger");
const { validateRedirectUrl } = require("../utils/security");

const TERMINAL_PAYMENT_STATUSES = new Set(["paid", "failed", "canceled", "expired", "refunded"]);

function generateRedirectToken() {
  return crypto.randomBytes(18).toString("hex");
}

function buildPaymentRedirectContext({
  appUrl,
  paymentType,
  draftId,
  subscriptionId,
  dayId,
  date,
  successUrl,
  backUrl,
}) {
  const safeAppUrl = String(appUrl || "https://example.com").trim() || "https://example.com";
  const token = generateRedirectToken();
  const normalizedSuccessUrl = validateRedirectUrl(successUrl, `${safeAppUrl}/payments/success`);
  const normalizedBackUrl = validateRedirectUrl(backUrl, `${safeAppUrl}/payments/cancel`);

  const successParams = new URLSearchParams({
    payment_type: String(paymentType || "").trim(),
    token,
  });
  const cancelParams = new URLSearchParams({
    payment_type: String(paymentType || "").trim(),
    token,
  });

  if (draftId) {
    successParams.set("draft_id", String(draftId));
    cancelParams.set("draft_id", String(draftId));
  }
  if (subscriptionId) {
    successParams.set("subscription_id", String(subscriptionId));
    cancelParams.set("subscription_id", String(subscriptionId));
  }
  if (dayId) {
    successParams.set("day_id", String(dayId));
    cancelParams.set("day_id", String(dayId));
  }
  if (date) {
    successParams.set("date", String(date));
    cancelParams.set("date", String(date));
  }

  return {
    token,
    paymentType: String(paymentType || "").trim(),
    draftId: draftId ? String(draftId) : "",
    subscriptionId: subscriptionId ? String(subscriptionId) : "",
    dayId: dayId ? String(dayId) : "",
    date: date ? String(date) : "",
    successRedirectUrl: normalizedSuccessUrl,
    cancelRedirectUrl: normalizedBackUrl,
    providerSuccessUrl: `${safeAppUrl}/payments/success?${successParams.toString()}`,
    providerCancelUrl: `${safeAppUrl}/payments/cancel?${cancelParams.toString()}`,
  };
}

function attachRedirectContext(metadata, redirectContext) {
  if (!redirectContext || typeof redirectContext !== "object") {
    return Object.assign({}, metadata || {});
  }

  return Object.assign({}, metadata || {}, {
    redirectContext: {
      token: String(redirectContext.token || "").trim(),
      paymentType: String(redirectContext.paymentType || "").trim(),
      draftId: String(redirectContext.draftId || "").trim(),
      subscriptionId: String(redirectContext.subscriptionId || "").trim(),
      dayId: String(redirectContext.dayId || "").trim(),
      date: String(redirectContext.date || "").trim(),
      successRedirectUrl: String(redirectContext.successRedirectUrl || "").trim(),
      cancelRedirectUrl: String(redirectContext.cancelRedirectUrl || "").trim(),
    },
  });
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

function buildRedirectLookupFilter(query = {}) {
  const paymentType = String(query.payment_type || query.type || "").trim();
  const token = String(query.token || "").trim();
  const draftId = String(query.draft_id || "").trim();
  const subscriptionId = String(query.subscription_id || "").trim();
  const dayId = String(query.day_id || "").trim();
  const date = String(query.date || "").trim();
  const paymentId = String(query.payment_id || "").trim();

  if (!token || !paymentType) {
    const err = new Error("Missing payment redirect token");
    err.code = "INVALID_REDIRECT_CONTEXT";
    err.status = 400;
    throw err;
  }

  const filter = {
    type: paymentType,
    "metadata.redirectContext.token": token,
  };

  if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
    filter._id = paymentId;
  }
  if (draftId) {
    filter["metadata.draftId"] = draftId;
  }
  if (subscriptionId) {
    filter["metadata.subscriptionId"] = subscriptionId;
  }
  if (dayId) {
    filter["metadata.dayId"] = dayId;
  }
  if (date) {
    filter["metadata.date"] = date;
  }

  return filter;
}

function buildPaymentResultPayload(payment, providerInvoice, effectResult) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const redirectContext = metadata.redirectContext && typeof metadata.redirectContext === "object"
    ? metadata.redirectContext
    : {};

  return {
    paymentId: payment ? String(payment._id) : null,
    paymentType: payment ? payment.type : null,
    paymentStatus: payment ? payment.status : null,
    applied: Boolean(payment && payment.applied),
    providerInvoiceId: payment && payment.providerInvoiceId ? String(payment.providerInvoiceId) : null,
    providerPaymentId: payment && payment.providerPaymentId ? String(payment.providerPaymentId) : null,
    amount: payment ? Number(payment.amount || 0) : 0,
    currency: payment ? payment.currency || "SAR" : "SAR",
    isFinal: Boolean(payment && TERMINAL_PAYMENT_STATUSES.has(String(payment.status || "").trim().toLowerCase())),
    successRedirectUrl: redirectContext.successRedirectUrl || "",
    cancelRedirectUrl: redirectContext.cancelRedirectUrl || "",
    providerInvoiceStatus: providerInvoice
      ? normalizeProviderPaymentStatus(
        (pickProviderInvoicePayment(providerInvoice, payment) || {}).status || providerInvoice.status
      ) || String(providerInvoice.status || "").trim().toLowerCase() || null
      : null,
    businessApplied: Boolean(effectResult && effectResult.applied),
    businessReason: effectResult && effectResult.reason ? String(effectResult.reason) : null,
  };
}

async function markNonPaidSubscriptionDraft(payment, session) {
  if (!payment || !["subscription_activation", "subscription_renewal"].includes(String(payment.type || ""))) {
    return;
  }

  const metadata = payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const draftId = String(metadata.draftId || "").trim();
  if (!draftId || !mongoose.Types.ObjectId.isValid(draftId)) return;

  const draft = await CheckoutDraft.findById(draftId).session(session);
  if (!draft) return;
  if (draft.subscriptionId) return;
  if (!["pending_payment", "failed", "canceled", "expired"].includes(String(draft.status || ""))) return;

  draft.status = payment.status === "canceled" ? "canceled" : payment.status === "expired" ? "expired" : "failed";
  draft.failedAt = draft.failedAt || new Date();
  draft.failureReason = `payment_${draft.status}`;
  await draft.save({ session });
}

async function synchronizePaymentForRedirect(query, { source = "redirect_verify" } = {}) {
  const filter = buildRedirectLookupFilter(query);
  const existingPayment = await Payment.findOne(filter).sort({ createdAt: -1 }).lean();
  if (!existingPayment) {
    const err = new Error("Payment not found for redirect context");
    err.code = "PAYMENT_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  if (existingPayment.status === "paid" && existingPayment.applied === true) {
    return buildPaymentResultPayload(existingPayment, null, { applied: true });
  }

  let providerInvoice = null;
  if (!existingPayment.providerInvoiceId) {
    const err = new Error("Payment invoice is not initialized");
    err.code = "CHECKOUT_IN_PROGRESS";
    err.status = 409;
    throw err;
  }

  try {
    providerInvoice = await getInvoice(existingPayment.providerInvoiceId);
  } catch (err) {
    logger.error("Payment redirect verify: failed to fetch provider invoice", {
      paymentId: String(existingPayment._id),
      providerInvoiceId: existingPayment.providerInvoiceId || null,
      error: err.message,
      source,
    });
    if (existingPayment.status === "paid" && existingPayment.applied) {
      return buildPaymentResultPayload(existingPayment, null, { applied: true });
    }
    err.code = err.code || "PAYMENT_PROVIDER_ERROR";
    err.status = err.status || 502;
    throw err;
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, existingPayment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    const err = new Error("Unsupported provider payment status");
    err.code = "PAYMENT_PROVIDER_ERROR";
    err.status = 409;
    throw err;
  }

  const providerPaymentId = providerPayment && providerPayment.id ? String(providerPayment.id) : null;

  return runMongoTransactionWithRetry(async (session, { attempt }) => {
    const payment = await Payment.findById(existingPayment._id).session(session);
    if (!payment) {
      const err = new Error("Payment not found");
      err.code = "PAYMENT_NOT_FOUND";
      err.status = 404;
      throw err;
    }

    if (payment.status === "paid" && payment.applied === true) {
      logger.info("Payment redirect verify: already processed", {
        paymentId: String(payment._id),
        providerInvoiceId: payment.providerInvoiceId || null,
        source,
        attempt: attempt + 1,
      });
      return buildPaymentResultPayload(payment.toObject(), providerInvoice, { applied: true });
    }

    if (normalizedStatus !== "paid") {
      const nonPaidUpdate = {
        status: normalizedStatus,
      };
      if (providerPaymentId && !payment.providerPaymentId) {
        nonPaidUpdate.providerPaymentId = providerPaymentId;
      }
      await Payment.updateOne({ _id: payment._id }, { $set: nonPaidUpdate }, { session });

      if (["failed", "canceled", "expired"].includes(normalizedStatus)) {
        const latestPayment = await Payment.findById(payment._id).session(session);
        await markNonPaidSubscriptionDraft(latestPayment, session);
        return buildPaymentResultPayload(latestPayment.toObject(), providerInvoice, { applied: false, reason: "payment_not_paid" });
      }

      const latestPayment = await Payment.findById(payment._id).session(session);
      return buildPaymentResultPayload(latestPayment.toObject(), providerInvoice, { applied: false, reason: "payment_not_paid" });
    }

    const claimUpdate = {
      status: "paid",
      paidAt: payment.paidAt || new Date(),
    };
    if (providerPaymentId && !payment.providerPaymentId) {
      claimUpdate.providerPaymentId = providerPaymentId;
    }

    const claimedPayment = await Payment.findOneAndUpdate(
      { _id: payment._id, applied: false },
      { $set: Object.assign({ applied: true }, claimUpdate) },
      { new: true, session }
    );

    if (!claimedPayment) {
      const latestPaidPayment = await Payment.findById(payment._id).session(session);
      logger.info("Payment redirect verify: claim skipped because payment was already processed", {
        paymentId: String(payment._id),
        providerInvoiceId: payment.providerInvoiceId || null,
        source,
        attempt: attempt + 1,
      });
      return buildPaymentResultPayload(
        latestPaidPayment ? latestPaidPayment.toObject() : payment.toObject(),
        providerInvoice,
        { applied: Boolean(latestPaidPayment && latestPaidPayment.applied) }
      );
    }

    logger.info("Payment redirect verify: payment claimed for processing", {
      paymentId: String(claimedPayment._id),
      providerInvoiceId: claimedPayment.providerInvoiceId || null,
      providerPaymentId,
      source,
      attempt: attempt + 1,
    });

    const effectResult = await applyPaymentSideEffects({
      payment: claimedPayment,
      session,
      source,
    });

    if (!effectResult || !effectResult.applied) {
      const mergedMetadata = Object.assign({}, claimedPayment.metadata || {}, {
        unappliedReason: effectResult && effectResult.reason ? effectResult.reason : "unknown",
      });
      await Payment.updateOne(
        { _id: claimedPayment._id },
        { $set: { applied: false, metadata: mergedMetadata } },
        { session }
      );
      claimedPayment.applied = false;
      claimedPayment.metadata = mergedMetadata;
    }

    return buildPaymentResultPayload(
      claimedPayment.toObject ? claimedPayment.toObject() : claimedPayment,
      providerInvoice,
      effectResult
    );
  }, {
    label: "payment_redirect_verify",
    context: {
      paymentId: String(existingPayment._id),
      providerInvoiceId: existingPayment.providerInvoiceId || null,
      source,
    },
  });
}

async function resolvePaymentForRedirect(query) {
  const filter = buildRedirectLookupFilter(query);
  return Payment.findOne(filter).sort({ createdAt: -1 }).lean();
}

module.exports = {
  buildPaymentRedirectContext,
  attachRedirectContext,
  synchronizePaymentForRedirect,
  resolvePaymentForRedirect,
};
