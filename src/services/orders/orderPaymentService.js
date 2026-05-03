const mongoose = require("mongoose");

const Order = require("../../models/Order");
const Payment = require("../../models/Payment");
const ActivityLog = require("../../models/ActivityLog");
const moyasarService = require("../moyasarService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { logger } = require("../../utils/logger");
const { ORDER_STATUSES } = require("../../utils/orderState");

const ORDER_PAYMENT_TYPE = "one_time_order";
const PAID_STATUSES = new Set(["paid"]);
const NON_PAYABLE_ORDER_STATUSES = new Set([ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXPIRED]);
const TERMINAL_PROVIDER_FAILURE_STATUSES = new Set(["failed", "canceled", "expired"]);
const FINAL_PAYMENT_STATUSES = new Set(["paid", "failed", "canceled", "expired", "refunded"]);

function createServiceError(status, code, message, details) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeProviderPaymentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "cancelled" || normalized === "voided") return "canceled";
  if (normalized === "captured") return "paid";
  if (["pending", "authorized", "verified", "on_hold"].includes(normalized)) return "initiated";
  if (["initiated", "paid", "failed", "canceled", "expired", "refunded"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeProviderStatusFromEvent(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("paid")) return "paid";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("cancelled") || normalized.includes("canceled")) return "canceled";
  if (normalized.includes("expired")) return "expired";
  if (normalized.includes("pending") || normalized.includes("initiated")) return "initiated";
  return null;
}

function pickProviderInvoicePayment(providerInvoice, payment) {
  const attempts = Array.isArray(providerInvoice && providerInvoice.payments)
    ? providerInvoice.payments.filter((item) => item && typeof item === "object")
    : [];
  if (!attempts.length) return null;

  if (payment && payment.providerPaymentId) {
    const matched = attempts.find((item) => String(item.id || "") === String(payment.providerPaymentId));
    if (matched) return matched;
  }

  const paidAttempt = attempts.find((item) => normalizeProviderPaymentStatus(item.status) === "paid");
  if (paidAttempt) return paidAttempt;
  return attempts[attempts.length - 1];
}

function getProviderInvoiceStatus(providerInvoice, payment) {
  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice && providerInvoice.status
  );
  return {
    providerPayment,
    providerStatus: normalizedStatus,
    providerPaymentId: providerPayment && providerPayment.id ? String(providerPayment.id) : "",
    providerInvoiceId: providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "",
  };
}

function getOrderAmount(order) {
  const pricing = order && order.pricing ? order.pricing : {};
  const value = pricing.totalHalala !== undefined ? pricing.totalHalala : (pricing.totalPrice !== undefined ? pricing.totalPrice : pricing.total);
  return Number(value);
}

function normalizeCurrency(value) {
  return String(value || "SAR").trim().toUpperCase();
}

function providerAmountMatches(providerInvoice, providerPayment, payment, order) {
  const amount = Number(
    providerPayment && providerPayment.amount !== undefined
      ? providerPayment.amount
      : providerInvoice && providerInvoice.amount
  );
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (payment && Number(payment.amount) !== amount) return false;
  return Number(getOrderAmount(order)) === amount;
}

function providerCurrencyMatches(providerInvoice, providerPayment, payment) {
  const currency = normalizeCurrency(
    providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice && providerInvoice.currency
  );
  return currency === normalizeCurrency(payment && payment.currency);
}

function buildAlreadyPaidPayload(order, payment, { providerInvoice = null, idempotent = true } = {}) {
  return {
    orderId: String(order._id),
    paymentId: payment ? String(payment._id) : (order.paymentId ? String(order.paymentId) : null),
    orderStatus: ORDER_STATUSES.CONFIRMED,
    paymentStatus: "paid",
    applied: true,
    providerInvoiceStatus: providerInvoice ? "paid" : undefined,
    isFinal: true,
    idempotent,
  };
}

function buildResultPayload({ order, payment, providerInvoice = null, providerStatus = null, isFinal = false, applied = false, idempotent = false }) {
  return {
    orderId: String(order._id),
    paymentId: payment ? String(payment._id) : (order.paymentId ? String(order.paymentId) : null),
    orderStatus: order.status,
    paymentStatus: payment && payment.status ? payment.status : order.paymentStatus,
    applied: Boolean(applied || (payment && payment.applied)),
    providerInvoiceStatus: providerStatus,
    isFinal,
    ...(idempotent ? { idempotent: true } : {}),
    ...(order ? { order: order.toObject ? order.toObject() : order } : {}),
  };
}

async function writeOrderLogOnce({ order, payment, action, source, session, meta = {} }) {
  const existing = await ActivityLog.findOne({
    entityType: "order",
    entityId: order._id,
    action,
    "meta.paymentId": String(payment._id),
  }).session(session || null).lean();
  if (existing) return;

  await ActivityLog.create(
    [
      {
        entityType: "order",
        entityId: order._id,
        action,
        byUserId: order.userId,
        byRole: source === "webhook" ? "system" : "client",
        meta: {
          source,
          orderId: String(order._id),
          paymentId: String(payment._id),
          providerInvoiceId: payment.providerInvoiceId || null,
          providerPaymentId: payment.providerPaymentId || null,
          ...meta,
        },
      },
    ],
    { session }
  );
}

async function applyPaidOrderPayment({ order, payment, providerInvoice, source = "verify", session }) {
  const { providerPayment, providerPaymentId, providerInvoiceId } = getProviderInvoiceStatus(providerInvoice, payment);
  const now = new Date();

  if (providerInvoiceId && payment.providerInvoiceId && String(payment.providerInvoiceId) !== providerInvoiceId) {
    throw createServiceError(409, "MISMATCH", "Invoice ID mismatch");
  }
  if (providerPaymentId && payment.providerPaymentId && String(payment.providerPaymentId) !== providerPaymentId) {
    throw createServiceError(409, "MISMATCH", "Payment ID mismatch");
  }
  if (!providerAmountMatches(providerInvoice, providerPayment, payment, order)) {
    throw createServiceError(409, "MISMATCH", "Amount mismatch");
  }
  if (!providerCurrencyMatches(providerInvoice, providerPayment, payment)) {
    throw createServiceError(409, "MISMATCH", "Currency mismatch");
  }

  const claim = await Payment.findOneAndUpdate(
    { _id: payment._id, type: ORDER_PAYMENT_TYPE, applied: false },
    {
      $set: {
        status: "paid",
        applied: true,
        paidAt: payment.paidAt || now,
        ...(providerPaymentId ? { providerPaymentId } : {}),
        ...(providerInvoiceId ? { providerInvoiceId } : {}),
      },
    },
    { new: true, session }
  );

  const latestPayment = claim || await Payment.findById(payment._id).session(session);
  if (latestPayment && latestPayment.status !== "paid") {
    latestPayment.status = "paid";
    latestPayment.applied = true;
    latestPayment.paidAt = latestPayment.paidAt || now;
    if (providerPaymentId && !latestPayment.providerPaymentId) latestPayment.providerPaymentId = providerPaymentId;
    if (providerInvoiceId && !latestPayment.providerInvoiceId) latestPayment.providerInvoiceId = providerInvoiceId;
    await latestPayment.save({ session });
  }

  if (!order.paymentId) order.paymentId = latestPayment._id;
  order.status = ORDER_STATUSES.CONFIRMED;
  order.paymentStatus = "paid";
  order.confirmedAt = order.confirmedAt || now;
  order.expiresAt = null;
  if (latestPayment.providerInvoiceId) order.providerInvoiceId = latestPayment.providerInvoiceId;
  if (latestPayment.providerPaymentId) order.providerPaymentId = latestPayment.providerPaymentId;
  await order.save({ session });

  if (claim) {
    await writeOrderLogOnce({
      order,
      payment: latestPayment,
      action: source === "webhook" ? "order_webhook_confirmed" : "order_payment_confirmed",
      source,
      session,
    });
  }

  return { order, payment: latestPayment, applied: true, idempotent: !claim };
}

async function markOrderPaymentNonPaid({ order, payment, providerStatus, reason, source = "verify", session }) {
  const normalizedStatus = normalizeProviderPaymentStatus(providerStatus);
  if (!normalizedStatus || !TERMINAL_PROVIDER_FAILURE_STATUSES.has(normalizedStatus)) {
    return { order, payment, applied: false };
  }
  if (order.status === ORDER_STATUSES.CONFIRMED || order.paymentStatus === "paid") {
    return { order, payment, applied: false, alreadyConfirmed: true };
  }

  payment.status = normalizedStatus;
  await payment.save({ session });

  if (order.status === ORDER_STATUSES.PENDING_PAYMENT) {
    order.status = normalizedStatus === "expired" ? ORDER_STATUSES.EXPIRED : ORDER_STATUSES.CANCELLED;
    order.paymentStatus = normalizedStatus;
    if (order.status === ORDER_STATUSES.CANCELLED) {
      order.cancelledAt = order.cancelledAt || new Date();
      order.canceledAt = order.canceledAt || order.cancelledAt;
      order.cancellationReason = order.cancellationReason || reason || `payment_${normalizedStatus}`;
    }
    await order.save({ session });
  }

  await writeOrderLogOnce({
    order,
    payment,
    action: normalizedStatus === "expired"
      ? "order_payment_expired"
      : (source === "webhook" ? "order_webhook_failed" : "order_payment_failed"),
    source,
    session,
    meta: { reason: reason || `payment_${normalizedStatus}`, providerStatus: normalizedStatus },
  });

  return { order, payment, applied: false };
}

async function resolveOrderPayment({ orderId, paymentId, userId, session = null }) {
  if (!mongoose.Types.ObjectId.isValid(String(orderId || ""))) {
    throw createServiceError(400, "INVALID_OBJECT_ID", "Invalid orderId");
  }
  if (paymentId && !mongoose.Types.ObjectId.isValid(String(paymentId))) {
    throw createServiceError(400, "INVALID_OBJECT_ID", "Invalid paymentId");
  }

  const orderQuery = Order.findOne({ _id: orderId, userId });
  const order = session ? await orderQuery.session(session) : await orderQuery;
  if (!order) {
    throw createServiceError(404, "NOT_FOUND", "Order not found");
  }

  if (paymentId && order.paymentId && String(order.paymentId) !== String(paymentId)) {
    throw createServiceError(409, "MISMATCH", "Payment ID mismatch");
  }

  let payment = null;
  if (paymentId) {
    const paymentQuery = Payment.findOne({ _id: paymentId, userId, provider: "moyasar" });
    payment = session ? await paymentQuery.session(session) : await paymentQuery;
  } else if (order.paymentId) {
    const paymentQuery = Payment.findOne({ _id: order.paymentId, userId, provider: "moyasar" });
    payment = session ? await paymentQuery.session(session) : await paymentQuery;
  }
  if (!payment) {
    const paymentQuery = Payment.findOne({ orderId: order._id, userId, provider: "moyasar", type: ORDER_PAYMENT_TYPE }).sort({ createdAt: -1 });
    payment = session ? await paymentQuery.session(session) : await paymentQuery;
  }
  if (!payment) {
    throw createServiceError(404, "NOT_FOUND", "Payment not found");
  }

  if (payment.type !== ORDER_PAYMENT_TYPE) {
    throw createServiceError(409, "MISMATCH", "Payment does not belong to a one-time order");
  }
  if (String(payment.orderId || "") !== String(order._id)) {
    throw createServiceError(409, "MISMATCH", "Payment does not belong to this order");
  }
  if (paymentId && String(payment._id) !== String(paymentId)) {
    throw createServiceError(409, "MISMATCH", "Payment ID mismatch");
  }

  return { order, payment };
}

async function verifyOrderPayment({ orderId, paymentId, userId, providerPaymentId, providerInvoiceId }) {
  const existing = await resolveOrderPayment({ orderId, paymentId, userId });
  const { order, payment } = existing;

  if (order.status === ORDER_STATUSES.CONFIRMED || (order.status !== ORDER_STATUSES.PENDING_PAYMENT && PAID_STATUSES.has(payment.status))) {
    return buildAlreadyPaidPayload(order, payment, { idempotent: true });
  }

  if (NON_PAYABLE_ORDER_STATUSES.has(order.status) && payment.status !== "paid") {
    throw createServiceError(409, "ORDER_NOT_PAYABLE", "Order is not payable");
  }

  if (providerPaymentId && payment.providerPaymentId && String(payment.providerPaymentId) !== String(providerPaymentId)) {
    throw createServiceError(409, "MISMATCH", "Payment ID mismatch");
  }

  const invoiceId = String(order.providerInvoiceId || payment.providerInvoiceId || providerInvoiceId || "").trim();
  if (!invoiceId) {
    throw createServiceError(409, "CHECKOUT_IN_PROGRESS", "Checkout invoice is not initialized yet");
  }
  if (providerInvoiceId && (order.providerInvoiceId || payment.providerInvoiceId) && String(order.providerInvoiceId || payment.providerInvoiceId) !== String(providerInvoiceId)) {
    throw createServiceError(409, "MISMATCH", "Invoice ID mismatch");
  }

  let providerInvoice;
  try {
    providerInvoice = await moyasarService.getInvoice(invoiceId);
  } catch (err) {
    logger.error("orderPaymentService.verifyOrderPayment provider fetch failed", {
      orderId: String(order._id),
      paymentId: String(payment._id),
      invoiceId,
      error: err.message,
    });
    if (err.code === "CONFIG") {
      throw createServiceError(500, "CONFIG", err.message);
    }
    throw createServiceError(502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const { providerPayment, providerStatus, providerPaymentId: invoicePaymentId, providerInvoiceId: invoiceProviderId } = getProviderInvoiceStatus(providerInvoice, payment);
  if (!providerStatus) {
    throw createServiceError(502, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }
  if (invoiceProviderId && String(invoiceProviderId) !== invoiceId) {
    throw createServiceError(409, "MISMATCH", "Invoice ID mismatch");
  }
  if (providerPaymentId && invoicePaymentId && String(providerPaymentId) !== String(invoicePaymentId)) {
    throw createServiceError(409, "MISMATCH", "Payment ID mismatch");
  }
  if (!providerAmountMatches(providerInvoice, providerPayment, payment, order)) {
    throw createServiceError(409, "MISMATCH", "Amount mismatch");
  }
  if (!providerCurrencyMatches(providerInvoice, providerPayment, payment)) {
    throw createServiceError(409, "MISMATCH", "Currency mismatch");
  }

  if (providerStatus === "paid") {
    const result = await runMongoTransactionWithRetry(async (session) => {
      const { order: orderInSession, payment: paymentInSession } = await resolveOrderPayment({
        orderId,
        paymentId: payment._id,
        userId,
        session,
      });
      return applyPaidOrderPayment({
        order: orderInSession,
        payment: paymentInSession,
        providerInvoice,
        source: "verify",
        session,
      });
    }, {
      label: "order_payment_verify",
      context: { orderId: String(order._id), paymentId: String(payment._id) },
    });

    return buildResultPayload({
      order: result.order,
      payment: result.payment,
      providerInvoice,
      providerStatus,
      isFinal: true,
      applied: true,
      idempotent: result.idempotent,
    });
  }

  if (providerStatus === "initiated") {
    if (payment.status !== "initiated" && !FINAL_PAYMENT_STATUSES.has(payment.status)) {
      payment.status = "initiated";
      await payment.save();
    }
    return buildResultPayload({ order, payment, providerInvoice, providerStatus: "pending", isFinal: false });
  }

  if (TERMINAL_PROVIDER_FAILURE_STATUSES.has(providerStatus)) {
    const result = await runMongoTransactionWithRetry(async (session) => {
      const { order: orderInSession, payment: paymentInSession } = await resolveOrderPayment({
        orderId,
        paymentId: payment._id,
        userId,
        session,
      });
      return markOrderPaymentNonPaid({
        order: orderInSession,
        payment: paymentInSession,
        providerStatus,
        reason: `payment_${providerStatus}`,
        source: "verify",
        session,
      });
    }, {
      label: "order_payment_verify_non_paid",
      context: { orderId: String(order._id), paymentId: String(payment._id), providerStatus },
    });

    const errorCode = providerStatus === "expired" ? "PAYMENT_EXPIRED" : "PAYMENT_FAILED";
    throw createServiceError(providerStatus === "expired" ? 409 : 402, errorCode, `Payment ${providerStatus}`, {
      orderId: String(result.order._id),
      paymentId: String(result.payment._id),
      orderStatus: result.order.status,
      paymentStatus: result.payment.status,
      providerInvoiceStatus: providerStatus,
      isFinal: true,
    });
  }

  throw createServiceError(502, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
}

async function findOrderPaymentForWebhook({ providerInvoice, eventType }) {
  const data = providerInvoice || {};
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};
  const paymentId = data.id || data.payment_id || data.paymentId || "";
  const invoiceId = data.invoice_id || data.invoiceId || data.id || "";
  const metadataPaymentId = metadata.paymentId || "";
  const metadataOrderId = metadata.orderId || "";

  const or = [
    paymentId ? { providerPaymentId: String(paymentId) } : null,
    invoiceId ? { providerInvoiceId: String(invoiceId) } : null,
    metadataPaymentId && mongoose.Types.ObjectId.isValid(String(metadataPaymentId)) ? { _id: metadataPaymentId } : null,
    metadataOrderId && mongoose.Types.ObjectId.isValid(String(metadataOrderId)) ? { orderId: metadataOrderId, type: ORDER_PAYMENT_TYPE } : null,
  ].filter(Boolean);

  if (!or.length) return null;
  const payment = await Payment.findOne({ provider: "moyasar", $or: or }).sort({ createdAt: -1 });
  if (!payment) return null;

  const isOrderMetadata = metadata.source === ORDER_PAYMENT_TYPE
    || metadata.type === ORDER_PAYMENT_TYPE
    || Boolean(metadata.orderId);
  if (payment.type !== ORDER_PAYMENT_TYPE && !isOrderMetadata) return null;
  return payment;
}

async function applyOrderWebhookInvoice({ providerInvoice, eventType }) {
  const payment = await findOrderPaymentForWebhook({ providerInvoice, eventType });
  if (!payment || payment.type !== ORDER_PAYMENT_TYPE) {
    return { handled: false };
  }

  const statusInfo = getProviderInvoiceStatus(providerInvoice, payment);
  const providerStatus = statusInfo.providerStatus || normalizeProviderStatusFromEvent(eventType);
  if (!providerStatus) {
    return { handled: true, ignored: true, reason: "unknown_event_type" };
  }

  const order = await Order.findById(payment.orderId);
  if (!order) {
    return { handled: true, ignored: true, reason: "order_not_found" };
  }
  if (providerInvoice.amount !== undefined && !providerAmountMatches(providerInvoice, statusInfo.providerPayment, payment, order)) {
    throw createServiceError(409, "MISMATCH", "Amount mismatch");
  }
  if (providerInvoice.currency && !providerCurrencyMatches(providerInvoice, statusInfo.providerPayment, payment)) {
    throw createServiceError(409, "MISMATCH", "Currency mismatch");
  }

  if (payment.applied === true && payment.status === "paid" && providerStatus === "paid") {
    return { handled: true, alreadyProcessed: true };
  }

  if (providerStatus === "paid") {
    const result = await runMongoTransactionWithRetry(async (session) => {
      const paymentInSession = await Payment.findById(payment._id).session(session);
      const orderInSession = await Order.findById(payment.orderId).session(session);
      if (!paymentInSession || !orderInSession) return { alreadyProcessed: true };
      if (paymentInSession.applied === true && paymentInSession.status === "paid") {
        return { order: orderInSession, payment: paymentInSession, alreadyProcessed: true };
      }
      return applyPaidOrderPayment({
        order: orderInSession,
        payment: paymentInSession,
        providerInvoice,
        source: "webhook",
        session,
      });
    }, {
      label: "order_payment_webhook_paid",
      context: { paymentId: String(payment._id), eventType: eventType || null },
    });
    return { handled: true, ...result };
  }

  if (TERMINAL_PROVIDER_FAILURE_STATUSES.has(providerStatus)) {
    const result = await runMongoTransactionWithRetry(async (session) => {
      const paymentInSession = await Payment.findById(payment._id).session(session);
      const orderInSession = paymentInSession && paymentInSession.orderId
        ? await Order.findById(paymentInSession.orderId).session(session)
        : null;
      if (!paymentInSession || !orderInSession) return { ignored: true };
      if (orderInSession.status === ORDER_STATUSES.CONFIRMED || orderInSession.paymentStatus === "paid") {
        return { order: orderInSession, payment: paymentInSession, alreadyConfirmed: true };
      }
      return markOrderPaymentNonPaid({
        order: orderInSession,
        payment: paymentInSession,
        providerStatus,
        reason: `webhook_${providerStatus}`,
        source: "webhook",
        session,
      });
    }, {
      label: "order_payment_webhook_non_paid",
      context: { paymentId: String(payment._id), eventType: eventType || null, providerStatus },
    });
    return { handled: true, ...result };
  }

  return { handled: true, ignored: true, reason: "non_terminal_status" };
}

module.exports = {
  ORDER_PAYMENT_TYPE,
  normalizeProviderPaymentStatus,
  pickProviderInvoicePayment,
  verifyOrderPayment,
  applyPaidOrderPayment,
  markOrderPaymentNonPaid,
  applyOrderWebhookInvoice,
};
