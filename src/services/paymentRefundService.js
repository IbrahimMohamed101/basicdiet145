"use strict";

const Payment = require("../models/Payment");
const PaymentRefund = require("../models/PaymentRefund");
const { calculateVatBreakdownFromInclusiveTotal } = require("../config/vat");

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
  try {
    const payment = paymentId
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

    const existing = await PaymentRefund.findOne({
      provider: "moyasar",
      idempotencyKey,
    });
    if (existing) return { refund: existing.toObject(), alreadyProcessed: true };

    const previouslyRecorded = await PaymentRefund.aggregate([
      {
        $match: {
          paymentId: payment._id,
          provider: "moyasar",
          status: { $in: ["confirmed", "needs_review"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountHalala" } } },
    ]);
    const recordedHalala = Number(previouslyRecorded[0] && previouslyRecorded[0].total || 0);
    const amountHalala = snapshot.cumulativeRefundedHalala - recordedHalala;
    if (amountHalala <= 0) {
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
    if (
      snapshot.cumulativeRefundedHalala > Number(payment.amount)
      || recordedHalala + amountHalala > Number(payment.amount)
    ) {
      const error = new Error("Refund exceeds original payment amount");
      error.code = "REFUND_AMOUNT_MISMATCH";
      error.status = 409;
      throw error;
    }

    const vat = calculateVatBreakdownFromInclusiveTotal(amountHalala);
    const created = await PaymentRefund.create({
      paymentId: payment._id,
      subscriptionId: payment.subscriptionId,
      orderId: payment.orderId,
      provider: "moyasar",
      providerRefundId: snapshot.providerRefundId || undefined,
      providerPaymentId: snapshot.providerPaymentId || payment.providerPaymentId,
      amountHalala,
      vatHalala: vat.vatHalala,
      refundedAt: snapshot.refundedAt || undefined,
      status: snapshot.refundedAt ? "confirmed" : "needs_review",
      idempotencyKey,
      rawReference: {
        webhookId: snapshot.webhookId || null,
        providerPaymentId: snapshot.providerPaymentId || null,
        cumulativeRefundedHalala: snapshot.cumulativeRefundedHalala,
      },
    });

    // Each write is independently durable. The immutable refund ledger is the
    // accounting source of truth; Payment remains gross-paid provider history.
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
    return { refund: created.toObject(), alreadyProcessed: false };
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
  }
}

module.exports = {
  buildMoyasarRefundIdempotencyKey,
  extractMoyasarRefundSnapshot,
  isMoyasarRefundEvent,
  recordMoyasarRefundWebhook,
};
