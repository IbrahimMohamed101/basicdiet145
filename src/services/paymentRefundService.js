"use strict";

const Payment = require("../models/Payment");
const PaymentRefund = require("../models/PaymentRefund");
const { calculateVatBreakdownFromInclusiveTotal } = require("../config/vat");

const REFUND_LEDGER_LOCK_TTL_MS = 5 * 60 * 1000;
const REFUND_LEDGER_LOCK_RETRIES = 5;

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function optionalDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMoyasarRefundEvent(eventType, data = {}) {
  const type = clean(eventType).toLowerCase();
  const status = clean(data.status).toLowerCase();
  return type === "payment_refunded"
    || type.endsWith(".refunded")
    || type.includes("payment_refunded")
    || status === "refunded";
}

function extractMoyasarRefundSnapshot({ payload = {}, data = {} } = {}) {
  const providerPaymentId = clean(data.id || data.payment_id || data.paymentId);
  const cumulativeRefundedHalala = positiveInteger(
    data.refunded !== undefined
      ? data.refunded
      : data.refunded_amount !== undefined
        ? data.refunded_amount
        : data.refund_amount
  );
  const refundedAt = optionalDate(
    data.refunded_at
    || data.refundedAt
    || data.refund && (data.refund.refunded_at || data.refund.refundedAt)
  );
  const webhookId = clean(
    payload.webhook_id
    || payload.webhookId
    || (payload.id && clean(payload.id) !== providerPaymentId ? payload.id : "")
  );
  const providerRefundId = clean(
    data.refund_id
    || data.refundId
    || data.refund && (data.refund.id || data.refund.refund_id)
  );
  return {
    providerPaymentId,
    providerRefundId,
    cumulativeRefundedHalala,
    refundedAt,
    webhookId,
  };
}

function buildMoyasarRefundIdempotencyKey(snapshot) {
  if (snapshot.webhookId) return `webhook:${snapshot.webhookId}`;
  if (snapshot.providerRefundId) return `refund:${snapshot.providerRefundId}`;
  return `payment:${snapshot.providerPaymentId}:refunded:${snapshot.cumulativeRefundedHalala}`;
}

function duplicateKey(error) {
  return Boolean(error && Number(error.code) === 11000);
}

async function acquireRefundLedgerLock(paymentId, operationKey) {
  for (let attempt = 0; attempt < REFUND_LEDGER_LOCK_RETRIES; attempt += 1) {
    const staleBefore = new Date(Date.now() - REFUND_LEDGER_LOCK_TTL_MS);
    const locked = await Payment.findOneAndUpdate(
      {
        _id: paymentId,
        $or: [
          { "metadata.accountingRefundRecordLock": { $exists: false } },
          { "metadata.accountingRefundRecordLock": null },
          { "metadata.accountingRefundRecordLock.operationKey": operationKey },
          { "metadata.accountingRefundRecordLock.acquiredAt": { $lt: staleBefore } },
        ],
      },
      {
        $set: {
          "metadata.accountingRefundRecordLock": {
            operationKey,
            acquiredAt: new Date(),
          },
        },
      },
      { new: true }
    );
    if (locked) return;
    if (attempt < REFUND_LEDGER_LOCK_RETRIES - 1) {
      await sleep(50 * (attempt + 1));
    }
  }

  const error = new Error("Refund ledger is temporarily busy");
  error.code = "REFUND_LEDGER_BUSY";
  error.status = 503;
  throw error;
}

async function releaseRefundLedgerLock(paymentId, operationKey) {
  await Payment.updateOne(
    { _id: paymentId, "metadata.accountingRefundRecordLock.operationKey": operationKey },
    { $unset: { "metadata.accountingRefundRecordLock": 1 } }
  );
}

async function sumMoyasarProviderLedger(paymentId) {
  const rows = await PaymentRefund.aggregate([
    {
      $match: {
        paymentId,
        provider: "moyasar",
        status: { $in: ["confirmed", "needs_review"] },
      },
    },
    { $group: { _id: null, total: { $sum: "$amountHalala" } } },
  ]);
  return Math.max(0, Number(rows[0] && rows[0].total || 0));
}

async function sumMoyasarReconciledAccounting(paymentId) {
  const rows = await PaymentRefund.aggregate([
    {
      $match: {
        paymentId,
        executionMode: "recorded_only",
        refundChannel: "moyasar",
        status: { $in: ["confirmed", "needs_review"] },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$settlement.providerConfirmedHalala", 0] } },
      },
    },
  ]);
  return Math.max(0, Number(rows[0] && rows[0].total || 0));
}

async function reconcileAccountingRowsWithMoyasar({ payment, snapshot, amountHalala }) {
  let remaining = Math.max(0, Number(amountHalala || 0));
  if (!remaining) return 0;

  const rows = await PaymentRefund.find({
    paymentId: payment._id,
    executionMode: "recorded_only",
    refundChannel: "moyasar",
    status: { $in: ["confirmed", "needs_review"] },
    $or: [
      { "settlement.method": "moyasar" },
      { "settlement.method": { $exists: false } },
      { "settlement.method": null },
    ],
  }).sort({ createdAt: 1 });

  for (const row of rows) {
    if (remaining <= 0) break;
    const alreadyConfirmed = Math.max(0, Number(row.settlement && row.settlement.providerConfirmedHalala || 0));
    const capacity = Math.max(0, Number(row.amountHalala || 0) - alreadyConfirmed);
    if (!capacity) continue;

    const applied = Math.min(capacity, remaining);
    const providerConfirmedHalala = alreadyConfirmed + applied;
    const fullyConfirmed = providerConfirmedHalala >= Number(row.amountHalala || 0);
    const existingSettled = Math.max(0, Number(row.settlement && row.settlement.settledAmountHalala || 0));
    const settledAmountHalala = Math.max(existingSettled, providerConfirmedHalala);

    await PaymentRefund.updateOne(
      { _id: row._id },
      {
        $set: {
          "settlement.status": fullyConfirmed ? "settled" : "partially_settled",
          "settlement.method": "moyasar",
          "settlement.settledAmountHalala": settledAmountHalala,
          ...(fullyConfirmed ? { "settlement.settledAt": snapshot.refundedAt || new Date() } : {}),
          "settlement.source": "moyasar_webhook_reconciliation",
          "settlement.providerConfirmedHalala": providerConfirmedHalala,
          ...(snapshot.providerRefundId ? { "settlement.providerRefundId": snapshot.providerRefundId } : {}),
          ...(snapshot.providerPaymentId || payment.providerPaymentId
            ? { "settlement.providerPaymentId": snapshot.providerPaymentId || payment.providerPaymentId }
            : {}),
        },
      }
    );
    remaining -= applied;
  }

  return remaining;
}

async function recordMoyasarRefundWebhook({
  payload,
  data,
  paymentId,
  startSession: _startSession,
} = {}) {
  const snapshot = extractMoyasarRefundSnapshot({ payload, data });
  if (!snapshot.providerPaymentId && !paymentId) {
    const error = new Error("Missing refunded payment identifier");
    error.code = "INVALID_REFUND";
    error.status = 400;
    throw error;
  }
  if (!snapshot.cumulativeRefundedHalala) {
    const error = new Error("Missing cumulative refunded amount");
    error.code = "INVALID_REFUND";
    error.status = 400;
    throw error;
  }

  const idempotencyKey = buildMoyasarRefundIdempotencyKey(snapshot);
  let payment = null;
  let lockKey = "";
  let lockHeld = false;

  try {
    payment = paymentId
      ? await Payment.findById(paymentId)
      : await Payment.findOne({
        provider: "moyasar",
        providerPaymentId: snapshot.providerPaymentId,
      });
    if (!payment) {
      const error = new Error("Payment not found");
      error.code = "NOT_FOUND";
      error.status = 404;
      throw error;
    }
    if (snapshot.cumulativeRefundedHalala > Number(payment.amount || 0)) {
      const error = new Error("Refund exceeds original payment amount");
      error.code = "REFUND_AMOUNT_MISMATCH";
      error.status = 409;
      throw error;
    }

    const existing = await PaymentRefund.findOne({
      provider: "moyasar",
      idempotencyKey,
    });
    if (existing) {
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: "paid",
            "metadata.providerRefundStatus": snapshot.cumulativeRefundedHalala >= Number(payment.amount)
              ? "refunded"
              : "partially_refunded",
            "metadata.providerRefundedHalala": snapshot.cumulativeRefundedHalala,
          },
        }
      );
      return { refund: existing.toObject(), alreadyProcessed: true };
    }

    lockKey = `webhook:${idempotencyKey}`;
    await acquireRefundLedgerLock(payment._id, lockKey);
    lockHeld = true;

    // Re-check after acquiring the shared lock in case another request finished
    // while this webhook was waiting.
    const existingAfterLock = await PaymentRefund.findOne({
      provider: "moyasar",
      idempotencyKey,
    });
    if (existingAfterLock) {
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: "paid",
            "metadata.providerRefundStatus": snapshot.cumulativeRefundedHalala >= Number(payment.amount)
              ? "refunded"
              : "partially_refunded",
            "metadata.providerRefundedHalala": snapshot.cumulativeRefundedHalala,
          },
        }
      );
      return { refund: existingAfterLock.toObject(), alreadyProcessed: true };
    }

    const [providerLedgerHalala, reconciledAccountingHalala] = await Promise.all([
      sumMoyasarProviderLedger(payment._id),
      sumMoyasarReconciledAccounting(payment._id),
    ]);
    const alreadyReconciledHalala = providerLedgerHalala + reconciledAccountingHalala;
    let newProviderDelta = snapshot.cumulativeRefundedHalala - alreadyReconciledHalala;

    if (newProviderDelta <= 0) {
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: "paid",
            "metadata.providerRefundStatus": snapshot.cumulativeRefundedHalala >= Number(payment.amount)
              ? "refunded"
              : "partially_refunded",
            "metadata.providerRefundedHalala": snapshot.cumulativeRefundedHalala,
          },
        }
      );
      return { refund: null, alreadyProcessed: true, staleSnapshot: true };
    }

    newProviderDelta = await reconcileAccountingRowsWithMoyasar({
      payment,
      snapshot,
      amountHalala: newProviderDelta,
    });

    let created = null;
    if (newProviderDelta > 0) {
      const allRecognized = await PaymentRefund.aggregate([
        {
          $match: {
            paymentId: payment._id,
            status: { $in: ["confirmed", "needs_review"] },
          },
        },
        { $group: { _id: null, total: { $sum: "$amountHalala" } } },
      ]);
      const recognizedHalala = Math.max(0, Number(allRecognized[0] && allRecognized[0].total || 0));
      const financialCapacity = Math.max(0, Number(payment.amount || 0) - recognizedHalala);
      const ledgerAmountHalala = Math.min(newProviderDelta, financialCapacity);

      if (ledgerAmountHalala > 0) {
        const vat = calculateVatBreakdownFromInclusiveTotal(ledgerAmountHalala);
        created = await PaymentRefund.create({
          paymentId: payment._id,
          subscriptionId: payment.subscriptionId,
          orderId: payment.orderId,
          provider: "moyasar",
          providerRefundId: snapshot.providerRefundId || undefined,
          providerPaymentId: snapshot.providerPaymentId || payment.providerPaymentId,
          amountHalala: ledgerAmountHalala,
          vatHalala: vat.vatHalala,
          refundedAt: snapshot.refundedAt || undefined,
          status: snapshot.refundedAt ? "confirmed" : "needs_review",
          idempotencyKey,
          executionMode: "provider_confirmed",
          refundChannel: "moyasar",
          settlement: {
            status: "settled",
            method: "moyasar",
            settledAmountHalala: ledgerAmountHalala,
            settledAt: snapshot.refundedAt || new Date(),
            source: "moyasar_webhook",
            providerConfirmedHalala: ledgerAmountHalala,
            providerRefundId: snapshot.providerRefundId || undefined,
            providerPaymentId: snapshot.providerPaymentId || payment.providerPaymentId,
          },
          rawReference: {
            webhookId: snapshot.webhookId || null,
            providerPaymentId: snapshot.providerPaymentId || null,
            cumulativeRefundedHalala: snapshot.cumulativeRefundedHalala,
            providerDeltaHalala: newProviderDelta,
            financialLedgerAmountHalala: ledgerAmountHalala,
          },
        });
      }
    }

    // Provider state is tracked separately from the accounting recognition rows.
    // No outbound provider request happens in this service.
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: "paid",
          "metadata.providerRefundStatus": snapshot.cumulativeRefundedHalala >= Number(payment.amount)
            ? "refunded"
            : "partially_refunded",
          "metadata.providerRefundedHalala": snapshot.cumulativeRefundedHalala,
        },
      }
    );
    return {
      refund: created ? created.toObject() : null,
      alreadyProcessed: false,
      reconciledAccountingOnly: !created,
    };
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const existing = await PaymentRefund.findOne({
      $or: [
        { provider: "moyasar", idempotencyKey },
        ...(snapshot.providerRefundId
          ? [{ provider: "moyasar", providerRefundId: snapshot.providerRefundId }]
          : []),
      ],
    }).lean();
    return { refund: existing, alreadyProcessed: true };
  } finally {
    if (payment && lockHeld && lockKey) {
      await releaseRefundLedgerLock(payment._id, lockKey).catch(() => null);
    }
  }
}

module.exports = {
  buildMoyasarRefundIdempotencyKey,
  extractMoyasarRefundSnapshot,
  isMoyasarRefundEvent,
  recordMoyasarRefundWebhook,
};
