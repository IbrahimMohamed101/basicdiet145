const mongoose = require("mongoose");
const { startSafeSession } = require("../utils/mongoTransactionSupport");
const crypto = require("crypto");
const { addDays } = require("date-fns");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const CheckoutDraft = require("../models/CheckoutDraft");
const Payment = require("../models/Payment");
const Plan = require("../models/Plan");
const Order = require("../models/Order");
const { notifyOrderUser } = require("../services/orderNotificationService");
const {
  applyPaymentSideEffects,
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
} = require("../services/paymentApplicationService");
const { applyOrderWebhookInvoice } = require("../services/orders/orderPaymentService");
const { releasePromoCodeUsageReservation } = require("../services/promoCodeService");
const { runMongoTransactionWithRetry } = require("../services/mongoTransactionRetryService");
const moyasarService = require("../services/moyasarService");
const {
  isMoyasarRefundEvent,
  recordMoyasarRefundWebhook,
} = require("../services/paymentRefundService");
const {
  cleanupTerminalNonPaidDayPayment,
} = require("../services/subscription/subscriptionDayPaymentLifecycleService");
const { writeLog } = require("../utils/log");
const { logger } = require("../utils/logger");
const { toKSADateString } = require("../utils/date");
const { isPhase1SharedPaymentDispatcherEnabled } = require("../utils/featureFlags");
const errorResponse = require("../utils/errorResponse");

function normalizePaymentStatus(payload, eventType) {
  if (payload && payload.status) {
    const normalizedPayloadStatus = String(payload.status).toLowerCase();
    if (normalizedPayloadStatus === "cancelled") return "canceled";
    if (["initiated", "paid", "failed", "canceled", "expired", "refunded"].includes(normalizedPayloadStatus)) {
      return normalizedPayloadStatus;
    }
  }
  if (!eventType) return undefined;
  const normalized = String(eventType).toLowerCase();
  if (normalized.includes("paid")) return "paid";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("canceled") || normalized.includes("cancelled")) return "canceled";
  if (normalized.includes("expired")) return "expired";
  return undefined;
}

function redactId(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function pickInvoicePayment(invoice) {
  const attempts = Array.isArray(invoice && invoice.payments)
    ? invoice.payments.filter((item) => item && typeof item === "object")
    : [];
  if (!attempts.length) return null;

  const paidAttempts = attempts.filter(
    (item) => normalizePaymentStatus(item, null) === "paid"
  );
  return paidAttempts.length ? paidAttempts[paidAttempts.length - 1] : attempts[attempts.length - 1];
}

function isInvoiceCallbackPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (payload.type || payload.event || payload.secret_token || payload.data || payload.payment) return false;
  const invoiceId = String(payload.id || payload.invoice_id || payload.invoiceId || "").trim();
  return Boolean(
    invoiceId
    && invoiceId.length <= 200
    && normalizePaymentStatus(payload, null) === "paid"
    && Array.isArray(payload.payments)
  );
}

function normalizeMoyasarPayload(payload, { verifiedInvoiceCallback = false } = {}) {
  const eventType = payload.type || payload.event;
  const data = payload.data || payload.payment || payload;
  const isInvoiceObject = verifiedInvoiceCallback || Array.isArray(data && data.payments);
  const invoicePayment = isInvoiceObject ? pickInvoicePayment(data) : null;
  const metadata = data && data.metadata && typeof data.metadata === "object"
    ? data.metadata
    : invoicePayment && invoicePayment.metadata && typeof invoicePayment.metadata === "object"
      ? invoicePayment.metadata
      : {};

  return {
    eventType,
    data,
    metadata,
    paymentStatus: normalizePaymentStatus(
      invoicePayment && invoicePayment.status ? invoicePayment : data,
      eventType
    ),
    paymentId: invoicePayment && invoicePayment.id
      ? String(invoicePayment.id)
      : isInvoiceObject
        ? undefined
        : data && data.id,
    invoiceId: isInvoiceObject
      ? data && (data.id || data.invoice_id || data.invoiceId)
      : data && (data.invoice_id || data.invoiceId),
  };
}

async function handleMoyasarWebhook(req, res, runtimeOverrides = null) {
  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => startSafeSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;
  const writeLogFn = runtimeOverrides && runtimeOverrides.writeLog
    ? runtimeOverrides.writeLog
    : writeLog;
  const notifyOrderUserFn = runtimeOverrides && runtimeOverrides.notifyOrderUser
    ? runtimeOverrides.notifyOrderUser
    : notifyOrderUser;
  const isSharedPaymentDispatcherEnabledFn = runtimeOverrides && runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    ? runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    : isPhase1SharedPaymentDispatcherEnabled;
  const supportedSharedPaymentTypes = runtimeOverrides && runtimeOverrides.supportedPaymentTypes
    ? runtimeOverrides.supportedPaymentTypes
    : SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES;
  const recordMoyasarRefundWebhookFn = runtimeOverrides && runtimeOverrides.recordMoyasarRefundWebhook
    ? runtimeOverrides.recordMoyasarRefundWebhook
    : recordMoyasarRefundWebhook;
  const getInvoiceFn = runtimeOverrides && runtimeOverrides.getInvoice
    ? runtimeOverrides.getInvoice
    : moyasarService.getInvoice;
  const applyOrderWebhookInvoiceFn = runtimeOverrides && runtimeOverrides.applyOrderWebhookInvoice
    ? runtimeOverrides.applyOrderWebhookInvoice
    : applyOrderWebhookInvoice;

  let payload = req.body || {};
  let normalizedPayload = normalizeMoyasarPayload(payload);
  let verifiedInvoiceCallback = false;

  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  const allowedWebhookIPs = process.env.MOYASAR_WEBHOOK_ALLOWED_IPS ? 
    process.env.MOYASAR_WEBHOOK_ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];
  
  // SUPPORTED: Header-based secret OR existing payload secret token
  const receivedHeaderSecret = String(req.headers["x-webhook-secret"] || "");
  const receivedBodySecret = String(payload.secret_token || "");
  
  let validSecret = false;
  if (secret) {
    const secretBuffer = Buffer.from(secret);
    
    // Check Header if present
    if (receivedHeaderSecret && Buffer.from(receivedHeaderSecret).length === secretBuffer.length) {
      if (crypto.timingSafeEqual(Buffer.from(receivedHeaderSecret), secretBuffer)) {
        validSecret = true;
      }
    }
    
    // Check Body if header missed or wasn't there
    if (!validSecret && receivedBodySecret && Buffer.from(receivedBodySecret).length === secretBuffer.length) {
      if (crypto.timingSafeEqual(Buffer.from(receivedBodySecret), secretBuffer)) {
        validSecret = true;
      }
    }
  }

  // Moyasar invoice callback_url posts an invoice object directly and does not
  // include the account-webhook secret token. Authenticate that distinct
  // contract by fetching the invoice from Moyasar and only use the provider's
  // authoritative response for all payment processing.
  if (!secret || !validSecret) {
    if (isInvoiceCallbackPayload(payload)) {
      const callbackInvoiceId = String(payload.id || payload.invoice_id || payload.invoiceId).trim();
      try {
        const verifiedInvoice = await getInvoiceFn(callbackInvoiceId);
        if (!verifiedInvoice || String(verifiedInvoice.id || "") !== callbackInvoiceId) {
          const mismatchError = new Error("Moyasar invoice verification returned a different invoice");
          mismatchError.code = "PAYMENT_PROVIDER_MISMATCH";
          mismatchError.status = 409;
          throw mismatchError;
        }
        payload = verifiedInvoice;
        normalizedPayload = normalizeMoyasarPayload(payload, { verifiedInvoiceCallback: true });
        if (normalizedPayload.paymentStatus !== "paid") {
          const statusError = new Error("Moyasar invoice callback is not paid");
          statusError.code = "PAYMENT_PROVIDER_STATUS_MISMATCH";
          statusError.status = 409;
          throw statusError;
        }
        verifiedInvoiceCallback = true;
      } catch (err) {
        logger.warn("Moyasar invoice callback verification failed", {
          invoiceId: redactId(callbackInvoiceId),
          code: err.code || null,
          error: err.message,
        });
        return errorResponse(
          res,
          err.status === 404 ? 404 : err.status === 409 ? 409 : 502,
          err.code || "PAYMENT_PROVIDER_ERROR",
          "Unable to verify invoice callback"
        );
      }
    } else {
      logger.warn("Moyasar webhook rejected: invalid token", {
        eventType: normalizedPayload.eventType || null,
        paymentStatus: normalizedPayload.paymentStatus || null,
        paymentId: redactId(normalizedPayload.paymentId),
        invoiceId: redactId(normalizedPayload.invoiceId),
        hasSecretToken: Boolean(payload.secret_token),
        hasConfiguredSecret: Boolean(secret),
        hasHeaderSecret: Boolean(receivedHeaderSecret),
      });
      return errorResponse(res, 401, "UNAUTHORIZED", "Invalid webhook token" );
    }
  }

  const {
    eventType,
    data,
    metadata,
    paymentStatus,
    paymentId,
    invoiceId,
  } = normalizedPayload;
  const isPaid = paymentStatus === "paid";
  const metadataOrderId = metadata.orderId;
  const logContext = {
    eventType: eventType || null,
    paymentStatus: paymentStatus || null,
    paymentId: redactId(paymentId),
    invoiceId: redactId(invoiceId),
    hasSecretToken: Boolean(req.body && req.body.secret_token),
    authentication: verifiedInvoiceCallback ? "provider_invoice_fetch" : "webhook_secret",
  };

  // SECURITY FIX: IP whitelist validation for webhooks
  if (!verifiedInvoiceCallback && allowedWebhookIPs.length > 0) {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]?.trim();
    if (!clientIP || !allowedWebhookIPs.includes(clientIP)) {
      logger.warn("Moyasar webhook rejected: IP not allowed", {
        ...logContext,
        clientIP: clientIP || 'unknown',
        allowedIPs: allowedWebhookIPs,
      });
      return errorResponse(res, 403, "FORBIDDEN", "IP not allowed" );
    }
  }

  if (!paymentId && !invoiceId && !metadataOrderId) {
    if (!paymentStatus) {
      logger.info("Moyasar webhook ignored: unknown event without payment identifiers", logContext);
      return res.status(200).json({ status: true, ignored: true });
    }
    logger.warn("Moyasar webhook rejected: missing payment identifiers", logContext);
    return errorResponse(res, 400, "INVALID", "Missing payment identifiers" );
  }

  try {
    if (isMoyasarRefundEvent(eventType, data)) {
      try {
        const refundResult = await recordMoyasarRefundWebhookFn({
          payload,
          data,
          startSession: startSessionFn,
        });
        logger.info("Moyasar refund webhook processed", {
          ...logContext,
          alreadyProcessed: Boolean(refundResult && refundResult.alreadyProcessed),
          staleSnapshot: Boolean(refundResult && refundResult.staleSnapshot),
        });
        return res.status(200).json({
          status: true,
          alreadyProcessed: Boolean(refundResult && refundResult.alreadyProcessed),
        });
      } catch (err) {
        if (err && err.code && err.status) {
          logger.warn("Moyasar refund webhook rejected", {
            ...logContext,
            code: err.code,
            error: err.message,
          });
          return errorResponse(res, err.status, err.code, err.message);
        }
        throw err;
      }
    }

    let orderWebhookResult;
    try {
      orderWebhookResult = await applyOrderWebhookInvoiceFn({ providerInvoice: data, eventType });
    } catch (err) {
      if (err && err.code && err.status) {
        logger.warn("Moyasar order webhook rejected", {
          ...logContext,
          code: err.code,
          error: err.message,
        });
        return errorResponse(res, err.status, err.code, err.message, err.details);
      }
      throw err;
    }
    if (orderWebhookResult && orderWebhookResult.handled) {
      logger.info("Moyasar webhook processed by one-time order branch", {
        ...logContext,
        alreadyProcessed: Boolean(orderWebhookResult.alreadyProcessed),
        ignored: Boolean(orderWebhookResult.ignored),
        reason: orderWebhookResult.reason || null,
      });
      return res.status(200).json({ status: true });
    }

    const payment = await Payment.findOne({
      provider: "moyasar",
      $or: [
        paymentId ? { providerPaymentId: paymentId } : null,
        invoiceId ? { providerInvoiceId: invoiceId } : null,
      ].filter(Boolean),
    }).lean();

    if (!payment) {
      logger.warn("Moyasar webhook rejected: payment not found", logContext);
      return errorResponse(res, 404, "NOT_FOUND", "Payment not found" );
    }

    if (paymentId && payment.providerPaymentId && payment.providerPaymentId !== paymentId) {
      logger.warn("Moyasar webhook rejected: payment id mismatch", {
        ...logContext,
        expectedPaymentId: redactId(payment.providerPaymentId),
      });
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch" );
    }
    if (invoiceId && payment.providerInvoiceId && payment.providerInvoiceId !== invoiceId) {
      logger.warn("Moyasar webhook rejected: invoice id mismatch", {
        ...logContext,
        expectedInvoiceId: redactId(payment.providerInvoiceId),
      });
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch" );
    }

    if (data.amount !== undefined && Number(data.amount) !== Number(payment.amount)) {
      logger.warn("Moyasar webhook rejected: amount mismatch", {
        ...logContext,
        receivedAmount: Number(data.amount),
        expectedAmount: Number(payment.amount),
      });
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch" );
    }
    if (data.currency && String(data.currency).toUpperCase() !== String(payment.currency || "").toUpperCase()) {
      logger.warn("Moyasar webhook rejected: currency mismatch", {
        ...logContext,
        receivedCurrency: String(data.currency).toUpperCase(),
        expectedCurrency: String(payment.currency || "").toUpperCase(),
      });
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch" );
    }

    if (payment.applied === true && payment.status === "paid" && isPaid) {
      logger.info("Moyasar webhook ignored before transaction: payment already applied", {
        ...logContext,
        internalPaymentId: String(payment._id),
        paymentType: payment.type,
      });
      return res.status(200).json({ status: true });
    }

    const result = await runMongoTransactionWithRetry(async (session, { attempt }) => {
      const paymentInSession = await Payment.findById(payment._id).session(session);
      if (!paymentInSession) {
        const err = new Error("Payment not found");
        err.code = "NOT_FOUND";
        err.status = 404;
        throw err;
      }

      if (paymentId && !paymentInSession.providerPaymentId) paymentInSession.providerPaymentId = paymentId;
      if (invoiceId && !paymentInSession.providerInvoiceId) paymentInSession.providerInvoiceId = invoiceId;

      if (paymentInSession.applied === true && paymentInSession.status === "paid" && isPaid) {
        logger.info("Moyasar webhook ignored in transaction: payment already applied", {
          ...logContext,
          internalPaymentId: String(paymentInSession._id),
          paymentType: paymentInSession.type,
          attempt: attempt + 1,
        });
        return { alreadyProcessed: true };
      }

      if (!isPaid) {
        const nonPaidUpdate = {};
        if (paymentStatus) nonPaidUpdate.status = paymentStatus;
        if (paymentId && !paymentInSession.providerPaymentId) nonPaidUpdate.providerPaymentId = paymentId;
        if (invoiceId && !paymentInSession.providerInvoiceId) nonPaidUpdate.providerInvoiceId = invoiceId;
        if (Object.keys(nonPaidUpdate).length) {
          await Payment.updateOne({ _id: paymentInSession._id }, { $set: nonPaidUpdate }, { session });
        }

        const latestPayment = await Payment.findById(paymentInSession._id).session(session);
        const terminalFailureStatuses = new Set(["failed", "canceled", "expired"]);
        if (terminalFailureStatuses.has(latestPayment.status)) {
          await cleanupTerminalNonPaidDayPayment({
            payment: latestPayment,
            status: latestPayment.status,
            session,
          });
        }
        if (latestPayment.type === "subscription_activation" && terminalFailureStatuses.has(latestPayment.status)) {
          const nonPaidMetadata = latestPayment.metadata || {};
          if (nonPaidMetadata.draftId && mongoose.Types.ObjectId.isValid(nonPaidMetadata.draftId)) {
            const draft = await CheckoutDraft.findById(nonPaidMetadata.draftId).session(session);
            const canMarkNonPaid =
              draft
              && !draft.subscriptionId
              && ["pending_payment", "failed", "canceled", "expired"].includes(draft.status);
            if (canMarkNonPaid) {
              draft.status = latestPayment.status === "canceled" ? "canceled" : latestPayment.status === "expired" ? "expired" : "failed";
              draft.failedAt = new Date();
              draft.failureReason = `payment_${draft.status}`;
              await draft.save({ session });
              await releasePromoCodeUsageReservation({
                checkoutDraftId: draft._id,
                session,
                reason: `payment_${draft.status}`,
              });
            }
          }
        }
        if (latestPayment.type === "one_time_order" && terminalFailureStatuses.has(latestPayment.status)) {
          const nonPaidMetadata = latestPayment.metadata || {};
          if (nonPaidMetadata.orderId && mongoose.Types.ObjectId.isValid(String(nonPaidMetadata.orderId))) {
            const order = await Order.findById(nonPaidMetadata.orderId).session(session);
            const isCurrentAttempt = order && (!order.paymentId || String(order.paymentId) === String(latestPayment._id));
            if (order && isCurrentAttempt) {
              order.paymentStatus = latestPayment.status;
              order.paymentId = latestPayment._id;
              if (latestPayment.providerInvoiceId) order.providerInvoiceId = latestPayment.providerInvoiceId;
              if (latestPayment.providerPaymentId) order.providerPaymentId = latestPayment.providerPaymentId;
              if (order.status === "created") {
                order.status = "canceled";
                order.canceledAt = order.canceledAt || new Date();
              }
              await order.save({ session });
            }
          }
        }

        return {
          nonPaid: true,
          paymentId: String(latestPayment._id),
          paymentType: latestPayment.type,
          status: latestPayment.status,
        };
      }

      const metadata = paymentInSession.metadata || {};
      const type = paymentInSession.type;
      let applied = false;
      let unappliedReason;
      let orderNotification = null;

      const claimUpdate = {
        applied: true,
        status: "paid",
        paidAt: paymentInSession.paidAt || new Date(),
      };
      if (paymentId && !paymentInSession.providerPaymentId) {
        claimUpdate.providerPaymentId = paymentId;
      }
      if (invoiceId && !paymentInSession.providerInvoiceId) {
        claimUpdate.providerInvoiceId = invoiceId;
      }

      const claim = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: claimUpdate },
        { new: true, session }
      );
      if (!claim) {
        logger.info("Moyasar webhook ignored: already claimed by another request", {
          ...logContext,
          internalPaymentId: String(paymentInSession._id),
          paymentType: paymentInSession.type,
          attempt: attempt + 1,
        });
        return { alreadyProcessed: true };
      }

      const useSharedDispatcher =
        supportedSharedPaymentTypes.has(String(type || ""))
        && (
          isSharedPaymentDispatcherEnabledFn()
          || String(type || "") === "premium_overage_day"
          || String(type || "") === "premium_extra_day"
          || String(type || "") === "one_time_addon_day_planning"
        );

      if (useSharedDispatcher) {
        const sharedResult = await applyPaymentSideEffectsFn({
          payment: claim,
          session,
          source: "webhook",
        });
        applied = Boolean(sharedResult && sharedResult.applied);
        unappliedReason = applied ? undefined : sharedResult.reason;
      } else if (type === "one_time_addon") {
        if (metadata.subscriptionId && metadata.addonId && metadata.date) {
          const updatedDay = await SubscriptionDay.findOneAndUpdate(
            { subscriptionId: metadata.subscriptionId, date: metadata.date, status: "open" },
            { $addToSet: { addonsOneTime: metadata.addonId } },
            { new: true, session }
        );
        if (updatedDay) {
          applied = true;
            await writeLogFn({
              entityType: "subscription_day",
              entityId: updatedDay._id,
              action: "one_time_addon_webhook",
            byRole: "system",
              meta: { addonId: metadata.addonId, date: metadata.date, paymentId },
          });
        } else {
          const dayCheck = await SubscriptionDay.findOne(
            { subscriptionId: metadata.subscriptionId, date: metadata.date },
            { status: 1 }
          ).session(session).lean();
          if (!dayCheck) {
            unappliedReason = "day_not_found";
          } else {
            unappliedReason = `day_not_open:${dayCheck.status}`;
          }
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else if (type === "custom_salad_day") {
      const snapshot = metadata.snapshot;
      if (metadata.subscriptionId && metadata.date && snapshot) {
        const existingDay = await SubscriptionDay.findOne(
          { subscriptionId: metadata.subscriptionId, date: metadata.date }
        ).session(session);

        let updatedDay;
        if (!existingDay) {
          const createdDay = await SubscriptionDay.create(
            [
              {
                subscriptionId: metadata.subscriptionId,
                date: metadata.date,
                status: "open",
                customSalads: [snapshot],
              },
            ],
            { session }
          );
          updatedDay = createdDay[0];
        } else if (existingDay.status === "open") {
          existingDay.customSalads = existingDay.customSalads || [];
          existingDay.customSalads.push(snapshot);
          await existingDay.save({ session });
          updatedDay = existingDay;
        } else {
          unappliedReason = `day_not_open:${existingDay.status}`;
        }

        if (updatedDay) {
          applied = true;
          await writeLogFn({
            entityType: "subscription_day",
            entityId: updatedDay._id,
            action: "custom_salad_day_webhook",
            byRole: "system",
            meta: { date: metadata.date, paymentId },
          });
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else if (type === "custom_meal_day") {
      const snapshot = metadata.snapshot;
      if (metadata.subscriptionId && metadata.date && snapshot) {
        const existingDay = await SubscriptionDay.findOne(
          { subscriptionId: metadata.subscriptionId, date: metadata.date }
        ).session(session);

        let updatedDay;
        if (!existingDay) {
          const createdDay = await SubscriptionDay.create(
            [
              {
                subscriptionId: metadata.subscriptionId,
                date: metadata.date,
                status: "open",
                customMeals: [snapshot],
              },
            ],
            { session }
          );
          updatedDay = createdDay[0];
        } else if (existingDay.status === "open") {
          existingDay.customMeals = existingDay.customMeals || [];
          existingDay.customMeals.push(snapshot);
          await existingDay.save({ session });
          updatedDay = existingDay;
        } else {
          unappliedReason = `day_not_open:${existingDay.status}`;
        }

        if (updatedDay) {
          applied = true;
          await writeLogFn({
            entityType: "subscription_day",
            entityId: updatedDay._id,
            action: "custom_meal_day_webhook",
            byRole: "system",
            meta: { date: metadata.date, paymentId },
          });
        }
      } else {
        unappliedReason = "invalid_metadata";
      }
    } else {
      unappliedReason = "unsupported_payment_type";
    }

      if (!applied) {
        if (unappliedReason) {
          const mergedMetadata = Object.assign({}, claim.metadata || {}, { unappliedReason });
          await Payment.updateOne(
            { _id: claim._id },
          { $set: { applied: false, status: "paid", metadata: mergedMetadata } },
          { session }
        );
        await writeLogFn({
          entityType: "payment",
          entityId: claim._id,
          action: "payment_unapplied",
          byRole: "system",
          meta: { reason: unappliedReason, paymentId },
        });
      } else {
        await Payment.updateOne({ _id: claim._id }, { $set: { applied: true } }, { session });
      }

        return {
          applied,
          unappliedReason: unappliedReason || null,
          internalPaymentId: String(claim._id),
          paymentType: claim.type,
          orderNotification,
        };
      }

      return {
        applied,
        unappliedReason: null,
        internalPaymentId: String(claim._id),
        paymentType: claim.type,
        orderNotification,
      };
    }, {
      label: "moyasar_webhook",
      context: {
        paymentId: redactId(paymentId),
        invoiceId: redactId(invoiceId),
        eventType: eventType || null,
        source: "webhook",
      },
    });

    if (result && result.nonPaid) {
      logger.info("Moyasar webhook processed: non-paid status", {
        ...logContext,
        internalPaymentId: result.paymentId,
        paymentType: result.paymentType,
        status: result.status,
      });
      return res.status(200).json({ status: true, message: "Ignored non-paid status" });
    }

    if (result && result.orderNotification) {
      await notifyOrderUserFn({
        order: { _id: result.orderNotification.orderId, userId: result.orderNotification.userId },
        type: "paid",
        paymentId: result.orderNotification.paymentId,
      });
    }

    logger.info("Moyasar webhook processed", {
      ...logContext,
      internalPaymentId: result && result.internalPaymentId ? result.internalPaymentId : String(payment._id),
      paymentType: result && result.paymentType ? result.paymentType : payment.type,
      applied: result && Object.prototype.hasOwnProperty.call(result, "applied") ? result.applied : true,
      unappliedReason: result && result.unappliedReason ? result.unappliedReason : null,
    });
    return res.status(200).json({ status: true });
  } catch (err) {
    logger.error("webhookController.handleMoyasarWebhook failed", {
      error: err.message,
      stack: err.stack,
      ...logContext,
    });
    return errorResponse(res, 500, "INTERNAL", "Webhook processing failed");
  }
}

module.exports = { handleMoyasarWebhook };
