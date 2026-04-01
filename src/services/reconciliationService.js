const CheckoutDraft = require("../models/CheckoutDraft");
const Payment = require("../models/Payment");
const { getInvoice } = require("./moyasarService");
const { logger } = require("../utils/logger");

const RECONCILE_MODES = {
  READ_ONLY: "READ_ONLY",
  PERSIST: "PERSIST",
};

function resolveCheckoutDraftPaymentType(draft) {
  return draft && draft.renewedFromSubscriptionId
    ? "subscription_renewal"
    : "subscription_activation";
}

function resolveCheckoutDraftResponseShape(draft) {
  return resolveCheckoutDraftPaymentType(draft) === "subscription_renewal"
    ? "subscription_renewal"
    : "subscription_checkout";
}

function buildRecoveredCheckoutPaymentMetadata(draft) {
  const paymentType = resolveCheckoutDraftPaymentType(draft);
  const metadata = {
    type: paymentType,
    draftId: String(draft && draft._id ? draft._id : ""),
    userId: String(draft && draft.userId ? draft.userId : ""),
    grams: Number(draft && draft.grams ? draft.grams : 0),
    mealsPerDay: Number(draft && draft.mealsPerDay ? draft.mealsPerDay : 0),
    paymentUrl: String(draft && draft.paymentUrl ? draft.paymentUrl : "").trim(),
    initiationResponseShape: resolveCheckoutDraftResponseShape(draft),
    totalHalala: Number(draft && draft.breakdown && draft.breakdown.totalHalala ? draft.breakdown.totalHalala : 0),
  };

  if (draft && draft.renewedFromSubscriptionId) {
    metadata.renewedFromSubscriptionId = String(draft.renewedFromSubscriptionId);
  }

  return metadata;
}

async function findDraftPaymentByDraftIdOrInvoice({ draft, session }) {
  if (!draft) return null;

  const paymentType = resolveCheckoutDraftPaymentType(draft);
  const draftId = String(draft._id);
  const providerInvoiceId = String(draft.providerInvoiceId || "").trim();

  let payment = null;
  if (providerInvoiceId) {
    payment = await Payment.findOne({
      provider: "moyasar",
      providerInvoiceId,
    }).sort({ createdAt: -1 }).session(session);
  }

  if (!payment) {
    payment = await Payment.findOne({
      userId: draft.userId,
      type: paymentType,
      "metadata.draftId": draftId,
    }).sort({ createdAt: -1 }).session(session);
  }

  return payment;
}

async function ensureDraftPaymentRecovered(draft, { session = null } = {}) {
  if (!draft) return null;
  if (draft.status !== "pending_payment") return null;

  const providerInvoiceId = String(draft.providerInvoiceId || "").trim();
  const paymentUrl = String(draft.paymentUrl || "").trim();
  if (!providerInvoiceId || !paymentUrl) return null;

  const paymentType = resolveCheckoutDraftPaymentType(draft);
  let payment = draft.paymentId
    ? await Payment.findById(draft.paymentId).session(session)
    : null;

  if (!payment) {
    payment = await findDraftPaymentByDraftIdOrInvoice({ draft, session });
  }

  const paymentMetadata = buildRecoveredCheckoutPaymentMetadata(draft);
  const paymentCurrency = String(
    draft && draft.breakdown && draft.breakdown.currency
      ? draft.breakdown.currency
      : "SAR"
  ).trim().toUpperCase() || "SAR";

  if (!payment) {
    try {
      const createdPayments = await Payment.create([{
        provider: "moyasar",
        type: paymentType,
        status: "initiated",
        amount: Number(draft && draft.breakdown && draft.breakdown.totalHalala ? draft.breakdown.totalHalala : 0),
        currency: paymentCurrency,
        userId: draft.userId,
        providerInvoiceId,
        metadata: paymentMetadata,
      }], session ? { session } : undefined);
      payment = Array.isArray(createdPayments) ? createdPayments[0] : createdPayments;
      logger.info("Recovered missing checkout payment from persisted draft invoice", {
        draftId: String(draft._id),
        paymentId: String(payment._id),
        providerInvoiceId,
        paymentType,
      });
    } catch (err) {
      if (err && err.code === 11000) {
        payment = await findDraftPaymentByDraftIdOrInvoice({ draft, session });
      }
      if (!payment) {
        throw err;
      }
    }
  } else {
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
    if (!payment.currency && paymentCurrency) {
      payment.currency = paymentCurrency;
      paymentChanged = true;
    }
    if (!payment.type && paymentType) {
      payment.type = paymentType;
      paymentChanged = true;
    }
    if (paymentChanged) {
      await payment.save({ session });
    }
  }

  if (payment && (!draft.paymentId || String(draft.paymentId) !== String(payment._id))) {
    draft.paymentId = payment._id;
    if (!draft.providerInvoiceId && providerInvoiceId) {
      draft.providerInvoiceId = providerInvoiceId;
    }
    if (!draft.paymentUrl && paymentUrl) {
      draft.paymentUrl = paymentUrl;
    }
    await draft.save({ session });
    logger.info("Linked recovered checkout payment back to draft", {
      draftId: String(draft._id),
      paymentId: String(payment._id),
    });
  }

  return payment;
}

/**
 * Reconciles a CheckoutDraft with its corresponding Payment and Moyasar state.
 * Supports READ_ONLY (for GET status) and PERSIST (for verify/checkout) modes.
 */
async function reconcileCheckoutDraft(draftId, { mode = RECONCILE_MODES.READ_ONLY, session = null, getInvoiceFn = getInvoice } = {}) {
  const draft = await CheckoutDraft.findById(draftId).session(session);
  if (!draft) return { draft: null, payment: null, invoice: null };

  let payment = null;
  if (draft.paymentId) {
    payment = await Payment.findById(draft.paymentId).session(session);
  }

  const paymentMetadata = payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};

  // Orphan recovery: Search by metadata.draftId if not linked
  if (!payment) {
    payment = await findDraftPaymentByDraftIdOrInvoice({ draft, session });

    if (payment && mode === RECONCILE_MODES.PERSIST) {
      draft.paymentId = payment._id;
      if (payment.providerInvoiceId && !draft.providerInvoiceId) {
        draft.providerInvoiceId = payment.providerInvoiceId;
      }
      await draft.save({ session });
      logger.info("Healed orphaned payment link for checkout draft", { draftId, paymentId: payment._id });
    }
  }

  if (!payment && mode === RECONCILE_MODES.PERSIST) {
    payment = await ensureDraftPaymentRecovered(draft, { session });
  }

  const resolvedPaymentMetadata = payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : paymentMetadata;

  if (!draft.paymentUrl && typeof resolvedPaymentMetadata.paymentUrl === "string" && resolvedPaymentMetadata.paymentUrl.trim()) {
    draft.paymentUrl = resolvedPaymentMetadata.paymentUrl.trim();
    if (mode === RECONCILE_MODES.PERSIST) {
      await draft.save({ session });
      logger.info("Recovered checkout payment URL from payment metadata", { draftId, paymentId: payment ? payment._id : null });
    }
  }

  let invoice = null;
  const providerInvoiceId = draft.providerInvoiceId || (payment && payment.providerInvoiceId);
  if (providerInvoiceId) {
    try {
      invoice = await getInvoiceFn(providerInvoiceId);
      
      if (invoice && invoice.url && !draft.paymentUrl) {
        draft.paymentUrl = invoice.url;
        if (mode === RECONCILE_MODES.PERSIST) {
          await draft.save({ session });
        }
      }

      // Optional: Sync payment status if we have the record and it's not terminal
      if (payment && invoice && !["paid", "failed", "canceled", "expired"].includes(payment.status)) {
        const providerStatus = (invoice.status || "").toLowerCase();
        if (providerStatus === "paid" || providerStatus === "captured") {
          payment.status = "paid";
          payment.paidAt = payment.paidAt || new Date();
          
          const providerPayment = Array.isArray(invoice.payments) ? invoice.payments.find(p => ["paid", "captured", "authorized"].includes(p.status)) : null;
          if (providerPayment && providerPayment.id && !payment.providerPaymentId) {
            payment.providerPaymentId = String(providerPayment.id);
          }

          if (mode === RECONCILE_MODES.PERSIST) {
            await payment.save({ session });
          }
        }
      }
    } catch (err) {
      logger.warn("Reconciliation failed to fetch provider invoice", { draftId, providerInvoiceId, error: err.message });
    }
  }

  return { draft, payment, invoice };
}

module.exports = {
  ensureDraftPaymentRecovered,
  reconcileCheckoutDraft,
  RECONCILE_MODES,
};
