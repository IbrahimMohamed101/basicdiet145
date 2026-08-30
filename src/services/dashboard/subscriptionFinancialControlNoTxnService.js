"use strict";

const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");
const PaymentRefund = require("../../models/PaymentRefund");
const SubscriptionAdminOperation = require("../../models/SubscriptionAdminOperation");
const { calculateVatBreakdownFromInclusiveTotal } = require("../../config/vat");
const { logger } = require("../../utils/logger");
const { writeLog } = require("../../utils/log");
const { performCancelSubscriptionAdmin } = require("../subscription/subscriptionLifecycleService");
const {
  extractRefundedHalala,
  getMoyasarPayment,
  refundMoyasarPayment,
} = require("../moyasarRefundGatewayService");
const { getCustomerManagementProfile } = require("./customerManagementService");

const ACTIONS = new Set(["cancel", "refund", "cancel_and_refund"]);
const REFUND_ACTIONS = new Set(["refund", "cancel_and_refund"]);
const REFUND_MODES = new Set(["full", "partial"]);

function fail(status, code, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (extra) error.extra = extra;
  return error;
}

function clean(value, max = 1000) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, max);
}

function duplicateKey(error) {
  return Boolean(error && Number(error.code) === 11000);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
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
    refundedHalala: extractRefundedHalala(snapshot),
    refundedAt: snapshot.refunded_at || snapshot.refundedAt || null,
    refundId: providerRefundId(snapshot) || null,
  };
}

async function sumRecordedRefunds(paymentId) {
  const rows = await PaymentRefund.aggregate([
    {
      $match: {
        paymentId: new mongoose.Types.ObjectId(String(paymentId)),
        provider: "moyasar",
        status: { $in: ["confirmed", "needs_review"] },
      },
    },
    { $group: { _id: null, amountHalala: { $sum: "$amountHalala" } } },
  ]);
  return Math.max(0, Number(rows[0] && rows[0].amountHalala || 0));
}

async function resolveSubscription({ customerId = null, subscriptionId }) {
  if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
    throw fail(400, "INVALID_SUBSCRIPTION_ID", "Subscription id is invalid");
  }
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");

  if (customerId) {
    const profile = await getCustomerManagementProfile(customerId);
    const managedUserId = profile && (profile.coreUserId || profile.id);
    if (!managedUserId || String(subscription.userId) !== String(managedUserId)) {
      throw fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription does not belong to this customer");
    }
  }
  return subscription;
}

async function listRefundablePayments(subscriptionId) {
  const payments = await Payment.find({
    subscriptionId,
    provider: "moyasar",
    status: "paid",
    providerPaymentId: { $exists: true, $nin: [null, ""] },
  }).sort({ paidAt: -1, createdAt: -1 }).lean();

  return Promise.all(payments.map(async (payment) => {
    const recordedRefundedHalala = await sumRecordedRefunds(payment._id);
    const amountHalala = Math.max(0, Number(payment.amount || 0));
    return {
      paymentId: String(payment._id),
      providerPaymentId: clean(payment.providerPaymentId, 200),
      amountHalala,
      recordedRefundedHalala,
      refundableHalala: Math.max(0, amountHalala - recordedRefundedHalala),
      paidAt: payment.paidAt || payment.createdAt || null,
      currency: payment.currency || "SAR",
      providerRefundStatus: payment.metadata && payment.metadata.providerRefundStatus || null,
    };
  }));
}

async function getFinancialControlPreview({ customerId = null, subscriptionId }) {
  const subscription = await resolveSubscription({ customerId, subscriptionId });
  const payments = await listRefundablePayments(subscription._id);
  return {
    subscription: {
      id: String(subscription._id),
      displayId: `SUB-${String(subscription._id).slice(-6).toUpperCase()}`,
      status: subscription.status,
      canceledAt: subscription.canceledAt || null,
      cancellationReason: subscription.cancellationReason || "",
    },
    canCancel: ["active", "pending_payment"].includes(String(subscription.status || "")),
    payments,
    totalRefundableHalala: payments.reduce((sum, payment) => sum + payment.refundableHalala, 0),
  };
}

function parseInput(payload = {}) {
  const action = clean(payload.action, 40).toLowerCase();
  const operationKey = clean(payload.operationKey, 120);
  const reason = clean(payload.reason, 500);
  const note = clean(payload.note, 1000);
  const refundMode = clean(payload.refundMode, 20).toLowerCase();
  const paymentId = clean(payload.paymentId, 80);
  const amountHalala = positiveInteger(payload.amountHalala);

  if (!ACTIONS.has(action)) throw fail(400, "INVALID_ACTION", "Invalid action");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(operationKey)) {
    throw fail(400, "INVALID_OPERATION_KEY", "A valid operationKey is required");
  }
  if (reason.length < 3) throw fail(400, "REASON_REQUIRED", "A reason of at least 3 characters is required");

  if (REFUND_ACTIONS.has(action)) {
    if (!mongoose.Types.ObjectId.isValid(paymentId)) throw fail(400, "PAYMENT_REQUIRED", "A valid payment is required");
    if (!REFUND_MODES.has(refundMode)) throw fail(400, "REFUND_MODE_REQUIRED", "Refund mode must be full or partial");
    if (refundMode === "partial" && !amountHalala) {
      throw fail(400, "INVALID_REFUND_AMOUNT", "Partial refund amount must be a positive integer in halala");
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

function operationMatches(operation, input, subscriptionId) {
  if (String(operation.subscriptionId) !== String(subscriptionId)) return false;
  if (operation.type !== input.action) return false;
  if (String(operation.refundMode || "none") !== input.refundMode) return false;
  if (String(operation.paymentId || "") !== input.paymentId) return false;
  if (input.refundMode === "partial" && Number(operation.requestedAmountHalala || 0) !== input.amountHalala) return false;
  return true;
}

async function claimOperation({ input, subscriptionId, actorId, actorRole, requestMeta }) {
  const existing = await SubscriptionAdminOperation.findById(input.operationKey);
  if (existing) {
    if (!operationMatches(existing, input, subscriptionId)) {
      throw fail(409, "OPERATION_KEY_REUSED", "This operation key is already bound to another operation");
    }
    return { operation: existing, replayed: true };
  }

  try {
    const operation = await SubscriptionAdminOperation.create({
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
    const operation = await SubscriptionAdminOperation.findById(input.operationKey);
    if (!operation || !operationMatches(operation, input, subscriptionId)) {
      throw fail(409, "OPERATION_KEY_REUSED", "This operation key is already bound to another operation");
    }
    return { operation, replayed: true };
  }
}

async function saveOperation(id, fields) {
  return SubscriptionAdminOperation.findByIdAndUpdate(id, { $set: fields }, { new: true });
}

async function loadPayment(subscriptionId, paymentId) {
  const payment = await Payment.findOne({
    _id: paymentId,
    subscriptionId,
    provider: "moyasar",
    status: "paid",
  });
  if (!payment || !clean(payment.providerPaymentId, 200)) {
    throw fail(409, "PAYMENT_NOT_REFUNDABLE", "Selected payment cannot be refunded through Moyasar");
  }
  return payment;
}

async function acquireRefundLock(payment, operationKey) {
  const locked = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      $or: [
        { "metadata.adminRefundLock": { $exists: false } },
        { "metadata.adminRefundLock": null },
        { "metadata.adminRefundLock.operationKey": operationKey },
      ],
    },
    {
      $set: {
        "metadata.adminRefundLock": {
          operationKey,
          acquiredAt: new Date(),
        },
      },
    },
    { new: true }
  );
  if (!locked) {
    const current = await Payment.findById(payment._id).select("metadata.adminRefundLock").lean();
    throw fail(
      409,
      "REFUND_OPERATION_IN_PROGRESS",
      "Another refund operation is already in progress for this payment. Retry the existing operation first.",
      { lock: current && current.metadata && current.metadata.adminRefundLock || null }
    );
  }
}

async function releaseRefundLock(paymentId, operationKey) {
  await Payment.updateOne(
    { _id: paymentId, "metadata.adminRefundLock.operationKey": operationKey },
    { $unset: { "metadata.adminRefundLock": 1 } }
  );
}

async function establishRefundBaseline({ operation, payment }) {
  const hasProviderBaseline = Number.isSafeInteger(Number(operation.providerRefundedBeforeHalala));
  const hasLocalBaseline = Number.isSafeInteger(Number(operation.recordedRefundedBeforeHalala));
  if (hasProviderBaseline && hasLocalBaseline && Number(operation.requestedAmountHalala || 0) > 0) return operation;

  const [providerSnapshot, localRefunded] = await Promise.all([
    getMoyasarPayment(payment.providerPaymentId),
    sumRecordedRefunds(payment._id),
  ]);
  const providerRefunded = extractRefundedHalala(providerSnapshot);
  if (localRefunded > providerRefunded) {
    throw fail(
      409,
      "REFUND_STATE_MISMATCH",
      "Local refund ledger is ahead of Moyasar. Retry after provider state is synchronized."
    );
  }

  const refundableHalala = Math.max(0, Number(payment.amount || 0) - providerRefunded);
  const requestedAmountHalala = operation.refundMode === "full"
    ? refundableHalala
    : Number(operation.requestedAmountHalala || 0);
  if (!requestedAmountHalala || requestedAmountHalala > refundableHalala) {
    throw fail(409, "REFUND_AMOUNT_EXCEEDS_AVAILABLE", "Refund amount exceeds the available payment balance");
  }

  return saveOperation(operation._id, {
    provider: "moyasar",
    providerPaymentId: payment.providerPaymentId,
    providerRefundedBeforeHalala: providerRefunded,
    recordedRefundedBeforeHalala: localRefunded,
    requestedAmountHalala,
    providerSnapshot: safeProviderSnapshot(providerSnapshot),
    status: "processing",
    lastStep: "refund_baseline_recorded",
    error: null,
  });
}

async function confirmProviderRefund({ operation, payment }) {
  const baseline = Number(operation.providerRefundedBeforeHalala || 0);
  const requested = Number(operation.requestedAmountHalala || 0);
  const target = baseline + requested;

  const current = await getMoyasarPayment(payment.providerPaymentId);
  if (extractRefundedHalala(current) >= target) {
    return saveOperation(operation._id, {
      status: "provider_succeeded",
      providerRefundedAfterHalala: extractRefundedHalala(current),
      providerRefundId: providerRefundId(current) || undefined,
      providerSnapshot: safeProviderSnapshot(current),
      lastStep: "refund_provider_succeeded",
      error: null,
    });
  }

  try {
    const response = await refundMoyasarPayment({
      paymentId: payment.providerPaymentId,
      amountHalala: requested,
    });
    const refundedAfter = extractRefundedHalala(response);
    if (refundedAfter < target) {
      const verified = await getMoyasarPayment(payment.providerPaymentId);
      if (extractRefundedHalala(verified) < target) {
        throw fail(503, "REFUND_PROVIDER_UNCONFIRMED", "Moyasar did not confirm the requested refund amount");
      }
      return saveOperation(operation._id, {
        status: "provider_succeeded",
        providerRefundedAfterHalala: extractRefundedHalala(verified),
        providerRefundId: providerRefundId(verified) || undefined,
        providerSnapshot: safeProviderSnapshot(verified),
        lastStep: "refund_provider_succeeded",
        error: null,
      });
    }
    return saveOperation(operation._id, {
      status: "provider_succeeded",
      providerRefundedAfterHalala: refundedAfter,
      providerRefundId: providerRefundId(response) || undefined,
      providerSnapshot: safeProviderSnapshot(response),
      lastStep: "refund_provider_succeeded",
      error: null,
    });
  } catch (providerError) {
    let verified = null;
    try {
      verified = await getMoyasarPayment(payment.providerPaymentId);
    } catch (_) {
      verified = null;
    }
    if (verified && extractRefundedHalala(verified) >= target) {
      return saveOperation(operation._id, {
        status: "provider_succeeded",
        providerRefundedAfterHalala: extractRefundedHalala(verified),
        providerRefundId: providerRefundId(verified) || undefined,
        providerSnapshot: safeProviderSnapshot(verified),
        lastStep: "refund_provider_recovered",
        error: null,
      });
    }

    const providerStatus = Number(providerError.status || 0);
    const definitiveRejection = providerStatus >= 400 && providerStatus < 500;
    await saveOperation(operation._id, {
      status: definitiveRejection ? "failed" : "needs_review",
      lastStep: "refund_provider_unconfirmed",
      error: {
        code: clean(providerError.code, 100) || "PAYMENT_PROVIDER_ERROR",
        message: clean(providerError.message, 500),
        status: providerStatus || null,
      },
    });
    if (definitiveRejection) await releaseRefundLock(payment._id, String(operation._id));
    throw fail(
      definitiveRejection ? 409 : 503,
      "REFUND_PROVIDER_UNCONFIRMED",
      definitiveRejection
        ? "Moyasar rejected the refund request"
        : "Refund result is uncertain. Retry with the same operation key so the server can reconcile it.",
      { operationKey: String(operation._id) }
    );
  }
}

async function recordRefundLedger({ operation, payment }) {
  if (operation.refundRecorded) return operation;
  const requested = Number(operation.requestedAmountHalala || 0);
  const localBefore = Number(operation.recordedRefundedBeforeHalala || 0);
  const localNow = await sumRecordedRefunds(payment._id);

  if (localNow - localBefore < requested) {
    const idempotencyKey = `admin:${operation._id}`;
    const existing = await PaymentRefund.findOne({ provider: "moyasar", idempotencyKey });
    if (!existing) {
      const vat = calculateVatBreakdownFromInclusiveTotal(requested);
      try {
        await PaymentRefund.create({
          paymentId: payment._id,
          subscriptionId: payment.subscriptionId,
          orderId: payment.orderId,
          provider: "moyasar",
          providerRefundId: operation.providerRefundId || undefined,
          providerPaymentId: payment.providerPaymentId,
          amountHalala: requested,
          vatHalala: vat.vatHalala,
          refundedAt: new Date(),
          status: "confirmed",
          idempotencyKey,
          rawReference: {
            source: "dashboard_superadmin",
            operationKey: String(operation._id),
            reason: operation.reason,
          },
        });
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
    }
  }

  const cumulative = Math.max(
    Number(operation.providerRefundedAfterHalala || 0),
    Number(operation.providerRefundedBeforeHalala || 0) + requested
  );
  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        status: "paid",
        "metadata.providerRefundStatus": cumulative >= Number(payment.amount || 0)
          ? "refunded"
          : "partially_refunded",
        "metadata.providerRefundedHalala": cumulative,
      },
    }
  );

  return saveOperation(operation._id, {
    refundRecorded: true,
    refundedAmountHalala: requested,
    status: "provider_succeeded",
    lastStep: "refund_recorded",
    error: null,
  });
}

async function ensureRefund({ operation, payment }) {
  if (operation.refundRecorded) return operation;
  await acquireRefundLock(payment, String(operation._id));
  operation = await establishRefundBaseline({ operation, payment });
  if (operation.status !== "provider_succeeded") {
    operation = await confirmProviderRefund({ operation, payment });
  }
  return recordRefundLedger({ operation, payment });
}

async function ensureCancellation({ operation, subscriptionId, actorId, actorRole, lang }) {
  if (operation.cancellationApplied) return operation;
  const current = await Subscription.findById(subscriptionId).select("status canceledAt").lean();
  if (!current) throw fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");

  if (current.status !== "canceled") {
    const result = await performCancelSubscriptionAdmin({
      subscriptionId,
      actor: {
        dashboardUserId: actorId,
        dashboardUserRole: actorRole,
      },
      lang: lang || "ar",
      reason: operation.reason,
    });
    if (result.outcome === "not_found") throw fail(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
    if (result.outcome === "invalid_transition") {
      throw fail(409, "SUBSCRIPTION_CANNOT_BE_CANCELED", "Subscription cannot be canceled in its current state");
    }
    if (!["canceled", "already_canceled"].includes(result.outcome)) {
      throw fail(409, "SUBSCRIPTION_CANCELLATION_FAILED", "Subscription cancellation could not be completed");
    }
  }

  return saveOperation(operation._id, {
    cancellationApplied: true,
    lastStep: "subscription_canceled",
    error: null,
  });
}

async function writeCompletionAudit(operation) {
  try {
    await writeLog({
      entityType: "subscription",
      entityId: operation.subscriptionId,
      action: "subscription_financial_control_completed_by_superadmin",
      byUserId: operation.actor && operation.actor.dashboardUserId,
      byRole: operation.actor && operation.actor.role || "superadmin",
      meta: {
        operationKey: String(operation._id),
        type: operation.type,
        paymentId: operation.paymentId ? String(operation.paymentId) : null,
        refundMode: operation.refundMode,
        refundedAmountHalala: Number(operation.refundedAmountHalala || 0),
        cancellationApplied: Boolean(operation.cancellationApplied),
        reason: operation.reason,
        source: "dashboard_superadmin_financial_control",
      },
    });
  } catch (error) {
    logger.error("subscription financial control audit log failed", {
      operationKey: String(operation._id),
      error: error.message,
    });
  }
}

async function executeFinancialControl({
  customerId = null,
  subscriptionId,
  payload,
  actorId,
  actorRole,
  requestMeta,
  lang,
}) {
  if (actorRole !== "superadmin") throw fail(403, "FORBIDDEN", "Only superadmin may perform this operation");
  const input = parseInput(payload || {});
  await resolveSubscription({ customerId, subscriptionId });

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

  let payment = null;
  try {
    if (REFUND_ACTIONS.has(input.action) && !operation.refundRecorded) {
      payment = await loadPayment(subscriptionId, input.paymentId);
      operation = await ensureRefund({ operation, payment });
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

    operation = await saveOperation(operation._id, {
      status: "completed",
      lastStep: "completed",
      error: null,
    });
    if (payment) await releaseRefundLock(payment._id, String(operation._id));
    await writeCompletionAudit(operation);
    return { operation: operation.toObject(), replayed };
  } catch (error) {
    if (error.code !== "REFUND_PROVIDER_UNCONFIRMED") {
      const latest = await SubscriptionAdminOperation.findById(operation._id).lean().catch(() => null);
      const providerSucceeded = latest && (latest.refundRecorded || latest.status === "provider_succeeded");
      await saveOperation(operation._id, {
        status: providerSucceeded ? "needs_review" : "failed",
        lastStep: latest && latest.lastStep || "failed",
        error: {
          code: clean(error.code, 100) || "FINANCIAL_CONTROL_FAILED",
          message: clean(error.message, 500),
          status: Number(error.status || 0) || null,
        },
      }).catch(() => null);
      if (payment && !providerSucceeded) {
        await releaseRefundLock(payment._id, String(operation._id)).catch(() => null);
      }
    }
    error.extra = { ...(error.extra || {}), operationKey: String(operation._id) };
    throw error;
  }
}

module.exports = {
  executeFinancialControl,
  getFinancialControlPreview,
};
