const CheckoutDraft = require("../../models/CheckoutDraft");
const Payment = require("../../models/Payment");
const { logger } = require("../../utils/logger");

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

function getPaymentMetadata(payment) {
  return payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
}

function buildCheckoutReusePayload(draft, payment) {
  const paymentMetadata = getPaymentMetadata(payment);
  return {
    subscriptionId: draft.subscriptionId ? String(draft.subscriptionId) : null,
    draftId: String(draft._id),
    paymentId: payment && payment.id ? payment.id : (payment && payment._id ? String(payment._id) : null),
    payment_url: paymentMetadata.paymentUrl || "",
    invoice_id: payment && payment.providerInvoiceId ? payment.providerInvoiceId : null,
    totals: draft.breakdown || {},
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

module.exports = {
  buildCheckoutInitFailureReason,
  isCheckoutDraftDuplicateKeyError,
  persistCheckoutDraftUpdate,
  persistCheckoutInitializationFailure,
  releaseCheckoutDraftIdempotencyKey,
  resolveSubscriptionCheckoutResponseShape,
  buildSubscriptionCheckoutPaymentMetadata,
  findSubscriptionCheckoutPayment,
  ensureSubscriptionCheckoutPayment,
  getPaymentMetadata,
  buildCheckoutReusePayload,
  isPendingCheckoutReusable,
};