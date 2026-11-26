"use strict";

const Payment = require("../../models/Payment");
const CheckoutDraft = require("../../models/CheckoutDraft");
const moyasar = require("../moyasarService");

const isSubscriptionCheckoutPayment = (payment) =>
  ["subscription_activation", "subscription_renewal"].includes(payment?.type);
const same = (a, b) => a != null && b != null && String(a) === String(b);
const paid = (status) => ["paid", "captured"].includes(String(status).toLowerCase());

function mismatch(message) {
  return Object.assign(new Error(message), { code: "PAYMENT_PROVIDER_MISMATCH", status: 409 });
}

function assertPrice(evidence, payment) {
  if (!Number.isSafeInteger(evidence?.amount) || evidence.amount <= 0 ||
      evidence.amount !== payment.amount || evidence.currency !== payment.currency) {
    throw mismatch("Provider amount or currency does not match checkout payment");
  }
}

/** Fetch provider authority, then commit the financial fact independently of
 * activation. No callback fields are used as evidence. apply=false is read-only.
 */
async function verifyAndRecordPaidSubscriptionPayment({
  paymentId, providerPaymentId = null, providerInvoiceId = null, apply = true,
} = {}, runtime = {}) {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment || payment.provider !== "moyasar" || !isSubscriptionCheckoutPayment(payment)) {
    throw mismatch("Not a Moyasar subscription checkout payment");
  }
  if (!payment.providerInvoiceId || (providerInvoiceId && !same(providerInvoiceId, payment.providerInvoiceId))) {
    throw mismatch("Invoice reference does not match payment");
  }
  const draftId = payment.metadata?.draftId || payment.checkoutDraftId;
  const draft = draftId ? await CheckoutDraft.findById(draftId).lean() : null;
  if (!draft || !same(draft.userId, payment.userId) || !same(draft.paymentId, payment._id) ||
      !same(draft.providerInvoiceId, payment.providerInvoiceId) ||
      (payment.checkoutDraftId && !same(payment.checkoutDraftId, draft._id))) {
    throw mismatch("Payment and saved draft ownership or invoice do not match");
  }
  if (draft.breakdown?.totalHalala !== payment.amount || draft.breakdown?.currency !== payment.currency) {
    throw mismatch("Saved draft price does not match payment");
  }

  const invoice = await (runtime.getInvoice || moyasar.getInvoiceDetails)(payment.providerInvoiceId);
  if (!same(invoice?.id, payment.providerInvoiceId) ||
      !same(invoice.metadata?.userId, payment.userId) || !same(invoice.metadata?.draftId, draft._id)) {
    throw mismatch("Provider invoice ownership or draft does not match");
  }
  assertPrice(invoice, payment);
  // A non-paid invoice is never promoted on a callback's claim of success.
  if (!paid(invoice.status)) return { verified: false, invoice, payment, draft };

  const paidAttempts = (Array.isArray(invoice.payments) ? invoice.payments : []).filter(p => paid(p.status));
  const reference = providerPaymentId || paidAttempts.at(-1)?.id;
  if (!reference) throw mismatch("Paid provider payment reference is required");
  // Fetch the exact attempt as well: never reuse the failed attempt stored by
  // the first callback merely because it belongs to the same invoice.
  const attempt = await (runtime.getPayment || moyasar.getPayment)(reference);
  if (!same(attempt?.id, reference) || !same(attempt.invoice_id, invoice.id) || !paid(attempt.status) ||
      Number(attempt.refunded || 0) !== 0 ||
      (attempt.metadata?.userId && !same(attempt.metadata.userId, payment.userId)) ||
      (attempt.metadata?.draftId && !same(attempt.metadata.draftId, draft._id))) {
    throw mismatch("Provider payment reference, status or ownership does not match");
  }
  assertPrice(attempt, payment);
  if (payment.status === "refunded" || (payment.status === "paid" && payment.providerPaymentId &&
      !same(payment.providerPaymentId, reference))) {
    throw mismatch("Payment already settled with a different reference or refunded");
  }
  if (!apply) return { verified: true, payment, draft, invoice, providerPaymentId: reference };

  const verifiedAt = payment.metadata?.providerVerification?.verifiedAt || new Date();

  // CAS protects against a concurrent refund, re-link, or another paid attempt.
  // In particular, never reset applied or overwrite metadata from a worker.
  const recorded = await Payment.findOneAndUpdate({
    _id: payment._id, provider: "moyasar", userId: payment.userId,
    providerInvoiceId: payment.providerInvoiceId, amount: payment.amount, currency: payment.currency,
    status: payment.status, providerPaymentId: payment.providerPaymentId ?? null,
  }, { $set: {
    status: "paid", providerPaymentId: reference, checkoutDraftId: draft._id,
    paidAt: payment.paidAt || new Date(attempt.updated_at || attempt.created_at || Date.now()),
    "metadata.providerVerification": { source: "moyasar_api", invoiceId: invoice.id,
      paymentId: reference, verifiedAt },
  } }, { new: true });
  if (!recorded) throw Object.assign(new Error("Payment changed; retry provider verification"), {
    code: "PAYMENT_VERIFICATION_CONFLICT", status: 409,
  });
  return { verified: true, payment: recorded.toObject(), draft, invoice, providerPaymentId: reference };
}

async function settlePaidSubscriptionPayment(options, runtime = {}) {
  const result = await verifyAndRecordPaidSubscriptionPayment(options, runtime);
  if (!result.verified || options.apply === false) return result;
  const recover = runtime.recover || require("./subscriptionPaymentRecoveryService").recoverPaidSubscriptionPayment;
  const recovery = await recover(result.payment._id);
  return { ...result, recovery, payment: await Payment.findById(result.payment._id).lean() };
}

module.exports = { isSubscriptionCheckoutPayment, verifyAndRecordPaidSubscriptionPayment, settlePaidSubscriptionPayment };
