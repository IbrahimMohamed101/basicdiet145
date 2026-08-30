"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");
const PaymentRefund = require("../../models/PaymentRefund");
const SubscriptionAdminOperation = require("../../models/SubscriptionAdminOperation");
const { calculateVatBreakdownFromInclusiveTotal } = require("../../config/vat");
const { performCancelSubscriptionAdmin } = require("../subscription/subscriptionLifecycleService");
const {
  extractRefundedHalala,
  getMoyasarPayment,
  refundMoyasarPayment,
} = require("../moyasarRefundGatewayService");
const { getCustomerManagementProfile } = require("./customerManagementService");

const ACTIONS = new Set(["cancel", "refund", "cancel_and_refund"]);
const REFUND_MODES = new Set(["full", "partial"]);
const REFUND_ACTIONS = new Set(["refund", "cancel_and_refund"]);

function makeError(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) error.extra = extra;
  return error;
}

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function objectIdString(value) {
  return value ? String(value) : "";
}

function positiveHalala(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function duplicateKey(error) {
  return Boolean(error && Number(error.code) === 11000);
}

function providerRefundId(snapshot) {
  return clean(
    snapshot && (
      snapshot.refund_id
      || snapshot.refundId
      || (snapshot.refund && (snapshot.refund.id || snapshot.refund.refund_id))
    ),
    200
  );
}

function safeProviderSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    id: clean(snapshot.id, 200) || null,
    status: clean(snapshot.status, 80) || null,
    amount: Number.isSafeInteger(Number(snapshot.amount)) ? Number(snapshot.amount) : null,
    currency: clean(snapshot.currency, 20) || null,
    refunded: extractRefundedHalala(snapshot),
    refundedAt: snapshot.refunded_at || snapshot.refundedAt || null,
    refundId: providerRefundId(snapshot) || null,
  };
}

async function recordedRefundedHalala(paymentId) {
  const rows = await PaymentRefund.aggregate([
    {
      $match: {
        paymentId: new mongoose.Types.ObjectId(String(paymentId)),
        provider: "moyasar",
        status: { $in: ["confirmed", "needs_review"] },
      },
    },
    { $group: { _id: null, total: { $sum: "$amountHalala" } } },
  ]);
  return Math.max(0, Number(rows[0] && rows[0].total || 0));
}

async function assertCustomerSubscription(customerId, subscriptionId) {
  const profile = await getCustomerManagementProfile(customerId);
  const activeId = profile && profile.activeSubscription && profile.activeSubscription.id;
  if (!activeId || String(activeId) !== String(subscriptionId)) {
    throw makeError(404, "ACTIVE_SUBSCRIPTION_NOT_FOUND", "Active subscription was not found for this customer");
  }
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    throw makeError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
  }
  return { profile, subscription };
}

async function listRefundablePayments(subscriptionId) {
  const payments = await Payment.find({
    subscriptionId,
    provider: "moyasar",
    status: "paid",
    providerPaymentId: { $exists: true, $nin: [null, ""] },
  }).sort({ paidAt: -1, createdAt: -1 }).lean();

  return Promise.all(payments.map(async (payment) => {
    const refunded = await recordedRefundedHalala(payment._id);
    const amount = Math.max(0, Number(payment.amount || 0));
    return {
      paymentId: String(payment._id),
      providerPaymentId: String(payment.providerPaymentId || ""),
      amountHalala: amount,
      recordedRefundedHalala: refunded,
      refundableHalala: Math.max(0, amount - refunded),
      paidAt: payment.paidAt || payment.createdAt || null,
      currency: payment.currency || "SAR",
    };
  }));
}

async function getFinancialControlPreview({ customerId, subscriptionId }) {
  const { subscription } = await assertCustomerSubscription(customerId, subscriptionId);
  const payments = await listRefundablePayments(subscriptionId);
  return {
    subscription: {
      id: String(subscription._id),
      status: subscription.status,
      displayId: subscription.displayId || subscription.subscriptionNumber || null,
    },
    canCancel: !["canceled", "completed", "expired"].includes(String(subscription.status || "")),
    payments,
    totalRefundableHalala: payments.reduce((sum, item) => sum + item.refundableHalala, 0),
    actions: ["cancel", "refund", "cancel_and_refund"],
  };
}

function validatePayload(payload) {
  const action = clean(payload.action, 40).toLowerCase();
  const operationKey = clean(payload.operationKey, 120);
  const reason = clean(payload.reason, 500);
  const note = clean(payload.note, 1000);
  const refundMode = clean(payload.refundMode, 20).toLowerCase();
  const paymentId = clean(payload.paymentId, 80);
  const amountHalala = positiveHalala(payload.amountHalala);

  if (!ACTIONS.has(action)) throw makeError(400, "INVALID_ACTION", "Invalid subscription financial action");
  if (operationKey.length < 8) throw makeError(400, "OPERATION_KEY_REQUIRED", "operationKey is required");
  if (reason.length < 3) throw makeError(400, "REASON_REQUIRED", "A reason of at least 3 characters is required");

  if (REFUND_ACTIONS.has(action)) {
    if (!mongoose.Types.ObjectId.isValid(paymentId)) throw makeError(400, "PAYMENT_REQUIRED", "A valid payment is required");
    if (!REFUND_MODES.has(refundMode)) throw makeError(400, "REFUND_MODE_REQUIRED", "Refund mode must be full or partial");
    if (refundMode === "partial" && !amountHalala) {
      throw makeError(400, "INVALID_REFUND_AMOUNT", "Partial refund amount must be a positive integer in halala");
    }
  }

  return {
    action,
    operationKey,
    reason,
    note,
    refundMode: REFUND_ACTIONS.has(action) ? refundMode : "none",
    paymentId: REFUND_ACTIONS.has(action) ? paymentId : "",
    amountHalala: refundMode === "partial" ? amountHalala : 0,
  };
}

function sameOperation(existing, input, subscriptionId) {
  if (String(existing.subscriptionId) !== String(subscriptionId)) return false;
  if (existing.type !== input.action) return false;
  if ((existing.refundMode || "none") !== input.refundMode) return false;
  if (objectIdString(existing.paymentId) !== input.paymentId) return false;
  if (input.refundMode === "partial" && Number(existing.requestedAmountHalala || 0) !== input.amountHalala) return false;
  return true;
}

async function claimOperation({ input, subscriptionId, actorId, actorRole, requestMeta }) {
  let operation = await SubscriptionAdminOperation.findById(input.operationKey);
  if (operation) {
    if (!sameOperation(operation, input, subscriptionId)) {
      throw makeError(409, "OPERATION_KEY_REUSED", "This operation key was already used for another request");
    }
    return { operation, replayed: true };
  }

  try {
    operation = await SubscriptionAdminOperation.create({
      _id: input.operationKey,
      type: input.action,
      status: "processing",
      subscriptionId,
      ...(input.paymentId ? { paymentId: input.paymentId } : {}),
      refundMode: input.refundMode,
      requestedAmountHalala: input.amountHalala,
      reason: input.reason,
      note: input.note || undefined,
      actor: {
        dashboardUserId: actorId ? String(actorId) : undefined,
        role: clean(actorRole, 80),
      },
      requestMeta: {
        ip: clean(requestMeta && requestMeta.ip, 100),
        userAgent: clean(requestMeta && requestMeta.userAgent, 300),
      },
      lastStep: "claimed",
    });
    return { operation, replayed: false };
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    operation = await SubscriptionAdminOperation.findById(input.operationKey);
    if (!operation || !sameOperation(operation, input, subscriptionId)) {
      throw makeError(409, "OPERATION_KEY_REUSED", "This operation key was already used for another request");
    }
    return { operation, replayed: true };
  }
}

async function loadPaymentForRefund(subscriptionId, paymentId) {
  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId,
    provider: "moyasar",
    status: "paid",
  });
  if (!payment || !clean(payment.providerPaymentId, 200)) {
    throw makeError(409, "PAYMENT_NOT_REFUNDABLE", "Selected payment is not refundable through Moyasar");
  }
  return payment;
}

async function persistOperation(operationId, set) {
  return SubscriptionAdminOperation.findByIdAndUpdate(
    operationId,
    { $set: set },
    { new: true }
  );
}

async function ensureProviderRefund({ operation, payment }) {
  if (operation.refundRecorded) return operation;

  let providerBefore = Number(operation.providerRefundedBeforeHalala);
  let recordedBefore = Number(operation.recordedRefundedBeforeHalala);
  let requestedAmount = Number(operation.requestedAmountHalala || 0);

  if (!Number.isSafeInteger(providerBefore) || providerBefore < 0 || !Number.isSafeInteger(recordedBefore) || recordedBefore < 0) {
    const [providerSnapshot, localRecorded] = await Promise.all([
      getMoyasarPayment(payment.providerPaymentId),
      recordedRefundedHalala(payment._id),
    ]);
    providerBefore = extractRefundedHalala(providerSnapshot);
    recordedBefore = localRecorded;
    const alreadyRefunded = Math.max(providerBefore, recordedBefore);
    const providerRemaining = Math.max(0, Number(payment.amount || 0) - alreadyRefunded);

    if (operation.refundMode === "full") requestedAmount = providerRemaining;
    if (!requestedAmount || requestedAmount > providerRemaining) {
      throw makeError(409, "REFUND_AMOUNT_EXCEEDS_AVAILABLE", "Refund amount exceeds the currently refundable payment balance");
    }

    operation = await persistOperation(operation._id, {
      provider: "moyasar",
      providerPaymentId: payment.providerPaymentId,
      providerRefundedBeforeHalala: providerBefore,
      recordedRefundedBeforeHalala: recordedBefore,
      requestedAmountHalala: requestedAmount,
      providerSnapshot: safeProviderSnapshot(providerSnapshot),
      lastStep: "refund_baseline_recorded",
      status: "processing",
      error: null,
    });
  }

  const targetProviderRefunded = providerBefore + requestedAmount;
  let providerSnapshot = null;

  if (operation.status === "provider_succeeded" && Number(operation.providerRefundedAfterHalala || 0) >= targetProviderRefunded) {
    providerSnapshot = operation.providerSnapshot;
  } else {
    const current = await getMoyasarPayment(payment.providerPaymentId);
    if (extractRefundedHalala(current) >= targetProviderRefunded) {
      providerSnapshot = current;
    } else {
      try {
        providerSnapshot = await refundMoyasarPayment({
          paymentId: payment.providerPaymentId,
          amountHalala: requestedAmount,
        });
      } catch (error) {
        let recovered = null;
        try { recovered = await getMoyasarPayment(payment.providerPaymentId); } catch (_) { recovered = null; }
        if (!recovered || extractRefundedHalala(recovered) < targetProviderRefunded) {
          await persistOperation(operation._id, {
            status: Number(error.status || 0) >= 400 && Number(error.status || 0) < 500 ? "failed" : "needs_review",
            lastStep: "refund_provider_uncertain",
            error: {
              code: clean(error.code, 100) || "PAYMENT_PROVIDER_ERROR",
              message: clean(error.message, 500),
              status: Number(error.status || 0) || null,
            },
          });
          throw makeError(
            Number(error.status || 0) >= 400 && Number(error.status || 0) < 500 ? 409 : 503,
            "REFUND_PROVIDER_UNCONFIRMED",
            "Moyasar refund was not confirmed. Retry using the same operation key.",
            { operationKey: String(operation._id) }
          );
        }
        providerSnapshot = recovered;
      }
    }

    operation = await persistOperation(operation._id, {
      status: "provider_succeeded",
      providerRefundedAfterHalala: extractRefundedHalala(providerSnapshot),
      providerRefundId: providerRefundId(providerSnapshot) || undefined,
      providerSnapshot: safeProviderSnapshot(providerSnapshot),
      lastStep: "refund_provider_succeeded",
      error: null,
    });
  }

  let refund = await PaymentRefund.findOne({
    provider: "moyasar",
    idempotencyKey: `admin:${operation._id}`,
  });

  if (!refund) {
    const nowRecorded = await recordedRefundedHalala(payment._id);
    const recordedDelta = Math.max(0, nowRecorded - recordedBefore);
    if (recordedDelta >= requestedAmount) {
      refund = await PaymentRefund.findOne({
        paymentId: payment._id,
        provider: "moyasar",
        createdAt: { $gte: operation.createdAt },
      }).sort({ createdAt: 1 });
    }

    if (!refund) {
      const vat = calculateVatBreakdownFromInclusiveTotal(requestedAmount);
      try {
        refund = await PaymentRefund.create({
          paymentId: payment._id,
          subscriptionId: payment.subscriptionId,
          orderId: payment.orderId,
          provider: "moyasar",
          providerRefundId: providerRefundId(providerSnapshot) || undefined,
          providerPaymentId: payment.providerPaymentId,
          amountHalala: requestedAmount,
          vatHalala: vat.vatHalala,
          refundedAt: new Date(),
          status: "confirmed",
          idempotencyKey: `admin:${operation._id}`,
          rawReference: {
            source: "dashboard_superadmin",
            operationKey: String(operation._id),
            reason: operation.reason,
          },
        });
      } catch (error) {
        if (!duplicateKey(error)) throw error;
        refund = await PaymentRefund.findOne({
          $or: [
            { provider: "moyasar", idempotencyKey: `admin:${operation._id}` },
            ...(providerRefundId(providerSnapshot) ? [{ provider: "moyasar", providerRefundId: providerRefundId(providerSnapshot) }] : []),
          ],
        });
      }
    }
  }

  const cumulativeProviderRefunded = Math.max(
    extractRefundedHalala(providerSnapshot),
    providerBefore + requestedAmount
  );
  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        status: "paid",
        "metadata.providerRefundStatus": cumulativeProviderRefunded >= Number(payment.amount || 0) ? "refunded" : "partially_refunded",
        "metadata.providerRefundedHalala": cumulativeProviderRefunded,
      },
    }
  );

  return persistOperation(operation._id, {
    refundRecorded: true,
    refundedAmountHalala: requestedAmount,
    providerRefundedAfterHalala: cumulativeProviderRefunded,
    lastStep: "refund_recorded",
    status: "provider_succeeded",
    error: null,
  });
}

async function ensureCancellation({ operation, subscriptionId, actorId, actorRole, lang }) {
  if (operation.cancellationApplied) return operation;
  const current = await Subscription.findById(subscriptionId).select({ status: 1 }).lean();
  if (!current) throw makeError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");

  if (current.status !== "canceled") {
    const result = await performCancelSubscriptionAdmin({
      subscriptionId,
      actor: {
        dashboardUserId: actorId,
        dashboardUserRole: actorRole,
      },
      lang: lang || "ar",
    });
    if (!["canceled", "already_canceled"].includes(result.outcome)) {
      if (result.outcome === "invalid_transition") {
        throw makeError(409, "SUBSCRIPTION_CANNOT_BE_CANCELED", "Subscription cannot be canceled in its current state");
      }
      if (result.outcome === "not_found") throw makeError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
      throw makeError(409, "SUBSCRIPTION_CANCELLATION_FAILED", "Subscription cancellation could not be completed");
    }
  }

  return persistOperation(operation._id, {
    cancellationApplied: true,
    lastStep: "subscription_canceled",
    error: null,
  });
}

async function executeFinancialControl({
  customerId,
  subscriptionId,
  payload,
  actorId,
  actorRole,
  requestMeta,
  lang,
}) {
  const input = validatePayload(payload || {});
  await assertCustomerSubscription(customerId, subscriptionId);

  let { operation, replayed } = await claimOperation({
    input,
    subscriptionId,
    actorId,
    actorRole,
    requestMeta,
  });

  if (operation.status === "completed") {
    return { operation: operation.toObject(), replayed: true };
  }

  try {
    if (REFUND_ACTIONS.has(input.action) && !operation.refundRecorded) {
      const payment = await loadPaymentForRefund(subscriptionId, input.paymentId);
      operation = await ensureProviderRefund({ operation, payment });
    }

    if ((input.action === "cancel" || input.action === "cancel_and_refund") && !operation.cancellationApplied) {
      operation = await ensureCancellation({
        operation,
        subscriptionId,
        actorId,
        actorRole,
        lang,
      });
    }

    operation = await persistOperation(operation._id, {
      status: "completed",
      lastStep: "completed",
      error: null,
    });
    return { operation: operation.toObject(), replayed };
  } catch (error) {
    if (error.code !== "REFUND_PROVIDER_UNCONFIRMED") {
      await persistOperation(operation._id, {
        status: operation.status === "provider_succeeded" ? "needs_review" : "failed",
        lastStep: clean(operation.lastStep, 100) || "failed",
        error: {
          code: clean(error.code, 100) || "FINANCIAL_CONTROL_FAILED",
          message: clean(error.message, 500),
          status: Number(error.status || 0) || null,
        },
      }).catch(() => null);
    }
    error.extra = { ...(error.extra || {}), operationKey: String(operation._id) };
    throw error;
  }
}

module.exports = {
  executeFinancialControl,
  getFinancialControlPreview,
};
