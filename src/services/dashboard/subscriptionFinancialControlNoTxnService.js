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
const { getCustomerManagementProfile } = require("./customerManagementService");

const ACTIONS = new Set(["cancel", "refund", "cancel_and_refund"]);
const REFUND_ACTIONS = new Set(["refund", "cancel_and_refund"]);
const REFUND_MODES = new Set(["full", "partial"]);
const REFUND_CHANNELS = new Set(["moyasar", "payment_gateway", "cash", "bank_transfer"]);
const REFUND_LOCK_TTL_MS = 5 * 60 * 1000;

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

async function sumRecognizedRefunds(paymentId) {
  const rows = await PaymentRefund.aggregate([
    {
      $match: {
        paymentId: new mongoose.Types.ObjectId(String(paymentId)),
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
    status: "paid",
    amount: { $gt: 0 },
  }).sort({ paidAt: -1, createdAt: -1 }).lean();

  return Promise.all(payments.map(async (payment) => {
    const recognizedRefundedHalala = await sumRecognizedRefunds(payment._id);
    const amountHalala = Math.max(0, Number(payment.amount || 0));
    return {
      paymentId: String(payment._id),
      providerPaymentId: clean(payment.providerPaymentId, 200) || null,
      provider: payment.provider || null,
      method: payment.method || null,
      source: payment.source || null,
      amountHalala,
      recordedRefundedHalala: recognizedRefundedHalala,
      refundableHalala: Math.max(0, amountHalala - recognizedRefundedHalala),
      paidAt: payment.paidAt || payment.createdAt || null,
      currency: payment.currency || "SAR",
    };
  }));
}

function serializeRefund(row) {
  const settlement = row && row.settlement || {};
  const inferredSettled = row && row.executionMode !== "recorded_only";
  return {
    id: String(row._id),
    paymentId: row.paymentId ? String(row.paymentId) : null,
    amountHalala: Number(row.amountHalala || 0),
    vatHalala: Number(row.vatHalala || 0),
    status: row.status,
    executionMode: row.executionMode || (row.provider === "moyasar" ? "provider_confirmed" : null),
    refundChannel: row.refundChannel || (row.provider === "moyasar" ? "moyasar" : null),
    recordedAt: row.refundedAt || row.createdAt || null,
    reason: row.rawReference && row.rawReference.reason || "",
    settlement: {
      status: settlement.status || (inferredSettled ? "settled" : "pending"),
      method: settlement.method || row.refundChannel || (row.provider === "moyasar" ? "moyasar" : null),
      settledAmountHalala: inferredSettled
        ? Number(row.amountHalala || 0)
        : Number(settlement.settledAmountHalala || 0),
      settledAt: settlement.settledAt || (inferredSettled ? row.refundedAt || row.createdAt || null : null),
      reference: settlement.reference || null,
      note: settlement.note || null,
      providerConfirmedHalala: Number(settlement.providerConfirmedHalala || 0),
    },
  };
}

async function listRefundRecords(subscriptionId) {
  const rows = await PaymentRefund.find({
    subscriptionId,
    status: { $in: ["confirmed", "needs_review"] },
  }).sort({ createdAt: -1 }).lean();
  return rows.map(serializeRefund);
}

async function getFinancialControlPreview({ customerId = null, subscriptionId }) {
  const subscription = await resolveSubscription({ customerId, subscriptionId });
  const [payments, refunds] = await Promise.all([
    listRefundablePayments(subscription._id),
    listRefundRecords(subscription._id),
  ]);
  return {
    subscription: {
      id: String(subscription._id),
      displayId: `SUB-${String(subscription._id).slice(-6).toUpperCase()}`,
      status: subscription.status,
      canceledAt: subscription.canceledAt || null,
      cancellationReason: subscription.cancellationReason || "",
    },
    canCancel: ["active", "pending_payment"].includes(String(subscription.status || "")),
    accountingOnly: true,
    moneyMovementEnabled: false,
    refundChannels: [...REFUND_CHANNELS],
    payments,
    refunds,
    totalRefundableHalala: payments.reduce((sum, payment) => sum + payment.refundableHalala, 0),
    pendingSettlementHalala: refunds
      .filter((refund) => refund.executionMode === "recorded_only" && refund.settlement.status !== "settled")
      .reduce((sum, refund) => sum + Math.max(0, refund.amountHalala - refund.settlement.settledAmountHalala), 0),
  };
}

function parseInput(payload = {}) {
  const action = clean(payload.action, 40).toLowerCase();
  const operationKey = clean(payload.operationKey, 120);
  const reason = clean(payload.reason, 500);
  const note = clean(payload.note, 1000);
  const refundMode = clean(payload.refundMode, 20).toLowerCase();
  const refundChannel = clean(payload.refundChannel, 40).toLowerCase();
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
    if (!REFUND_CHANNELS.has(refundChannel)) {
      throw fail(400, "REFUND_CHANNEL_REQUIRED", "A valid refund channel is required");
    }
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
    refundChannel: REFUND_ACTIONS.has(action) ? refundChannel : "none",
    paymentId: REFUND_ACTIONS.has(action) ? paymentId : "",
    amountHalala: refundMode === "partial" ? amountHalala : 0,
  };
}

function operationMatches(operation, input, subscriptionId) {
  if (String(operation.subscriptionId) !== String(subscriptionId)) return false;
  if (operation.type !== input.action) return false;
  if (String(operation.refundMode || "none") !== input.refundMode) return false;
  if (String(operation.refundChannel || "none") !== input.refundChannel) return false;
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
      refundChannel: input.refundChannel,
      requestedAmountHalala: input.amountHalala,
      reason: input.reason,
      note: input.note || undefined,
      accountingOnly: true,
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
    status: "paid",
  });
  if (!payment) throw fail(409, "PAYMENT_NOT_REFUNDABLE", "Selected payment is not available for accounting refund");
  return payment;
}

async function acquireRefundLock(payment, operationKey) {
  const staleBefore = new Date(Date.now() - REFUND_LOCK_TTL_MS);
  const locked = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
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
  if (!locked) {
    throw fail(409, "REFUND_RECORD_IN_PROGRESS", "Another accounting refund is being recorded for this payment");
  }
}

async function releaseRefundLock(paymentId, operationKey) {
  await Payment.updateOne(
    { _id: paymentId, "metadata.accountingRefundRecordLock.operationKey": operationKey },
    { $unset: { "metadata.accountingRefundRecordLock": 1 } }
  );
}

async function prepareAccountingRefund({ operation, payment }) {
  if (operation.refundRecorded) return operation;

  const existing = await PaymentRefund.findOne({
    provider: "none",
    idempotencyKey: `admin:${operation._id}`,
  });
  if (existing) {
    return saveOperation(operation._id, {
      refundId: existing._id,
      refundRecorded: true,
      refundedAmountHalala: Number(existing.amountHalala || 0),
      requestedAmountHalala: Number(existing.amountHalala || 0),
      lastStep: "accounting_refund_recorded",
      error: null,
    });
  }

  const recognizedBefore = await sumRecognizedRefunds(payment._id);
  const refundableHalala = Math.max(0, Number(payment.amount || 0) - recognizedBefore);
  const requestedAmountHalala = operation.refundMode === "full"
    ? refundableHalala
    : Number(operation.requestedAmountHalala || 0);

  if (!requestedAmountHalala || requestedAmountHalala > refundableHalala) {
    throw fail(409, "REFUND_AMOUNT_EXCEEDS_AVAILABLE", "Refund amount exceeds the available accounting balance");
  }

  return saveOperation(operation._id, {
    recordedRefundedBeforeHalala: recognizedBefore,
    requestedAmountHalala,
    status: "processing",
    lastStep: "accounting_refund_prepared",
    error: null,
  });
}

async function recordAccountingRefund({ operation, payment }) {
  if (operation.refundRecorded) return operation;
  const requested = Number(operation.requestedAmountHalala || 0);
  const idempotencyKey = `admin:${operation._id}`;
  let refund = await PaymentRefund.findOne({ provider: "none", idempotencyKey });

  if (!refund) {
    const vat = calculateVatBreakdownFromInclusiveTotal(requested);
    try {
      refund = await PaymentRefund.create({
        paymentId: payment._id,
        subscriptionId: payment.subscriptionId,
        orderId: payment.orderId,
        provider: "none",
        amountHalala: requested,
        vatHalala: vat.vatHalala,
        refundedAt: new Date(),
        status: "confirmed",
        idempotencyKey,
        executionMode: "recorded_only",
        refundChannel: operation.refundChannel,
        settlement: {
          status: "pending",
          method: operation.refundChannel,
          settledAmountHalala: 0,
          providerConfirmedHalala: 0,
          source: "dashboard_superadmin_accounting_record",
        },
        rawReference: {
          source: "dashboard_superadmin",
          accountingOnly: true,
          moneyMovementPerformed: false,
          operationKey: String(operation._id),
          reason: operation.reason,
          note: operation.note || null,
        },
      });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      refund = await PaymentRefund.findOne({ provider: "none", idempotencyKey });
    }
  }

  const recognizedAfter = await sumRecognizedRefunds(payment._id);
  await Payment.updateOne(
    { _id: payment._id },
    {
      $set: {
        status: "paid",
        "metadata.accountingRefundedHalala": recognizedAfter,
        "metadata.accountingRefundStatus": recognizedAfter >= Number(payment.amount || 0)
          ? "refunded"
          : "partially_refunded",
      },
    }
  );

  return saveOperation(operation._id, {
    refundId: refund && refund._id,
    refundRecorded: true,
    refundedAmountHalala: requested,
    status: "processing",
    lastStep: "accounting_refund_recorded",
    error: null,
  });
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
        refundId: operation.refundId ? String(operation.refundId) : null,
        refundMode: operation.refundMode,
        refundChannel: operation.refundChannel,
        refundedAmountHalala: Number(operation.refundedAmountHalala || 0),
        cancellationApplied: Boolean(operation.cancellationApplied),
        accountingOnly: true,
        moneyMovementPerformed: false,
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
  if (operation.status === "completed") return { operation: operation.toObject(), replayed: true };

  let payment = null;
  let lockHeld = false;
  try {
    if (REFUND_ACTIONS.has(input.action) && !operation.refundRecorded) {
      payment = await loadPayment(subscriptionId, input.paymentId);
      await acquireRefundLock(payment, String(operation._id));
      lockHeld = true;
      operation = await prepareAccountingRefund({ operation, payment });
    }

    // Combined action cancels first. If cancellation is not allowed, no new
    // accounting refund row is created.
    if ((input.action === "cancel" || input.action === "cancel_and_refund") && !operation.cancellationApplied) {
      operation = await ensureCancellation({ operation, subscriptionId, actorId, actorRole, lang });
    }

    if (REFUND_ACTIONS.has(input.action) && !operation.refundRecorded) {
      operation = await recordAccountingRefund({ operation, payment });
    }

    operation = await saveOperation(operation._id, {
      status: "completed",
      lastStep: "completed",
      error: null,
    });
    await writeCompletionAudit(operation);
    return { operation: operation.toObject(), replayed };
  } catch (error) {
    const latest = await SubscriptionAdminOperation.findById(operation._id).lean().catch(() => null);
    await saveOperation(operation._id, {
      status: latest && (latest.refundRecorded || latest.cancellationApplied) ? "needs_review" : "failed",
      lastStep: latest && latest.lastStep || "failed",
      error: {
        code: clean(error.code, 100) || "FINANCIAL_CONTROL_FAILED",
        message: clean(error.message, 500),
        status: Number(error.status || 0) || null,
      },
    }).catch(() => null);
    error.extra = { ...(error.extra || {}), operationKey: String(operation._id) };
    throw error;
  } finally {
    if (payment && lockHeld) {
      await releaseRefundLock(payment._id, String(operation._id)).catch(() => null);
    }
  }
}

async function settleRecordedRefund({
  subscriptionId,
  refundId,
  payload,
  actorId,
  actorRole,
}) {
  if (actorRole !== "superadmin") throw fail(403, "FORBIDDEN", "Only superadmin may settle refunds");
  await resolveSubscription({ subscriptionId });
  if (!mongoose.Types.ObjectId.isValid(refundId)) throw fail(400, "INVALID_REFUND_ID", "Refund id is invalid");

  const method = clean(payload && payload.method, 40).toLowerCase();
  const reference = clean(payload && payload.reference, 200);
  const note = clean(payload && payload.note, 500);
  if (!REFUND_CHANNELS.has(method)) throw fail(400, "REFUND_CHANNEL_REQUIRED", "A valid settlement method is required");

  const current = await PaymentRefund.findOne({ _id: refundId, subscriptionId });
  if (!current) throw fail(404, "REFUND_NOT_FOUND", "Refund record not found");
  if (current.executionMode !== "recorded_only") {
    throw fail(409, "REFUND_ALREADY_PROVIDER_CONFIRMED", "This refund was already confirmed by a provider");
  }
  if (current.settlement && current.settlement.status === "settled") {
    return { refund: serializeRefund(current.toObject()), replayed: true };
  }

  const settledAt = new Date();
  const updated = await PaymentRefund.findOneAndUpdate(
    {
      _id: current._id,
      subscriptionId,
      executionMode: "recorded_only",
      "settlement.status": { $ne: "settled" },
    },
    {
      $set: {
        "settlement.status": "settled",
        "settlement.method": method,
        "settlement.settledAmountHalala": Number(current.amountHalala || 0),
        "settlement.settledAt": settledAt,
        "settlement.reference": reference || undefined,
        "settlement.note": note || undefined,
        "settlement.byDashboardUserId": actorId,
        "settlement.source": "dashboard_manual_confirmation",
      },
    },
    { new: true }
  );

  if (!updated) {
    const replay = await PaymentRefund.findById(current._id);
    if (replay && replay.settlement && replay.settlement.status === "settled") {
      return { refund: serializeRefund(replay.toObject()), replayed: true };
    }
    throw fail(409, "REFUND_SETTLEMENT_CONFLICT", "Refund settlement changed; refresh and try again");
  }

  try {
    await writeLog({
      entityType: "subscription",
      entityId: subscriptionId,
      action: "accounting_refund_marked_settled_by_superadmin",
      byUserId: actorId,
      byRole: actorRole,
      meta: {
        refundId: String(updated._id),
        paymentId: updated.paymentId ? String(updated.paymentId) : null,
        amountHalala: Number(updated.amountHalala || 0),
        plannedChannel: updated.refundChannel || null,
        actualMethod: method,
        reference: reference || null,
        moneyMovementPerformedBySystem: false,
      },
    });
  } catch (error) {
    logger.error("refund settlement audit log failed", { refundId: String(updated._id), error: error.message });
  }

  return { refund: serializeRefund(updated.toObject()), replayed: false };
}

module.exports = {
  executeFinancialControl,
  getFinancialControlPreview,
  settleRecordedRefund,
};
