"use strict";

const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const CheckoutDraft = require("../../models/CheckoutDraft");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { logger } = require("../../utils/logger");
const { applyPaymentSideEffects } = require("../paymentApplicationService");
const {
  SUBSCRIPTION_PAYMENT_TYPES,
} = require("./subscriptionPaymentApplicationStateService");

const DEFAULT_BATCH_SIZE = 20;

async function applicationIsComplete(payment, session) {
  if (!payment || !payment.subscriptionId) return false;
  const subscription = await Subscription.findOne({
    _id: payment.subscriptionId,
    userId: payment.userId,
  }).session(session).lean();
  if (!subscription) return false;
  const metadata = payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};
  const directDraftId = metadata.draftId || payment.checkoutDraftId;
  const draft = directDraftId
    ? await CheckoutDraft.findById(directDraftId).session(session).lean()
    : await CheckoutDraft.findOne({
      $or: [
        { paymentId: payment._id },
        ...(payment.providerInvoiceId
          ? [{ providerInvoiceId: String(payment.providerInvoiceId) }]
          : []),
      ],
    }).session(session).lean();
  return Boolean(
    draft
      && String(draft.status || "") === "completed"
      && String(draft.subscriptionId || "") === String(subscription._id)
  );
}

async function recoverPaidSubscriptionPayment(paymentId) {
  const session = await startSafeSession();
  try {
    if (session.supportsTransactions !== false) session.startTransaction();
    const payment = await Payment.findById(paymentId).session(session);
    if (
      !payment
      || String(payment.status || "") !== "paid"
      || !SUBSCRIPTION_PAYMENT_TYPES.has(String(payment.type || ""))
    ) {
      if (session.inTransaction()) await session.commitTransaction();
      return { recovered: false, reason: "not_recoverable" };
    }

    if (await applicationIsComplete(payment, session)) {
      if (!payment.applied) {
        payment.applied = true;
        await payment.save({ session });
      }
      if (session.inTransaction()) await session.commitTransaction();
      return { recovered: true, idempotent: true };
    }

    payment.applied = false;
    await payment.save({ session });
    const claim = await Payment.findOneAndUpdate(
      { _id: payment._id, status: "paid", applied: false },
      { $set: { applied: true } },
      { new: true, session }
    );
    if (!claim) {
      if (session.inTransaction()) await session.commitTransaction();
      return { recovered: false, reason: "claim_lost" };
    }

    const result = await applyPaymentSideEffects({
      payment: claim,
      session,
      source: "subscription_payment_recovery_job",
    });
    if (!result || !result.applied) {
      const metadata = Object.assign({}, claim.metadata || {}, {
        unappliedReason: result && result.reason || "unknown",
        subscriptionRecoveryNextAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      await Payment.updateOne(
        { _id: claim._id },
        { $set: { applied: false, metadata } },
        { session }
      );
      if (session.inTransaction()) await session.commitTransaction();
      return { recovered: false, reason: result && result.reason || "unknown" };
    }
    if (session.inTransaction()) await session.commitTransaction();
    return { recovered: true, subscriptionId: result.subscriptionId || null };
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    const current = await Payment.findById(paymentId).lean().catch(() => null);
    const metadata = Object.assign({}, current && current.metadata || {}, {
      unappliedReason: String(err.code || err.message || "recovery_failed"),
      subscriptionRecoveryNextAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await Payment.updateOne(
      { _id: paymentId, status: "paid" },
      {
        $set: {
          applied: false,
          metadata,
        },
      }
    ).catch(() => null);
    throw err;
  } finally {
    await session.endSession();
  }
}

async function processPaidSubscriptionPaymentRecoveries({ limit = DEFAULT_BATCH_SIZE } = {}) {
  const now = new Date();
  const candidates = await Payment.find({
    status: "paid",
    type: { $in: Array.from(SUBSCRIPTION_PAYMENT_TYPES) },
    $and: [
      {
        $or: [
          { applied: false },
          { subscriptionId: null },
          { subscriptionId: { $exists: false } },
        ],
      },
      {
        $or: [
          { "metadata.subscriptionRecoveryNextAt": null },
          { "metadata.subscriptionRecoveryNextAt": { $exists: false } },
          { "metadata.subscriptionRecoveryNextAt": { $lte: now } },
        ],
      },
    ],
  }).sort({ paidAt: 1, createdAt: 1 }).limit(Math.max(1, Math.min(100, Number(limit) || DEFAULT_BATCH_SIZE))).select("_id").lean();

  const stats = { scanned: candidates.length, recovered: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      const result = await recoverPaidSubscriptionPayment(candidate._id);
      if (result.recovered) stats.recovered += 1;
      else stats.failed += 1;
    } catch (err) {
      stats.failed += 1;
      logger.error("Paid subscription payment recovery failed", {
        paymentId: String(candidate._id),
        code: err.code || null,
        error: err.message,
      });
    }
  }
  return stats;
}

module.exports = {
  applicationIsComplete,
  processPaidSubscriptionPaymentRecoveries,
  recoverPaidSubscriptionPayment,
};
