"use strict";

const { Types } = require("mongoose");
const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const CheckoutDraft = require("../../models/CheckoutDraft");
const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { startSafeSession } = require("../../utils/mongoTransactionSupport");
const { logger } = require("../../utils/logger");
const { applyPaymentSideEffects } = require("../paymentApplicationService");
const {
  SUBSCRIPTION_PAYMENT_TYPES,
} = require("./subscriptionPaymentApplicationStateService");

const DEFAULT_BATCH_SIZE = 20;
const DRAFT_CONFLICT = "STACKING_DRAFT_COMPLETION_CONFLICT";
const REVIEW_STATUS = "needs_review";
const AUDIT_REASON = "paid_after_payment_failed";
const APPLIED_SUBSCRIPTION_STATUSES = ["active", "frozen", "expired", "completed"];

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function compatibleId(existing, expected) {
  return existing == null || existing === "" || sameId(existing, expected);
}

async function findDraft(payment, session) {
  const directId = payment.metadata?.draftId || payment.checkoutDraftId;
  if (directId && Types.ObjectId.isValid(String(directId))) {
    return CheckoutDraft.findById(directId).session(session).lean();
  }
  return CheckoutDraft.findOne({
    $or: [
      { paymentId: payment._id },
      ...(payment.providerInvoiceId
        ? [{ providerInvoiceId: String(payment.providerInvoiceId) }]
        : []),
    ],
  }).session(session).lean();
}

async function applicationIsComplete(payment, session, draft) {
  if (!payment?.subscriptionId) return false;
  const checkout = draft === undefined ? await findDraft(payment, session) : draft;
  if (checkout?.status !== "completed" || !sameId(checkout.subscriptionId, payment.subscriptionId)) {
    return false;
  }
  return Boolean(await Subscription.exists({
    _id: payment.subscriptionId,
    userId: payment.userId,
  }).session(session));
}

function matchesPrice(amount, currency, payment) {
  return Number.isSafeInteger(payment.amount) && payment.amount > 0 &&
    amount === payment.amount && typeof payment.currency === "string" &&
    payment.currency.length > 0 && currency === payment.currency;
}

function matchesPackage(entitlement, draft, mealsPerDay, grams) {
  return sameId(entitlement.planId, draft.planId) &&
    Number.isSafeInteger(draft.daysCount) && draft.daysCount > 0 &&
    Number.isSafeInteger(draft.mealsPerDay) && draft.mealsPerDay > 0 &&
    Number.isSafeInteger(draft.grams) && draft.grams > 0 &&
    mealsPerDay === draft.mealsPerDay && grams === draft.grams &&
    entitlement.totalMeals === draft.daysCount * draft.mealsPerDay;
}

async function findAppliedEntitlement(payment, draft, session) {
  const knownConflict = payment.metadata?.unappliedReason === DRAFT_CONFLICT;
  const failedDraft = draft?.status === "failed" && draft.failureReason === "payment_failed";
  const resuming = draft?.status === "completed" &&
    draft.paymentRecoveryAudit?.reason === AUDIT_REASON &&
    sameId(draft.paymentRecoveryAudit.paymentId, payment._id);
  if (!failedDraft && !resuming) {
    return knownConflict ? { reason: "draft_state_mismatch" } : null;
  }

  const batches = await SubscriptionEntitlementBatch.find({
    $or: [{ paymentId: payment._id }, { checkoutDraftId: draft._id }],
  }).limit(2).session(session).lean();
  const batch = batches[0];
  const stacking = draft.stackingFinalization?.mode === "additive_existing_parent";
  // The preallocated subscription ID identifies a standard activation from this
  // checkout. A payment's link to an older container alone does not prove one.
  const standaloneId = stacking ? null : draft.activationSubscriptionId;
  const hasStackingEvidence = knownConflict || resuming || stacking || Boolean(batch);
  const standalone = !hasStackingEvidence && standaloneId
    ? await Subscription.findOne({
      _id: standaloneId,
      userId: payment.userId,
      status: { $in: APPLIED_SUBSCRIPTION_STATUSES },
    }).session(session).lean()
    : null;
  if (!hasStackingEvidence && !standalone) return null;

  if (!sameId(draft.userId, payment.userId) || !sameId(draft.paymentId, payment._id) ||
      !compatibleId(payment.checkoutDraftId, draft._id) ||
      !compatibleId(payment.metadata?.draftId, draft._id) ||
      !matchesPrice(draft.breakdown?.totalHalala, draft.breakdown?.currency, payment)) {
    return { reason: "payment_draft_mismatch" };
  }

  if (batches.length > 1 || (batch && (
    batch.applicationState !== "applied" || batch.status === "canceled" ||
    !sameId(batch.userId, payment.userId) || !sameId(batch.paymentId, payment._id) ||
    !sameId(batch.checkoutDraftId, draft._id) || batch.daysCount !== draft.daysCount ||
    !matchesPackage(batch, draft, batch.mealsPerDay, batch.proteinGrams) ||
    !matchesPrice(batch.pricingSnapshot?.totalPriceHalala, batch.pricingSnapshot?.currency, payment)
  ))) {
    return { reason: "entitlement_batch_mismatch" };
  }

  const subscriptionId = batch?.containerSubscriptionId || standaloneId;
  if (!subscriptionId ||
      !compatibleId(payment.subscriptionId, subscriptionId) ||
      !compatibleId(payment.metadata?.subscriptionId, subscriptionId) ||
      !compatibleId(draft.subscriptionId, subscriptionId) ||
      !compatibleId(draft.stackingFinalization?.expectedParentSubscriptionId, subscriptionId) ||
      (resuming && !compatibleId(draft.paymentRecoveryAudit.batchId, batch?._id))) {
    return { reason: "subscription_link_mismatch" };
  }

  const subscription = standalone || await Subscription.findOne({
    _id: subscriptionId,
    userId: payment.userId,
    status: { $in: APPLIED_SUBSCRIPTION_STATUSES },
  }).session(session).lean();
  if (!subscription || (!batch && (
    !matchesPackage(subscription, draft, subscription.selectedMealsPerDay, subscription.selectedGrams) ||
    !matchesPrice(subscription.totalPriceHalala, subscription.checkoutCurrency, payment)
  ))) {
    return { reason: "subscription_mismatch" };
  }
  return { subscriptionId, batchId: batch?._id ?? null, resuming };
}

async function reconcileAppliedPayment({ payment, draft, entitlement, session }) {
  const paymentFilter = {
    _id: payment._id,
    userId: payment.userId,
    status: "paid",
    updatedAt: payment.updatedAt ?? null,
    "subscriptionRecoveryReview.status": { $ne: REVIEW_STATUS },
  };
  if (entitlement.reason) {
    const result = await Payment.updateOne(paymentFilter, {
      $set: { subscriptionRecoveryReview: {
        status: REVIEW_STATUS,
        reason: entitlement.reason,
        flaggedAt: new Date(),
      } },
      $unset: { "metadata.subscriptionRecoveryNextAt": "" },
    }, { session });
    return result.matchedCount
      ? { recovered: false, reason: REVIEW_STATUS, reviewReason: entitlement.reason }
      : { recovered: false, reason: "reconciliation_changed" };
  }

  const { subscriptionId, batchId, resuming } = entitlement;
  if (!resuming) {
    const now = new Date();
    const result = await CheckoutDraft.updateOne({
      _id: draft._id,
      userId: payment.userId,
      paymentId: payment._id,
      updatedAt: draft.updatedAt ?? null,
      status: "failed",
      failureReason: "payment_failed",
    }, {
      $set: {
        status: "completed",
        subscriptionId,
        activationSubscriptionId: subscriptionId,
        completedAt: now,
        failureReason: "",
        paymentRecoveryAudit: {
          paymentId: payment._id,
          batchId,
          previousFailedAt: draft.failedAt,
          reason: AUDIT_REASON,
          reconciledAt: now,
        },
      },
      $unset: { failedAt: "" },
    }, { session });
    if (!result.matchedCount) return { recovered: false, reason: "reconciliation_changed" };
  }

  // On standalone MongoDB, the draft audit lets the next run resume this
  // exact payment update if interrupted between the two document writes.
  const result = await Payment.updateOne(paymentFilter, {
    $set: { applied: true, subscriptionId, checkoutDraftId: draft._id },
    $unset: { "metadata.unappliedReason": "", "metadata.subscriptionRecoveryNextAt": "" },
  }, { session });
  return result.matchedCount
    ? { recovered: true, subscriptionId: String(subscriptionId) }
    : { recovered: false, reason: "reconciliation_changed" };
}

async function recoverPaidSubscriptionPayment(paymentId) {
  const session = await startSafeSession();
  let reconciling = false;
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

    if (payment.subscriptionRecoveryReview?.status === REVIEW_STATUS) {
      if (session.inTransaction()) await session.commitTransaction();
      return { recovered: false, reason: REVIEW_STATUS };
    }

    const draft = await findDraft(payment, session);
    // A completed and fully linked payment may have been reconciled by another
    // worker after this candidate was selected.
    const hasRecoveryAudit = draft?.paymentRecoveryAudit?.reason === AUDIT_REASON;
    if ((payment.applied || !hasRecoveryAudit) && await applicationIsComplete(payment, session, draft)) {
      if (!payment.applied) {
        payment.applied = true;
        await payment.save({ session });
      }
      if (session.inTransaction()) await session.commitTransaction();
      return { recovered: true, idempotent: true };
    }

    reconciling = true;
    const entitlement = await findAppliedEntitlement(payment, draft, session);
    if (entitlement) {
      const result = await reconcileAppliedPayment({ payment, draft, entitlement, session });
      if (session.inTransaction()) {
        if (result.reason === "reconciliation_changed") await session.abortTransaction();
        else await session.commitTransaction();
      }
      if (result.reviewReason) {
        logger.warn("Paid subscription payment needs review", {
          paymentId: String(payment._id),
          draftId: draft ? String(draft._id) : null,
          code: DRAFT_CONFLICT,
          reason: result.reviewReason,
        });
      }
      return result;
    }
    reconciling = false;

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
    if (reconciling) throw err;
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
    "subscriptionRecoveryReview.status": { $ne: REVIEW_STATUS },
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
