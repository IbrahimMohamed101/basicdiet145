const mongoose = require("mongoose");
const CheckoutDraft = require("../models/CheckoutDraft");
const Payment = require("../models/Payment");
const { getInvoice } = require("./moyasarService");
const { logger } = require("../utils/logger");

const RECONCILE_MODES = {
  READ_ONLY: "READ_ONLY",
  PERSIST: "PERSIST",
};

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

  // Orphan recovery: Search by metadata.draftId if not linked
  if (!payment) {
    payment = await Payment.findOne({
      userId: draft.userId,
      type: "subscription_activation",
      "metadata.draftId": String(draftId),
    }).sort({ createdAt: -1 }).session(session);

    if (payment && mode === RECONCILE_MODES.PERSIST) {
      draft.paymentId = payment._id;
      if (payment.providerInvoiceId && !draft.providerInvoiceId) {
        draft.providerInvoiceId = payment.providerInvoiceId;
      }
      await draft.save({ session });
      logger.info("Healed orphaned payment link for checkout draft", { draftId, paymentId: payment._id });
    }
  }

  let invoice = null;
  const providerInvoiceId = draft.providerInvoiceId || (payment && payment.providerInvoiceId);
  if (providerInvoiceId) {
    try {
      invoice = await getInvoiceFn(providerInvoiceId);
      
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
  reconcileCheckoutDraft,
  RECONCILE_MODES,
};
